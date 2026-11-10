// ============================================================
// unturnedLog.js — Leitor e interpretador do log do Unturned
//
// O cliente do Unturned grava um log MUITO mais rico do que o
// simples "IP:porta" que o app usava antes. Ao conectar em um
// servidor ele publica um bloco completo:
//
//   Client connecting to 147.135.30.38:27041
//   Client connection with 4217919358 ready
//   Server name: "Xylem's Semi-RP | 10x Loot | Modded"
//   Server level name: "WashingtonX"
//   Server max players: 60
//   Server thumbnail URL: "https://i.imgur.com/V3z1y1N.png"
//   Server description: "<color=#d50808>| Modded |</color>"
//   Server specified 29 workshop item(s), querying details
//   Workshop File "City Expansion 2" (1935236838) added asset ...
//
// É daqui que sai TUDO o que o app precisa para sugerir um
// servidor ao clicar em "+", montar o card de "jogando agora"
// e listar os mods com nome (e não só o ID numérico).
//
// Este módulo é PURO em relação ao Electron: só usa fs/path, o
// que o deixa testável fora do app.
//
// Filosofia de robustez: cada padrão é reconhecido por regex
// independente. Se a Smartly Dressed Games mudar o texto de uma
// linha, só aquela informação some — nada quebra em cascata, e a
// linha continua aparecendo no visualizador de log como "outro".
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

// Quanto do fim do arquivo lemos ao abrir o app (o log de uma
// sessão longa de Unturned passa de 600 KB; 8 MB cobre com folga
// e ainda protege contra um log corrompido gigante).
const BACKFILL_BYTES = 8 * 1024 * 1024;

// ------------------------------------------------------------
// Categorias — usadas pelos filtros do visualizador de log.
// ------------------------------------------------------------
const CATEGORIES = ['connection', 'server', 'player', 'workshop', 'level', 'session', 'error', 'other'];

// ------------------------------------------------------------
// Padrões. Cada entrada: { key, cat, sev, re, map(m) -> data }
// A ORDEM importa: o primeiro que casar vence, então os padrões
// específicos vêm antes dos genéricos (erros ficam por último).
// ------------------------------------------------------------
const PATTERNS = [
  // ---------- Conexão ----------
  {
    key: 'connecting', cat: 'connection', sev: 'info',
    re: /^Client connecting to (\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/,
    map: (m) => ({ ip: m[1], port: parseInt(m[2], 10), transport: 'direct' })
  },
  {
    // Servidores por relay da Steam (SDR/P2P) não expõem IP aqui.
    key: 'connectingP2P', cat: 'connection', sev: 'info',
    re: /^Client connecting to steamid:(\d+)/,
    map: (m) => ({ steamId: m[1], transport: 'p2p' })
  },
  {
    key: 'connectionReady', cat: 'connection', sev: 'info',
    re: /^Client connection with (\d+) ready/,
    map: (m) => ({ connectionId: m[1] })
  },
  {
    key: 'transport', cat: 'connection', sev: 'info',
    re: /^Initializing ClientTransport_(\S+)/,
    map: (m) => ({ transport: m[1] })
  },
  {
    key: 'disconnecting', cat: 'connection', sev: 'warn',
    re: /^Disconnecting: (.+)$/,
    map: (m) => ({ reason: m[1] })
  },
  {
    key: 'clientDisconnect', cat: 'connection', sev: 'warn',
    re: /^Client disconnect from (\d+) result:/,
    map: (m) => ({ connectionId: m[1] })
  },
  { key: 'disconnected', cat: 'connection', sev: 'warn', re: /^Disconnected\s*$/, map: () => ({}) },
  {
    key: 'connectFailed', cat: 'connection', sev: 'error',
    re: /^(?:Failed to connect|Connection failed|Lost connection|Client connection.*(?:closed|failed)|Timed out)\b(.*)$/i,
    map: (m) => ({ detail: (m[1] || '').trim() })
  },
  {
    key: 'kicked', cat: 'connection', sev: 'error',
    re: /^(?:Kicked|You were kicked|Banned|You are banned)\b[:\s]*(.*)$/i,
    map: (m) => ({ detail: (m[1] || '').trim() })
  },

  // ---------- Bloco de informações do servidor ----------
  { key: 'serverName',      cat: 'server', sev: 'info', re: /^Server name:\s*"(.*)"\s*$/,            map: (m) => ({ name: m[1] }) },
  { key: 'serverLevel',     cat: 'server', sev: 'info', re: /^Server level name:\s*"(.*)"\s*$/,      map: (m) => ({ levelName: m[1] }) },
  { key: 'serverDesc',      cat: 'server', sev: 'info', re: /^Server description:\s*"([\s\S]*)"\s*$/, map: (m) => ({ description: m[1] }) },
  { key: 'serverThumb',     cat: 'server', sev: 'info', re: /^Server thumbnail URL:\s*"(.*)"\s*$/,   map: (m) => ({ thumbnail: m[1] }) },
  { key: 'serverBookmark',  cat: 'server', sev: 'info', re: /^Server bookmark host:\s*"(.*)"\s*$/,   map: (m) => ({ bookmarkHost: m[1] }) },
  { key: 'serverMax',       cat: 'server', sev: 'info', re: /^Server max players:\s*(\d+)/,          map: (m) => ({ maxPlayers: parseInt(m[1], 10) }) },
  { key: 'serverDifficulty',cat: 'server', sev: 'info', re: /^Server difficulty:\s*(\S+)/,           map: (m) => ({ difficulty: m[1] }) },
  { key: 'serverCamera',    cat: 'server', sev: 'info', re: /^Server camera mode:\s*(\S+)/,          map: (m) => ({ cameraMode: m[1] }) },
  { key: 'serverHoliday',   cat: 'server', sev: 'info', re: /^Server holiday:\s*(\S+)/,              map: (m) => ({ holiday: m[1] }) },
  { key: 'serverPvp',       cat: 'server', sev: 'info', re: /^Server is PvP:\s*(True|False)/i,       map: (m) => ({ pvp: /true/i.test(m[1]) }) },
  { key: 'serverVac',       cat: 'server', sev: 'info', re: /^Server is VAC secure:\s*(True|False)/i, map: (m) => ({ vac: /true/i.test(m[1]) }) },
  { key: 'serverBattlEye',  cat: 'server', sev: 'info', re: /^Server has \(official\) third-party anti-cheat enabled:\s*(True|False)/i, map: (m) => ({ battlEye: /true/i.test(m[1]) }) },
  { key: 'serverCheats',    cat: 'server', sev: 'info', re: /^Server allows admin cheat codes:\s*(True|False)/i, map: (m) => ({ adminCheats: /true/i.test(m[1]) }) },
  { key: 'serverGold',      cat: 'server', sev: 'info', re: /^Server requires gold:\s*(True|False)/i, map: (m) => ({ requiresGold: /true/i.test(m[1]) }) },
  {
    key: 'serverWorkshopIp', cat: 'server', sev: 'info',
    re: /^Server's allowed IP for Workshop downloads:\s*(\d{1,3}(?:\.\d{1,3}){3})/,
    map: (m) => ({ workshopIp: m[1] })
  },
  {
    key: 'hostBanFlags', cat: 'server', sev: 'info',
    re: /^(.+?) host ban flags:\s*(\S+)/,
    map: (m) => ({ name: m[1], banFlags: m[2] })
  },
  {
    // Tags do navegador de servidores. Vem numa linha de "erro" do
    // jogo, mas carrega gamemode, dificuldade e a thumbnail — dados
    // bons demais para jogar fora.
    key: 'browserTags', cat: 'server', sev: 'info',
    re: /^Unable to parse net transport tag for server "(.*)" from "(.*)"?$/,
    map: (m) => ({ name: m[1], tags: m[2] })
  },

  // ---------- Workshop / mods ----------
  {
    key: 'workshopFile', cat: 'workshop', sev: 'info',
    re: /^Workshop File "(.*)" \((\d+)\) added asset search location/,
    map: (m) => ({ modName: m[1], modId: m[2] })
  },
  {
    // Mesma linha, mas sem o nome entre aspas (acontece quando o
    // cliente ainda não recebeu os detalhes da Steam).
    key: 'workshopFile', cat: 'workshop', sev: 'info',
    re: /^Workshop File \((\d+)\) added asset search location/,
    map: (m) => ({ modId: m[1] })
  },
  {
    key: 'workshopSubscribed', cat: 'workshop', sev: 'info',
    re: /^Subscribed workshop file \d+ of \d+:\s*"(.*)" \((\d+)\)/,
    map: (m) => ({ modName: m[1], modId: m[2], subscribed: true })
  },
  {
    key: 'workshopInstalling', cat: 'workshop', sev: 'info',
    re: /^Installing cached server workshop item:\s*(\d+)/,
    map: (m) => ({ modId: m[1] })
  },
  {
    key: 'workshopDownloading', cat: 'workshop', sev: 'info',
    re: /^(?:Downloading|Requesting download of) server workshop item:?\s*(\d+)/i,
    map: (m) => ({ modId: m[1], downloading: true })
  },
  {
    key: 'workshopReady', cat: 'workshop', sev: 'info',
    re: /^Workshop item (installed|downloaded):\s*(\d+)/i,
    map: (m) => ({ modId: m[2], state: m[1].toLowerCase() })
  },
  {
    key: 'workshopCount', cat: 'workshop', sev: 'info',
    re: /^Server (?:specified|has) (\d+) (?:valid )?workshop item/,
    map: (m) => ({ workshopCount: parseInt(m[1], 10) })
  },
  {
    key: 'workshopTimestamp', cat: 'workshop', sev: 'info',
    re: /^Workshop file (\d+) timestamp matches between client and server/,
    map: (m) => ({ modId: m[1] })
  },
  {
    key: 'workshopIds', cat: 'workshop', sev: 'info',
    re: /^Subscribed workshop file ID\(s\):\s*(.+)$/,
    map: (m) => ({ modIds: m[1].split(',').map((s) => s.trim()).filter(Boolean) })
  },

  // ---------- Nível / mapa ----------
  {
    key: 'loadingLevel', cat: 'level', sev: 'info',
    re: /^Loading server level \((.+)\)\s*$/,
    map: (m) => ({ levelName: m[1] })
  },
  {
    key: 'discoveredLevel', cat: 'level', sev: 'info',
    re: /^Discovered level "(.*)" at "(.*)"\s*$/,
    map: (m) => ({ levelName: m[1], levelPath: m[2] })
  },

  // ---------- Jogadores ----------
  // O log do CLIENTE normalmente não registra entrada/saída dos
  // outros jogadores (isso vem do Query Port). Mas servidores com
  // plugins que escrevem no console do cliente, e o próprio jogo em
  // algumas versões, usam estes formatos — então ficam suportados.
  {
    key: 'playerJoin', cat: 'player', sev: 'info',
    re: /^(?:Player )?"?([^"]+?)"?\s+(?:\[(\d{17})\]\s+)?(?:joined the (?:server|game)|connected)\b/i,
    map: (m) => ({ playerName: m[1], steamId: m[2] || null, event: 'join' })
  },
  {
    key: 'playerLeave', cat: 'player', sev: 'info',
    re: /^(?:Player )?"?([^"]+?)"?\s+(?:\[(\d{17})\]\s+)?(?:left the (?:server|game)|disconnected)\b/i,
    map: (m) => ({ playerName: m[1], steamId: m[2] || null, event: 'leave' })
  },

  // ---------- Sessão / sistema ----------
  {
    key: 'gameVersion', cat: 'session', sev: 'info',
    re: /^Game version:\s*(\S+)\s+Engine version:\s*(\S+)/,
    map: (m) => ({ gameVersion: m[1], engineVersion: m[2] })
  },
  { key: 'quit',         cat: 'session', sev: 'warn', re: /^Quit game:\s*(.+)$/,                 map: (m) => ({ reason: m[1] }) },
  { key: 'bookmarks',    cat: 'session', sev: 'info', re: /^Loaded server bookmarks:\s*(\d+)/,   map: (m) => ({ count: parseInt(m[1], 10) }) },
  { key: 'masterServer', cat: 'session', sev: 'info', re: /^Successfully refreshed the master server\./, map: () => ({}) },
  { key: 'browserFilter',cat: 'session', sev: 'info', re: /^Refreshing server list with filters:\s*(.+)$/, map: (m) => ({ filters: m[1] }) },
  {
    key: 'authTicket', cat: 'session', sev: 'info',
    re: /^Calling GetAuthSessionTicket with identity steamid:(\d+)/,
    map: (m) => ({ serverSteamId: m[1] })
  },
  {
    key: 'battlEyeGuid', cat: 'session', sev: 'info',
    re: /^BattlEye client message: Server computed GUID:\s*(\S+)/,
    map: (m) => ({ guid: m[1] })
  },
  { key: 'os',       cat: 'session', sev: 'info', re: /^Operating System:\s*(.+)$/,     map: (m) => ({ os: m[1].trim() }) },
  { key: 'gpu',      cat: 'session', sev: 'info', re: /^Graphics Device Name:\s*(.+)$/, map: (m) => ({ gpu: m[1].trim() }) },

  // ---------- Erros (genérico, por último) ----------
  {
    key: 'exception', cat: 'error', sev: 'error',
    re: /(?:^|\s)(?:[A-Za-z.]*Exception|Stack ?trace)\b/,
    map: () => ({})
  },
  {
    key: 'error', cat: 'error', sev: 'error',
    re: /^(?:Error|Failed|Unable to)\b/i,
    map: () => ({})
  }
];

// Linhas repetidas de spam do Unity que só poluem o visualizador.
// Continuam disponíveis no filtro "tudo", mas nascem escondidas.
const NOISE = [
  /^Releasing render texture/,
  /^Internal: (?:deleting an allocation|JobTempAlloc)/,
  /^To Debug, run app with -diag-job-temp-memory-leak/,
  /^tellUIEffect(?:Text|Visibility):/,
  /^BoxCollider does not support negative scale/,
  /^The effective box size has been forced positive/,
  /^If you absolutely need to use negative scaling/,
  /^Renderer '.*' is registered with more than one LODGroup/,
  /^(?:Object|Tree) with no asset/,
  /^Unable to find object for GUID/,
  /^Context ".*" known missing asset/,
  /^\s+at [A-Za-z]/,
  /^Long delay between Updates/,
  /^Set target frame rate/,
  // Erros de ASSET (mods mal formatados). São do conteúdo instalado,
  // não do app nem da conexão — ficam escondidos por padrão.
  /^Error parsing "/,
  /^Failed getting load state of FSB/,
  /^Unable to find consolidated version of shader/,
  /^Missing blueprint type/,
  /^The referenced script on this Behaviour/,
  /^Workshop File ".*" \(\d+\) .*: (?:table \d+ has|unable to find root)/,
  /^Tag: .* is not defined\./,
  /^Scheduled [A-Z_]+ from /,
  /^Looked for economy translation at:/,
  /^(?:Supports|Graphics|Render Threading|System Memory|Platform):/,
  /^Requesting resolution change:/,
  /^Reflect net invokables:/,
  /^Workshop file \d+ not requesting load/,
  /^Received details for \d+ subscribed workshop file/,
  /^Querying details for subscribed workshop files/,
  /^Adding \d+ asset\(s\) from origin/,
  /^Unable to find level asset/,
  /^Unable to parse net transport tag for server/,
  /^Context "/,
  /^Caught exception while populating/,
  /^Workshop File [^:]*: /,
  /^missing "/,
  /^Object ".*" with palette/,
  /^Discovered level "/,
  /^Net id \d+ was previously assigned/,
  /^Loading asset bundle "/,
  /^Already registered newly downloaded workshop item/,
  /^at SDG\./,
  /^Assets\//,
  /^Adding \d+ subscribed/
];

const TS_RE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]\s?(.*)$/;

// ------------------------------------------------------------
// parseLine — uma linha crua vira um evento estruturado.
// Linhas de continuação (sem timestamp) herdam o horário anterior.
// ------------------------------------------------------------
function parseLine(rawLine, prevTime) {
  const line = String(rawLine).replace(/^﻿/, '').replace(/\s+$/, '');
  if (!line) return null;

  const ts = TS_RE.exec(line);
  let time = prevTime || null;
  let body = line;

  if (ts) {
    // Timestamp é hora LOCAL do jogador; montamos a Date no fuso local.
    const d = new Date(
      Number(ts[1]), Number(ts[2]) - 1, Number(ts[3]),
      Number(ts[4]), Number(ts[5]), Number(ts[6])
    );
    time = Number.isNaN(d.getTime()) ? prevTime || null : d.toISOString();
    body = ts[7];
  }

  const evt = {
    t: time,
    raw: body,
    cat: 'other',
    sev: 'info',
    key: null,
    data: {},
    noise: NOISE.some((re) => re.test(body)),
    hasTimestamp: !!ts
  };

  for (const p of PATTERNS) {
    const m = p.re.exec(body);
    if (!m) continue;
    evt.cat = p.cat;
    evt.sev = p.sev;
    evt.key = p.key;
    try { evt.data = p.map(m) || {}; } catch { evt.data = {}; }
    break;
  }

  // Conexão e jogadores NUNCA são ruído: é exatamente o que o
  // usuário abre o visualizador para ver.
  if (evt.key && (evt.cat === 'connection' || evt.cat === 'player')) evt.noise = false;
  return evt;
}

function parseLines(text, prevTime) {
  const out = [];
  let last = prevTime || null;
  for (const line of String(text).split(/\r?\n/)) {
    const evt = parseLine(line, last);
    if (!evt) continue;
    if (evt.t) last = evt.t;
    out.push(evt);
  }
  return out;
}

// ------------------------------------------------------------
// Tags do navegador de servidores ("PVP,CHn,NRM,2Pp,WSy,F2P,BEy,
// <gm>SurvivalGameMode</gm>,<tn>https://...png</tn>").
// ------------------------------------------------------------
const DIFFICULTY_TAGS = { EZY: 'EASY', NRM: 'NORMAL', HRD: 'HARD' };

function parseBrowserTags(tagString) {
  const s = String(tagString || '');
  const out = { pvp: null, difficulty: null, gameMode: null, thumbnail: null, workshop: null, battlEye: null };

  const tn = /<tn>([\s\S]*?)(?:<\/tn>|$)/.exec(s);
  if (tn) out.thumbnail = tn[1].trim() || null;
  const gm = /<gm>([\s\S]*?)(?:<\/gm>|$)/.exec(s);
  if (gm) out.gameMode = gm[1].trim() || null;

  const plain = s.replace(/<[^>]*>[\s\S]*?(?:<\/[^>]*>|$)/g, '');
  for (const t of plain.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (t === 'PVP') out.pvp = true;
    else if (t === 'PVE') out.pvp = false;
    else if (DIFFICULTY_TAGS[t]) out.difficulty = DIFFICULTY_TAGS[t];
    else if (t === 'WSy') out.workshop = true;
    else if (t === 'WSn') out.workshop = false;
    else if (t === 'BEy') out.battlEye = true;
    else if (t === 'BEn') out.battlEye = false;
  }
  return out;
}

// ------------------------------------------------------------
// buildSessions — reduz uma lista de eventos a "sessões de
// servidor": cada vez que o jogador conectou, com tudo que o log
// contou sobre aquele servidor.
//
// É esta lista que alimenta:
//   • o card de "jogando agora" (última sessão ainda aberta);
//   • as sugestões do botão "+" (sessões recentes, mais nova
//     primeiro, sem repetir o mesmo IP:porta).
// ------------------------------------------------------------
function emptySession(t) {
  return {
    startedAt: t || null, endedAt: null, open: true,
    transport: null, ip: null, port: null, steamId: null, connectionId: null,
    name: null, levelName: null, description: null, thumbnail: null,
    bookmarkHost: null, maxPlayers: null, difficulty: null, cameraMode: null,
    holiday: null, pvp: null, vac: null, battlEye: null, adminCheats: null,
    requiresGold: null, gameMode: null, workshopIp: null, workshopCount: null,
    serverSteamId: null, reason: null,
    mods: [], modIds: []
  };
}

function addMod(session, id, name) {
  if (!id) return;
  const found = session.mods.find((m) => m.id === id);
  if (found) { if (name && !found.name) found.name = name; return; }
  session.mods.push({ id, name: name || null });
  session.modIds.push(id);
}

function buildSessions(events, opts = {}) {
  const sessions = [];
  // Nomes de mods vistos em QUALQUER ponto do log (inclusive na
  // lista de itens inscritos do jogador) — usados para dar nome a
  // um ID que o servidor só citou como número.
  const modNames = opts.modNames || {};
  // Nome do servidor anunciado logo antes de conectar
  // ("<nome> host ban flags: None"), útil quando a conexão falha
  // antes do bloco "Server name".
  let pendingName = null;
  let cur = null;

  const close = (t, reason) => {
    if (!cur) return;
    cur.open = false;
    cur.endedAt = t || cur.endedAt;
    if (reason) cur.reason = reason;
    sessions.push(cur);
    cur = null;
  };

  for (const e of events) {
    const d = e.data || {};

    switch (e.key) {
      case 'workshopSubscribed':
        if (d.modId && d.modName) modNames[d.modId] = d.modName;
        break;
      case 'workshopFile':
        if (d.modId && d.modName) modNames[d.modId] = d.modName;
        if (cur) addMod(cur, d.modId, d.modName);
        break;
      case 'hostBanFlags':
        pendingName = d.name || null;
        break;
      case 'browserTags': {
        const parsed = parseBrowserTags(d.tags);
        // Só aplicamos à sessão aberta se o nome bater — a lista do
        // navegador cita dezenas de servidores que não são o nosso.
        if (cur && cur.name && d.name === cur.name) {
          if (parsed.gameMode && !cur.gameMode) cur.gameMode = parsed.gameMode;
          if (parsed.thumbnail && !cur.thumbnail) cur.thumbnail = parsed.thumbnail;
          if (parsed.difficulty && !cur.difficulty) cur.difficulty = parsed.difficulty;
        }
        break;
      }
      case 'connecting':
      case 'connectingP2P':
        close(e.t, 'replaced');
        cur = emptySession(e.t);
        cur.transport = d.transport || null;
        cur.ip = d.ip || null;
        cur.port = d.port != null ? d.port : null;
        cur.steamId = d.steamId || null;
        if (pendingName) { cur.name = pendingName; pendingName = null; }
        break;
      case 'connectionReady':
        if (cur) cur.connectionId = d.connectionId || null;
        break;
      case 'serverName':       if (cur) cur.name = d.name; break;
      case 'serverLevel':      if (cur) cur.levelName = d.levelName; break;
      case 'loadingLevel':     if (cur && !cur.levelName) cur.levelName = d.levelName; break;
      case 'serverDesc':       if (cur) cur.description = d.description; break;
      case 'serverThumb':      if (cur) cur.thumbnail = d.thumbnail || null; break;
      case 'serverBookmark':   if (cur) cur.bookmarkHost = d.bookmarkHost || null; break;
      case 'serverMax':        if (cur) cur.maxPlayers = d.maxPlayers; break;
      case 'serverDifficulty': if (cur) cur.difficulty = d.difficulty; break;
      case 'serverCamera':     if (cur) cur.cameraMode = d.cameraMode; break;
      case 'serverHoliday':    if (cur) cur.holiday = d.holiday; break;
      case 'serverPvp':        if (cur) cur.pvp = d.pvp; break;
      case 'serverVac':        if (cur) cur.vac = d.vac; break;
      case 'serverBattlEye':   if (cur) cur.battlEye = d.battlEye; break;
      case 'serverCheats':     if (cur) cur.adminCheats = d.adminCheats; break;
      case 'serverGold':       if (cur) cur.requiresGold = d.requiresGold; break;
      case 'authTicket':       if (cur) cur.serverSteamId = d.serverSteamId; break;
      case 'workshopCount':    if (cur && cur.workshopCount == null) cur.workshopCount = d.workshopCount; break;
      case 'workshopInstalling':
      case 'workshopTimestamp':
        if (cur) addMod(cur, d.modId, modNames[d.modId] || null);
        break;
      case 'serverWorkshopIp':
        if (cur) {
          cur.workshopIp = d.workshopIp;
          // Recuperação do endereço em conexões P2P/relay: o IP
          // liberado para baixar o Workshop é o do próprio servidor.
          // 0.0.0.0 significa "qualquer um" e não serve.
          if (!cur.ip && d.workshopIp && d.workshopIp !== '0.0.0.0') cur.ip = d.workshopIp;
        }
        break;
      case 'disconnecting':
      case 'quit':
        close(e.t, d.reason || null);
        break;
      case 'disconnected':
      case 'clientDisconnect':
        close(e.t, cur && cur.reason ? cur.reason : null);
        break;
      case 'connectFailed':
      case 'kicked':
        close(e.t, e.key === 'kicked' ? 'kicked' : 'failed');
        break;
      default:
        break;
    }
  }

  if (cur) sessions.push(cur);

  // Preenche nomes de mods descobertos depois da sessão terminar.
  for (const s of sessions) {
    for (const m of s.mods) if (!m.name && modNames[m.id]) m.name = modNames[m.id];
  }
  return { sessions, modNames };
}

// Sessão atual = a última ainda aberta E com endereço conhecido.
function currentFromSessions(sessions) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].open) return sessions[i];
  }
  return null;
}

// Sugestões para o botão "+": sessões mais recentes primeiro, sem
// repetir o mesmo servidor.
//
// Sessões via relay da Steam (P2P) não têm IP direto no log e não
// podem ser adicionadas por endereço — elas VÊM na lista mesmo
// assim, marcadas com `addressable: false`, para a interface poder
// explicar o motivo em vez de simplesmente esconder o servidor em
// que o usuário acabou de jogar.
function suggestionsFromSessions(sessions, limit = 8) {
  const seen = new Set();
  const out = [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    const addressable = !!(s.ip && s.port);
    const key = addressable
      ? `${s.ip}:${s.port}`
      : (s.steamId ? `steam:${s.steamId}` : `name:${s.name || i}`);
    if (!addressable && !s.name) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      addressable,
      transport: s.transport || null,
      ip: s.ip, port: s.port, steamId: s.steamId || null,
      name: s.name || key,
      map: s.levelName || null, description: s.description || null,
      thumbnail: s.thumbnail || null, maxPlayers: s.maxPlayers || null,
      difficulty: s.difficulty || null, pvp: s.pvp, battlEye: s.battlEye,
      mods: s.mods.slice(), at: s.startedAt, open: s.open,
      bookmarkHost: s.bookmarkHost || null
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ------------------------------------------------------------
// Localização do log
// ------------------------------------------------------------
function defaultLogDir(homeDir) {
  const home = homeDir || process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, 'AppData', 'LocalLow', 'SmartlyDressedGames', 'Unturned');
}

// Ordem de preferência: o Client.log atual (formato novo, com
// timestamps e o bloco "Server ...") vem primeiro.
function findLogFile(homeDir, explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const base = defaultLogDir(homeDir);
  const candidates = [
    path.join(base, 'Logs', 'Client.log'),
    path.join(base, 'Client.log'),
    path.join(base, 'Player.log'),
    path.join(base, 'output_log.txt')
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

function previousLogFile(logFile) {
  if (!logFile) return null;
  const dir = path.dirname(logFile);
  const ext = path.extname(logFile);
  const base = path.basename(logFile, ext);
  const prev = path.join(dir, `${base}_Prev${ext}`);
  try { return fs.existsSync(prev) ? prev : null; } catch { return null; }
}

// Lê no máximo os últimos `maxBytes` de um arquivo, alinhando o
// início na primeira quebra de linha para não cortar uma linha.
function readTailFile(file, maxBytes = BACKFILL_BYTES) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const len = stat.size - start;
  if (len <= 0) return { text: '', size: stat.size };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf-8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return { text, size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------
// LogSession — leitura incremental (tail) com estado.
//
// Uso:
//   const s = new LogSession({ onEvents, onCurrentChange });
//   s.open('.../Client.log');   // faz o backfill e começa a vigiar
//   s.close();
// ------------------------------------------------------------
class LogSession {
  constructor(opts = {}) {
    this.onEvents = opts.onEvents || (() => {});
    this.onCurrentChange = opts.onCurrentChange || (() => {});
    this.maxEvents = opts.maxEvents || 4000;
    this.maxSessions = opts.maxSessions || 60;

    this.file = null;
    this.pos = 0;
    this.partial = '';
    this.lastTime = null;

    this.events = [];       // buffer circular dos eventos recentes
    this.sessions = [];
    this.modNames = {};
    this.current = null;
    this.watcher = null;
  }

  // Reprocessa tudo (backfill + tail) para recalcular sessões.
  _rebuild() {
    const { sessions, modNames } = buildSessions(this.events, { modNames: this.modNames });
    this.modNames = modNames;
    this.sessions = sessions.slice(-this.maxSessions);
    const next = currentFromSessions(this.sessions);
    const before = this.current;
    this.current = next;

    const key = (s) => (s ? `${s.ip || s.steamId || '?'}:${s.port || ''}|${s.name || ''}|${s.levelName || ''}` : '');
    if (key(before) !== key(next)) this.onCurrentChange(next, before);
  }

  _ingest(text, { silent = false } = {}) {
    const combined = this.partial + text;
    // Se o pedaço não termina em quebra de linha, o resto fica para
    // o próximo tick (o jogo pode ter escrito meia linha).
    const lastNl = combined.lastIndexOf('\n');
    let chunk = combined;
    if (lastNl < 0) { this.partial = combined; return []; }
    chunk = combined.slice(0, lastNl + 1);
    this.partial = combined.slice(lastNl + 1);

    const evts = parseLines(chunk, this.lastTime);
    if (evts.length) {
      const withTime = evts.filter((e) => e.t);
      if (withTime.length) this.lastTime = withTime[withTime.length - 1].t;
    }
    this.events.push(...evts);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    this._rebuild();
    if (!silent && evts.length) this.onEvents(evts);
    return evts;
  }

  // Carrega histórico (log anterior + log atual) e passa a vigiar.
  open(file) {
    this.close();
    if (!file) return false;
    this.file = file;
    this.events = [];
    this.partial = '';
    this.lastTime = null;
    this.modNames = {};

    // 1) log da sessão ANTERIOR — só para dar nome aos mods e
    //    alimentar as sugestões; não deve virar "jogando agora",
    //    então fechamos qualquer sessão que tenha ficado aberta.
    const prev = previousLogFile(file);
    if (prev) {
      try {
        const { text } = readTailFile(prev, BACKFILL_BYTES);
        this._ingest(text, { silent: true });
        this.partial = '';
        for (const s of this.sessions) { s.open = false; }
        this.events.push({ t: this.lastTime, raw: '--- log anterior ---', cat: 'session', sev: 'info', key: 'logRotated', data: {}, noise: false, hasTimestamp: false });
        // Encerra explicitamente a última sessão do log antigo.
        this.events.push({ t: this.lastTime, raw: 'Disconnected', cat: 'connection', sev: 'warn', key: 'disconnected', data: {}, noise: false, hasTimestamp: false });
      } catch { /* sem log anterior utilizável */ }
    }

    // 2) log ATUAL
    try {
      const { text, size } = readTailFile(file, BACKFILL_BYTES);
      this.pos = size;
      this._ingest(text, { silent: true });
    } catch {
      this.pos = 0;
    }

    this._rebuild();
    this._startWatch();
    return true;
  }

  _startWatch() {
    if (!this.file) return;
    this.watcher = () => this.readNew();
    fs.watchFile(this.file, { interval: 1000 }, this.watcher);
  }

  readNew() {
    if (!this.file) return [];
    let stat;
    try { stat = fs.statSync(this.file); } catch { return []; }

    // Log rotacionado (o jogo reabriu e recomeçou o arquivo).
    if (stat.size < this.pos) {
      this.pos = 0;
      this.partial = '';
    }
    if (stat.size === this.pos) return [];

    const len = stat.size - this.pos;
    let buf;
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, this.pos);
      } finally { fs.closeSync(fd); }
    } catch { return []; }

    this.pos = stat.size;
    return this._ingest(buf.toString('utf-8'));
  }

  close() {
    if (this.file && this.watcher) {
      try { fs.unwatchFile(this.file, this.watcher); } catch {}
    }
    this.watcher = null;
    this.file = null;
  }

  // Snapshot para a interface.
  getState() {
    return {
      file: this.file,
      current: this.current,
      sessions: this.sessions.slice(-20),
      suggestions: suggestionsFromSessions(this.sessions),
      eventCount: this.events.length
    };
  }

  getEvents(limit = 800, { includeNoise = false } = {}) {
    const src = includeNoise ? this.events : this.events.filter((e) => !e.noise);
    return src.slice(-limit);
  }
}

module.exports = {
  CATEGORIES,
  parseLine,
  parseLines,
  parseBrowserTags,
  buildSessions,
  currentFromSessions,
  suggestionsFromSessions,
  findLogFile,
  previousLogFile,
  defaultLogDir,
  readTailFile,
  LogSession
};
