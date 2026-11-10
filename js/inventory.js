// ============================================================
// inventory.js — Inventário do servidor (aba "Inventário")
//
// Cada servidor tem o seu inventário: quanto você tem de cada item
// FORA das bases, mais o que está guardado dentro dos storages das
// bases (bases.js). O total de um item é a soma das duas coisas.
//
// O catálogo (nomes, IDs, ícones, tamanhos) vem dos arquivos do
// jogo e dos mods, lido no processo principal (inventoryStore.js).
// ============================================================

const IT = (k, v) => I18N.t('inv.' + k, v);

const RARITY_ORDER = { mythical: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5 };
const RARITY_COLOR = { common: '#b9bcb2', uncommon: '#4cc24c', rare: '#7d90ff', epic: '#b27dff', legendary: '#de72ff', mythical: '#ff6a50' };

// O PDF sai sempre em inglês, independente do idioma do app.
const TYPE_EN = { hat: 'Hats', pants: 'Pants', shirt: 'Shirts', mask: 'Masks', backpack: 'Backpacks', vest: 'Vests', glasses: 'Glasses', gun: 'Guns', sight: 'Sights', tactical: 'Tacticals', grip: 'Grips', barrel: 'Barrels', magazine: 'Ammo & Magazines', food: 'Food', water: 'Drinks', medical: 'Medical', melee: 'Melee', fuel: 'Fuel', tool: 'Tools', barricade: 'Barricades', storage: 'Storage', beacon: 'Beacons', farm: 'Farming', trap: 'Traps', structure: 'Structures', supply: 'Supplies', throwable: 'Throwables', grower: 'Growers', optic: 'Optics', refill: 'Refills', fisher: 'Fishing', cloud: 'Clouds', map: 'Maps', key: 'Keys', box: 'Boxes', arrest_start: 'Handcuffs', arrest_end: 'Handcuff Keys', tank: 'Tanks', generator: 'Generators', detonator: 'Detonators', charge: 'Charges', library: 'Libraries', filter: 'Filters', sentry: 'Sentries', vehicle_repair_tool: 'Vehicle Repair', tire: 'Tires', compass: 'Compasses', oil_pump: 'Oil Pumps' };
const RARITY_EN = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythical: 'Mythical' };

const Inv = {
  catalog: null,
  items: new Map(),       // key -> item
  storages: [],           // itens que são storage (baú, safe, armário...)
  data: null,             // dados do servidor aberto
  serverId: null,
  saveTimer: null,
  sub: 'items',           // items | bases
  filter: { q: '', type: '', map: '', mine: false, sort: 'id' },
  list: [], rendered: 0,
  placed: new Map(),      // key -> { qty, locs: [] }
  selectedKey: null
};

const invUid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const invNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const invEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const invTypeLabel = (t) => IT('type.' + t);
const invRarityLabel = (r) => (RARITY_COLOR[r] ? IT('rarity.' + r) : r);

// ------------------------------------------------------------
// Ícones
//
// 1) o PNG exportado pelo jogo (Extras/Icons), quando existe;
// 2) senão, para item do jogo base, o mesmo CDN da calculadora de
//    raid (baixado uma vez e guardado em cache pelo processo
//    principal). Item de mod não tem ícone em CDN: fica a sigla.
// ------------------------------------------------------------
const InvIcons = {
  url: new Map(),      // key -> url | null (null = não tem)
  queue: [], busy: 0,
  redrawTimer: null,

  get(it) {
    if (!it) return null;
    if (it.icon) return it.icon;
    if (this.url.has(it.key)) return this.url.get(it.key);
    if (it.sourceId === 'game' && (it.guid || it.id)) this.request(it);
    else this.url.set(it.key, null);
    return null;
  },

  request(it) {
    this.url.set(it.key, null);   // marca como "pedido", não repete
    this.queue.push(it);
    this.pump();
  },

  pump() {
    while (this.busy < 6 && this.queue.length) {
      const it = this.queue.shift();
      this.busy++;
      window.api.raidIcon({ guid: it.guid, id: it.id })
        .then((u) => { if (u) { this.url.set(it.key, u); this.arrived(it.key, u); } })
        .catch(() => {})
        .finally(() => { this.busy--; this.pump(); });
    }
  },

  // Troca a sigla pelo ícone nos lugares que já estão na tela.
  arrived(key, u) {
    for (const el of document.querySelectorAll(`[data-ik="${CSS.escape(key)}"]`)) {
      const img = document.createElement('img');
      img.src = u; img.alt = ''; img.draggable = false;
      if (el.dataset.rot) { img.className = 'rot'; img.style.cssText = el.dataset.rot; }
      el.replaceWith(img);
    }
    clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => { if (typeof basesRedrawAll === 'function') basesRedrawAll(); }, 250);
  }
};

function invIcon(it) { return InvIcons.get(it); }

// <img> pronto ou a sigla do tipo (que vira ícone quando chegar).
function invIconHtml(it, extra = '') {
  const u = invIcon(it);
  if (u) return `<img src="${invEsc(u)}" alt="" draggable="false" ${extra}>`;
  const sig = it ? invTypeLabel(it.type).slice(0, 3).toUpperCase() : '?';
  return `<span class="inv-ph" ${it ? `data-ik="${invEsc(it.key)}"` : ''}>${invEsc(sig)}</span>`;
}

function invMaps(it) {
  const idx = (Inv.catalog && Inv.catalog.mapIndex) || {};
  const s = new Set();
  ((it.guid && idx['g:' + it.guid]) || []).forEach((m) => s.add(m));
  ((it.id != null && idx['id:' + it.id]) || []).forEach((m) => s.add(m));
  return s;
}

// ------------------------------------------------------------
// Catálogo
// ------------------------------------------------------------
function invIndexCatalog(cat) {
  Inv.catalog = cat && cat.items ? cat : null;
  Inv.items = new Map(); Inv.storages = [];
  if (!Inv.catalog) return;
  for (const it of cat.items) {
    Inv.items.set(it.key, it);
    if (it.storage) Inv.storages.push(it);
  }
  Inv.storages.sort((a, b) => (b.storage.w * b.storage.h) - (a.storage.w * a.storage.h) || a.name.localeCompare(b.name));
}

async function invEnsureCatalog() {
  if (Inv.catalog) return Inv.catalog;
  try { invIndexCatalog(await window.api.invCatalog()); } catch { invIndexCatalog(null); }
  return Inv.catalog;
}

function invCatalogSummary() {
  const c = Inv.catalog;
  if (!c) return IT('cat.none');
  return IT('cat.summary', {
    items: c.items.length.toLocaleString(),
    sources: c.sources.length,
    icons: (c.withIcon || 0).toLocaleString(),
    storages: Inv.storages.length,
    when: new Date(c.scannedAt).toLocaleString()
  });
}

function invProgressText(m) {
  if (!m) return '';
  if (m.step === 'game') return m.total ? IT('scan.game', { done: m.done, total: m.total }) : IT('scan.gameStart');
  if (m.step === 'mods') return IT('scan.mods', { done: m.done, total: m.total, name: m.name || '' });
  if (m.step === 'spawns') return IT('scan.spawns');
  return '';
}

async function invScan() {
  const btns = document.querySelectorAll('.inv-scan-btn');
  const outs = document.querySelectorAll('.inv-scan-status');
  btns.forEach((b) => { b.disabled = true; });
  outs.forEach((o) => { o.textContent = IT('scan.gameStart'); });
  const off = window.api.onInvProgress((m) => outs.forEach((o) => { o.textContent = invProgressText(m); }));
  try {
    const r = await window.api.invScan();
    if (!r || !r.ok) {
      const msg = r && r.error === 'no_game' ? IT('scan.noGame') : IT('scan.failed', { err: (r && r.error) || '' });
      outs.forEach((o) => { o.textContent = msg; });
      toast(msg);
      return;
    }
    invIndexCatalog(r.catalog);
    InvIcons.url.clear();
    outs.forEach((o) => { o.textContent = invCatalogSummary(); });
    toast(IT('scan.done', { n: r.catalog.items.length.toLocaleString() }));
    invRenderCatalogModal();
    if (Inv.serverId) invRender();
  } finally {
    if (typeof off === 'function') off();
    btns.forEach((b) => { b.disabled = false; });
  }
}

// ------------------------------------------------------------
// Dados do servidor
// ------------------------------------------------------------
function invEmptyData() { return { version: 2, counts: {}, bases: [] }; }

async function invLoadServer(serverId) {
  if (Inv.serverId === serverId && Inv.data) return;
  await invFlush();
  Inv.serverId = serverId;
  Inv.selectedKey = null;
  let d = null;
  try { d = await window.api.invLoad(serverId); } catch { d = null; }
  Inv.data = d && typeof d === 'object' ? Object.assign(invEmptyData(), d) : invEmptyData();
  if (typeof basesMigrate === 'function') basesMigrate(Inv.data);
  invRecount();
  if (typeof basesOnServerChanged === 'function') basesOnServerChanged();
}

function invSave() {
  clearTimeout(Inv.saveTimer);
  const sid = Inv.serverId, data = Inv.data;
  if (!sid || !data) return;
  Inv.saveTimer = setTimeout(async () => {
    Inv.saveTimer = null;
    const ok = await window.api.invSave(sid, data).catch(() => false);
    if (!ok) toast(IT('saveFailed'));
  }, 400);
}

// Grava o que estiver pendente agora (troca de servidor).
async function invFlush() {
  if (!Inv.saveTimer) return;
  clearTimeout(Inv.saveTimer); Inv.saveTimer = null;
  if (Inv.serverId && Inv.data) await window.api.invSave(Inv.serverId, Inv.data).catch(() => false);
}

// Conta os itens guardados nos storages de todas as bases.
function invRecount() {
  const placed = new Map();
  if (Inv.data) {
    for (const base of Inv.data.bases) for (const floor of base.floors) for (const st of floor.storages) {
      for (const it of st.items) {
        let p = placed.get(it.key);
        if (!p) { p = { qty: 0, locs: [] }; placed.set(it.key, p); }
        const n = 1;
        p.qty += n;
        let loc = p.locs.find((l) => l.storageId === st.id);
        if (!loc) { loc = { baseId: base.id, floorId: floor.id, storageId: st.id, qty: 0 }; p.locs.push(loc); }
        loc.qty += n;
      }
    }
  }
  Inv.placed = placed;
}

const invExtra = (key) => (Inv.data && Inv.data.counts[key]) || 0;
const invPlaced = (key) => (Inv.placed.get(key) || { qty: 0 }).qty;
const invTotal = (key) => invExtra(key) + invPlaced(key);

function invServerName() {
  const s = (AppState.config.servers || []).find((x) => x.bmId === Inv.serverId);
  return (s && s.name) || String(Inv.serverId || '');
}

// ------------------------------------------------------------
// Aba
// ------------------------------------------------------------
async function openInventoryTab() {
  const sid = AppState.trackingId;
  if (!sid) return;
  await invEnsureCatalog();
  await invLoadServer(sid);
  invRender();
}

function invRender() {
  const hasCat = !!(Inv.catalog && Inv.catalog.items.length);
  document.getElementById('inv-onboard').classList.toggle('hidden', hasCat);
  document.getElementById('inv-items').classList.toggle('hidden', !hasCat || Inv.sub !== 'items');
  document.getElementById('inv-bases').classList.toggle('hidden', !hasCat || Inv.sub !== 'bases');
  document.querySelectorAll('#inv-subtabs .inv-subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === Inv.sub));
  document.getElementById('inv-subtabs').classList.toggle('hidden', !hasCat);
  document.getElementById('inv-pdf').disabled = !hasCat;
  if (!hasCat) { invRenderOnboard(); return; }
  invUpdateStats();
  if (Inv.sub === 'items') { invRenderChips(); invRenderMapSelect(); invApplyFilter(); }
  else if (typeof basesRender === 'function') basesRender();
}

function invUpdateStats() {
  if (!Inv.data) return;
  let types = 0, units = 0, inBases = 0;
  const keys = new Set([...Object.keys(Inv.data.counts), ...Inv.placed.keys()]);
  for (const k of keys) { const t = invTotal(k); if (t > 0) { types++; units += t; } inBases += invPlaced(k); }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('inv-stat-types', types.toLocaleString());
  set('inv-stat-units', units.toLocaleString());
  set('inv-stat-inbase', inBases.toLocaleString());
  set('inv-stat-bases', Inv.data.bases.length);
}

async function invRenderOnboard() {
  const p = await window.api.invPaths().catch(() => ({}));
  const g = document.getElementById('inv-onb-game');
  g.textContent = p.gamePath || IT('cat.gameMissing');
  g.classList.toggle('missing', !p.gamePath);
  document.getElementById('inv-onb-workshop').textContent = p.workshopPath || IT('cat.workshopMissing');
  document.getElementById('inv-onb-scan').disabled = !p.gamePath;
}

// ---------- itens ----------
function invRenderChips() {
  const box = document.getElementById('inv-chips');
  const counts = {};
  for (const it of Inv.items.values()) counts[it.type] = (counts[it.type] || 0) + 1;
  const chip = (type, label, n) =>
    `<button class="inv-chip${Inv.filter.type === type ? ' active' : ''}" data-type="${invEsc(type)}">${invEsc(label)}<span>${n}</span></button>`;
  box.innerHTML = chip('', IT('all'), Inv.items.size) +
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((t) => chip(t, invTypeLabel(t), counts[t])).join('');
}

function invRenderMapSelect() {
  const sel = document.getElementById('inv-map');
  const cur = Inv.filter.map;
  sel.innerHTML = `<option value="">${invEsc(IT('map.any'))}</option>` +
    (Inv.catalog.mapNames || []).map((n) =>
      `<option value="in:${invEsc(n)}">${invEsc(IT('map.in', { map: n }))}</option>` +
      `<option value="only:${invEsc(n)}">${invEsc(IT('map.only', { map: n }))}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  Inv.filter.map = sel.value;
}

function invApplyFilter() {
  const f = Inv.filter; const q = invNorm(f.q.trim());
  const qId = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null;
  const list = [...Inv.items.values()].filter((it) => {
    if (f.type && it.type !== f.type) return false;
    if (f.mine && !(invTotal(it.key) > 0)) return false;
    if (f.map) {
      const i = f.map.indexOf(':'); const mode = f.map.slice(0, i), name = f.map.slice(i + 1);
      const ms = invMaps(it);
      if (!ms.has(name)) return false;
      if (mode === 'only' && ms.size !== 1) return false;
    }
    if (q) {
      if (qId != null) return it.id === qId || String(it.id).startsWith(String(qId));
      return invNorm(it.name).includes(q) || invNorm(it.asset).includes(q);
    }
    return true;
  });
  const byId = (a, b) => (a.id ?? 1e9) - (b.id ?? 1e9);
  const sorters = {
    id: byId,
    name: (a, b) => a.name.localeCompare(b.name) || byId(a, b),
    qty: (a, b) => invTotal(b.key) - invTotal(a.key) || byId(a, b),
    rarity: (a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9) || byId(a, b)
  };
  list.sort(sorters[f.sort] || byId);
  if (qId != null) list.sort((a, b) => (b.id === qId) - (a.id === qId));
  Inv.list = list; Inv.rendered = 0;
  document.getElementById('inv-grid').innerHTML = '';
  document.getElementById('inv-empty').classList.toggle('hidden', list.length > 0);
  document.getElementById('inv-count').textContent = list.length === 1 ? IT('result1') : IT('results', { n: list.length.toLocaleString() });
  invRenderMore();
}

function invRenderMore() {
  const grid = document.getElementById('inv-grid');
  const end = Math.min(Inv.list.length, Inv.rendered + 160);
  let html = '';
  for (let i = Inv.rendered; i < end; i++) html += invTileHtml(Inv.list[i]);
  Inv.rendered = end;
  grid.insertAdjacentHTML('beforeend', html);
}

function invTileHtml(it) {
  const total = invTotal(it.key), placed = invPlaced(it.key);
  const rar = RARITY_COLOR[it.rarity] ? it.rarity : 'common';
  const cls = ['inv-slot', 'r-' + rar];
  if (total > 0) cls.push('has');
  if (Inv.selectedKey === it.key) cls.push('selected');
  return `<div class="${cls.join(' ')}" data-key="${invEsc(it.key)}" title="${invEsc(it.desc || it.name)}">
    <div class="inv-ico">${invIconHtml(it, 'loading="lazy"')}</div>
    <div class="inv-tile-meta"><div class="inv-name">${invEsc(it.name)}</div>
      <div class="inv-sub"><span>ID ${it.id ?? '—'}</span><span class="inv-rar">${invEsc(invRarityLabel(it.rarity))}</span></div></div>
    <div class="inv-qty"><button data-act="-" title="${invEsc(IT('less'))}">−</button><input type="number" min="0" value="${invExtra(it.key)}" title="${invEsc(IT('outsideHint'))}"><button data-act="+" title="${invEsc(IT('more'))}">+</button></div>
    ${total > 0 ? `<span class="inv-badge">×${total}</span>` : ''}
    ${placed > 0 ? `<span class="inv-inbase" title="${invEsc(IT('inBasesHint'))}">${Icon.svg('home', 11)} ${placed}</span>` : ''}
  </div>`;
}

function invRefreshTile(key) {
  const el = document.querySelector(`#inv-grid .inv-slot[data-key="${CSS.escape(key)}"]`);
  const it = Inv.items.get(key);
  if (el && it) el.outerHTML = invTileHtml(it);
}

function invSetExtra(key, n) {
  n = Math.max(0, Math.min(999999, Math.floor(Number(n) || 0)));
  if (n > 0) Inv.data.counts[key] = n; else delete Inv.data.counts[key];
  invSave(); invUpdateStats(); invRefreshTile(key);
  if (Inv.selectedKey === key) invShowWhere(key);
}

// ---------- onde está ----------
function invLocLabel(l) {
  const base = Inv.data.bases.find((b) => b.id === l.baseId);
  const floor = base && base.floors.find((f) => f.id === l.floorId);
  const st = floor && floor.storages.find((s) => s.id === l.storageId);
  if (!st) return null;
  return { base, floor, st, name: st.label || (Inv.items.get(st.key) || {}).name || IT('storage') };
}

function invShowWhere(key) {
  Inv.selectedKey = key;
  document.querySelectorAll('#inv-grid .inv-slot.selected').forEach((e) => e.classList.remove('selected'));
  const tileEl = document.querySelector(`#inv-grid .inv-slot[data-key="${CSS.escape(key)}"]`);
  if (tileEl) tileEl.classList.add('selected');
  const it = Inv.items.get(key);
  const panel = document.getElementById('inv-where');
  if (!it) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const p = Inv.placed.get(key) || { qty: 0, locs: [] };
  const maps = [...invMaps(it)].sort();
  const rc = RARITY_COLOR[it.rarity] || '#ccc';
  const cmd = it.id != null ? `/give ${it.id}/${Math.max(1, invTotal(key))}` : '';
  const locs = p.locs.map((l) => ({ l, info: invLocLabel(l) })).filter((x) => x.info);
  panel.innerHTML = `
    <div class="inv-where-head">
      <div class="inv-where-ico">${invIconHtml(it)}</div>
      <div class="inv-where-title"><h3>${invEsc(it.name)}</h3>
        <small>ID ${it.id ?? '—'} · ${invEsc(invTypeLabel(it.type))} · <span style="color:${rc}">${invEsc(invRarityLabel(it.rarity))}</span> · ${it.sx}×${it.sy}</small></div>
      <button class="inv-x" id="inv-where-close" title="${invEsc(I18N.t('common.close'))}">${Icon.svg('close', 14)}</button>
    </div>
    <div class="inv-where-sum">
      <div><b>${invTotal(key)}</b><span>${invEsc(IT('total'))}</span></div>
      <div><b>${p.qty}</b><span>${invEsc(IT('inBases'))}</span></div>
      <div><b>${invExtra(key)}</b><span>${invEsc(IT('outside'))}</span></div>
    </div>
    ${cmd ? `<div class="inv-cmd"><code>${invEsc(cmd)}</code><button class="btn-small" id="inv-copy">${invEsc(IT('copy'))}</button></div>` : ''}
    <h4>${invEsc(IT('whereTitle'))}</h4>
    ${locs.length ? `<ul class="inv-locs">${locs.map(({ l, info }) => `
      <li><div><b>${invEsc(info.name)}</b><small>${invEsc(info.base.name)} › ${invEsc(info.floor.name)}</small></div>
        <span class="loc-q">×${l.qty}</span>
        <button class="btn-small" data-open="${invEsc(l.baseId)}|${invEsc(l.floorId)}|${invEsc(l.storageId)}">${invEsc(IT('open'))}</button></li>`).join('')}</ul>`
      : `<p class="muted small">${invEsc(IT('whereEmpty'))}</p>`}
    <div class="inv-where-actions">
      <button class="btn-small" id="inv-show-3d">${Icon.svg('home', 13)} ${invEsc(IT('showInBases'))}</button>
    </div>
    ${maps.length ? `<h4>${invEsc(IT('spawnsOn'))}</h4><p class="muted small">${maps.map(invEsc).join(', ')}</p>` : ''}`;
  panel.querySelector('#inv-where-close').onclick = () => {
    panel.classList.add('hidden'); Inv.selectedKey = null;
    document.querySelectorAll('#inv-grid .inv-slot.selected').forEach((e) => e.classList.remove('selected'));
  };
  const cp = panel.querySelector('#inv-copy');
  if (cp) cp.onclick = async () => { await window.api.copyText(cmd); toast(IT('copied')); };
  panel.querySelectorAll('[data-open]').forEach((b) => {
    b.onclick = () => {
      const [baseId, floorId, stId] = b.dataset.open.split('|');
      Inv.sub = 'bases'; invRender();
      if (typeof basesOpenStorage === 'function') basesOpenStorage(baseId, floorId, stId, key);
    };
  });
  panel.querySelector('#inv-show-3d').onclick = () => {
    Inv.sub = 'bases'; invRender();
    if (typeof basesFocusItem === 'function') basesFocusItem(key);
  };
}

// ------------------------------------------------------------
// PDF (sempre em inglês)
// ------------------------------------------------------------
function invGiveCommand(id, qty, fmt, player) {
  if (id == null) return '(no legacy ID)';
  const p = (player || '').trim();
  if (fmt === 'rocket') return `/i ${id} ${qty}`;
  if (fmt === 'rocket-give') return `/give ${p || '<player>'} ${id} ${qty}`;
  return `/give ${p ? p + '/' : ''}${id}/${qty}`;
}

function invBuildReport(opts) {
  const keys = new Set([...Object.keys(Inv.data.counts), ...Inv.placed.keys()]);
  let rows = [...keys].map((k) => ({ key: k, qty: invTotal(k), it: Inv.items.get(k) })).filter((r) => r.qty > 0);
  if (opts.scope === 'view') { const vis = new Set(Inv.list.map((i) => i.key)); rows = rows.filter((r) => vis.has(r.key)); }
  const byId = (a, b) => (a.it?.id ?? 1e9) - (b.it?.id ?? 1e9);
  rows.sort(opts.sort === 'name' ? (a, b) => (a.it?.name || '~').localeCompare(b.it?.name || '~') || byId(a, b)
    : opts.sort === 'qty' ? (a, b) => b.qty - a.qty || byId(a, b) : byId);
  const groups = new Map();
  for (const r of rows) {
    const g = opts.group ? (r.it ? TYPE_EN[r.it.type] || r.it.type : 'Unknown items') : 'All items';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const ordered = [...groups].sort((a, b) => (a[0] === 'Unknown items') - (b[0] === 'Unknown items') || a[0].localeCompare(b[0]));
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const locText = (key) => {
    const p = Inv.placed.get(key); if (!p) return '';
    return p.locs.map((l) => { const i = invLocLabel(l); return i ? `${i.base.name} / ${i.floor.name} / ${i.name} (${l.qty})` : ''; })
      .filter(Boolean).join('; ');
  };
  let body = '';
  for (const [g, list] of ordered) {
    if (opts.group) body += `<h2>${invEsc(g)} <small>${list.length} items · ${list.reduce((s, r) => s + r.qty, 0).toLocaleString('en-US')} units</small></h2>`;
    body += '<table><thead><tr><th class="c-ic">Icon</th><th>Item</th><th class="c-id">ID</th><th class="c-q">Qty</th><th>Command</th></tr></thead><tbody>';
    for (const r of list) {
      const it = r.it; const url = it ? invIcon(it) : null; const rc = RARITY_COLOR[it?.rarity] || '#999';
      const loc = opts.locations ? locText(r.key) : '';
      body += `<tr><td class="c-ic" style="border-left:3px solid ${rc}">${url ? `<img src="${invEsc(url)}">` : `<span class="ph">${invEsc(((it && TYPE_EN[it.type]) || '?').slice(0, 3).toUpperCase())}</span>`}</td>
        <td><b>${invEsc(it ? it.name : 'Unknown item')}</b><br><small><span style="color:${rc}">${invEsc(it ? RARITY_EN[it.rarity] || it.rarity : '')}</span> ${invEsc(it ? TYPE_EN[it.type] || it.type : r.key)}</small>${loc ? `<br><small class="loc">Stored: ${invEsc(loc)}</small>` : ''}</td>
        <td class="c-id mono">${it?.id ?? '-'}</td><td class="c-q">x${r.qty.toLocaleString('en-US')}</td><td class="mono cmd">${invEsc(invGiveCommand(it?.id, r.qty, opts.fmt, opts.player))}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  const cmds = rows.filter((r) => r.it?.id != null)
    .map((r) => `<div><code>${invEsc(invGiveCommand(r.it.id, r.qty, opts.fmt, opts.player))}</code><small>${invEsc(r.it.name)}</small></div>`).join('');
  const fmtLabel = { vanilla: 'Vanilla /give [player]/&lt;id&gt;/&lt;amount&gt;', rocket: 'Rocket / uEssentials /i &lt;id&gt; &lt;amount&gt;', 'rocket-give': 'Rocket /give &lt;player&gt; &lt;id&gt; &lt;amount&gt;' }[opts.fmt];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm 16mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #22261c; font-size: 10.5px; margin: 0; }
    h1 { font-size: 24px; margin: 0; letter-spacing: .02em; text-transform: uppercase; }
    .sub { color: #5a614c; margin: 4px 0 14px; }
    .boxes { display: flex; gap: 8px; margin-bottom: 8px; }
    .box { border: 1px solid #d3d8c6; background: #f8f9f4; border-radius: 4px; padding: 6px 10px; min-width: 110px; }
    .box b { display: block; font-size: 16px; } .box span { font-size: 8px; text-transform: uppercase; color: #5a614c; letter-spacing: .06em; }
    .fmt { color: #5a614c; font-size: 9px; margin-bottom: 10px; }
    h2 { font-size: 13px; margin: 14px 0 4px; display: flex; justify-content: space-between; align-items: baseline; break-after: avoid; }
    h2 small { font-weight: normal; color: #5a614c; font-size: 9px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #23402a; color: #fff; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .06em; padding: 4px 6px; }
    td { border-bottom: 1px solid #e3e6da; padding: 3px 6px; vertical-align: middle; }
    tr { break-inside: avoid; }
    .c-ic { width: 40px; } .c-ic img { width: 34px; height: 34px; object-fit: contain; display: block; }
    .ph { display: inline-grid; place-items: center; width: 34px; height: 34px; background: #eef0e8; font-size: 7px; font-weight: bold; color: #5a614c; }
    .c-id { width: 50px; } .c-q { width: 50px; font-weight: bold; font-size: 12px; }
    .mono { font-family: Consolas, "Courier New", monospace; } .cmd { color: #24713a; }
    small { color: #5a614c; } .loc { color: #23402a; }
    .cmds { page-break-before: always; } .cmds h1 { font-size: 16px; }
    .cmdgrid { columns: 2; column-gap: 18px; margin-top: 8px; } .cmdgrid div { break-inside: avoid; margin-bottom: 5px; }
    .cmdgrid code { font-family: Consolas, monospace; font-weight: bold; display: block; } .cmdgrid small { font-size: 8px; }
  </style></head><body>
    <h1>Unturned Inventory</h1>
    <div class="sub">${invEsc(invServerName())} · Exported ${date}${opts.player ? ' · Player: ' + invEsc(opts.player) : ''}</div>
    <div class="boxes"><div class="box"><b>${rows.length}</b><span>item types</span></div><div class="box"><b>${total.toLocaleString('en-US')}</b><span>total units</span></div><div class="box"><b>${Inv.data.bases.length}</b><span>bases</span></div></div>
    <div class="fmt">Command format: ${fmtLabel}</div>
    ${rows.length ? body : '<p>No items yet.</p>'}
    ${cmds ? `<div class="cmds"><h1>All commands</h1><div class="sub">Paste into the game chat (singleplayer with cheats on, or as server admin).</div><div class="cmdgrid">${cmds}</div></div>` : ''}
  </body></html>`;
}

function invPdfPrefs() {
  try { return JSON.parse(localStorage.getItem('inv.pdf') || '{}'); } catch { return {}; }
}

function invOpenPdfModal() {
  const o = invPdfPrefs();
  document.getElementById('inv-pdf-player').value = o.player || '';
  document.getElementById('inv-pdf-fmt').value = o.fmt || 'vanilla';
  document.getElementById('inv-pdf-sort').value = o.sort || 'id';
  document.getElementById('inv-pdf-scope').value = o.scope || 'all';
  document.getElementById('inv-pdf-group').checked = o.group !== false;
  document.getElementById('inv-pdf-loc').checked = o.locations !== false;
  showModal('modal-inv-pdf');
}

async function invExportPdf() {
  const opts = {
    player: document.getElementById('inv-pdf-player').value.trim(),
    fmt: document.getElementById('inv-pdf-fmt').value,
    sort: document.getElementById('inv-pdf-sort').value,
    scope: document.getElementById('inv-pdf-scope').value,
    group: document.getElementById('inv-pdf-group').checked,
    locations: document.getElementById('inv-pdf-loc').checked
  };
  try { localStorage.setItem('inv.pdf', JSON.stringify(opts)); } catch { /* segue */ }
  hideModal('modal-inv-pdf');
  const html = invBuildReport(opts);
  const safe = invServerName().replace(/[^\w-]+/g, '_').slice(0, 40) || 'server';
  const r = await window.api.invExportPdf(html, `unturned-inventory-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
  if (r && r.ok) toast(IT('pdf.saved'));
  else if (r && !r.canceled) toast(IT('pdf.failed', { err: r.error || '' }));
}

// ------------------------------------------------------------
// Catálogo: pastas e fontes
// ------------------------------------------------------------
async function invRenderCatalogModal() {
  const box = document.getElementById('inv-cat-body');
  if (!box) return;
  const p = await window.api.invPaths().catch(() => ({}));
  const c = Inv.catalog;
  box.innerHTML = `
    <div class="inv-cat-row"><span class="inv-cat-k">${invEsc(IT('cat.game'))}</span>
      <code class="${p.gamePath ? '' : 'missing'}">${invEsc(p.gamePath || IT('cat.gameMissing'))}</code>
      <button class="btn-small" id="inv-cat-game">${invEsc(IT('cat.change'))}</button></div>
    <div class="inv-cat-row"><span class="inv-cat-k">${invEsc(IT('cat.workshop'))}</span>
      <code class="${p.workshopPath ? '' : 'missing'}">${invEsc(p.workshopPath || IT('cat.workshopMissing'))}</code>
      <button class="btn-small" id="inv-cat-ws">${invEsc(IT('cat.change'))}</button>
      ${p.workshopAuto ? '' : `<button class="btn-small" id="inv-cat-ws-auto">${invEsc(IT('cat.auto'))}</button>`}</div>
    <div class="inv-cat-row top"><span class="inv-cat-k">${invEsc(IT('cat.extra'))}</span>
      <div class="inv-cat-extra">${(p.extraFolders || []).map((f, i) => `<div><code>${invEsc(f)}</code><button class="inv-x" data-rm="${i}" title="${invEsc(I18N.t('common.delete'))}">${Icon.svg('close', 12)}</button></div>`).join('') || `<span class="muted small">${invEsc(IT('cat.extraNone'))}</span>`}
        <button class="btn-small" id="inv-cat-add">${Icon.svg('plus', 12)} ${invEsc(IT('cat.extraAdd'))}</button></div></div>
    <p class="muted small">${invEsc(IT('cat.iconsHint'))}</p>
    ${c ? `<div class="inv-cat-sources">${c.sources.map((s) => `<div><b>${invEsc(s.label)}</b><span>${s.workshopId ? 'Workshop ' + invEsc(s.workshopId) + ' · ' : ''}${s.count.toLocaleString()} ${invEsc(IT('cat.itemsWord'))}</span></div>`).join('')}</div>` : ''}
    <div class="inv-cat-foot"><span class="inv-scan-status muted small">${invEsc(invCatalogSummary())}</span>
      <button class="btn btn-primary inv-scan-btn" id="inv-cat-scan" ${p.gamePath ? '' : 'disabled'}>${Icon.svg('refresh', 14)} ${invEsc(IT('cat.scan'))}</button></div>`;
  box.querySelector('#inv-cat-game').onclick = async () => {
    const r = await window.api.gamePickPath();
    if (r && r.ok) invRenderCatalogModal();
    else if (r && r.error) toast(IT('cat.notGame'));
  };
  box.querySelector('#inv-cat-ws').onclick = async () => {
    const f = await window.api.invPickFolder(IT('cat.workshop'));
    if (f) { await window.api.invSetPaths({ workshopPath: f }); invRenderCatalogModal(); }
  };
  const auto = box.querySelector('#inv-cat-ws-auto');
  if (auto) auto.onclick = async () => { await window.api.invSetPaths({ workshopPath: '' }); invRenderCatalogModal(); };
  box.querySelector('#inv-cat-add').onclick = async () => {
    const f = await window.api.invPickFolder(IT('cat.extraAdd'));
    if (f) { await window.api.invSetPaths({ extraFolders: [...(p.extraFolders || []), f] }); invRenderCatalogModal(); }
  };
  box.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = async () => {
      const list = [...(p.extraFolders || [])]; list.splice(Number(b.dataset.rm), 1);
      await window.api.invSetPaths({ extraFolders: list }); invRenderCatalogModal();
    };
  });
  box.querySelector('#inv-cat-scan').onclick = invScan;
}

async function invOpenCatalogModal() {
  await invEnsureCatalog();
  await invRenderCatalogModal();
  showModal('modal-inv-catalog');
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
function initInventory() {
  const pane = document.getElementById('tkpane-inventory');
  if (!pane) return;

  document.querySelectorAll('#inv-subtabs .inv-subtab').forEach((b) =>
    b.addEventListener('click', () => { Inv.sub = b.dataset.sub; invRender(); }));

  let qT;
  document.getElementById('inv-search').addEventListener('input', (e) => {
    clearTimeout(qT); qT = setTimeout(() => { Inv.filter.q = e.target.value; invApplyFilter(); }, 150);
  });
  document.getElementById('inv-sort').addEventListener('change', (e) => { Inv.filter.sort = e.target.value; invApplyFilter(); });
  document.getElementById('inv-map').addEventListener('change', (e) => { Inv.filter.map = e.target.value; invApplyFilter(); });
  document.getElementById('inv-mine').addEventListener('change', (e) => { Inv.filter.mine = e.target.checked; invApplyFilter(); });
  document.getElementById('inv-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.inv-chip'); if (!b) return;
    const t = b.dataset.type;
    Inv.filter.type = Inv.filter.type === t ? '' : t;
    invRenderChips(); invApplyFilter();
  });

  const grid = document.getElementById('inv-grid');
  grid.addEventListener('click', (e) => {
    const slot = e.target.closest('.inv-slot'); if (!slot) return;
    const b = e.target.closest('button[data-act]');
    if (b) {
      const step = e.shiftKey ? 10 : 1;
      invSetExtra(slot.dataset.key, invExtra(slot.dataset.key) + (b.dataset.act === '+' ? step : -step));
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    invShowWhere(slot.dataset.key);
  });
  grid.addEventListener('change', (e) => {
    if (e.target.tagName === 'INPUT') invSetExtra(e.target.closest('.inv-slot').dataset.key, e.target.value);
  });
  grid.addEventListener('focusin', (e) => { if (e.target.tagName === 'INPUT') e.target.select(); });
  document.getElementById('inv-scroll').addEventListener('scroll', (e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && Inv.rendered < Inv.list.length) invRenderMore();
  });

  document.getElementById('inv-pdf').addEventListener('click', invOpenPdfModal);
  document.getElementById('inv-pdf-go').addEventListener('click', invExportPdf);
  document.getElementById('inv-pdf-cancel').addEventListener('click', () => hideModal('modal-inv-pdf'));
  document.getElementById('inv-catalog-btn').addEventListener('click', invOpenCatalogModal);
  document.getElementById('inv-cat-close').addEventListener('click', () => hideModal('modal-inv-catalog'));
  document.getElementById('inv-onb-scan').addEventListener('click', invScan);
  document.getElementById('inv-onb-folders').addEventListener('click', invOpenCatalogModal);

  if (typeof initBases === 'function') initBases();
}
