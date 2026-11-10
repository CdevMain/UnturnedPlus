// ============================================================
// queryEngine.js — motor de consulta de servidores
//
// Estratégia (robustez em primeiro lugar):
//   1) gamedig com type "unturned" — biblioteca testada que conhece
//      as particularidades do Unturned (portas, EDF do A2S, rules
//      grandes comprimidas em bzip2 que a implementação "na mão"
//      recusa). É o motor PRIMÁRIO quando estiver instalado.
//   2) A2S próprio (queryPort.js) — implementação sem dependências,
//      com sonda multi-porta, usada como FALLBACK. Assim o app
//      funciona mesmo sem `npm install` do gamedig.
//
// Os dois caminhos devolvem SEMPRE o mesmo formato:
//   { info, players, unturned, resolvedQueryPort, engine }
// ============================================================
const queryPort = require('./queryPort');
const unturnedRules = require('./unturnedRules');

// Carrega o gamedig se estiver disponível (compatível com v3 e v4).
let GameDig = null;
try {
  const mod = require('gamedig');
  GameDig = mod && mod.GameDig ? mod.GameDig : mod;
  if (!GameDig || typeof GameDig.query !== 'function') GameDig = null;
} catch { GameDig = null; }

function hasGamedig() { return !!GameDig; }

function minimalUnturned(info) {
  return {
    fields: { map: (info && info.map) || null },
    mods: [], modCount: 0, airdropSeconds: null, iconUrl: null,
    raw: {}, rawCount: 0
  };
}

// Converte o estado retornado pelo gamedig para o nosso formato.
function normalizeGamedig(state) {
  const players = Array.isArray(state.players)
    ? state.players
        .filter((p) => p && p.name != null)
        .map((p) => ({
          name: String(p.name),
          score: p.score ?? p.raw?.score ?? null,
          duration: p.time ?? p.raw?.time ?? null
        }))
    : [];
  const numPlayers = (typeof state.numplayers === 'number')
    ? state.numplayers
    : (Array.isArray(state.players) ? state.players.length : 0);

  const info = {
    name: state.name ?? null,
    map: state.map ?? null,
    players: numPlayers,
    maxPlayers: state.maxplayers ?? null,
    bots: state.bots ?? 0,
    folder: state.raw?.folder ?? null,
    game: state.raw?.game ?? null,
    version: state.raw?.version ?? state.version ?? null,
    vac: state.raw?.secure ?? null,
    password: state.password ?? null
  };

  // gamedig pode expor as rules cruas em state.raw.rules — reaproveitamos
  // toda a nossa heurística (mods, ícone, airdrop, descrição fragmentada).
  const rawRules = (state.raw && typeof state.raw.rules === 'object' && state.raw.rules)
    ? state.raw.rules : null;
  const unturned = rawRules ? unturnedRules.interpret(rawRules, info) : minimalUnturned(info);
  return { info, players, unturned };
}

// Tenta o gamedig nas portas candidatas; devolve o 1º sucesso normalizado.
async function viaGamedig(ip, candidates, opts = {}) {
  if (!GameDig) return null;
  const t = opts.timeoutMs || 3000;
  for (const port of candidates) {
    try {
      const state = await GameDig.query({
        type: 'unturned', host: ip, port,
        socketTimeout: t, attemptTimeout: t * 2, maxAttempts: 1
      });
      const norm = normalizeGamedig(state);
      return { ...norm, resolvedQueryPort: port, engine: 'gamedig' };
    } catch { /* tenta a próxima porta candidata */ }
  }
  return null;
}

// Enriquecimento: se o motor não trouxe as rules (mods/ícone/airdrop),
// tenta buscá-las via A2S_RULES próprio nas portas candidatas.
async function enrichRules(ip, candidates, current, opts) {
  if (current.unturned && current.unturned.rawCount > 0) return current;
  for (const p of candidates) {
    try {
      const rules = await queryPort.queryRules(ip, p, opts);
      if (rules && Object.keys(rules).length) {
        current.unturned = unturnedRules.interpret(rules, current.info);
        current.resolvedQueryPort = p;
        break;
      }
    } catch { /* segue tentando */ }
  }
  return current;
}

// Consulta completa e resiliente. Recebe a porta de JOGO e, opcionalmente,
// uma porta de query explícita; descobre sozinho qual porta responde.
async function queryResolved(ip, gamePort, queryPortOverride, opts = {}) {
  if (!ip) throw new Error('Informe um IP válido.');
  const candidates = queryPort.candidatePorts(gamePort, queryPortOverride);
  if (!candidates.length) throw new Error('Informe uma porta válida.');

  // 1) gamedig primeiro (se instalado)
  const gd = await viaGamedig(ip, candidates, opts);
  if (gd) return await enrichRules(ip, candidates, gd, opts);

  // 2) fallback: nosso A2S multi-porta (testado, zero-dependência)
  const { port, info } = await queryPort.probeInfo(ip, candidates, opts);
  let players = [];
  try { players = await queryPort.queryPlayers(ip, port, opts); } catch { players = []; }
  let rules = null;
  try { rules = await queryPort.queryRules(ip, port, opts); } catch { rules = null; }
  const unturned = rules ? unturnedRules.interpret(rules, info) : minimalUnturned(info);
  return { info, players, unturned, resolvedQueryPort: port, engine: 'a2s' };
}

module.exports = { queryResolved, hasGamedig, _internals: { normalizeGamedig, viaGamedig } };
