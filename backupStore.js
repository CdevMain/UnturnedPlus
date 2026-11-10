// ============================================================
// backupStore.js — Backup completo (exportar / importar / resetar)
//
// Um backup do Unturned+ é UM arquivo .json. Não um zip, não uma
// pasta: se for mais de um arquivo, metade das pessoas manda só
// metade e o backup não serve para nada.
//
// O que entra é escolha do usuário — daí `parts`. Cada parte é
// independente e pode ser importada sozinha:
//
//   servers    a lista de servidores (com tags, favoritos, pasta)
//   folders    as pastas
//   settings   idioma, intervalos, overlay, atalhos, notificações
//   markers    marcadores de mapa, por mapa
//   notes      anotações (com ou sem os prints embutidos)
//   history    histórico local de jogadores por servidor
//
// O que NUNCA entra, mesmo em "tudo": apiKey da Steam e apiToken.
// São credenciais suas; um backup circula por Discord. Na volta o
// app avisa que elas ficaram de fora em vez de fingir que restaurou.
// ============================================================

const fs = require('fs');
const path = require('path');

const FORMAT = 'unturned-plus-backup';
const VERSION = 1;

const ALL_PARTS = ['servers', 'folders', 'settings', 'markers', 'notes', 'history'];

// Chaves de configuração que jamais saem daqui.
const SECRET_KEYS = ['apiToken'];
const SECRET_STEAM_KEYS = ['apiKey'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------
// Exportar
// ------------------------------------------------------------
// deps: { configPath, mapsDir, historyDir, notes, appVersion }
function buildBackup(deps, opts = {}) {
  const parts = (opts.parts && opts.parts.length ? opts.parts : ALL_PARTS)
    .filter((p) => ALL_PARTS.includes(p));
  const includeShots = opts.includeShots !== false;
  // Lista de bmIds a incluir. Vazio = todos.
  const only = Array.isArray(opts.serverIds) && opts.serverIds.length
    ? new Set(opts.serverIds.map(String))
    : null;

  const cfg = readJson(deps.configPath(), {});
  const out = {
    format: FORMAT,
    version: VERSION,
    app: deps.appVersion || '',
    createdAt: new Date().toISOString(),
    parts,
    data: {}
  };

  let servers = Array.isArray(cfg.servers) ? cfg.servers : [];
  if (only) servers = servers.filter((s) => only.has(String(s.bmId || s.id)));

  if (parts.includes('servers')) out.data.servers = servers;

  if (parts.includes('folders')) {
    // Só as pastas que os servidores exportados usam — exportar
    // "os 3 servidores da rede X" não deve arrastar as 12 pastas.
    const used = new Set(servers.map((s) => s.folderId).filter(Boolean));
    const folders = Array.isArray(cfg.folders) ? cfg.folders : [];
    out.data.folders = only ? folders.filter((f) => used.has(f.id)) : folders;
  }

  if (parts.includes('settings')) {
    const s = { ...cfg };
    delete s.servers; delete s.folders; delete s.logs;
    for (const k of SECRET_KEYS) delete s[k];
    if (s.steam) { s.steam = { ...s.steam }; for (const k of SECRET_STEAM_KEYS) delete s.steam[k]; }
    out.data.settings = s;
  }

  if (parts.includes('markers')) {
    out.data.markers = {};
    let mapNames = [];
    try { mapNames = fs.readdirSync(deps.mapsDir()); } catch { mapNames = []; }
    for (const name of mapNames) {
      const f = path.join(deps.mapsDir(), name, 'markers.json');
      if (!fs.existsSync(f)) continue;
      const d = readJson(f, null);
      if (d && Array.isArray(d.markers) && d.markers.length) out.data.markers[name] = d;
    }
  }

  if (parts.includes('notes')) {
    // Escopos: os servidores exportados + todos os marcadores.
    let scopes = null;
    if (only) {
      scopes = servers.map((s) => 'server:' + (s.bmId || s.id));
      // marcadores dos mapas exportados continuam vindo inteiros
      for (const n of deps.notes.list()) {
        if (n.scope.startsWith('marker:')) scopes.push(n.scope);
      }
    }
    out.data.notes = deps.notes.exportNotes(scopes, { includeShots });
  }

  if (parts.includes('history')) {
    out.data.history = {};
    let files = [];
    try { files = fs.readdirSync(deps.historyDir()); } catch { files = []; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      if (only && !only.has(id)) continue;
      const d = readJson(path.join(deps.historyDir(), f), null);
      if (d) out.data.history[id] = d;
    }
  }

  return out;
}

// Só para a tela de exportação mostrar "vai levar ~12 MB".
function estimateSize(backup) {
  try { return Buffer.byteLength(JSON.stringify(backup), 'utf8'); } catch { return 0; }
}

// ------------------------------------------------------------
// Ler e conferir antes de importar
// ------------------------------------------------------------
// Devolve um RESUMO. A tela mostra isso e só então o usuário
// confirma — importar às cegas um arquivo de outra pessoa por cima
// da sua lista é exatamente o tipo de coisa que não tem desfazer.
function inspect(backup) {
  if (!backup || backup.format !== FORMAT) {
    return { ok: false, reason: 'not_a_backup' };
  }
  if (Number(backup.version) > VERSION) {
    return { ok: false, reason: 'newer_version', version: backup.version };
  }
  const d = backup.data || {};
  return {
    ok: true,
    version: backup.version,
    app: backup.app || '',
    createdAt: backup.createdAt || '',
    parts: backup.parts || [],
    counts: {
      servers: (d.servers || []).length,
      folders: (d.folders || []).length,
      settings: d.settings ? 1 : 0,
      markers: Object.keys(d.markers || {}).length,
      notes: ((d.notes || {}).notes || []).length,
      shots: Object.keys((d.notes || {}).shots || {}).length,
      history: Object.keys(d.history || {}).length
    }
  };
}

// ------------------------------------------------------------
// Importar
// ------------------------------------------------------------
// mode: 'merge' (padrão, não sobrescreve o que já existe)
//       'replace' (o do backup vence em caso de conflito)
function applyBackup(deps, backup, opts = {}) {
  const check = inspect(backup);
  if (!check.ok) return { ok: false, reason: check.reason };

  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const parts = (opts.parts && opts.parts.length ? opts.parts : (backup.parts || ALL_PARTS))
    .filter((p) => ALL_PARTS.includes(p));
  const d = backup.data || {};
  const cfg = readJson(deps.configPath(), {});
  if (!Array.isArray(cfg.servers)) cfg.servers = [];
  if (!Array.isArray(cfg.folders)) cfg.folders = [];

  const result = { ok: true, mode, added: {}, skipped: {}, warnings: [] };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  // --- Pastas antes dos servidores: um servidor pode apontar para
  // uma pasta que só existe no backup.
  if (parts.includes('folders') && Array.isArray(d.folders)) {
    const byId = new Map(cfg.folders.map((f) => [f.id, f]));
    for (const f of d.folders) {
      if (!f || !f.id) continue;
      if (byId.has(f.id)) {
        if (mode === 'replace') { cfg.folders[cfg.folders.findIndex((x) => x.id === f.id)] = f; bump(result.added, 'folders'); }
        else bump(result.skipped, 'folders');
      } else { cfg.folders.push(f); bump(result.added, 'folders'); }
    }
  }

  if (parts.includes('servers') && Array.isArray(d.servers)) {
    const key = (s) => String(s.bmId || s.id || (s.ip + ':' + s.port));
    const byKey = new Map(cfg.servers.map((s) => [key(s), s]));
    const folderIds = new Set(cfg.folders.map((f) => f.id));
    for (const s of d.servers) {
      if (!s) continue;
      // Pasta que não veio junto vira "sem pasta" em vez de um
      // servidor invisível preso numa pasta fantasma.
      if (s.folderId && !folderIds.has(s.folderId)) s.folderId = null;
      const k = key(s);
      if (byKey.has(k)) {
        if (mode === 'replace') { cfg.servers[cfg.servers.findIndex((x) => key(x) === k)] = s; bump(result.added, 'servers'); }
        else bump(result.skipped, 'servers');
      } else { cfg.servers.push(s); bump(result.added, 'servers'); }
    }
  }

  if (parts.includes('settings') && d.settings) {
    const s = { ...d.settings };
    delete s.servers; delete s.folders; delete s.logs;
    for (const k of SECRET_KEYS) delete s[k];
    if (s.steam) { s.steam = { ...s.steam }; for (const k of SECRET_STEAM_KEYS) delete s.steam[k]; }
    // Caminhos de instalação são da MÁQUINA, não do usuário: um
    // backup do PC do amigo apontaria para um drive que não existe.
    delete s.unturnedPath; delete s.unturnedLogPath;
    Object.assign(cfg, s);
    result.added.settings = 1;
    result.warnings.push('settings_secrets_excluded');
  }

  writeJson(deps.configPath(), cfg);

  if (parts.includes('markers') && d.markers) {
    for (const [mapName, data] of Object.entries(d.markers)) {
      const file = path.join(deps.mapsDir(), mapName, 'markers.json');
      const current = readJson(file, { worldSize: null, markers: [] });
      if (mode === 'replace' || !current.markers.length) {
        writeJson(file, data);
        bump(result.added, 'markers');
      } else {
        // Junta sem duplicar: mesmo nome + mesma coordenada é o
        // mesmo ponto, mesmo tendo vindo de outra pessoa.
        const seen = new Set(current.markers.map((m) => `${m.type}|${m.x}|${m.z}|${m.name}`));
        let n = 0;
        for (const m of data.markers || []) {
          const sig = `${m.type}|${m.x}|${m.z}|${m.name}`;
          if (seen.has(sig)) continue;
          seen.add(sig); current.markers.push(m); n++;
        }
        if (!current.worldSize && data.worldSize) current.worldSize = data.worldSize;
        if (n) { writeJson(file, current); bump(result.added, 'markers'); }
        else bump(result.skipped, 'markers');
      }
    }
  }

  if (parts.includes('notes') && d.notes) {
    const r = deps.notes.importNotes(d.notes, { mode });
    result.added.notes = r.notes;
    result.added.shots = r.shots;
  }

  if (parts.includes('history') && d.history) {
    for (const [id, data] of Object.entries(d.history)) {
      const file = path.join(deps.historyDir(), id + '.json');
      if (fs.existsSync(file) && mode === 'merge') { bump(result.skipped, 'history'); continue; }
      writeJson(file, data);
      bump(result.added, 'history');
    }
  }

  return result;
}

// ------------------------------------------------------------
// Reset total
// ------------------------------------------------------------
// Apaga tudo que o app criou. NÃO apaga a instalação do Unturned,
// obviamente — só a pasta de dados do Unturned+. `keep` permite
// segurar algo (na prática, os mapas importados: baixá-los de novo
// leva minutos e eles não são "seus dados").
function resetAll(deps, { keep = [] } = {}) {
  const userData = deps.userDataPath();
  const removed = [];
  const targets = [
    { name: 'settings', p: deps.configPath() },
    { name: 'maps', p: deps.mapsDir() },
    { name: 'history', p: deps.historyDir() },
    { name: 'notes', p: path.join(userData, 'notes') },
    { name: 'geo', p: path.join(userData, 'geo.json') },
    { name: 'workshop', p: path.join(userData, 'workshop.json') },
    { name: 'steam', p: path.join(userData, 'steam.json') }
  ];
  for (const t of targets) {
    if (keep.includes(t.name)) continue;
    try {
      if (fs.existsSync(t.p)) { fs.rmSync(t.p, { recursive: true, force: true }); removed.push(t.name); }
    } catch (e) {
      // Não aborta: um arquivo travado não pode impedir o reset do resto.
      removed.push(t.name + ':failed');
    }
  }
  return { ok: true, removed };
}

module.exports = { FORMAT, VERSION, ALL_PARTS, buildBackup, estimateSize, inspect, applyBackup, resetAll };
