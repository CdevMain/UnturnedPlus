// ============================================================
// queryPort.js — Consulta LOCAL ao servidor via protocolo
// A2S / Source Engine Query (UDP), sem depender de terceiros.
//
// É o MESMO protocolo público que o BattleMetrics, o server
// browser do Steam e o próprio jogo usam para descobrir nome,
// mapa, jogadores, MODS e a configuração pública do servidor.
// Não requer chave/token — é um recurso público exposto pelo
// próprio servidor no seu "Query Port".
//
// Cobre as três consultas do protocolo:
//   • A2S_INFO   (0x54 'T')  -> nome, mapa, jogadores, versão...
//   • A2S_PLAYER (0x55 'U')  -> lista de jogadores online
//   • A2S_RULES  (0x56 'V')  -> TODAS as "rules" públicas do
//                               servidor (é aqui que o Unturned
//                               publica mapa detalhado, mods do
//                               Workshop, descrição, RocketMod,
//                               e diversos valores de config).
//
// Inclui suporte a:
//   • Handshake de "challenge" (obrigatório em servidores novos).
//   • Respostas fragmentadas em múltiplos pacotes UDP
//     (cabeçalho 0xFFFFFFFE) — o A2S_RULES do Unturned quase
//     sempre vem picotado em vários pacotes.
// ============================================================
const dgram = require('dgram');

const HEADER_SINGLE = -1; // 0xFFFFFFFF
const HEADER_MULTI  = -2; // 0xFFFFFFFE
const A2S_INFO_PAYLOAD = Buffer.from('Source Engine Query\0', 'latin1');

// Opcodes de resposta
const R_CHALLENGE = 0x41; // 'A'
const R_INFO      = 0x49; // 'I'
const R_PLAYER    = 0x44; // 'D'
const R_RULES     = 0x45; // 'E'

// ------------------------------------------------------------
// Montagem das requisições
// ------------------------------------------------------------
function buildInfoRequest(challenge) {
  const parts = [
    Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x54]), // header + 'T'
    A2S_INFO_PAYLOAD
  ];
  if (challenge) parts.push(challenge);
  return Buffer.concat(parts);
}

function buildPlayerRequest(challenge) {
  return Buffer.concat([
    Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55]), // header + 'U'
    challenge || Buffer.from([0xFF, 0xFF, 0xFF, 0xFF])
  ]);
}

function buildRulesRequest(challenge) {
  return Buffer.concat([
    Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x56]), // header + 'V'
    challenge || Buffer.from([0xFF, 0xFF, 0xFF, 0xFF])
  ]);
}

// ------------------------------------------------------------
// Leitor sequencial de buffer (little-endian, strings C)
// ------------------------------------------------------------
class Cursor {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  u8() { return this.buf.readUInt8(this.pos++); }
  i32() { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  u32() { const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  f32() { const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  cstr() {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0x00) this.pos++;
    const str = this.buf.toString('utf-8', start, this.pos);
    this.pos++; // pula o \0
    return str;
  }
  remaining() { return this.buf.length - this.pos; }
}

// ------------------------------------------------------------
// transact() — envia UMA requisição e devolve a resposta já
// REMONTADA (concatenando fragmentos se vier em multi-pacote).
//
// O buffer devolvido começa no BYTE DE TIPO da resposta (o
// cabeçalho 0xFFFFFFFF de pacote único já é removido), então o
// chamador lê resp[0] para saber o opcode (0x41/0x49/0x44/0x45).
// ------------------------------------------------------------
function transact(ip, port, requestBuf, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let done = false;

    // Estado de remontagem de multi-pacote
    const fragments = new Map(); // number -> Buffer(payload)
    let expectedTotal = null;
    let isCompressed = false;

    const finish = (err, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* já fechado */ }
      err ? reject(err) : resolve(res);
    };

    const timer = setTimeout(
      () => finish(new Error('Timeout ao consultar o Query Port (servidor não respondeu).')),
      timeoutMs
    );

    socket.once('error', (err) => finish(err));

    socket.on('message', (msg) => {
      try {
        if (msg.length < 5) return; // ruído
        const head = msg.readInt32LE(0);

        // ---- Pacote único ----
        if (head === HEADER_SINGLE) {
          finish(null, msg.subarray(4)); // devolve a partir do byte de tipo
          return;
        }

        // ---- Pacote fragmentado (Source multi-packet) ----
        if (head === HEADER_MULTI) {
          const c = new Cursor(msg);
          c.i32();                       // header 0xFFFFFFFE
          const id = c.u32();            // ID da resposta (bit 31 = comprimido)
          isCompressed = (id & 0x80000000) !== 0;
          const total = c.u8();          // total de pacotes
          const number = c.u8();         // índice deste pacote (0-based)
          c.u16();                       // tamanho máx. do pacote (presente no Unturned)
          if (number === 0 && isCompressed) {
            c.u32(); // tamanho descomprimido
            c.u32(); // crc32
          }
          fragments.set(number, msg.subarray(c.pos));
          expectedTotal = total;

          if (fragments.size === expectedTotal) {
            const ordered = [];
            for (let i = 0; i < expectedTotal; i++) {
              if (!fragments.has(i)) return; // ainda faltam pacotes
              ordered.push(fragments.get(i));
            }
            let full = Buffer.concat(ordered);
            if (isCompressed) {
              return finish(new Error(
                'O servidor respondeu comprimido (bzip2), formato antigo não suportado por este app.'
              ));
            }
            // O buffer remontado começa com 0xFFFFFFFF + tipo; remove o header.
            if (full.length >= 4 && full.readInt32LE(0) === HEADER_SINGLE) {
              full = full.subarray(4);
            }
            finish(null, full);
          }
          return;
        }

        finish(new Error(`Cabeçalho de resposta desconhecido (0x${(head >>> 0).toString(16)}).`));
      } catch (e) {
        finish(e);
      }
    });

    socket.send(requestBuf, port, ip, (err) => { if (err) finish(err); });
  });
}

// Executa a transação lidando com o handshake de challenge:
// se a 1ª resposta for 0x41 ('A'), reenvia a requisição com o
// challenge de 4 bytes e devolve a 2ª resposta.
async function transactWithChallenge(ip, port, buildReq, expectedType, opts) {
  let resp = await transact(ip, port, buildReq(null), opts);
  let type = resp.readUInt8(0);

  if (type === R_CHALLENGE) {
    const challenge = resp.subarray(1, 5);
    resp = await transact(ip, port, buildReq(challenge), opts);
    type = resp.readUInt8(0);
  }

  if (type !== expectedType) {
    throw new Error(`Resposta inesperada do servidor (opcode 0x${type.toString(16)}).`);
  }
  return resp;
}

// ------------------------------------------------------------
// A2S_INFO — nome, mapa, jogadores, modo, versão, etc.
// ------------------------------------------------------------
async function queryInfo(ip, port, opts = {}) {
  const resp = await transactWithChallenge(ip, port, buildInfoRequest, R_INFO, opts);
  const c = new Cursor(resp);
  c.u8(); // tipo 0x49
  return parseInfo(c);
}

function parseInfo(c) {
  const protocol = c.u8();
  const name = c.cstr();
  const map = c.cstr();
  const folder = c.cstr();
  const game = c.cstr();
  const appId = c.u16();
  const players = c.u8();
  const maxPlayers = c.u8();
  const bots = c.u8();
  const serverType = String.fromCharCode(c.u8());   // 'd' dedicated, 'l' listen, 'p' proxy/SourceTV
  const environment = String.fromCharCode(c.u8());  // 'l' linux, 'w' windows, 'm'/'o' mac
  const visibility = c.u8();                         // 0 público, 1 privado
  const vac = c.u8();                                // 0/1

  let version = null;
  try { version = c.cstr(); } catch { /* alguns servidores omitem */ }

  return {
    protocol, name, map, folder, game, appId,
    players, maxPlayers, bots,
    serverType, environment,
    private: visibility === 1,
    vacSecured: vac === 1,
    version,
    queriedAt: new Date().toISOString()
  };
}

// ------------------------------------------------------------
// A2S_PLAYER — lista de jogadores online (nome, tempo conectado)
// ------------------------------------------------------------
async function queryPlayers(ip, port, opts = {}) {
  const resp = await transactWithChallenge(ip, port, buildPlayerRequest, R_PLAYER, opts);
  const c = new Cursor(resp);
  c.u8(); // tipo 0x44
  return parsePlayers(c);
}

function parsePlayers(c) {
  const count = c.u8();
  const players = [];
  for (let i = 0; i < count && c.remaining() > 0; i++) {
    c.u8(); // índice (sempre 0 na prática, ignorado)
    const name = c.cstr();
    const score = c.i32();
    const duration = c.f32(); // segundos conectado
    players.push({ name, score, secondsConnected: Math.max(0, Math.round(duration)) });
  }
  return players;
}

// ------------------------------------------------------------
// A2S_RULES — TODAS as "rules" públicas do servidor.
// No Unturned é aqui que ficam: mapa detalhado, mods do Workshop,
// descrição do browser, versão do RocketMod/plugins, e muitos
// valores de configuração. Devolve um objeto { chave: valor }
// com TUDO que o servidor publicou (sem interpretar).
// ------------------------------------------------------------
async function queryRules(ip, port, opts = {}) {
  const resp = await transactWithChallenge(ip, port, buildRulesRequest, R_RULES, opts);
  const c = new Cursor(resp);
  c.u8(); // tipo 0x45
  return parseRules(c);
}

function parseRules(c) {
  const count = c.u16();
  const rules = {};
  for (let i = 0; i < count && c.remaining() > 0; i++) {
    const key = c.cstr();
    const value = c.cstr();
    rules[key] = value;
  }
  // Anexa metadados úteis (não são "rules" do servidor, mas ajudam o consumidor)
  Object.defineProperty(rules, '__count', { value: count, enumerable: false });
  return rules;
}

// ------------------------------------------------------------
// Consultas combinadas
// ------------------------------------------------------------

// Info + players (leve — usado no polling contínuo de todos os cards)
async function queryServer(ip, port, opts = {}) {
  const info = await queryInfo(ip, port, opts);
  let players = [];
  try {
    players = await queryPlayers(ip, port, opts);
  } catch {
    // Não fatal — alguns servidores desativam A2S_PLAYER (anti-scraping).
    players = null;
  }
  return { info, players };
}

// Consulta COMPLETA — info + players + rules (usado ao abrir o
// tracking de um servidor, para trazer mapa detalhado, mods e
// toda a configuração pública). Rules é best-effort: se o
// servidor bloquear/for lento, o resto continua funcionando.
async function queryServerFull(ip, port, opts = {}) {
  const info = await queryInfo(ip, port, opts);

  let players = null;
  try { players = await queryPlayers(ip, port, opts); } catch { players = null; }

  let rules = null;
  let rulesError = null;
  try {
    rules = await queryRules(ip, port, opts);
  } catch (e) {
    rulesError = e.message;
  }

  return { info, players, rules, rulesError };
}

// ------------------------------------------------------------
// probeInfo() — descobre QUAL porta responde ao A2S.
//
// É a peça que conserta o problema clássico do Unturned: a porta
// que o jogador digita pode ser a porta de JOGO (ex: 27015) ou já
// a de QUERY (ex: 27016 — que é o que o BattleMetrics mostra), e a
// convenção de offset varia de host pra host. Em vez de "chutar
// jogo + 1" e falhar, testamos várias portas candidatas EM
// PARALELO e ficamos com a primeira que de fato responder.
//
// Recebe uma lista de portas candidatas e devolve { port, info }
// da primeira que respondeu ao A2S_INFO. Se nenhuma responder,
// rejeita com um resumo dos erros.
// ------------------------------------------------------------
function probeInfo(ip, candidatePorts, opts = {}) {
  const ports = [...new Set(
    (candidatePorts || []).filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
  )];
  if (!ports.length) {
    return Promise.reject(new Error('Nenhuma porta de consulta candidata válida.'));
  }
  return new Promise((resolve, reject) => {
    let pending = ports.length;
    let settled = false;
    const errors = [];
    for (const port of ports) {
      queryInfo(ip, port, opts).then(
        (info) => { if (!settled) { settled = true; resolve({ port, info }); } },
        (e) => {
          errors.push(`porta ${port}: ${e.message}`);
          if (--pending === 0 && !settled) {
            reject(new Error(`Nenhuma porta de consulta respondeu (${errors.join(' | ')}).`));
          }
        }
      );
    }
  });
}

// Gera a lista de portas candidatas a partir da porta digitada e de
// uma eventual porta de query explícita informada pelo usuário.
// Ordem = mais provável primeiro (Unturned: query = jogo + 1).
function candidatePorts(port, queryPortOverride) {
  const list = [];
  if (queryPortOverride) list.push(Number(queryPortOverride));
  if (port) {
    const p = Number(port);
    list.push(p + 1, p, p - 1);
  }
  return list;
}

module.exports = {
  queryInfo, queryPlayers, queryRules,
  queryServer, queryServerFull,
  probeInfo, candidatePorts,
  // exportados para testes
  _internals: { Cursor, parseInfo, parsePlayers, parseRules, buildRulesRequest, transact }
};
