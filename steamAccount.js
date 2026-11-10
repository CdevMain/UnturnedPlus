// ============================================================
// steamAccount.js — Conta Steam do usuário e amigos
//
// O que dá para fazer SEM chave de API:
//   • descobrir o SteamID64 de quem está logado (loginusers.vdf
//     da própria instalação da Steam);
//   • pegar nome e foto de qualquer perfil público pelo XML que a
//     comunidade Steam expõe há anos (`?xml=1`).
//
// O que EXIGE uma chave gratuita da Steam Web API:
//   • a lista de amigos (ISteamUser/GetFriendList);
//   • em qual servidor cada amigo está jogando
//     (ISteamUser/GetPlayerSummaries -> gameid/gameserverip).
//
// A chave é gratuita e sai em https://steamcommunity.com/dev/apikey.
// Sem ela, o app continua funcionando: mostra sua foto e seu nome,
// e simplesmente não lista amigos — em vez de fingir que sabe.
//
// LIMITES HONESTOS que a interface precisa comunicar:
//   • o perfil do amigo precisa ser PÚBLICO para aparecer o que
//     ele está jogando;
//   • `gameserverip` só vem quando o servidor tem IP direto. Quem
//     entra por relay da Steam (P2P) aparece "jogando Unturned"
//     mas sem endereço — igual ao que acontece no log do jogo.
//
// Módulo puro em relação ao Electron: recebe as funções de rede
// por injeção, então dá para testar fora do app.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const UNTURNED_APPID = '304930';
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;   // foto/nome mudam pouco
const SUMMARY_MAX = 100;                     // limite do GetPlayerSummaries

// ------------------------------------------------------------
// VDF — o formato de texto da Valve usado no loginusers.vdf.
//
//   "users"
//   {
//       "76561198000000000"
//       {
//           "AccountName"   "carlo"
//           "PersonaName"   "Carlo"
//           "MostRecent"    "1"
//       }
//   }
//
// Parser mínimo: só o necessário para ler esse arquivo, tolerante
// a comentários e a chaves sem valor.
// ------------------------------------------------------------
function parseVdf(text) {
  const src = String(text || '');
  let i = 0;

  const skipWs = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {          // comentário de linha
        while (i < src.length && src[i] !== '\n') i++;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++;
      } else {
        break;
      }
    }
  };

  const readString = () => {
    if (src[i] !== '"') return null;
    i++;
    let out = '';
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\' && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
      out += src[i++];
    }
    i++; // fecha aspas
    return out;
  };

  const readObject = () => {
    const obj = {};
    skipWs();
    if (src[i] !== '{') return obj;
    i++;
    while (i < src.length) {
      skipWs();
      if (src[i] === '}') { i++; break; }
      const key = readString();
      if (key === null) { i++; continue; }   // lixo: pula um caractere
      skipWs();
      if (src[i] === '{') obj[key] = readObject();
      else obj[key] = readString();
    }
    return obj;
  };

  skipWs();
  const root = {};
  while (i < src.length) {
    skipWs();
    if (i >= src.length) break;
    const key = readString();
    if (key === null) { i++; continue; }
    skipWs();
    root[key] = src[i] === '{' ? readObject() : readString();
  }
  return root;
}

// ------------------------------------------------------------
// Onde a Steam está instalada
// ------------------------------------------------------------
const STEAM_CANDIDATES = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\Steam'
];

// Deriva a raiz da Steam a partir do caminho do Unturned já
// configurado no app: <steam>/steamapps/common/Unturned.
function steamRootFromUnturned(unturnedPath) {
  if (!unturnedPath) return null;
  const parts = String(unturnedPath).split(/[\\/]/);
  const idx = parts.lastIndexOf('steamapps');
  if (idx <= 0) return null;
  return parts.slice(0, idx).join(path.sep);
}

function findSteamPath({ explicit, unturnedPath, home, execSync } = {}) {
  const ok = (p) => { try { return !!p && fs.existsSync(path.join(p, 'config', 'loginusers.vdf')); } catch { return false; } };

  if (ok(explicit)) return explicit;

  const fromGame = steamRootFromUnturned(unturnedPath);
  if (ok(fromGame)) return fromGame;

  for (const p of STEAM_CANDIDATES) if (ok(p)) return p;

  // Último recurso no Windows: o registro sabe onde a Steam está.
  if (process.platform === 'win32' && typeof execSync === 'function') {
    try {
      const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf-8', timeout: 4000 });
      const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
      if (m) {
        const p = m[1].trim().replace(/\//g, '\\');
        if (ok(p)) return p;
      }
    } catch { /* sem registro acessível */ }
  }

  // Linux/macOS (útil para desenvolvimento)
  if (home) {
    for (const p of [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, 'Library', 'Application Support', 'Steam')
    ]) if (ok(p)) return p;
  }

  return null;
}

// Lê o loginusers.vdf e devolve as contas, a mais recente primeiro.
function readLoginUsers(steamPath) {
  if (!steamPath) return [];
  let raw;
  try {
    raw = fs.readFileSync(path.join(steamPath, 'config', 'loginusers.vdf'), 'utf-8');
  } catch {
    return [];
  }

  const data = parseVdf(raw);
  const users = data.users || data.Users || {};
  const out = [];
  for (const [id, info] of Object.entries(users)) {
    if (!/^\d{17}$/.test(id) || !info || typeof info !== 'object') continue;
    out.push({
      steamId: id,
      accountName: info.AccountName || null,
      personaName: info.PersonaName || null,
      mostRecent: info.MostRecent === '1' || info.mostrecent === '1',
      timestamp: parseInt(info.Timestamp || info.timestamp || '0', 10) || 0
    });
  }
  out.sort((a, b) => (b.mostRecent - a.mostRecent) || (b.timestamp - a.timestamp));
  return out;
}

// ------------------------------------------------------------
// XML público do perfil (sem chave)
// ------------------------------------------------------------
function pickXml(xml, tag) {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

function parseProfileXml(xml) {
  if (!xml || !/<profile[\s>]/i.test(xml)) return null;
  const id = pickXml(xml, 'steamID64');
  if (!id) return null;
  return {
    steamId: id,
    personaName: pickXml(xml, 'steamID'),
    avatar: pickXml(xml, 'avatarMedium') || pickXml(xml, 'avatarIcon'),
    avatarFull: pickXml(xml, 'avatarFull'),
    onlineState: pickXml(xml, 'onlineState'),
    stateMessage: pickXml(xml, 'stateMessage'),
    profileUrl: `https://steamcommunity.com/profiles/${id}`,
    private: /<privacyMessage>/i.test(xml),
    at: Date.now()
  };
}

class SteamAccount {
  // httpGetText(url) -> Promise<string>
  // httpGetJson(url)  -> Promise<object>
  constructor({ cacheFile, httpGetText, httpGetJson, execSync }) {
    this.cacheFile = cacheFile;
    this.httpGetText = httpGetText;
    this.httpGetJson = httpGetJson;
    this.execSync = execSync;
    this.cache = null;      // { profiles: { id: {...} } }
    this.dirty = false;
    this.pendingProfiles = new Map();
  }

  _load() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8')) || {};
    } catch {
      this.cache = {};
    }
    if (!this.cache.profiles) this.cache.profiles = {};
    return this.cache;
  }

  flush() {
    if (!this.dirty || !this.cache) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache), 'utf-8');
      this.dirty = false;
    } catch { /* cache é opcional */ }
  }

  // ---------- detecção local ----------
  detect({ unturnedPath, home, explicitSteamPath } = {}) {
    const steamPath = findSteamPath({
      explicit: explicitSteamPath, unturnedPath, home, execSync: this.execSync
    });
    const users = readLoginUsers(steamPath);
    return {
      steamPath,
      users,
      steamId: users.length ? users[0].steamId : null
    };
  }

  // ---------- perfil público (sem chave) ----------
  async profile(steamId, { force = false } = {}) {
    if (!/^\d{17}$/.test(String(steamId || ''))) return null;
    const cache = this._load();
    const hit = cache.profiles[steamId];
    if (!force && hit && Date.now() - (hit.at || 0) < PROFILE_TTL_MS) return hit;
    if (this.pendingProfiles.has(steamId)) return this.pendingProfiles.get(steamId);

    const job = (async () => {
      try {
        const xml = await this.httpGetText(`https://steamcommunity.com/profiles/${steamId}?xml=1`);
        const parsed = parseProfileXml(xml);
        if (parsed) {
          cache.profiles[steamId] = parsed;
          this.dirty = true;
          this.flush();
          return parsed;
        }
      } catch { /* perfil privado, offline ou bloqueado */ }
      return hit || null;
    })().finally(() => this.pendingProfiles.delete(steamId));

    this.pendingProfiles.set(steamId, job);
    return job;
  }

  // ---------- amigos (precisa de chave) ----------
  async friendIds(steamId, apiKey) {
    if (!apiKey) throw new Error('NO_KEY');
    const url = `https://api.steampowered.com/ISteamUser/GetFriendList/v1/`
      + `?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&relationship=friend`;
    const json = await this.httpGetJson(url);
    const list = json && json.friendslist && json.friendslist.friends;
    if (!Array.isArray(list)) throw new Error('PRIVATE_OR_EMPTY');
    return list.map((f) => String(f.steamid)).filter((id) => /^\d{17}$/.test(id));
  }

  async summaries(ids, apiKey) {
    if (!apiKey) throw new Error('NO_KEY');
    const out = [];
    for (let i = 0; i < ids.length; i += SUMMARY_MAX) {
      const batch = ids.slice(i, i + SUMMARY_MAX);
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/`
        + `?key=${encodeURIComponent(apiKey)}&steamids=${batch.join(',')}`;
      try {
        const json = await this.httpGetJson(url);
        const players = json && json.response && json.response.players;
        if (Array.isArray(players)) out.push(...players);
      } catch { /* um lote que falha não derruba o resto */ }
    }
    return out;
  }

  // Amigos jogando Unturned agora, com o servidor quando disponível.
  //
  // Devolve SEMPRE um objeto com `status` explicando o que houve —
  // a interface precisa distinguir "sem chave", "perfil privado" e
  // "ninguém jogando", que são situações bem diferentes.
  async friendsPlaying(steamId, apiKey) {
    if (!/^\d{17}$/.test(String(steamId || ''))) {
      return { status: 'no_steamid', friends: [], playing: [] };
    }
    if (!apiKey) return { status: 'no_key', friends: [], playing: [] };

    let ids;
    try {
      ids = await this.friendIds(steamId, apiKey);
    } catch (e) {
      return { status: e.message === 'NO_KEY' ? 'no_key' : 'friends_unavailable', friends: [], playing: [] };
    }
    if (!ids.length) return { status: 'no_friends', friends: [], playing: [] };

    const players = await this.summaries(ids, apiKey);
    const cache = this._load();

    const friends = players.map((p) => {
      const entry = {
        steamId: String(p.steamid),
        personaName: p.personaname || null,
        avatar: p.avatarmedium || p.avatar || null,
        avatarFull: p.avatarfull || null,
        state: p.personastate,
        gameId: p.gameid ? String(p.gameid) : null,
        gameName: p.gameextrainfo || null,
        // Só vem quando o servidor tem IP direto e a privacidade permite.
        serverAddress: p.gameserverip && !/^0\.0\.0\.0/.test(p.gameserverip) ? p.gameserverip : null,
        serverSteamId: p.gameserversteamid || null,
        profileUrl: p.profileurl || `https://steamcommunity.com/profiles/${p.steamid}`,
        playingUnturned: String(p.gameid || '') === UNTURNED_APPID
      };
      // Aproveita para manter o cache de perfis quentinho.
      cache.profiles[entry.steamId] = {
        steamId: entry.steamId, personaName: entry.personaName,
        avatar: entry.avatar, avatarFull: entry.avatarFull,
        profileUrl: entry.profileUrl, at: Date.now()
      };
      return entry;
    });
    this.dirty = true;
    this.flush();

    const playing = friends.filter((f) => f.playingUnturned);

    // Agrupa por servidor. Quem está no Unturned sem endereço
    // (relay da Steam) fica num grupo separado e identificado.
    const byServer = new Map();
    const withoutAddress = [];
    for (const f of playing) {
      if (!f.serverAddress) { withoutAddress.push(f); continue; }
      const [ip, port] = f.serverAddress.split(':');
      const key = f.serverAddress;
      if (!byServer.has(key)) byServer.set(key, { address: key, ip, port: Number(port) || null, friends: [] });
      byServer.get(key).friends.push(f);
    }

    return {
      status: 'ok',
      friendCount: friends.length,
      friends,
      playing,
      servers: [...byServer.values()].sort((a, b) => b.friends.length - a.friends.length),
      withoutAddress
    };
  }
}

module.exports = {
  SteamAccount,
  parseVdf,
  readLoginUsers,
  findSteamPath,
  steamRootFromUnturned,
  parseProfileXml,
  UNTURNED_APPID
};
