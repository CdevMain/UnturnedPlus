// ============================================================
// inventoryStore.js — Inventário por servidor + catálogo de itens
//
// Duas coisas moram aqui, as duas no processo principal:
//
//  1. O CATÁLOGO de itens, lido dos arquivos do jogo instalado e
//     dos mods do Workshop (os mesmos .dat que o jogo lê). Dele vêm
//     nome, ID, GUID, raridade, o tamanho do item na mochila
//     (Size_X/Size_Y) e — para baús, safes e armários — o tamanho
//     do storage (Storage_X/Storage_Y). Também lemos as tabelas de
//     spawn (Bundles/Spawns) e o Spawns/Items.dat de cada mapa
//     para saber em que mapa cada item nasce.
//
//  2. Os DADOS de cada servidor: quanto você tem de cada item fora
//     das bases, e as bases (andares, chão, paredes, storages e o
//     que está dentro de cada storage).
//
// Ícones: o jogo exporta todos em Extras/Icons quando você usa
// Workshop → F1 → "All Item Icons". Se a pasta existir, usamos.
// Sem ela, o renderer cai no ícone baixado pelo raid:icon (só
// itens do jogo base têm ícone nesse CDN).
// ============================================================

const fs = require('fs');
const path = require('path');

let dir = null;              // <userData>/inventory
let catalogCache = null;     // catálogo já lido do disco

function init(userDataPath) {
  dir = path.join(userDataPath, 'inventory');
  fs.mkdirSync(path.join(dir, 'servers'), { recursive: true });
}

const catalogFile = () => path.join(dir, 'catalog.json');
const settingsFile = () => path.join(dir, 'settings.json');

// O ID do servidor vira nome de arquivo. Servidor adicionado por IP
// tem ID "local:1.2.3.4:27015" — dois-pontos não pode no Windows.
function serverFile(serverId) {
  const safe = String(serverId || 'none').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return path.join(dir, 'servers', safe + '.json');
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}

// Gravação atômica: um crash no meio não pode deixar o inventário
// de alguém pela metade.
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, p);
}

// ------------------------------------------------------------
// Dados por servidor
// ------------------------------------------------------------
function loadData(serverId) { return readJson(serverFile(serverId), null); }
function saveData(serverId, data) { writeJson(serverFile(serverId), data); return true; }

function settings() { return readJson(settingsFile(), { workshopPath: '', extraFolders: [] }); }
function saveSettings(patch) {
  const s = { ...settings(), ...(patch || {}) };
  s.extraFolders = [...new Set((s.extraFolders || []).filter(Boolean))];
  writeJson(settingsFile(), s);
  return s;
}

// ------------------------------------------------------------
// Leitor de .dat
// ------------------------------------------------------------
const ITEM_TYPES = new Set(('hat pants shirt mask backpack vest glasses gun sight tactical grip barrel magazine food water medical melee fuel tool barricade storage beacon farm trap structure supply throwable grower optic refill fisher cloud map key box arrest_start arrest_end tank generator detonator charge library filter sentry vehicle_repair_tool tire compass oil_pump').split(' '));
const LANG_FILES = /^(english|portuguese|brazilian|spanish|russian|german|french|polish|chinese|schinese|tchinese|japanese|korean|turkish|italian|dutch|czech|ukrainian|swedish|finnish|norwegian|danish|hungarian|romanian|thai|vietnamese|arabic|greek|bulgarian|latam)\.dat$/i;

// Chaves do nível raiz em `top`; as de dentro de blocos em `deep`
// (formato v2 guarda algumas propriedades dentro de { }).
function parseDat(text) {
  const top = {}, deep = {};
  let depth = 0;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const c = line.indexOf(' //'); if (c > 0) line = line.slice(0, c).trim();
    if (line === '{' || line === '[') { depth++; continue; }
    if (line === '}' || line === ']') { depth = Math.max(0, depth - 1); continue; }
    const m = line.match(/^"?([A-Za-z0-9_.]+)"?(?:\s+(.*))?$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = (m[2] || '').trim().replace(/^"(.*)"$/, '$1');
    const bag = depth === 0 ? top : deep;
    if (!(key in bag)) bag[key] = val;
  }
  return { top, deep };
}
const pick = (p, k) => (p.top[k] !== undefined ? p.top[k] : p.deep[k]);
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

function normalizeType(t) {
  if (!t) return null;
  let s = String(t).trim();
  // Formato novo: "SDG.Unturned.ItemBarricadeAsset, Assembly-CSharp"
  const cls = s.match(/Item([A-Za-z]+)Asset/);
  if (cls) s = cls[1].replace(/([a-z])([A-Z])/g, '$1_$2');
  s = s.toLowerCase();
  return ITEM_TYPES.has(s) ? s : null;
}

function parseItem(datText, langText, assetName) {
  const p = parseDat(datText);
  const type = normalizeType(pick(p, 'type'));
  if (!type) return null;
  const idRaw = pick(p, 'id');
  const id = idRaw && /^\d+$/.test(idRaw) ? parseInt(idRaw, 10) : null;
  const guid = (pick(p, 'guid') || '').toLowerCase().replace(/[^0-9a-f]/g, '') || null;
  if (id == null && !guid) return null;
  let name = null, desc = null;
  if (langText) { const l = parseDat(langText); name = l.top.name || null; desc = l.top.description || null; }
  const it = {
    id, guid, type,
    rarity: (pick(p, 'rarity') || 'common').toLowerCase(),
    name: name || String(assetName || '').replace(/_/g, ' '),
    desc: desc || undefined,
    asset: assetName,
    sx: Math.max(1, Math.round(num(p.top.size_x, 1))),
    sy: Math.max(1, Math.round(num(p.top.size_y, 1)))
  };
  if (p.top.storage_x || p.top.storage_y) {
    it.storage = {
      w: Math.max(1, Math.round(num(p.top.storage_x, 1))),
      h: Math.max(1, Math.round(num(p.top.storage_y, 1)))
    };
    it.build = String(p.top.build || '').toLowerCase();
  }
  if (p.top.amount) it.amount = Math.round(num(p.top.amount, 0)) || undefined;

  // Placeables (barricadas): o que o planejador de bases precisa.
  //   Radius            raio livre exigido para colocar (m) — o "tamanho" no chão
  //   Wirerange         alcance do gerador (m)
  //   Detection_Radius  alcance da sentry (m, padrão 48)
  //   PlaceableProvidesCraftingTags  estação de criação (raio 8 m no jogo)
  if (/^(barricade|generator|sentry|beacon|oil_pump|tank|library|trap|storage)$/.test(type)) {
    it.build = String(p.top.build || it.build || '').toLowerCase();
    if (p.top.radius !== undefined) it.pr = num(p.top.radius, 0.5);
    if (p.top.health !== undefined) it.hp = Math.round(num(p.top.health, 0));
    if (p.top.wirerange !== undefined) it.wire = num(p.top.wirerange, 0);
    if (type === 'sentry') it.det = num(p.top.detection_radius, 48);
    if (/(^|\n)\s*PlaceableProvidesCraftingTags/i.test(datText)) it.craft = true;
  }
  return it;
}

// ------------------------------------------------------------
// Tabelas de spawn e Spawns/Items.dat dos mapas
// ------------------------------------------------------------
function parseSpawnAsset(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let guid = null, id = null, type = null;
  const refs = [], roots = [];
  let depth = 0, listKey = null, pendingKey = null, cur = null;
  for (const raw of lines) {
    let line = raw.trim();
    const c = line.indexOf('//'); if (c >= 0) line = line.slice(0, c).trim();
    if (!line) continue;
    if (line === '[') { depth++; if (depth === 1) listKey = pendingKey; continue; }
    if (line === ']') { depth = Math.max(0, depth - 1); if (depth === 0) listKey = null; continue; }
    if (line === '{') { depth++; cur = {}; continue; }
    if (line === '}') {
      depth = Math.max(0, depth - 1);
      if (cur && (cur.s != null || cur.a != null || cur.g)) (listKey === 'roots' ? roots : refs).push(cur);
      cur = null; continue;
    }
    const m = line.match(/^"?([A-Za-z0-9_]+)"?(?:\s+"?([^"]*)"?)?$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = (m[2] || '').trim();
    if (cur) {
      if (key === 'guid') cur.g = val.toLowerCase().replace(/[^0-9a-f]/g, '');
      else if (key === 'legacyspawnid') cur.s = parseInt(val, 10);
      else if (key === 'legacyassetid') cur.a = parseInt(val, 10);
      continue;
    }
    if (depth !== 0) continue;
    pendingKey = null;
    if (key === 'guid') guid = val.toLowerCase().replace(/[^0-9a-f]/g, '');
    else if (key === 'id') id = parseInt(val, 10);
    else if (key === 'type') type = val.toLowerCase();
    else if (key === 'tables' || key === 'roots') pendingKey = key;
    else if (/^table_\d+_spawn_id$/.test(key)) refs.push({ s: parseInt(val, 10) });
    else if (/^table_\d+_asset_id$/.test(key)) refs.push({ a: parseInt(val, 10) });
    else if (/^root_\d+_spawn_id$/.test(key)) roots.push({ s: parseInt(val, 10) });
  }
  if (type !== 'spawn' && !/spawnasset/.test(type || '')) return null;
  return { guid, id: Number.isFinite(id) ? id : null, refs, roots };
}

// Spawns/Items.dat do mapa é binário:
//   u8 versão, u8 quantidade; por tabela: rgb(3), string (u8 len),
//   u16 id da tabela, u8 tiers; por tier: string, f32, u8 n, u16[n].
function parseMapItems(buf) {
  const b = new Uint8Array(buf); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = { tables: [], inline: [] };
  if (b.length < 3) return out;
  let i = 1; const n = b[i++];
  try {
    for (let k = 0; k < n; k++) {
      i += 3; const L = b[i++]; i += L;
      const tid = dv.getUint16(i, true); i += 2;
      const tc = b[i++];
      for (let t = 0; t < tc; t++) {
        const L2 = b[i++]; i += L2 + 4; const c = b[i++];
        for (let x = 0; x < c; x++) { out.inline.push(dv.getUint16(i, true)); i += 2; }
      }
      if (tid) out.tables.push(tid);
    }
  } catch { /* arquivo truncado: fica o que deu para ler */ }
  return out;
}

// Para cada mapa, desce pelas tabelas de spawn até os itens.
// Devolve { "id:N" | "g:<guid>": [mapas] }.
function computeMapIndex(spawnAssets, maps) {
  const nodes = spawnAssets.map((s) => ({ s, kids: [] }));
  const byId = new Map(), byGuid = new Map();
  for (const n of nodes) { if (n.s.id != null) byId.set(n.s.id, n); if (n.s.guid) byGuid.set(n.s.guid, n); }
  const find = (r) => (r.s != null ? byId.get(r.s) : r.g ? byGuid.get(r.g) : null);
  for (const n of nodes) for (const r of n.s.roots) { const p = find(r); if (p) p.kids.push(n); }
  const index = {};
  const mark = (k, name) => { const a = index[k] || (index[k] = []); if (!a.includes(name)) a.push(name); };
  for (const [name, m] of Object.entries(maps)) {
    const seen = new Set(); const st = [];
    for (const t of m.tables) { const n = byId.get(t); if (n) st.push(n); }
    for (const id of m.inline) mark('id:' + id, name);
    while (st.length) {
      const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
      for (const k of n.kids) st.push(k);
      for (const r of n.s.refs) {
        if (r.s != null) { const c = byId.get(r.s); if (c) st.push(c); }
        else if (r.a != null) mark('id:' + r.a, name);
        else if (r.g) { const c = byGuid.get(r.g); if (c) st.push(c); else mark('g:' + r.g, name); }
      }
    }
  }
  return index;
}

// ------------------------------------------------------------
// Varredura
// ------------------------------------------------------------
async function walk(d, out, depth = 0) {
  if (depth > 14) return;
  let ents;
  try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (/\.(dat|asset)$/i.test(e.name)) out.push(p);
  }
}

async function mapLimit(list, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < list.length) { const k = i++; await fn(list[k], k); }
  });
  await Promise.all(workers);
}

// Uma "fonte" é a pasta do jogo ou a pasta de um mod.
async function scanSource(root, sourceId, onProgress) {
  const files = [];
  // No jogo, só Bundles e Maps interessam: varrer a pasta inteira
  // (Logs, Screenshots, Servers...) só gastaria tempo.
  const isGame = fs.existsSync(path.join(root, 'Bundles')) && fs.existsSync(path.join(root, 'Maps'));
  if (isGame) { for (const sub of ['Bundles', 'Maps']) await walk(path.join(root, sub), files); }
  else await walk(root, files);

  const dirs = new Map(); const maps = {}; const spawns = []; let bundleFile = null;
  const mapFiles = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    const mm = norm.match(/\/([^/]+)\/Spawns\/Items\.dat$/i);
    if (mm && !/\/Bundles\/Spawns\//i.test(norm)) { mapFiles.push([mm[1], f]); continue; }
    const d = path.dirname(f);
    if (/[\\/]spawns$/i.test(d)) continue;
    const base = path.basename(f);
    if (/^masterbundle\.dat$/i.test(base)) { if (!bundleFile) bundleFile = f; continue; }
    if (!dirs.has(d)) dirs.set(d, { lang: null, cands: [] });
    const e = dirs.get(d);
    if (LANG_FILES.test(base)) { if (!e.lang || /^english\.dat$/i.test(base)) e.lang = f; }
    else e.cands.push(f);
  }
  for (const [name, f] of mapFiles) {
    try { maps[name] = parseMapItems(await fs.promises.readFile(f)); } catch { /* segue */ }
  }
  // Nome do mod: o prefixo do MasterBundle costuma ser o nome dele.
  let label = null;
  if (bundleFile) {
    try {
      const mb = parseDat(await fs.promises.readFile(bundleFile, 'utf8'));
      const pre = mb.top.asset_prefix || '';
      label = (pre.split('/').pop() || String(mb.top.asset_bundle_name || '').replace(/\.masterbundle$/i, ''))
        .replace(/_/g, ' ') || null;
    } catch { /* segue */ }
  }

  const items = []; const entries = [...dirs]; let done = 0;
  await mapLimit(entries, 16, async ([d, e]) => {
    const folder = path.basename(d);
    // O .dat com o nome da pasta é o asset; os outros são extras.
    e.cands.sort((a, b) => (path.parse(b).name === folder) - (path.parse(a).name === folder));
    let langText = null;
    for (const c of e.cands) {
      let st; try { st = await fs.promises.stat(c); } catch { continue; }
      if (st.size > 400000) continue;
      let text; try { text = await fs.promises.readFile(c, 'utf8'); } catch { continue; }
      if (!/(^|\n)\s*"?(ID|GUID)"?\s/i.test(text) || !/(^|\n)\s*"?Type"?\s/i.test(text)) continue;
      if (/(^|\n)\s*"?Type"?\s+"?Spawn/i.test(text)) { const s = parseSpawnAsset(text); if (s) { spawns.push(s); break; } }
      if (langText === null && e.lang) { try { langText = await fs.promises.readFile(e.lang, 'utf8'); } catch { langText = ''; } }
      const it = parseItem(text, langText, path.parse(c).name);
      if (it) { it.sourceId = sourceId; items.push(it); break; }
    }
    if (++done % 200 === 0 && onProgress) onProgress(done, entries.length);
  });
  return { items, spawns, maps, label };
}

function findIcons(d) {
  const icons = {};
  try {
    for (const f of fs.readdirSync(d)) {
      if (/\.png$/i.test(f)) icons[path.parse(f).name.toLowerCase()] = path.join(d, f);
    }
  } catch { /* sem pasta de ícones */ }
  return icons;
}

// O Workshop fica fora da pasta do jogo:
//   .../steamapps/common/Unturned  ->  .../steamapps/workshop/content/304930
function workshopFor(gamePath) {
  if (!gamePath) return '';
  const p = path.resolve(gamePath, '..', '..', 'workshop', 'content', '304930');
  return fs.existsSync(p) ? p : '';
}

async function scanCatalog({ gamePath, workshopPath, extraFolders = [] }, say = () => {}) {
  const sources = []; const all = []; const spawns = []; const maps = {};

  if (gamePath && fs.existsSync(gamePath)) {
    say({ step: 'game' });
    const r = await scanSource(gamePath, 'game', (d, t) => say({ step: 'game', done: d, total: t }));
    sources.push({ id: 'game', label: 'Unturned', kind: 'game', count: r.items.length });
    all.push(...r.items); spawns.push(...r.spawns); Object.assign(maps, r.maps);
  }

  const modDirs = [];
  if (workshopPath && fs.existsSync(workshopPath)) {
    for (const d of fs.readdirSync(workshopPath)) {
      const p = path.join(workshopPath, d);
      try { if (fs.statSync(p).isDirectory()) modDirs.push([d, p]); } catch { /* segue */ }
    }
  }
  for (const p of extraFolders) if (p && fs.existsSync(p)) modDirs.push([path.basename(p), p]);

  let k = 0;
  for (const [id, p] of modDirs) {
    k++; say({ step: 'mods', done: k, total: modDirs.length, name: id });
    const r = await scanSource(p, 'mod:' + id);
    if (!r.items.length && !Object.keys(r.maps).length) continue;
    sources.push({ id: 'mod:' + id, label: r.label || id, workshopId: /^\d+$/.test(id) ? id : null, kind: 'mod', count: r.items.length });
    all.push(...r.items); spawns.push(...r.spawns); Object.assign(maps, r.maps);
  }

  say({ step: 'spawns' });
  const mapIndex = computeMapIndex(spawns, maps);
  const mapNames = Object.keys(maps).filter((n) => maps[n].tables.length || maps[n].inline.length).sort();

  // Ícones exportados pelo jogo: <Asset>_<ID>.png
  const icons = gamePath ? findIcons(path.join(gamePath, 'Extras', 'Icons')) : {};
  const iconById = new Map();
  for (const stem of Object.keys(icons)) {
    const m = stem.match(/_(\d+)$/);
    if (m) { const id = +m[1]; iconById.set(id, (iconById.get(id) || 0) + 1); }
  }

  // Chave única: GUID quando há; senão fonte#ID (dois mods podem
  // reaproveitar o mesmo número).
  const byKey = new Map();
  let withIcon = 0;
  for (const it of all) {
    it.key = it.guid || `${it.sourceId}#${it.id}`;
    let p = null;
    if (it.asset) p = icons[(it.asset + '_' + it.id).toLowerCase()] || icons[String(it.asset).toLowerCase()];
    if (!p && it.id != null && iconById.get(it.id) === 1) {
      const stem = Object.keys(icons).find((s) => s.endsWith('_' + it.id));
      p = stem ? icons[stem] : null;
    }
    if (p) { it.icon = p; withIcon++; }
    byKey.set(it.key, it);
  }

  const cat = {
    version: 2, scannedAt: Date.now(), gamePath: gamePath || '', workshopPath: workshopPath || '',
    sources, items: [...byKey.values()], mapIndex, mapNames,
    iconCount: Object.keys(icons).length, withIcon
  };
  writeJson(catalogFile(), cat);
  catalogCache = cat;
  return cat;
}

function loadCatalog() {
  if (!catalogCache) catalogCache = readJson(catalogFile(), null);
  return catalogCache;
}

module.exports = {
  init, loadData, saveData, settings, saveSettings,
  scanCatalog, loadCatalog, workshopFor,
  // exportados para teste
  parseDat, parseItem, parseSpawnAsset, parseMapItems, computeMapIndex
};
