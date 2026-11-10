// ============================================================
// wsClient.js — cliente WebSocket (RFC 6455) sem dependência
//
// O Electron 28 roda Node 18, que ainda não tem `WebSocket` global
// estável; e o pacote `ws` traria uma dependência nativa opcional
// para dentro do instalador. O que o app precisa é pequeno:
// conectar em wss://, mandar texto, receber texto, responder ping.
//
// ------------------------------------------------------------
// O QUE NÃO DÁ PARA ERRAR AQUI
// ------------------------------------------------------------
// • Frame do CLIENTE é sempre MASCARADO. Servidor que segue a RFC
//   derruba a conexão se vier sem máscara — e o nosso derruba.
// • A máscara tem que ser aleatória de verdade (crypto), não
//   Math.random: o ponto dela é justamente impedir que um proxy no
//   meio veja padrão repetido no tráfego.
// • O tamanho é conferido antes de alocar.
// • Resposta ao PING do servidor é obrigatória — sem PONG, o
//   servidor considera a conexão morta em ~70s e desconecta.
// ============================================================

'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');
const { EventEmitter } = require('events');

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const GUID = '258EAFA5-E914-47DA-95CA-5AB0DC85B11F';
const MAX_MSG = 1024 * 1024;   // 1 MB: o servidor manda histórico, não arquivo

class WebSocket extends EventEmitter {
  constructor(url, { timeoutMs = 15000 } = {}) {
    super();
    this.url = url;
    this.pronto = false;
    this.fechado = false;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.fragOp = null;
    this._conectar(timeoutMs);
  }

  _conectar(timeoutMs) {
    let u;
    try { u = new URL(this.url); } catch { return this._morrer(new Error('url_invalida')); }

    const seguro = u.protocol === 'wss:';
    const porta = u.port || (seguro ? 443 : 80);
    const chave = crypto.randomBytes(16).toString('base64');
    this.chaveEsperada = crypto.createHash('sha1').update(chave + GUID).digest('base64');

    const opcoes = { host: u.hostname, port: porta, servername: u.hostname };
    this.sock = seguro ? tls.connect(opcoes) : net.connect(opcoes);
    this.sock.setNoDelay(true);

    const relogio = setTimeout(() => this._morrer(new Error('timeout_handshake')), timeoutMs);

    this.sock.on(seguro ? 'secureConnect' : 'connect', () => {
      const caminho = (u.pathname || '/') + (u.search || '');
      this.sock.write(
        `GET ${caminho} HTTP/1.1\r\n` +
        `Host: ${u.hostname}${u.port ? ':' + u.port : ''}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${chave}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n');
    });

    let cabecalhoLido = false;
    this.sock.on('data', (d) => {
      if (!cabecalhoLido) {
        this.buf = Buffer.concat([this.buf, d]);
        const fim = this.buf.indexOf('\r\n\r\n');
        if (fim < 0) {
          // Cabeçalho gigante = servidor errado ou ataque.
          if (this.buf.length > 16384) this._morrer(new Error('handshake_grande'));
          return;
        }
        const cab = this.buf.subarray(0, fim).toString('latin1');
        const resto = this.buf.subarray(fim + 4);
        this.buf = Buffer.alloc(0);
        cabecalhoLido = true;
        clearTimeout(relogio);

        if (!/^HTTP\/1\.1 101/i.test(cab)) {
          return this._morrer(new Error('handshake_' + (cab.split(' ')[1] || 'falhou')));
        }
        // Conferir o Accept é o que prova que falamos com um
        // servidor WebSocket e não com um proxy que devolveu 101
        // por engano.
        if (!cab.includes(this.chaveEsperada)) return this._morrer(new Error('accept_invalido'));

        this.pronto = true;
        this.emit('open');
        if (resto.length) this._dados(resto);
        return;
      }
      this._dados(d);
    });

    this.sock.on('error', (e) => { this.emit('error', e); this._fim(1006); });
    this.sock.on('close', () => this._fim(this.codigoFecho || 1006));
    this.sock.on('end', () => this._fim(this.codigoFecho || 1006));
  }

  _morrer(e) {
    this.emit('error', e);
    try { this.sock && this.sock.destroy(); } catch { /* já morto */ }
    this._fim(1006);
  }

  _fim(codigo) {
    if (this.fechado) return;
    this.fechado = true;
    this.pronto = false;
    this.emit('close', codigo);
  }

  _dados(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) break;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      // O SERVIDOR nunca manda mascarado. Se vier, o outro lado não
      // é o nosso servidor.
      if (b1 & 0x80) return this._morrer(new Error('servidor_mascarou'));

      let tam = b1 & 0x7f;
      let off = 2;
      if (tam === 126) { if (this.buf.length < 4) break; tam = this.buf.readUInt16BE(2); off = 4; }
      else if (tam === 127) {
        if (this.buf.length < 10) break;
        const g = this.buf.readBigUInt64BE(2);
        if (g > BigInt(MAX_MSG)) return this._morrer(new Error('frame_grande'));
        tam = Number(g); off = 10;
      }
      if (tam > MAX_MSG) return this._morrer(new Error('frame_grande'));
      if (this.buf.length < off + tam) break;

      const payload = this.buf.subarray(off, off + tam);
      this.buf = this.buf.subarray(off + tam);

      if (op === OP.PING) { this._frame(OP.PONG, payload); continue; }
      if (op === OP.PONG) continue;
      if (op === OP.CLOSE) {
        this.codigoFecho = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        try { this._frame(OP.CLOSE, payload); } catch { /* já caiu */ }
        try { this.sock.end(); } catch { /* idem */ }
        continue;
      }

      // Fragmentação: o servidor não usa hoje, mas um proxy pode
      // reempacotar. Ignorar isso daria mensagem truncada.
      if (op === OP.CONT) {
        if (this.fragOp === null) return this._morrer(new Error('cont_orfao'));
        this.frag.push(payload);
        if (!fin) continue;
        const inteiro = Buffer.concat(this.frag);
        const o = this.fragOp;
        this.frag = []; this.fragOp = null;
        this._entregar(o, inteiro);
        continue;
      }
      if (!fin) { this.fragOp = op; this.frag = [payload]; continue; }
      this._entregar(op, payload);
    }
  }

  _entregar(op, payload) {
    if (op !== OP.TEXT) return;
    let obj;
    try { obj = JSON.parse(payload.toString('utf8')); }
    catch { return; }                 // lixo do servidor não derruba o app
    this.emit('message', obj);
  }

  _frame(op, payload) {
    if (!this.sock || this.sock.destroyed) return false;
    const d = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const mask = crypto.randomBytes(4);

    let hdr;
    if (d.length < 126) { hdr = Buffer.alloc(2); hdr[1] = 0x80 | d.length; }
    else if (d.length < 65536) { hdr = Buffer.alloc(4); hdr[1] = 0x80 | 126; hdr.writeUInt16BE(d.length, 2); }
    else { hdr = Buffer.alloc(10); hdr[1] = 0x80 | 127; hdr.writeBigUInt64BE(BigInt(d.length), 2); }
    hdr[0] = 0x80 | op;

    const m = Buffer.allocUnsafe(d.length);
    for (let i = 0; i < d.length; i++) m[i] = d[i] ^ mask[i & 3];

    try { this.sock.write(Buffer.concat([hdr, mask, m])); return true; }
    catch { return false; }
  }

  sendJson(obj) {
    if (!this.pronto) return false;
    return this._frame(OP.TEXT, JSON.stringify(obj));
  }

  close(codigo = 1000, motivo = '') {
    if (!this.sock || this.fechado) return;
    const m = Buffer.from(String(motivo).slice(0, 100), 'utf8');
    const b = Buffer.alloc(2 + m.length);
    b.writeUInt16BE(codigo, 0);
    m.copy(b, 2);
    this._frame(OP.CLOSE, b);
    setTimeout(() => { try { this.sock.destroy(); } catch { /* idem */ } }, 100);
  }
}

module.exports = { WebSocket, OP };
