// ============================================================
// netClient.js — a conexão viva com api.cdev.com.br
//
// Um WebSocket, no processo principal, que fica de pé enquanto o
// app estiver aberto. O renderer não abre socket nenhum: se
// abrisse, trocar de tela derrubaria a conexão e a presença ficaria
// piscando entre online e offline.
//
// ------------------------------------------------------------
// RECONEXÃO
// ------------------------------------------------------------
// Rede cai o tempo todo — Wi-Fi troca de canal, o jogo satura o
// link, o servidor reinicia. Reconectar imediatamente e em laço
// seria pior: mil tentativas por minuto contra uma VPS de 1 vCPU.
//
// Recuo exponencial com TETO e com ruído:
//   1s, 2s, 4s, 8s, 16s, 30s, 30s...
// O ruído (±30%) existe porque, quando o servidor reinicia, TODOS
// os apps reconectam no mesmo instante — e uma rajada sincronizada
// derruba de novo o que acabou de subir.
// ============================================================

'use strict';

const { WebSocket } = require('./wsClient');
const log = { info: (...a) => console.log('[net]', ...a), warn: (...a) => console.warn('[net]', ...a) };

const BASE_MS = 1000;
const TETO_MS = 30000;
const PING_MS = 25000;

const Net = {
  ws: null,
  estado: 'off',        // off | connecting | online | retrying
  tentativa: 0,
  timerReconexao: null,
  timerPing: null,
  onEvent: null,        // (obj) => void — repassa para o renderer
  onEstado: null,
  conta: null,          // accountStore
  fechandoDeProposito: false,
  ultimoErro: null,
  pendentes: new Map(), // ref -> {resolve, reject, timer}
  refSeq: 0
};

function configurar({ conta, onEvent, onEstado }) {
  Net.conta = conta;
  Net.onEvent = onEvent;
  Net.onEstado = onEstado;
}

function estado() {
  return { estado: Net.estado, tentativa: Net.tentativa, erro: Net.ultimoErro };
}

function avisarEstado(novo, erro = null) {
  Net.estado = novo;
  Net.ultimoErro = erro;
  if (Net.onEstado) { try { Net.onEstado(estado()); } catch { /* renderer fechou */ } }
}

function urlWs(baseUrl) {
  // https -> wss, http -> ws. O caminho é sempre /ws.
  const u = String(baseUrl || '').replace(/\/+$/, '');
  return u.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';
}

async function conectar() {
  if (Net.ws || Net.estado === 'connecting') return;
  if (!Net.conta) return;

  const info = Net.conta.publico();
  if (!info.signedIn || !info.baseUrl) { avisarEstado('off'); return; }

  // O token vai numa MENSAGEM depois de conectar, nunca na URL:
  // query string entra no log de acesso do Nginx.
  const token = await Net.conta.accessParaWs();
  if (!token) { avisarEstado('off'); return; }

  avisarEstado('connecting');
  Net.fechandoDeProposito = false;

  let ws;
  try { ws = new WebSocket(urlWs(info.baseUrl)); }
  catch (e) { return agendarReconexao(e.message); }
  Net.ws = ws;

  ws.on('open', () => { ws.sendJson({ type: 'auth', token }); });

  ws.on('message', (obj) => {
    if (obj.type === 'auth_ok') {
      Net.tentativa = 0;                 // reconectou: zera o recuo
      avisarEstado('online');
      iniciarPing();
      return;
    }
    // Resposta de algo que pedimos: casa pelo `ref`.
    if (obj.ref && Net.pendentes.has(obj.ref)) {
      const p = Net.pendentes.get(obj.ref);
      Net.pendentes.delete(obj.ref);
      clearTimeout(p.timer);
      obj.type === 'error' ? p.resolve({ ok: false, error: obj.error }) : p.resolve({ ok: true, data: obj });
      return;
    }
    if (Net.onEvent) { try { Net.onEvent(obj); } catch { /* renderer fechou */ } }
  });

  ws.on('close', (codigo) => {
    pararPing();
    Net.ws = null;
    for (const [, p] of Net.pendentes) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'disconnected' }); }
    Net.pendentes.clear();

    if (Net.fechandoDeProposito) { avisarEstado('off'); return; }
    // 4003 = token recusado. Reconectar com o MESMO token daria o
    // mesmo resultado para sempre; renovar primeiro é o caminho.
    if (codigo === 4003) {
      Net.conta.renovar(true).then((r) => {
        r.ok ? agendarReconexao('token_renovado') : avisarEstado('off', 'session_expired');
      });
      return;
    }
    agendarReconexao('close_' + codigo);
  });

  ws.on('error', (e) => { /* o close vem logo atrás e trata */ Net.ultimoErro = e.message; });
}

function agendarReconexao(motivo) {
  if (Net.timerReconexao) return;
  Net.tentativa += 1;
  const base = Math.min(TETO_MS, BASE_MS * Math.pow(2, Net.tentativa - 1));
  // ±30% de ruído: sem isso, todos os apps voltam no mesmo segundo
  // depois de um restart do servidor e derrubam ele de novo.
  const espera = Math.round(base * (0.7 + Math.random() * 0.6));
  avisarEstado('retrying', motivo);
  Net.timerReconexao = setTimeout(() => {
    Net.timerReconexao = null;
    conectar().catch(() => agendarReconexao('erro_conectar'));
  }, espera);
  if (Net.timerReconexao.unref) Net.timerReconexao.unref();
}

function iniciarPing() {
  pararPing();
  // Ping de aplicação: alguns proxies respondem ao ping do próprio
  // WebSocket sozinhos, e aí o app acha que a ponta está viva
  // quando só o proxy está.
  Net.timerPing = setInterval(() => {
    if (Net.ws) Net.ws.sendJson({ type: 'ping' });
  }, PING_MS);
  if (Net.timerPing.unref) Net.timerPing.unref();
}

function pararPing() { if (Net.timerPing) { clearInterval(Net.timerPing); Net.timerPing = null; } }

function desconectar() {
  Net.fechandoDeProposito = true;
  if (Net.timerReconexao) { clearTimeout(Net.timerReconexao); Net.timerReconexao = null; }
  pararPing();
  if (Net.ws) { try { Net.ws.close(1000, 'bye'); } catch { /* já caiu */ } Net.ws = null; }
  Net.tentativa = 0;
  avisarEstado('off');
}

// Manda e espera a resposta correspondente.
function pedir(msg, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!Net.ws || Net.estado !== 'online') return resolve({ ok: false, error: 'offline' });
    const ref = 'r' + (++Net.refSeq);
    const timer = setTimeout(() => {
      Net.pendentes.delete(ref);
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    if (timer.unref) timer.unref();
    Net.pendentes.set(ref, { resolve, timer });
    Net.ws.sendJson({ ...msg, ref });
  });
}

// Manda sem esperar resposta (typing, read).
function enviar(msg) {
  if (!Net.ws || Net.estado !== 'online') return false;
  Net.ws.sendJson(msg);
  return true;
}

module.exports = { configurar, conectar, desconectar, pedir, enviar, estado, Net };
