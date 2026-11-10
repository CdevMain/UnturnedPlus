// ============================================================
// syncClient.js — A camada de rede dos grupos
//
// ESTADO: implementada por inteiro, DESLIGADA por padrão.
// Não existe servidor ainda. Este arquivo já contém o cliente que
// vai falar com ele, e — mais importante — um transporte de
// LOOPBACK que executa o caminho completo (fila de saída, envio,
// confirmação, recebimento, aplicação) sem rede nenhuma.
//
// Por que o loopback e não deixar para depois: o que quebra em
// sincronização não é o HTTP, é a lógica em volta — operação
// enviada duas vezes, confirmação perdida, item que ressuscita
// depois de apagado. Com o loopback esses casos são testáveis
// hoje, e no dia da hospedagem só se troca o transporte.
//
// ------------------------------------------------------------
// CONTRATO DO SERVIDOR (o que precisa existir para ligar)
// ------------------------------------------------------------
// Autenticação: header `Authorization: Bearer <token>`.
//
//   POST /v1/identity          { name, avatar, steamId } -> { userId, token }
//   POST /v1/groups            { name, photo, serverId } -> { group }
//   POST /v1/groups/join       { code }                  -> { group }
//   GET  /v1/groups/:id        -> { group, members }
//   POST /v1/sync              { groupId, ops[], since } -> { acked[], ops[], cursor }
//   GET  /v1/uploads/:id       -> bytes do print
//   POST /v1/uploads           multipart                 -> { id, url }
//   WS   /v1/live?group=<id>   eventos { type:'ops', ops:[...] }
//
// `POST /v1/sync` é o coração e é IDEMPOTENTE: reenviar a mesma
// operação (mesmo `opId`) não pode duplicar nada. É isso que
// permite reenviar sem medo quando a conexão cai no meio.
//
// `since`/`cursor` fazem a paginação do que chegou. O cliente
// guarda o cursor por grupo e nunca pede o histórico inteiro duas
// vezes.
// ============================================================

const EventEmitter = require('events');

const DEFAULTS = {
  enabled: false,          // desligado até existir servidor
  baseUrl: '',             // ex.: https://api.unturnedplus.app
  token: '',
  transport: 'http',       // 'http' | 'loopback'
  intervalMs: 5000,        // ritmo do envio quando não há WebSocket
  positionMs: 15000        // ritmo do envio de posição
};

class SyncClient extends EventEmitter {
  constructor(store, opts = {}) {
    super();
    this.store = store;
    this.opts = { ...DEFAULTS, ...opts };
    this.timer = null;
    this.cursors = {};       // groupId -> cursor
    this.running = false;
    this.lastError = null;
    this.stats = { sent: 0, received: 0, rounds: 0, failures: 0 };
    // Transporte de loopback: um "servidor" em memória. Serve para
    // testar o ciclo completo e para o modo demonstração.
    this.loop = { ops: [], seq: 0 };
  }

  configure(patch = {}) {
    const antes = this.opts.enabled;
    this.opts = { ...this.opts, ...patch };
    if (antes && !this.opts.enabled) this.stop();
    if (!antes && this.opts.enabled) this.start();
    return this.status();
  }

  status() {
    return {
      enabled: !!this.opts.enabled,
      running: this.running,
      transport: this.opts.transport,
      baseUrl: this.opts.baseUrl,
      hasToken: !!this.opts.token,
      pending: this.store.pendingOps(9999).length,
      lastError: this.lastError,
      stats: { ...this.stats }
    };
  }

  start() {
    if (!this.opts.enabled || this.running) return this.status();
    // Sem endereço não há o que iniciar; dizer "conectando" seria
    // mentira na tela.
    if (this.opts.transport === 'http' && !this.opts.baseUrl) {
      this.lastError = 'no_base_url';
      return this.status();
    }
    this.running = true;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.opts.intervalMs);
    this.emit('status', this.status());
    return this.status();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit('status', this.status());
    return this.status();
  }

  // Uma rodada: manda o que está na fila, recebe o que há de novo.
  async tick() {
    if (!this.running) return { skipped: true };
    const grupos = this.store.listGroups();
    if (!grupos.length) return { skipped: true };

    this.stats.rounds += 1;
    let enviadas = 0, recebidas = 0;

    for (const g of grupos) {
      const ops = this.store.pendingOps(200)
        .filter((o) => this._opDoGrupo(o, g.id));
      let resposta;
      try {
        resposta = await this._sync(g.id, ops, this.cursors[g.id] || 0);
      } catch (e) {
        this.stats.failures += 1;
        this.lastError = e.message;
        this.emit('status', this.status());
        continue;
      }
      this.lastError = null;

      // Confirmação ANTES de aplicar o que chegou: se o processo
      // morrer entre as duas coisas, o pior caso é reenviar (que é
      // inofensivo, porque /sync é idempotente). Na ordem inversa o
      // pior caso seria PERDER uma operação nossa para sempre.
      if (resposta.acked && resposta.acked.length) {
        this.store.ackOps(resposta.acked);
        enviadas += resposta.acked.length;
      }
      if (resposta.ops && resposta.ops.length) {
        const r = this.store.applyRemote(resposta.ops);
        recebidas += r.applied;
      }
      if (resposta.cursor !== undefined) this.cursors[g.id] = resposta.cursor;
    }

    this.stats.sent += enviadas;
    this.stats.received += recebidas;
    if (enviadas || recebidas) this.emit('changed', { sent: enviadas, received: recebidas });
    return { sent: enviadas, received: recebidas };
  }

  // Uma operação pertence ao grupo se o payload disser isso. As
  // que não têm grupo (identidade) sobem em qualquer rodada.
  _opDoGrupo(op, groupId) {
    const p = op.payload || {};
    const g = p.groupId || (p.id && String(p.id).startsWith('g_') ? p.id : null);
    return !g || g === groupId;
  }

  async _sync(groupId, ops, since) {
    if (this.opts.transport === 'loopback') return this._syncLoopback(groupId, ops, since);
    return this._syncHttp(groupId, ops, since);
  }

  // ---------- transporte real ----------
  async _syncHttp(groupId, ops, since) {
    const url = this.opts.baseUrl.replace(/\/$/, '') + '/v1/sync';
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.opts.token
        },
        body: JSON.stringify({ groupId, ops, since }),
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error('http_' + r.status);
      return await r.json();
    } finally {
      clearTimeout(prazo);
    }
  }

  // ---------- loopback ----------
  // Guarda as operações numa lista e devolve tudo que veio DEPOIS
  // do cursor e que NÃO é nosso — que é exatamente o que um
  // servidor de verdade faria.
  async _syncLoopback(groupId, ops, since) {
    const eu = this.store.me();
    const acked = [];
    for (const op of ops) {
      if (this.loop.ops.some((o) => o.opId === op.opId)) { acked.push(op.opId); continue; }
      this.loop.seq += 1;
      this.loop.ops.push({ ...op, seq: this.loop.seq, groupId });
      acked.push(op.opId);
    }
    const novas = this.loop.ops
      .filter((o) => o.seq > (since || 0))
      .filter((o) => o.groupId === groupId)
      .filter((o) => !eu || o.authorId !== eu.userId);
    const cursor = this.loop.ops.length ? this.loop.ops[this.loop.ops.length - 1].seq : (since || 0);
    return { acked, ops: novas, cursor };
  }

  // Injeta operações "de outro jogador" no loopback. É assim que a
  // tela de teste demonstra o grupo funcionando sem servidor.
  injectRemote(groupId, ops = []) {
    for (const op of ops) {
      this.loop.seq += 1;
      this.loop.ops.push({ ...op, seq: this.loop.seq, groupId });
    }
    return this.loop.ops.length;
  }

  async syncNow() {
    const eraRunning = this.running;
    this.running = true;
    const r = await this.tick();
    this.running = eraRunning;
    return r;
  }
}

module.exports = { SyncClient, DEFAULTS };
