// ============================================================
// bases.js — Bases do servidor: andares, chão, paredes, storages
//
// Modelo (dentro do inventário do servidor):
//
//   base  { id, name, createdAt, map: {mapName,x,z,markerId}|null,
//           customWalls: [{id,name,color,span}], floors: [floor] }
//   floor { id, name, w, h,                      // tamanho da grade, em pisos
//           pieces: [{id, s:'sq'|'tri', v:[[x,y],...]}],   // vértices em pisos
//           walls: { "e:x1,y1,x2,y2": {t, c?} | {link:"e:..."} },
//           storages: [st] }
//   st    { id, key, label, x, y,                // em subcélulas (3 por piso)
//           cw, ch, items: [{id,key,x,y,r,n?}] }
//
// Arestas: "e:x1,y1,x2,y2" — as duas pontas, de qualquer peça (lado
// reto ou inclinado). Tipos de parede: wall | door | window | garage |
// custom. A customizada pode ocupar várias arestas seguidas (mods
// com porta dupla que pega duas paredes): a primeira guarda o tipo,
// as outras apontam para ela com {link}.
//
// Peças: quadrado ou triângulo equilátero de lado 1 piso (6 m). Um
// triângulo encaixa em qualquer lado livre de outra peça, e um
// quadrado encaixa no lado inclinado de um triângulo — como no jogo.
// ============================================================

const SUB = 3;          // subcélulas por lado de piso (posição dos storages)
const TILE = 66;        // px por piso no zoom 1
const WALL_TYPES = ['wall', 'door', 'window', 'garage', 'custom'];
const WALL_COLOR = { wall: '#c9d1c3', door: '#d9903f', window: '#6cc7e8', garage: '#a7b1bb' };
const FLOOR_GAP = 0.56; // altura de um andar no 3D (1 piso = 1 unidade = 6 m)
const WALL_H = 0.5;

const Bases = {
  baseId: null, floorId: null,
  tool: 'floor',        // select | floor | tri | erase | wall | storage
  brush: 1, triR: 0,
  wallType: 'wall', customId: null,
  pick: null, selStorage: null,
  view: '2d',
  zoom: 1, panX: 40, panY: 40, centeredFor: null,
  drag: null, hover: null,
  imgCache: new Map(),
  three: null,
  onlyBelow: false, glassWalls: true,
  material: 'pine',     // material do chão/parede que vai ser colocado
  pickObj: null, selObj: null, objCat: '', rightTab: 'storages',
  showAreas: true
};

// ------------------------------------------------------------
// Materiais (vida tirada dos .dat do jogo: Bundles/Items/Structures)
// ------------------------------------------------------------
const MATERIALS = {
  pine:  { color: '#b08a57', c3: 0x9c7a4c, floor: 550,  wall: 450 },
  birch: { color: '#cdb88f', c3: 0xb8a37c, floor: 450,  wall: 350 },
  maple: { color: '#94643f', c3: 0x845a39, floor: 500,  wall: 400 },
  metal: { color: '#8d969c', c3: 0x7d868c, floor: 1300, wall: 1100 },
  brick: { color: '#a4573f', c3: 0x924d38, floor: 1850, wall: 1650 }
};
const matOf = (m) => MATERIALS[m] || null;
const matColor = (m) => (matOf(m) ? matOf(m).color : '#c9d1c3');

// ------------------------------------------------------------
// Objetos (placeables): categorias e áreas de ação.
//
// Valores do jogo (código e .dat oficiais, repositório
// Unturned-Datamining):
//   Flag (claim)     raio 32 m (InteractableClaim); outra flag não
//                    pode ficar a menos de 64 m (2 × raio)
//   Gerador          Wirerange do .dat (portátil 16 m, industrial 64 m)
//   Sentry           Detection_Radius do .dat (padrão 48 m)
//   Estação de criação  8 m (PlayerCrafting: raio dos crafting tags)
//   Safezone / Oxygenator  24 m
//   Luzes            o alcance da luz fica no modelo 3D, não no .dat:
//                    o valor aqui é ESTIMADO (marcado com ≈)
// O tamanho no chão é o `Radius` do .dat (espaço livre para colocar).
// Flag e gerador precisam tocar o solo: só no térreo, fora do chão
// construído.
// ------------------------------------------------------------
const PL_CATS = [
  { id: 'claim',     icon: 'flag',   color: '#6ee06e' },
  { id: 'power',     icon: 'plug',   color: '#e6b450' },
  { id: 'defense',   icon: 'shield', color: '#e05c5c' },
  { id: 'craft',     icon: 'hammer', color: '#5cb8e0' },
  { id: 'bed',       icon: 'home',   color: '#a98bff' },
  { id: 'light',     icon: 'eye',    color: '#f2e28c' },
  { id: 'util',      icon: 'gear',   color: '#8ba394' },
  { id: 'furniture', icon: 'box',    color: '#c9a27a' }
];
const plCatInfo = (id) => PL_CATS.find((c) => c.id === id) || PL_CATS[PL_CATS.length - 1];

function plCat(it) {
  if (!it) return null;
  const b = it.build || '', t = it.type;
  if (b === 'claim') return 'claim';
  if (t === 'generator') return 'power';
  if (t === 'sentry' || t === 'trap') return 'defense';
  if (b === 'bed') return 'bed';
  if (t !== 'storage' && (it.craft || b === 'campfire' || b === 'oven')) return 'craft';
  if (b === 'spot' || b === 'cage' || b === 'torch') return 'light';
  if (['safezone', 'oxygenator', 'beacon', 'oil', 'tank', 'clock', 'stereo', 'barrel_rain', 'library', 'mannequin', 'sign', 'sign_wall', 'note'].includes(b) ||
      ['beacon', 'oil_pump', 'tank', 'library'].includes(t)) return 'util';
  if (t === 'barricade' && b === 'barricade') return 'furniture';
  return null;
}

// Fallback para catálogo lido antes desta versão (sem Radius/Wirerange).
const PL_VANILLA = { 1158: { pr: 0.5 }, 458: { pr: 0.5, wire: 16 }, 1230: { pr: 1.25, wire: 64 }, 1244: { pr: 0.5, det: 48 }, 1372: { pr: 0.5, det: 48 }, 1373: { pr: 0.5, det: 48 } };
// Placeables vanilla embutidos (valores do .dat oficial — Unturned-Datamining).
// Garantem que a claim flag, geradores, pump jack etc. aparecam mesmo com
// catalogo antigo (lido antes de existirem build/Radius) ou sem o jogo lido.
const PL_BUILTIN = [
  {"key":"cba173169b314a16be5a1ab44f25fcf2","id":1158,"name":"Claim Flag","type":"barricade","rarity":"legendary","asset":"Claim","build":"claim","pr":0.5,"hp":50,"sx":2,"sy":2},
  {"key":"72fae83175f34bde94bd52d40c7a9ebc","id":458,"name":"Portable Generator","type":"generator","rarity":"rare","asset":"Generator_Small","build":"generator","pr":0.5,"hp":450,"wire":16,"sx":2,"sy":2},
  {"key":"dc56734a150849e785975751364d41de","id":1230,"name":"Industrial Generator","type":"generator","rarity":"epic","asset":"Generator_Large","build":"generator","pr":1.25,"hp":600,"wire":64,"sx":3,"sy":3},
  {"key":"eeffac0063804866b38c8eb6436ace10","id":1219,"name":"Pump Jack","type":"oil_pump","rarity":"rare","asset":"Oil","build":"oil","pr":0.5,"hp":450,"sx":3,"sy":3},
  {"key":"0c005ae5e4c74575af53ffe2144fad0b","id":1244,"name":"Neutral Sentry","type":"sentry","rarity":"epic","asset":"Sentry","build":"sentry","pr":0.5,"hp":150,"det":48,"sx":2,"sy":2},
  {"key":"5a7281e9af4c435b8cb7f9f5acf05aa9","id":1372,"name":"Friendly Sentry","type":"sentry","rarity":"epic","asset":"Sentry_Friendly","build":"sentry","pr":0.5,"hp":300,"det":48,"sx":2,"sy":2},
  {"key":"8f7670d2dabc449d8f38c8cb656c6acf","id":1373,"name":"Hostile Sentry","type":"sentry","rarity":"epic","asset":"Sentry_Hostile","build":"sentry","pr":0.5,"hp":150,"det":48,"sx":2,"sy":2},
  {"key":"1f8856edf5964774aa2457b37e45603b","id":1050,"name":"Safezone Radiator","type":"barricade","rarity":"legendary","asset":"Safezone","build":"safezone","pr":0.5,"hp":450,"sx":2,"sy":2},
  {"key":"ea56c734f3614983a5381bbce91ba79a","id":1261,"name":"Oxygenator","type":"barricade","rarity":"epic","asset":"Oxygenator","build":"oxygenator","pr":0.5,"hp":450,"sx":2,"sy":2},
  {"key":"7ff64602a47842f284d7a6cb714c2d69","id":1243,"name":"Cot","type":"barricade","rarity":"common","asset":"Cot","build":"bed","pr":0.4,"hp":350,"sx":2,"sy":1},
  {"key":"343b36df35c94338a2f1e4a4a1b75440","id":288,"name":"Black Bedroll","type":"barricade","rarity":"common","asset":"Bedroll_Black","build":"bed","pr":0.2,"hp":50,"sx":2,"sy":1},
  {"key":"fdac7ad3db9c46109fa6a4e137969ad6","id":362,"name":"Campfire","type":"barricade","rarity":"uncommon","asset":"Campfire","build":"campfire","pr":0.6,"hp":200,"sx":2,"sy":1},
  {"key":"3407a91dde0c4454b91d5af072f11a4c","id":459,"name":"Spotlight","type":"barricade","rarity":"rare","asset":"Spotlight","build":"spot","pr":0.5,"hp":300,"sx":2,"sy":2},
  {"key":"9908a43237364f22a62242cd1fb14fc9","id":1222,"name":"Cagelight","type":"barricade","rarity":"rare","asset":"Cagelight","build":"cage","hp":300,"sx":1,"sy":1},
  {"key":"2f48d614b5424e90adcbbde333abc7d6","id":1255,"name":"Lamp","type":"barricade","rarity":"rare","asset":"Lamp","build":"spot","pr":0.5,"hp":300,"sx":2,"sy":2},
  {"key":"c8c459e27d724d02a00bca4f4a7a6971","id":1208,"name":"Rain Barrel","type":"barricade","rarity":"uncommon","asset":"Barrel_Rain","build":"barrel_rain","pr":0.5,"hp":235,"sx":2,"sy":2},
  {"key":"db4346abc6a040d2ae51987dac2a4dc5","id":1466,"name":"Boombox","type":"barricade","rarity":"common","asset":"Stereo","build":"stereo","pr":0.2,"hp":50,"sx":2,"sy":2}
];
function plEnsureBuiltins() {
  if (!Inv.items || Inv.items._plOk) return;
  const porId = new Map();
  for (const it of Inv.items.values()) if (it.sourceId === 'game' && it.id != null) porId.set(it.id, it);
  for (const v of PL_BUILTIN) {
    const it = Inv.items.get(v.key) || porId.get(v.id);
    if (it) { for (const [k, val] of Object.entries(v)) if (k !== 'key' && (it[k] === undefined || it[k] === null || it[k] === '')) it[k] = val; }
    else Inv.items.set(v.key, { ...v, sourceId: 'game', builtin: true });
  }
  Inv.items._plOk = true;
}
const plVal = (it, k) => (it[k] !== undefined ? it[k] : (PL_VANILLA[it.id] || {})[k]);

// Raio no chão, em PISOS (1 piso = 6 m).
function plRadius(it) { return Math.max(0.15, plVal(it, 'pr') || 0.5) / 6; }

// Áreas de ação em metros: [{r, kind, est?, dashed?}]
function plAreas(it) {
  const cat = plCat(it); const b = it.build || ''; const out = [];
  if (cat === 'claim') { out.push({ r: 32, kind: 'claim' }); out.push({ r: 64, kind: 'claimBlock', dashed: true }); }
  if (cat === 'power') { const w = plVal(it, 'wire'); if (w) out.push({ r: w, kind: 'power' }); }
  if (it.type === 'sentry') out.push({ r: plVal(it, 'det') || 48, kind: 'sentry' });
  if (cat === 'craft' || (it.type === 'storage' && it.craft)) out.push({ r: 8, kind: 'craft' });
  if (b === 'safezone') out.push({ r: 24, kind: 'safezone' });
  if (b === 'oxygenator') out.push({ r: 24, kind: 'oxygen' });
  if (cat === 'light') {
    const n = String(it.asset || it.name || '').toLowerCase();
    const est = /spotlight/.test(n) ? 24 : /desk/.test(n) ? 4 : b === 'torch' ? 6 : b === 'cage' ? 8 : 10;
    out.push({ r: est, kind: 'light', est: true });
  }
  return out;
}
const AREA_COLOR = { claim: '#6ee06e', claimBlock: '#6ee06e', power: '#e6b450', sentry: '#e05c5c', craft: '#5cb8e0', safezone: '#7fe0c0', oxygen: '#6cc7e8', light: '#f2e28c' };
// Precisa tocar o SOLO (terreno), nao estrutura. No jogo (UseableBarricade.cs)
// so EBuild.OIL e EBuild.FARM exigem hit com tag "Ground" (+ material com
// petroleo). Claim flag e geradores podem ir em cima de chao/andar.
const plGround = (it) => !!it && (it.type === 'oil_pump' || it.build === 'oil');

// ------------------------------------------------------------
// Utilidades do modelo
// ------------------------------------------------------------
// ---------- aumentar a base ----------
const FLOOR_MAX = 200;
// Desloca todo o conteudo do andar (dx, dy em pisos).
function floorShift(f, dx, dy) {
  if (!dx && !dy) return;
  for (const p of f.pieces) p.v = p.v.map(([x, y]) => [R4(x + dx), R4(y + dy)]);
  const mv = (k) => { const e = edgePoints(f, k); return e ? edgeKey([e[0][0] + dx, e[0][1] + dy], [e[1][0] + dx, e[1][1] + dy]) : k; };
  const walls = {};
  for (const [k, w] of Object.entries(f.walls || {})) walls[mv(k)] = w.link ? { ...w, link: mv(w.link) } : w;
  f.walls = walls;
  for (const st of f.storages) { st.x += dx * SUB; st.y += dy * SUB; }
  for (const o of f.objects || []) { o.x = R4(o.x + dx); o.y = R4(o.y + dy); }
}
// Aumenta TODOS os andares da base para um lado (mantem alinhados).
function basesGrow(b, dir, n) {
  const horiz = dir === 'left' || dir === 'right';
  if (b.floors.some((f) => (horiz ? f.w : f.h) + n > FLOOR_MAX)) return false;
  for (const f of b.floors) {
    if (horiz) f.w += n; else f.h += n;
    if (dir === 'left') floorShift(f, n, 0);
    if (dir === 'up') floorShift(f, 0, n);
  }
  return true;
}

function bCurBase() { return (Inv.data && Inv.data.bases.find((b) => b.id === Bases.baseId)) || null; }
function bCurFloor() {
  const b = bCurBase();
  return (b && (b.floors.find((f) => f.id === Bases.floorId) || b.floors[0])) || null;
}
const tKey = (x, y) => x + ',' + y;

function basesNewFloor(name, w = 8, h = 8) {
  return { id: invUid(), name, w, h, pieces: [], walls: {}, storages: [], objects: [] };
}

function basesNew(name, mapLink) {
  const base = {
    id: invUid(),
    name: name || IT('bases.defaultName', { n: Inv.data.bases.length + 1 }),
    createdAt: Date.now(), map: mapLink || null, customWalls: [], floors: []
  };
  base.floors.push(basesNewFloor(IT('bases.ground')));
  Inv.data.bases.push(base);
  return base;
}

// Arquivo antigo (ou editado à mão) com campo faltando.
function basesMigrate(data) {
  for (const b of data.bases || []) {
    b.customWalls = b.customWalls || [];
    b.floors = b.floors || [];
    if (!b.floors.length) b.floors.push(basesNewFloor(IT('bases.ground')));
    for (const f of b.floors) {
      f.walls = f.walls || {}; f.storages = f.storages || []; f.objects = f.objects || [];
      f.w = f.w || 10; f.h = f.h || 10;
      if (!f.pieces) basesMigrateTiles(f);
      for (const s of f.storages) s.items = s.items || [];
    }
  }
}

// Versão anterior: chão em grade (`tiles`) e paredes por grade
// (h:/v:/a:/b:). Vira peças e arestas pela geometria.
function basesMigrateTiles(f) {
  f.pieces = [];
  const velho = {};
  for (const [k, tile] of Object.entries(f.tiles || {})) {
    const [x, y] = k.split(',').map(Number);
    const v = tile.s === 'tri' ? triAt(x, y, tile.r || 0) : sqAt(x, y);
    f.pieces.push({ id: invUid(), s: tile.s === 'tri' ? 'tri' : 'sq', v: v.map(([a, b]) => [R4(a), R4(b)]) });
    if (tile.s === 'tri') { const P = triAt(x, y, tile.r || 0); velho['a:' + k] = [P[0], P[2]]; velho['b:' + k] = [P[2], P[1]]; }
  }
  const conv = (k) => {
    const [tp, rest] = k.split(':'); if (!rest) return null;
    const [x, y] = rest.split(',').map(Number);
    if (tp === 'h') return edgeKey([x, y], [x + 1, y]);
    if (tp === 'v') return edgeKey([x, y], [x, y + 1]);
    return velho[k] ? edgeKey(velho[k][0], velho[k][1]) : null;
  };
  const walls = {};
  for (const [k, w] of Object.entries(f.walls || {})) {
    const nk = conv(k); if (!nk) continue;
    walls[nk] = w.link ? { link: conv(w.link) } : w;
  }
  f.walls = walls;
  delete f.tiles;
  wallsCleanup(f);
}

function basesOnServerChanged() {
  Bases.baseId = null; Bases.floorId = null; Bases.selStorage = null; Bases.centeredFor = null;
  if (Bases.three) Bases.three.framedBase = null;
}

function bChanged(opts = {}) {
  invRecount(); invSave(); invUpdateStats();
  if (!opts.noList) basesRenderList();
  basesDraw();
  if (Bases.view === '3d') bases3DBuild();
  basesRenderDetails();
}

function basesRedrawAll() {
  if (Inv.sub !== 'bases') return;
  basesDraw(); basesRenderDetails();
}

function bImg(url) {
  if (!url) return null;
  let im = Bases.imgCache.get(url);
  if (!im) { im = new Image(); im.onload = () => basesDraw(); im.src = url; Bases.imgCache.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}

function bStorageInfo(st) {
  const it = Inv.items.get(st.key);
  const cap = it && it.storage ? it.storage : { w: st.cw || 5, h: st.ch || 5 };
  st.cw = cap.w; st.ch = cap.h;
  let used = 0;
  for (const x of st.items) { const ii = Inv.items.get(x.key); used += ii ? ii.sx * ii.sy : 1; }
  return { it, cap, used, total: cap.w * cap.h };
}

// ---------- peças de chão ----------
//
// O chão é uma lista de PEÇAS (quadrado ou triângulo equilátero de
// lado 1 = 6 m), cada uma com os seus vértices. Assim, como no jogo,
// um triângulo encaixa em QUALQUER lado de outra peça — inclusive nos
// lados inclinados de outro triângulo — e um quadrado também encaixa
// no lado inclinado de um triângulo. Longe de outras peças, a peça
// nova cai alinhada à grade.
const TRI_H = Math.sqrt(3) / 2;   // altura do equilátero de lado 1
const R4 = (n) => Math.round(n * 1e4) / 1e4;
const R3 = (n) => (Math.round(n * 1e3) / 1e3) || 0;

// Triângulo alinhado à grade (r = lado da base: 0 embaixo, 1 esq., 2 em cima, 3 dir.).
function triPts(r) {
  let P = [[0, 1], [1, 1], [0.5, 1 - TRI_H]];
  for (let i = 0; i < r; i++) P = P.map(([a, b]) => [0.5 - (b - 0.5), 0.5 + (a - 0.5)]);
  return P;
}
const sqAt = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
const triAt = (x, y, r) => triPts(r).map(([a, b]) => [x + a, y + b]);

function centroid(v) { let x = 0, y = 0; for (const p of v) { x += p[0]; y += p[1]; } return [x / v.length, y / v.length]; }
function pointInPoly(x, y, v) {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i], [xj, yj] = v[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pieceAt(f, x, y) { return f.pieces.find((p) => pointInPoly(x, y, p.v)) || null; }

// Duas peças se sobrepõem? Testa o centro e os vértices puxados um
// pouco para dentro — encostar lado com lado não conta.
function overlaps(v, w) {
  const probe = (a, b) => {
    const c = centroid(a);
    if (pointInPoly(c[0], c[1], b)) return true;
    return a.some(([x, y]) => pointInPoly(x + (c[0] - x) * 0.12, y + (c[1] - y) * 0.12, b));
  };
  return probe(v, w) || probe(w, v);
}
function canPlace(f, v) {
  const c = centroid(v);
  if (c[0] < 0 || c[1] < 0 || c[0] > f.w || c[1] > f.h) return false;
  return !f.pieces.some((p) => overlaps(v, p.v));
}
function addPiece(f, s, v) {
  if (!canPlace(f, v)) return null;
  const p = { id: invUid(), s, m: Bases.material, v: v.map(([x, y]) => [R4(x), R4(y)]) };
  f.pieces.push(p);
  return p;
}
function removePiece(f, p) {
  f.pieces = f.pieces.filter((x) => x !== p);
  wallsCleanup(f);
}

// ---------- arestas ----------
// Chave de uma aresta = as duas pontas (arredondadas), em ordem fixa.
// Duas peças vizinhas geram a MESMA chave para o lado em comum.
function edgeKey(a, b) {
  let A = [R3(a[0]), R3(a[1])], B = [R3(b[0]), R3(b[1])];
  if (A[0] > B[0] || (A[0] === B[0] && A[1] > B[1])) [A, B] = [B, A];
  return `e:${A[0]},${A[1]},${B[0]},${B[1]}`;
}
function edgePoints(f, key) {
  if (!key || !key.startsWith('e:')) return null;
  const n = key.slice(2).split(',').map(Number);
  return [[n[0], n[1]], [n[2], n[3]]];
}
// Todas as arestas do andar: chave -> { a, b, n (normal para fora), pecas }.
function allEdges(f) {
  const m = new Map();
  for (const p of f.pieces) {
    const c = centroid(p.v);
    for (let i = 0; i < p.v.length; i++) {
      const a = p.v[i], b = p.v[(i + 1) % p.v.length];
      const k = edgeKey(a, b);
      let e = m.get(k);
      if (!e) {
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        let nx = -dy / L, ny = dx / L;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if ((mx - c[0]) * nx + (my - c[1]) * ny < 0) { nx = -nx; ny = -ny; }
        e = { a, b, n: [nx, ny], pecas: 0 };
        m.set(k, e);
      }
      e.pecas++;
    }
  }
  return m;
}
function edgeValid(f, key) { return allEdges(f).has(key); }

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

// A aresta seguinte na mesma direção (para parede de vários vãos).
function edgeNext(key, i) {
  const pts = edgePoints(null, key); if (!pts) return null;
  const [A, B] = pts; const dx = B[0] - A[0], dy = B[1] - A[1];
  return edgeKey([A[0] + dx * i, A[1] + dy * i], [B[0] + dx * i, B[1] + dy * i]);
}

// Lado LIVRE (só uma peça encostada) mais perto do ponto, com o ponto
// do lado de fora. É onde a próxima peça encaixa.
function snapEdge(f, x, y, soInclinado) {
  let best = null, bd = 0.5;
  for (const e of allEdges(f).values()) {
    if (e.pecas > 1) continue;
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1];
    if (soInclinado && (Math.abs(dx) < 1e-3 || Math.abs(dy) < 1e-3)) continue;
    const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
    if ((x - mx) * e.n[0] + (y - my) * e.n[1] < -0.05) continue;
    const d = segDist(x, y, e.a, e.b);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
const triOnEdge = (e) => {
  const mx = (e.a[0] + e.b[0]) / 2, my = (e.a[1] + e.b[1]) / 2;
  return [e.a, e.b, [mx + e.n[0] * TRI_H, my + e.n[1] * TRI_H]];
};
const sqOnEdge = (e) => [e.a, e.b, [e.b[0] + e.n[0], e.b[1] + e.n[1]], [e.a[0] + e.n[0], e.a[1] + e.n[1]]];

// O que a ferramenta de triângulo colocaria neste ponto.
function triCandidate(f, p) {
  const e = snapEdge(f, p.fx, p.fy, false);
  if (e) { const v = triOnEdge(e); if (canPlace(f, v)) return v; }
  if (pieceAt(f, p.fx, p.fy) || p.tx < 0 || p.ty < 0 || p.tx >= f.w || p.ty >= f.h) return null;
  const v = triAt(p.tx, p.ty, Bases.triR);
  return canPlace(f, v) ? v : null;
}
// Quadrado encaixado no lado inclinado de um triângulo (se houver).
function sqCandidate(f, p) {
  if (pieceAt(f, p.fx, p.fy)) return null;
  const e = snapEdge(f, p.fx, p.fy, true);
  if (!e) return null;
  const v = sqOnEdge(e);
  return canPlace(f, v) ? v : null;
}

function wallAnchor(f, key) {
  const w = f.walls[key];
  if (!w) return null;
  return w.link ? (f.walls[w.link] ? w.link : null) : key;
}

function wallSpan(base, w) {
  if (!w || w.t !== 'custom') return 1;
  const c = base.customWalls.find((x) => x.id === w.c);
  return Math.max(1, Math.min(6, (c && c.span) || 1));
}

function wallRemove(f, key) {
  const a = wallAnchor(f, key);
  if (!a) { delete f.walls[key]; return; }
  delete f.walls[a];
  for (const [k, w] of Object.entries(f.walls)) if (w.link === a) delete f.walls[k];
}

// Parede sem chão embaixo some junto com a peça.
function wallsCleanup(f) {
  const edges = allEdges(f);
  for (const k of Object.keys(f.walls)) if (f.walls[k] && !edges.has(k)) wallRemove(f, k);
}

// Coloca a parede do tipo atual a partir da aresta `key`.
function wallPlace(base, f, key) {
  const t = Bases.wallType;
  let span = 1, c;
  if (t === 'custom') {
    const cw = base.customWalls.find((x) => x.id === Bases.customId);
    if (!cw) { toast(IT('bases.pickCustom')); return false; }
    c = cw.id; span = cw.span;
  }
  const edges = allEdges(f);
  const keys = [key];
  for (let i = 1; i < span; i++) keys.push(edgeNext(key, i));
  if (keys.some((k) => !k || !edges.has(k))) { toast(IT('bases.noRoom')); return false; }
  const cur = f.walls[key];
  const m = Bases.material;
  if (cur && !cur.link && cur.t === t && cur.c === c && cur.m === m) return false;   // já é isso
  for (const k of keys) if (f.walls[k]) wallRemove(f, k);
  f.walls[key] = c ? { t, c, m } : { t, m };
  for (let i = 1; i < keys.length; i++) f.walls[keys[i]] = { link: key };
  return true;
}

// ---------- objetos (placeables) ----------
const snapM = (v) => Math.round(v * 6) / 6;   // posição de 1 em 1 metro
function objAt(f, x, y) {
  let best = null, bd = Infinity;
  for (const o of f.objects) {
    const r = Math.max(plRadius(Inv.items.get(o.key) || {}), 0.09);
    const d = Math.hypot(o.x - x, o.y - y);
    if (d <= r + 0.04 && d < bd) { bd = d; best = o; }
  }
  return best;
}
// Pode colocar aqui? Devolve null ou a chave do motivo.
function objCheck(base, f, it, x, y, ignoreId) {
  if (x < 0 || y < 0 || x > f.w || y > f.h) return 'objOutside';
  const r = plRadius(it);
  if (plGround(it)) {
    if (base.floors.indexOf(f) !== 0) return 'objGroundFloor';
    for (let i = 0; i <= 8; i++) {
      const a = i * Math.PI / 4, k = i === 8 ? 0 : r;
      if (pieceAt(f, x + Math.cos(a) * k, y + Math.sin(a) * k)) return 'objGroundBuilt';
    }
  }
  for (const o of f.objects) {
    if (o.id === ignoreId) continue;
    const oi = Inv.items.get(o.key) || {};
    if (Math.hypot(o.x - x, o.y - y) < r + plRadius(oi) - 1e-3) return 'objTooClose';
  }
  return null;
}
function objLabel(o) { const it = Inv.items.get(o.key); return o.label || (it ? it.name : '?'); }

// Até STACK_MAX storages empilhados na mesma posição (z = 0, 1, 2).
const STACK_MAX = 3;
function bStack(f, sx, sy) {
  return f.storages.filter((s) => s.x === sx && s.y === sy).sort((a, b) => (a.z || 0) - (b.z || 0));
}
// O de cima da pilha (o que um clique pega primeiro).
function bStorageAt(f, sx, sy) { const s = bStack(f, sx, sy); return s.length ? s[s.length - 1] : null; }
// Renumera a pilha de baixo para cima, sem buracos (depois de tirar um do meio).
function bCompact(f, sx, sy) { bStack(f, sx, sy).forEach((s, i) => { s.z = i; }); }

// ------------------------------------------------------------
// Render geral
// ------------------------------------------------------------
function basesRender() {
  plEnsureBuiltins();
  if (!Inv.data) return;
  if (!bCurBase() && Inv.data.bases.length) Bases.baseId = Inv.data.bases[0].id;
  const base = bCurBase();
  if (base && !base.floors.some((f) => f.id === Bases.floorId)) Bases.floorId = base.floors[0].id;
  basesRenderList();
  document.getElementById('bs-empty').classList.toggle('hidden', !!base);
  document.getElementById('bs-work').classList.toggle('hidden', !base);
  if (!base) return;
  document.getElementById('bs-name').value = base.name;
  document.getElementById('bs-base-count').textContent = Inv.data.bases.length;
  basesRenderFloors();
  basesRenderTools();
  basesRenderPalette();
  basesRenderDetails();
  basesSetView(Bases.view);
}

function basesSelect(baseId, floorId) {
  Bases.baseId = baseId;
  const b = bCurBase();
  Bases.floorId = floorId || (b && b.floors[0] && b.floors[0].id) || null;
  Bases.selStorage = null;
  basesRender();
}

function basesRenderList() {
  const ul = document.getElementById('bs-list');
  ul.innerHTML = Inv.data.bases.map((b) => {
    let st = 0, items = 0;
    for (const f of b.floors) { st += f.storages.length; for (const s of f.storages) items += s.items.length; }
    return `<li class="${b.id === Bases.baseId ? 'active' : ''}" data-id="${invEsc(b.id)}">
      <div class="bl-name">${invEsc(b.name)}${b.map ? ` <span class="bl-pin" title="${invEsc(IT('bases.onMap', { map: b.map.mapName }))}">${Icon.svg('pin', 11)}</span>` : ''}</div>
      <div class="bl-meta">${invEsc(IT('bases.meta', { floors: b.floors.length, st, items }))}</div>
      <button class="inv-x bl-del" title="${invEsc(IT('bases.delete'))}">${Icon.svg('trash', 13)}</button>
    </li>`;
  }).join('') || `<li class="bl-none muted small">${invEsc(IT('bases.none'))}</li>`;
}

function basesRenderFloors() {
  const base = bCurBase(); const box = document.getElementById('bs-floor-tabs');
  // de cima para baixo, como num prédio
  box.innerHTML = [...base.floors].map((f, i) => [f, i]).reverse().map(([f, i]) => {
    const n = f.storages.length;
    return `<button class="bs-floor${f.id === Bases.floorId ? ' active' : ''}" data-id="${invEsc(f.id)}">
      <span class="bf-level">${i === 0 ? 'T' : i}</span><span class="bf-name">${invEsc(f.name)}</span>${n ? `<span class="bf-n">${n}</span>` : ''}</button>`;
  }).join('');
  const f = bCurFloor();
  document.getElementById('bs-floor-name').value = f.name;
  document.getElementById('bs-floor-w').value = f.w;
  document.getElementById('bs-floor-h').value = f.h;
}

const TOOL_HINT = { select: 'hintSelect', floor: 'hintFloor', tri: 'hintTri', erase: 'hintErase', wall: 'hintWall', storage: 'hintStorage', object: 'hintObject' };

function basesRenderTools() {
  document.querySelectorAll('#bs-tools2d .bs-tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === Bases.tool));
  document.getElementById('bs-opt-brush').classList.toggle('hidden', Bases.tool !== 'floor');
  document.getElementById('bs-opt-tri').classList.toggle('hidden', Bases.tool !== 'tri');
  document.getElementById('bs-opt-wall').classList.toggle('hidden', Bases.tool !== 'wall');
  // material: vale para chão, triângulo e parede
  const usaMat = Bases.tool === 'floor' || Bases.tool === 'tri' || Bases.tool === 'wall';
  document.getElementById('bs-opt-mat').classList.toggle('hidden', !usaMat);
  document.querySelectorAll('#bs-opt-mat .bs-mat').forEach((b) => b.classList.toggle('active', b.dataset.mat === Bases.material));
  const mi = MATERIALS[Bases.material];
  document.getElementById('bs-mat-hp').textContent = IT('bases.matHp', { floor: mi.floor, wall: mi.wall });
  document.getElementById('bs-areas').checked = Bases.showAreas;
  document.getElementById('bs-areas3d').checked = Bases.showAreas;
  document.getElementById('bs-brush').value = String(Bases.brush);
  document.getElementById('bs-tri-rot').innerHTML = basesTriIcon(Bases.triR);
  document.querySelectorAll('#bs-opt-wall .bs-wt').forEach((b) => b.classList.toggle('active', b.dataset.wt === Bases.wallType));
  // customizadas desta base
  const base = bCurBase();
  const sel = document.getElementById('bs-custom-sel');
  const list = base ? base.customWalls : [];
  if (!list.some((c) => c.id === Bases.customId)) Bases.customId = list[0] ? list[0].id : null;
  sel.innerHTML = list.length
    ? list.map((c) => `<option value="${invEsc(c.id)}">${invEsc(c.name)} (${c.span}×)</option>`).join('')
    : `<option value="">${invEsc(IT('bases.customNone'))}</option>`;
  sel.value = Bases.customId || '';
  sel.classList.toggle('hidden', Bases.wallType !== 'custom');
  document.getElementById('bs-custom-edit').classList.toggle('hidden', Bases.wallType !== 'custom');
  const cur = list.find((c) => c.id === Bases.customId);
  document.querySelector('#bs-opt-wall .bs-wt[data-wt="custom"] .wt-sw').style.background = cur ? cur.color : '#e05c9a';

  let hint = IT('bases.' + TOOL_HINT[Bases.tool]);
  if (Bases.tool === 'storage' && !Bases.pick) hint = IT('bases.hintStoragePick');
  if (Bases.tool === 'object' && !Bases.pickObj) hint = IT('bases.hintObjectPick');
  document.getElementById('bs-hint').textContent = hint;
  const hl = document.getElementById('bs-focus');
  const it = Inv.selectedKey && Inv.items.get(Inv.selectedKey);
  hl.classList.toggle('hidden', !it);
  if (it) hl.querySelector('b').textContent = it.name;
}

// Desenho do triângulo para o botão de giro.
function basesTriIcon(r) {
  const pts = triPts(r).map(([a, b]) => `${(a * 16).toFixed(1)},${(b * 16).toFixed(1)}`);
  return `<svg width="16" height="16" viewBox="-1 -1 18 18"><polygon points="${pts.join(' ')}" fill="currentColor" opacity=".85"/></svg>`;
}

function basesRenderPalette() {
  plEnsureBuiltins();
  const q = invNorm(document.getElementById('bs-st-search').value);
  const box = document.getElementById('bs-palette');
  document.querySelectorAll('#bs-right .bs-rtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === Bases.rightTab));
  const cats = document.getElementById('bs-obj-cats');
  if (Bases.rightTab === 'objects') {
    const todos = [...Inv.items.values()].filter((it) => plCat(it));
    const cont = {}; for (const it of todos) { const c = plCat(it); cont[c] = (cont[c] || 0) + 1; }
    cats.classList.remove('hidden');
    cats.innerHTML = `<button class="ob-chip${!Bases.objCat ? ' on' : ''}" data-cat="">${invEsc(IT('all'))}</button>` +
      PL_CATS.filter((c) => cont[c.id]).map((c) => `<button class="ob-chip${Bases.objCat === c.id ? ' on' : ''}" data-cat="${c.id}" style="--c:${c.color}">${Icon.svg(c.icon, 11)} ${invEsc(IT('cat.' + c.id))}<span>${cont[c.id]}</span></button>`).join('');
    const list = todos.filter((it) => (!Bases.objCat || plCat(it) === Bases.objCat) && (!q || invNorm(it.name).includes(q) || String(it.id) === q))
      .sort((a2, b2) => PL_CATS.findIndex((c) => c.id === plCat(a2)) - PL_CATS.findIndex((c) => c.id === plCat(b2)) || a2.name.localeCompare(b2.name))
      .slice(0, 150);
    if (!list.length) { box.innerHTML = `<p class="muted small">${invEsc(IT(todos.length ? 'bases.noObjects' : 'bases.noObjectsCatalog'))}</p>`; return; }
    box.innerHTML = list.map((it) => {
      const ci = plCatInfo(plCat(it)); const a0 = plAreas(it).find((a) => !a.dashed);
      return `<button class="st-pal${Bases.pickObj === it.key ? ' active' : ''}" data-key="${invEsc(it.key)}" data-kind="obj" title="${invEsc(it.name)}">
        <span class="st-pal-ico" style="box-shadow: inset 0 0 0 1px ${ci.color}">${invIconHtml(it)}</span><span class="st-pal-name">${invEsc(it.name)}</span>
        <span class="st-pal-cap" style="color:${a0 ? AREA_COLOR[a0.kind] : 'var(--muted)'}">${a0 ? (a0.est ? '≈' : '') + a0.r + ' m' : ((plVal(it, 'pr') || 0.5) * 2) + ' m'}</span></button>`;
    }).join('');
    return;
  }
  cats.classList.add('hidden');
  const list = Inv.storages.filter((s) => !q || invNorm(s.name).includes(q) || String(s.id) === q).slice(0, 120);
  if (!list.length) { box.innerHTML = `<p class="muted small">${invEsc(IT('bases.noStorages'))}</p>`; return; }
  box.innerHTML = list.map((s) => `
    <button class="st-pal${Bases.pick === s.key ? ' active' : ''}" data-key="${invEsc(s.key)}"
      title="${invEsc(IT('bases.capTitle', { name: s.name, n: s.storage.w * s.storage.h, w: s.storage.w, h: s.storage.h }))}">
      <span class="st-pal-ico">${invIconHtml(s)}</span><span class="st-pal-name">${invEsc(s.name)}</span>
      <span class="st-pal-cap">${s.storage.w}×${s.storage.h}</span></button>`).join('');
}

function basesRenderObjDetails(box, f, o) {
  const it = Inv.items.get(o.key) || {};
  const cat = plCat(it); const ci = plCatInfo(cat);
  const areas = plAreas(it);
  box.innerHTML = `
    <div class="std-head"><span class="std-ico">${invIconHtml(Inv.items.get(o.key))}</span>
      <div><input id="bs-ob-label" class="std-label" maxlength="40" placeholder="${invEsc(it.name || '')}">
        <small><span class="ob-cat" style="--c:${ci.color}">${invEsc(IT('cat.' + cat))}</span> · ID ${it.id ?? '—'}</small></div></div>
    <ul class="ob-facts">
      ${it.hp ? `<li><span>${invEsc(IT('bases.objHp'))}</span><b>${it.hp} HP</b></li>` : ''}
      <li><span>${invEsc(IT('bases.objSize'))}</span><b>${(plVal(it, 'pr') || 0.5) * 2} m</b></li>
      ${areas.filter((a) => !a.dashed).map((a) => `<li><span>${invEsc(IT('area.' + a.kind))}</span><b style="color:${AREA_COLOR[a.kind]}">${a.est ? '≈' : ''}${a.r} m</b></li>`).join('')}
      ${areas.some((a) => a.kind === 'claimBlock') ? `<li class="ob-note">${invEsc(IT('bases.claimNote'))}</li>` : ''}
      ${plGround(it) ? `<li class="ob-note">${invEsc(IT('bases.groundNote'))}</li>` : ''}
      ${areas.some((a) => a.est) ? `<li class="ob-note">${invEsc(IT('bases.lightNote'))}</li>` : ''}
    </ul>
    <div class="std-actions"><button class="btn-small danger" id="bs-ob-del" title="Delete">${Icon.svg('trash', 13)} ${invEsc(I18N.t('common.delete'))}</button></div>`;
  const lab = box.querySelector('#bs-ob-label');
  lab.value = o.label || '';
  lab.oninput = () => { o.label = lab.value; invSave(); basesDraw(); };
  box.querySelector('#bs-ob-del').onclick = () => basesDeleteObject(o);
}

function basesRenderDetails() {
  const box = document.getElementById('bs-details');
  const fo = bCurFloor(); const ob = fo && fo.objects.find((o) => o.id === Bases.selObj);
  if (ob) {
    box.classList.remove('hidden'); document.getElementById('bs-stage').classList.add('has-sel');
    basesRenderObjDetails(box, fo, ob); return;
  }
  const f = bCurFloor(); const st = f && f.storages.find((s) => s.id === Bases.selStorage);
  // Painel flutuante: só aparece com um storage selecionado.
  box.classList.toggle('hidden', !st);
  document.getElementById('bs-stage').classList.toggle('has-sel', !!st);
  if (!st) { box.innerHTML = ''; return; }
  const pilha = bStack(f, st.x, st.y);
  const { it, cap, used, total } = bStorageInfo(st);
  const counts = new Map();
  for (const x of st.items) counts.set(x.key, (counts.get(x.key) || 0) + 1);
  box.innerHTML = `
    <div class="std-head"><span class="std-ico">${invIconHtml(it)}</span>
      <div><input id="bs-st-label" class="std-label" maxlength="40" placeholder="${invEsc(it ? it.name : IT('storage'))}">
        <small>${invEsc(it ? it.name : IT('storage'))} · ${cap.w}×${cap.h}</small></div></div>
    ${pilha.length > 1 ? `<div class="std-stack"><span>${invEsc(IT('bases.stack'))}</span>${pilha.map((p2, i) => {
      const ii = Inv.items.get(p2.key);
      return `<button class="std-lvl${p2.id === st.id ? ' on' : ''}" data-st="${invEsc(p2.id)}" title="${invEsc(p2.label || (ii ? ii.name : ''))}">${i + 1}</button>`;
    }).join('')}<small class="muted">${invEsc(IT('bases.stackHint'))}</small></div>` : ''}
    <div class="std-bar"><div style="width:${Math.min(100, (used / total) * 100)}%"></div></div>
    <small class="muted">${invEsc(IT('bases.usage', { used, total, n: st.items.length }))}</small>
    <div class="std-actions">
      <button class="btn-small primary" id="bs-st-open">${invEsc(IT('bases.openStorage'))}</button>
      <button class="btn-small danger" id="bs-st-del" title="Delete">${Icon.svg('trash', 13)}</button></div>
    <ul class="std-items">${[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const ii = Inv.items.get(k);
      return `<li><span class="std-ico sm">${invIconHtml(ii)}</span><span>${invEsc(ii ? ii.name : IT('unknownItem'))}</span><b>×${n}</b></li>`;
    }).join('')}</ul>`;
  const lab = box.querySelector('#bs-st-label');
  lab.value = st.label || '';
  lab.oninput = () => { st.label = lab.value; invSave(); basesDraw(); };
  box.querySelector('#bs-st-open').onclick = () => basesOpenStorage(Bases.baseId, f.id, st.id);
  box.querySelectorAll('.std-lvl').forEach((b) => {
    b.onclick = () => { Bases.selStorage = b.dataset.st; basesRenderDetails(); basesDraw(); if (Bases.view === '3d') bases3DBuild(); };
  });
  box.querySelector('#bs-st-del').onclick = () => basesDeleteStorage(st);
}

// ------------------------------------------------------------
// Editor 2D
// ------------------------------------------------------------
function bCanvas() { return document.getElementById('bs-canvas'); }

function basesResize() {
  const c = bCanvas(); if (!c) return;
  const wrap = c.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  c.width = Math.max(10, Math.round(w * dpr)); c.height = Math.max(10, Math.round(h * dpr));
  c.style.width = w + 'px'; c.style.height = h + 'px';
  basesDraw();
  if (Bases.three) bases3DResize();
}

// Posição do mouse em coordenadas de piso (fracionárias).
function bPoint(e) {
  const r = bCanvas().getBoundingClientRect();
  const s = TILE * Bases.zoom;
  const fx = (e.clientX - r.left - Bases.panX) / s, fy = (e.clientY - r.top - Bases.panY) / s;
  return { fx, fy, tx: Math.floor(fx), ty: Math.floor(fy), sx: Math.floor(fx * SUB), sy: Math.floor(fy * SUB) };
}

// Aresta mais próxima do ponto (ou null se longe de todas). Com
// `trava` (arrastando), só vale aresta paralela à primeira — passar
// perto de um canto não pode virar uma parede atravessada.
function bEdgeAt(f, p, trava) {
  let dir = null;
  if (trava) { const q = edgePoints(f, trava); const dx = q[1][0] - q[0][0], dy = q[1][1] - q[0][1], L = Math.hypot(dx, dy); dir = [dx / L, dy / L]; }
  const lim = trava ? 0.5 : 0.22;
  let best = null, bd = lim;
  for (const [k, e] of allEdges(f)) {
    if (dir) {
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy);
      if (Math.abs(dir[0] * dy / L - dir[1] * dx / L) > 0.02) continue;
    }
    const d = segDist(p.fx, p.fy, e.a, e.b);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function polyPath(g, ox, oy, s, v) {
  g.beginPath(); g.moveTo(ox + v[0][0] * s, oy + v[0][1] * s);
  for (let i = 1; i < v.length; i++) g.lineTo(ox + v[i][0] * s, oy + v[i][1] * s);
  g.closePath();
}

function triPath(g, X, Y, s, r) {
  const P = triPts(r);
  g.beginPath(); g.moveTo(X + P[0][0] * s, Y + P[0][1] * s);
  g.lineTo(X + P[1][0] * s, Y + P[1][1] * s); g.lineTo(X + P[2][0] * s, Y + P[2][1] * s); g.closePath();
}

function drawTiles(g, f, ox, oy, s, fill, stroke, porMaterial) {
  for (const p of f.pieces) {
    polyPath(g, ox, oy, s, p.v);
    if (porMaterial && matOf(p.m)) { g.fillStyle = '#26302a'; g.fill(); g.globalAlpha = 0.55; g.fillStyle = matColor(p.m); g.fill(); g.globalAlpha = 1; }
    else { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  }
}

function wallStyle(base, w) {
  if (w.t === 'custom') {
    const c = base.customWalls.find((x) => x.id === w.c);
    return { color: (c && c.color) || '#e05c9a', name: c ? c.name : '?' };
  }
  return { color: WALL_COLOR[w.t] || WALL_COLOR.wall };
}

// Uma parede no 2D. Cada tipo tem um desenho próprio para dar para
// ler a planta sem legenda: porta = vão com folha, janela = linha
// dupla azul, garagem = tracejado largo, custom = vão largo colorido.
function drawWall(g, base, w, a, b, s) {
  const st = wallStyle(base, w);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy); const ux = dx / L, uy = dy / L; const nx = -uy, ny = ux;
  const at = (t, off = 0) => [a[0] + dx * t + nx * off, a[1] + dy * t + ny * off];
  const line = (t0, t1, width, color, off = 0, dash = null) => {
    const p0 = at(t0, off), p1 = at(t1, off);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]);
    g.setLineDash(dash || []); g.lineWidth = width; g.strokeStyle = color; g.stroke(); g.setLineDash([]);
  };
  const W = Math.max(3, s * 0.09);
  g.lineCap = 'butt';
  const WC = matColor(w.m);
  if (w.t === 'wall') { line(0, 1, W, WC); return; }
  if (w.t === 'door') {
    const o = 0.35, c = 0.65;
    line(0, o, W, WC); line(c, 1, W, WC);
    // folha aberta a 90° e o arco de abertura
    const h = at(o); const len = (c - o) * L;
    g.beginPath(); g.moveTo(h[0], h[1]); g.lineTo(h[0] + nx * len, h[1] + ny * len);
    g.lineWidth = Math.max(2, W * 0.6); g.strokeStyle = st.color; g.stroke();
    const ang0 = Math.atan2(uy, ux);
    g.beginPath(); g.arc(h[0], h[1], len, ang0, ang0 + Math.PI / 2, false);
    g.setLineDash([3, 3]); g.lineWidth = 1; g.strokeStyle = st.color; g.stroke(); g.setLineDash([]);
    return;
  }
  if (w.t === 'window') {
    line(0, 0.25, W, WC); line(0.75, 1, W, WC);
    line(0.25, 0.75, W * 1.3, 'rgba(108,199,232,.28)');
    line(0.25, 0.75, Math.max(2, W * 0.4), st.color, W * 0.45);
    line(0.25, 0.75, Math.max(2, W * 0.4), st.color, -W * 0.45);
    return;
  }
  if (w.t === 'garage') {
    line(0, 0.08, W, WC); line(0.92, 1, W, WC);
    line(0.08, 0.92, W * 1.15, st.color, 0, [Math.max(3, s * 0.08), Math.max(2, s * 0.04)]);
    return;
  }
  // custom: pilares nas pontas + painel largo colorido e o nome
  line(0, 0.07, W, WC); line(0.93, 1, W, WC);
  line(0.07, 0.93, W * 0.75, st.color);
  if (s * L >= 70) {
    const m = at(0.5, -W * 1.6);
    g.font = `600 ${Math.max(10, Math.min(13, s * 0.17))}px "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(st.name, m[0], m[1]);
    g.fillStyle = st.color; g.fillText(st.name, m[0], m[1]);
  }
}

function basesDraw() {
  plEnsureBuiltins();
  const c = bCanvas(); if (!c || Bases.view !== '2d' || Inv.sub !== 'bases') return;
  const base = bCurBase(); const f = bCurFloor(); const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  if (!f) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = TILE * Bases.zoom; const ox = Bases.panX, oy = Bases.panY;

  // fundo do terreno
  g.fillStyle = '#0d1410'; g.fillRect(ox, oy, f.w * s, f.h * s);
  // subgrade (posição dos storages) — só com zoom suficiente
  if (s / SUB >= 12) {
    g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= f.w * SUB; x++) { const X = Math.round(ox + x * s / SUB) + 0.5; g.moveTo(X, oy); g.lineTo(X, oy + f.h * s); }
    for (let y = 0; y <= f.h * SUB; y++) { const Y = Math.round(oy + y * s / SUB) + 0.5; g.moveTo(ox, Y); g.lineTo(ox + f.w * s, Y); }
    g.stroke();
  }
  // andar de baixo como referência
  const idx = base.floors.indexOf(f);
  if (idx > 0) drawTiles(g, base.floors[idx - 1], ox, oy, s, 'rgba(110,224,110,0.07)', 'rgba(110,224,110,0.18)');
  // chão
  drawTiles(g, f, ox, oy, s, '#3d4a42', '#56685c', true);
  // grade dos pisos
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.beginPath();
  for (let x = 0; x <= f.w; x++) { const X = Math.round(ox + x * s) + 0.5; g.moveTo(X, oy); g.lineTo(X, oy + f.h * s); }
  for (let y = 0; y <= f.h; y++) { const Y = Math.round(oy + y * s) + 0.5; g.moveTo(ox, Y); g.lineTo(ox + f.w * s, Y); }
  g.stroke();
  g.strokeStyle = 'rgba(110,224,110,0.35)'; g.strokeRect(ox + 0.5, oy + 0.5, f.w * s, f.h * s);

  // paredes (só âncoras; os vãos ligados são desenhados juntos)
  for (const [k, w] of Object.entries(f.walls)) {
    if (w.link) continue;
    const pts = edgePoints(f, k); if (!pts) continue;
    const span = wallSpan(base, w);
    let b = pts[1];
    if (span > 1) { const last = edgePoints(f, edgeNext(k, span - 1)); if (last) b = last[1]; }
    drawWall(g, base, w, [ox + pts[0][0] * s, oy + pts[0][1] * s], [ox + b[0] * s, oy + b[1] * s], s);
  }

  // storages
  const hk = Inv.selectedKey; const cs = s / SUB;
  // Uma pilha por posição. Desenha o de cima (ou o selecionado, se
  // ele estiver na pilha), com as camadas de baixo aparecendo atrás.
  const pilhas = new Map();
  for (const st of f.storages) {
    const k = st.x + ',' + st.y;
    if (!pilhas.has(k)) pilhas.set(k, []);
    pilhas.get(k).push(st);
  }
  for (const pilha of pilhas.values()) {
    pilha.sort((a, b) => (a.z || 0) - (b.z || 0));
    const st = pilha.find((x) => x.id === Bases.selStorage) || pilha[pilha.length - 1];
    const { it, used, total } = bStorageInfo(st);
    const X = ox + st.x * cs, Y = oy + st.y * cs;
    const has = hk && pilha.some((p2) => p2.items.some((x) => x.key === hk));
    if (pilha.length > 1) {
      const off = Math.max(2, cs * 0.1);
      for (let i = pilha.length - 1; i >= 1; i--) {
        g.fillStyle = '#15201a'; g.fillRect(X + 1 + off * i, Y + 1 - off * i, cs - 2, cs - 2);
        g.strokeStyle = 'rgba(201,216,205,.45)'; g.lineWidth = 1; g.strokeRect(X + 1 + off * i, Y + 1 - off * i, cs - 2, cs - 2);
      }
    }
    g.fillStyle = '#1c2a22'; g.fillRect(X + 1, Y + 1, cs - 2, cs - 2);
    const im = bImg(invIcon(it));
    if (im) { const m = cs * 0.84; g.drawImage(im, X + (cs - m) / 2, Y + (cs - m) / 2, m, m); }
    else {
      // sem ícone: a capacidade, que é o que diferencia um baú do outro
      g.fillStyle = '#c9d8cd'; g.font = `700 ${Math.max(8, cs * 0.3)}px "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${st.cw}×${st.ch}`, X + cs / 2, Y + cs / 2 - 1);
    }
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(X + 2, Y + cs - 5, cs - 4, 3);
    g.fillStyle = used / total > 0.9 ? '#e05c5c' : '#6ee06e'; g.fillRect(X + 2, Y + cs - 5, (cs - 4) * Math.min(1, used / total), 3);
    g.lineWidth = has ? 3 : 1.5;
    g.strokeStyle = st.id === Bases.selStorage ? '#5cb8e0' : has ? '#ffd166' : (RARITY_COLOR[it?.rarity] || '#8a8f98');
    g.strokeRect(X + 1, Y + 1, cs - 2, cs - 2);
    if (has) { g.fillStyle = 'rgba(255,209,102,.18)'; g.fillRect(X + 1, Y + 1, cs - 2, cs - 2); }
    if (cs >= 14 && (st.label || st.id === Bases.selStorage || has)) {
      const label = st.label || (it ? it.name : '');
      g.font = `${Math.max(10, Math.min(13, cs * 0.45))}px "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(label, X + cs / 2, Y - 2);
      g.fillStyle = has ? '#ffd166' : '#e6efe8'; g.fillText(label, X + cs / 2, Y - 2);
    }
    if (pilha.length > 1) {
      // selo "nível/total" no canto: qual da pilha está à mostra
      const lvl = pilha.indexOf(st) + 1;
      const txt = `${lvl}/${pilha.length}`;
      const fs = Math.max(9, Math.min(12, cs * 0.34));
      g.font = `800 ${fs}px "Segoe UI", sans-serif`;
      const tw = g.measureText(txt).width + 6;
      g.fillStyle = '#e6b450'; g.fillRect(X + cs - tw + 2, Y + cs - fs - 8, tw, fs + 3);
      g.fillStyle = '#1a1206'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, X + cs - tw / 2 + 2, Y + cs - fs / 2 - 6);
    }
  }

  drawObjects(g, base, f, ox, oy, s);

  // prévia do que a ferramenta vai fazer
  const h = Bases.hover;
  if (h) {
    const fantasma = (v, ok) => {
      polyPath(g, ox, oy, s, v);
      g.fillStyle = ok ? 'rgba(110,224,110,.28)' : 'rgba(224,92,92,.25)'; g.fill();
      g.strokeStyle = ok ? '#6ee06e' : '#e05c5c'; g.lineWidth = 2; g.stroke();
    };
    if (Bases.tool === 'floor') {
      const enc = sqCandidate(f, h);
      if (enc) fantasma(enc, true);
      else {
        const r = Math.floor(Bases.brush / 2);
        g.strokeStyle = '#6ee06e'; g.lineWidth = 2;
        g.strokeRect(ox + (h.tx - r) * s, oy + (h.ty - r) * s, Bases.brush * s, Bases.brush * s);
      }
    } else if (Bases.tool === 'tri') {
      const v = triCandidate(f, h);
      if (v) fantasma(v, true);
    } else if (Bases.tool === 'wall' || Bases.tool === 'erase') {
      const k = bEdgeAt(f, h);
      if (k) {
        const a = wallAnchor(f, k) || k; const w = f.walls[a];
        let pts = edgePoints(f, a); let b = pts[1];
        const span = Bases.tool === 'wall' && !w ? (Bases.wallType === 'custom' ? ((base.customWalls.find((x) => x.id === Bases.customId) || {}).span || 1) : 1) : wallSpan(base, w);
        if (span > 1) { const last = edgePoints(f, edgeNext(a, span - 1)); if (last) b = last[1]; }
        g.beginPath(); g.moveTo(ox + pts[0][0] * s, oy + pts[0][1] * s); g.lineTo(ox + b[0] * s, oy + b[1] * s);
        g.lineWidth = Math.max(6, s * 0.16); g.lineCap = 'round';
        g.strokeStyle = Bases.tool === 'erase' ? 'rgba(224,92,92,.6)' : 'rgba(110,224,110,.55)'; g.stroke(); g.lineCap = 'butt';
      } else if (Bases.tool === 'erase') {
        const pc = pieceAt(f, h.fx, h.fy);
        if (pc) { polyPath(g, ox, oy, s, pc.v); g.strokeStyle = '#e05c5c'; g.lineWidth = 2; g.stroke(); }
      }
    } else if (Bases.tool === 'object' && Bases.pickObj) {
      const it = Inv.items.get(Bases.pickObj);
      if (it) {
        const x = snapM(h.fx), y = snapM(h.fy);
        const ok = !objCheck(base, f, it, x, y, null);
        if (Bases.showAreas) for (const a of plAreas(it)) drawArea(g, ox + x * s, oy + y * s, a.r / 6 * s, a, 0.5);
        g.beginPath(); g.arc(ox + x * s, oy + y * s, Math.max(5, plRadius(it) * s), 0, Math.PI * 2);
        g.fillStyle = ok ? 'rgba(110,224,110,.45)' : 'rgba(224,92,92,.45)'; g.fill();
        g.lineWidth = 2; g.strokeStyle = ok ? '#6ee06e' : '#e05c5c'; g.stroke();
      }
    } else if (Bases.tool === 'storage' && Bases.pick) {
      const ok = h.sx >= 0 && h.sy >= 0 && h.sx < f.w * SUB && h.sy < f.h * SUB && bStack(f, h.sx, h.sy).length < STACK_MAX;
      g.fillStyle = ok ? 'rgba(110,224,110,.35)' : 'rgba(224,92,92,.35)';
      g.fillRect(ox + h.sx * cs, oy + h.sy * cs, cs, cs);
    }
  }
}

// Pincel do chão: quadrados na grade. Apagando, tira as peças cujo
// centro cai nos pisos do pincel.
function bPaint(f, cx, cy, on) {
  const r = Math.floor(Bases.brush / 2); let changed = false;
  for (let y = cy - r; y < cy - r + Bases.brush; y++) for (let x = cx - r; x < cx - r + Bases.brush; x++) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
    if (on) {
      if (addPiece(f, 'sq', sqAt(x, y))) changed = true;
      else {
        // já tem chão aqui: troca o material
        const pc = pieceAt(f, x + 0.5, y + 0.5);
        if (pc && pc.m !== Bases.material) { pc.m = Bases.material; changed = true; }
      }
    }
    else {
      const fora = f.pieces.filter((p) => { const c = centroid(p.v); return c[0] >= x && c[0] < x + 1 && c[1] >= y && c[1] < y + 1; });
      if (fora.length) { f.pieces = f.pieces.filter((p) => !fora.includes(p)); changed = true; }
    }
  }
  if (changed && !on) wallsCleanup(f);
  return changed;
}

function drawArea(g, X, Y, R, a, alpha = 1) {
  const col = AREA_COLOR[a.kind] || '#ffffff';
  g.save(); g.globalAlpha = alpha;
  g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2);
  if (!a.dashed) { g.globalAlpha = alpha * 0.07; g.fillStyle = col; g.fill(); g.globalAlpha = alpha; }
  g.setLineDash(a.dashed || a.est ? [6, 5] : []);
  g.lineWidth = a.dashed ? 1 : 1.6; g.strokeStyle = col; g.globalAlpha = alpha * (a.dashed ? 0.45 : 0.85); g.stroke();
  g.setLineDash([]);
  if (R > 40) {
    g.globalAlpha = alpha; g.font = '600 11px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const txt = `${a.est ? '≈' : ''}${a.r} m`;
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(txt, X, Y - R - 2); g.fillStyle = col; g.fillText(txt, X, Y - R - 2);
  }
  g.restore();
}

// Objetos e as áreas de ação (claim, gerador, sentry, criação, luz...).
function drawObjects(g, base, f, ox, oy, s) {
  if (Bases.showAreas) {
    for (const o of f.objects) {
      const it = Inv.items.get(o.key); if (!it) continue;
      for (const a of plAreas(it)) drawArea(g, ox + o.x * s, oy + o.y * s, a.r / 6 * s, a, o.id === Bases.selObj ? 1 : 0.75);
    }
    // bancadas que também são storage (Workbench...) têm raio de criação
    for (const st of f.storages) {
      const it = Inv.items.get(st.key);
      if (it && it.craft) drawArea(g, ox + (st.x + 0.5) / SUB * s, oy + (st.y + 0.5) / SUB * s, 8 / 6 * s, { r: 8, kind: 'craft' }, 0.6);
    }
  }
  for (const o of f.objects) {
    const it = Inv.items.get(o.key);
    const cat = plCatInfo(plCat(it));
    const X = ox + o.x * s, Y = oy + o.y * s, R = Math.max(6, plRadius(it || {}) * s);
    g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2);
    g.fillStyle = '#16201a'; g.fill();
    g.globalAlpha = 0.55; g.fillStyle = cat.color; g.fill(); g.globalAlpha = 1;
    const im = bImg(invIcon(it));
    if (im && R >= 9) { const m = R * 1.5; g.drawImage(im, X - m / 2, Y - m / 2, m, m); }
    g.lineWidth = o.id === Bases.selObj ? 3 : 1.5;
    g.strokeStyle = o.id === Bases.selObj ? '#5cb8e0' : cat.color; g.stroke();
    if (o.id === Bases.selObj || o.label || s >= 60) {
      g.font = `${Math.max(10, Math.min(13, s * 0.17))}px "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(objLabel(o), X, Y + R + 2);
      g.fillStyle = '#e6efe8'; g.fillText(objLabel(o), X, Y + R + 2);
    }
  }
}

function basesDeleteObject(o) {
  const f = bCurFloor(); f.objects = f.objects.filter((x) => x.id !== o.id);
  Bases.selObj = null; bChanged({ noList: true });
}

function basesDeleteStorage(st) {
  const run = () => {
    const f = bCurFloor(); f.storages = f.storages.filter((s) => s.id !== st.id);
    bCompact(f, st.x, st.y);
    Bases.selStorage = null; bChanged(); basesRenderFloors();
  };
  if (!st.items.length) { run(); return; }
  Ask.confirm(IT('bases.confirmDelStorage', { n: st.items.length })).then((ok) => { if (ok) run(); });
}

function basesCenterView() {
  const f = bCurFloor(); const c = bCanvas(); if (!f || !c) return;
  const wrap = c.parentElement;
  // Enquadra o que está desenhado (com folga de 1 piso); andar vazio
  // mostra o grid inteiro. Assim os storages ficam grandes o bastante.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of f.pieces) for (const [x, y] of p.v) { x0 = Math.min(x0, Math.floor(x)); y0 = Math.min(y0, Math.floor(y)); x1 = Math.max(x1, Math.ceil(x)); y1 = Math.max(y1, Math.ceil(y)); }
  if (Number.isFinite(x0)) { x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(f.w, x1 + 1); y1 = Math.min(f.h, y1 + 1); }
  else { x0 = 0; y0 = 0; x1 = f.w; y1 = f.h; }
  // Área livre entre os painéis flutuantes (andares à esquerda,
  // storages à direita, ferramentas em cima).
  const padL = 200, padR = 300, padT = 70, padB = 30;
  const aw = Math.max(200, wrap.clientWidth - padL - padR), ah = Math.max(200, wrap.clientHeight - padT - padB);
  const z = Math.max(0.25, Math.min(3, Math.min(aw / ((x1 - x0) * TILE), ah / ((y1 - y0) * TILE))));
  Bases.zoom = z;
  Bases.panX = padL + (aw - (x1 - x0) * TILE * z) / 2 - x0 * TILE * z;
  Bases.panY = padT + (ah - (y1 - y0) * TILE * z) / 2 - y0 * TILE * z;
  basesDraw();
}

function basesInitCanvas() {
  const c = bCanvas();
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('mousedown', (e) => {
    const base = bCurBase(); const f = bCurFloor(); if (!f) return;
    const p = bPoint(e);
    if (e.button === 2 || e.button === 1) {
      Bases.drag = { mode: 'pan', sx: e.clientX - Bases.panX, sy: e.clientY - Bases.panY }; return;
    }
    if (e.button !== 0) return;
    const t = Bases.tool;
    if (t === 'floor') {
      // perto do lado inclinado de um triângulo: quadrado encaixado nele
      const enc = sqCandidate(f, p);
      if (enc) { addPiece(f, 'sq', enc); bChanged({ noList: true }); return; }
      Bases.drag = { mode: 'floor', changed: bPaint(f, p.tx, p.ty, true) }; basesDraw(); return;
    }
    if (t === 'tri') {
      const v = triCandidate(f, p);
      if (!v) {
        const pc = pieceAt(f, p.fx, p.fy);
        if (pc && pc.m !== Bases.material) { pc.m = Bases.material; bChanged({ noList: true }); }
        return;
      }
      addPiece(f, 'tri', v);
      bChanged({ noList: true }); return;
    }
    if (t === 'erase') {
      const ek = bEdgeAt(f, p);
      if (ek && f.walls[ek]) { wallRemove(f, ek); Bases.drag = { mode: 'erase', changed: true }; bChanged({ noList: true }); return; }
      const pc = pieceAt(f, p.fx, p.fy);
      if (pc) removePiece(f, pc);
      Bases.drag = { mode: 'erase', changed: !!pc }; basesDraw(); return;
    }
    if (t === 'wall') {
      const ek = bEdgeAt(f, p); if (!ek) return;
      const changed = wallPlace(base, f, ek);
      Bases.drag = { mode: 'wall', last: ek, changed };
      if (changed) bChanged({ noList: true });
      return;
    }
    if (t === 'object') {
      if (!Bases.pickObj) { toast(IT('bases.hintObjectPick')); return; }
      const it = Inv.items.get(Bases.pickObj); if (!it) return;
      const x = snapM(p.fx), y = snapM(p.fy);
      const motivo = objCheck(base, f, it, x, y, null);
      if (motivo) { toast(IT('bases.' + motivo, { name: it.name })); return; }
      const o = { id: invUid(), key: it.key, x, y, label: '' };
      f.objects.push(o); Bases.selObj = o.id; Bases.selStorage = null;
      bChanged({ noList: true }); return;
    }
    if (t === 'storage') {
      if (!Bases.pick) { toast(IT('bases.hintStoragePick')); return; }
      if (p.sx < 0 || p.sy < 0 || p.sx >= f.w * SUB || p.sy >= f.h * SUB) return;
      const stack = bStack(f, p.sx, p.sy);
      if (stack.length >= STACK_MAX) {
        toast(IT('bases.stackFull', { n: STACK_MAX }));
        Bases.selStorage = stack[stack.length - 1].id; basesRenderDetails(); basesDraw(); return;
      }
      const sit = Inv.items.get(Bases.pick);
      // Em cima de outro: empilha (até 3).
      const st = { id: invUid(), key: Bases.pick, label: '', x: p.sx, y: p.sy, z: stack.length, cw: sit.storage.w, ch: sit.storage.h, items: [] };
      f.storages.push(st); Bases.selStorage = st.id;
      // storage em cima do nada ganha chão
      if (!pieceAt(f, (p.sx + 0.5) / SUB, (p.sy + 0.5) / SUB)) addPiece(f, 'sq', sqAt(Math.floor(p.sx / SUB), Math.floor(p.sy / SUB)));
      bChanged(); basesRenderFloors(); return;
    }
    // select: objeto por cima de tudo
    const ob = objAt(f, p.fx, p.fy);
    if (ob) {
      Bases.selObj = ob.id; Bases.selStorage = null;
      Bases.drag = { mode: 'moveObj', o: ob, moved: false };
      basesRenderDetails(); basesDraw(); return;
    }
    Bases.selObj = null;
    // select: pega o storage ou arrasta a vista
    let hit = (p.sx >= 0 && p.sy >= 0) ? bStorageAt(f, p.sx, p.sy) : null;
    // Clicar de novo na mesma pilha desce para o de baixo (e volta ao topo).
    if (hit) {
      const stack = bStack(f, p.sx, p.sy);
      const cur = stack.findIndex((s) => s.id === Bases.selStorage);
      if (cur >= 0 && stack.length > 1) hit = stack[(cur - 1 + stack.length) % stack.length];
    }
    if (hit) {
      Bases.selStorage = hit.id;
      Bases.drag = { mode: 'move', st: hit, moved: false };
      basesRenderDetails(); basesDraw();
    } else {
      Bases.selStorage = null; basesRenderDetails();
      Bases.drag = { mode: 'pan', sx: e.clientX - Bases.panX, sy: e.clientY - Bases.panY }; basesDraw();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (Bases.view !== '2d' || Inv.sub !== 'bases') return;
    const f = bCurFloor(); if (!f) return;
    const c2 = bCanvas(); const r = c2.getBoundingClientRect();
    if (!r.width) return;
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const p = bPoint(e);
    Bases.hover = inside ? p : null;
    const d = Bases.drag;
    if (d && d.mode === 'pan') { Bases.panX = e.clientX - d.sx; Bases.panY = e.clientY - d.sy; }
    else if (d && d.mode === 'floor') { if (bPaint(f, p.tx, p.ty, true)) d.changed = true; }
    else if (d && d.mode === 'erase') {
      const ek = bEdgeAt(f, p);
      if (ek && f.walls[ek]) { wallRemove(f, ek); d.changed = true; }
      else { const pc = pieceAt(f, p.fx, p.fy); if (pc) { removePiece(f, pc); d.changed = true; } }
    } else if (d && d.mode === 'wall' && Bases.wallType !== 'custom') {
      const ek = bEdgeAt(f, p, d.last);
      if (ek && ek !== d.last) { d.last = ek; if (wallPlace(bCurBase(), f, ek)) d.changed = true; }
    } else if (d && d.mode === 'moveObj') {
      const x = snapM(p.fx), y = snapM(p.fy);
      const it = Inv.items.get(d.o.key);
      if (it && (x !== d.o.x || y !== d.o.y) && !objCheck(bCurBase(), f, it, x, y, d.o.id)) { d.o.x = x; d.o.y = y; d.moved = true; }
    } else if (d && d.mode === 'move') {
      if (p.sx >= 0 && p.sy >= 0 && p.sx < f.w * SUB && p.sy < f.h * SUB &&
          (p.sx !== d.st.x || p.sy !== d.st.y) && bStack(f, p.sx, p.sy).length < STACK_MAX) {
        const ox = d.st.x, oy = d.st.y;
        d.st.x = p.sx; d.st.y = p.sy; d.st.z = 99;   // vai para o topo da pilha de destino
        bCompact(f, ox, oy); bCompact(f, p.sx, p.sy);
        d.moved = true;
      }
    }
    if (inside || d) basesDraw();
  });
  window.addEventListener('mouseup', () => {
    const d = Bases.drag; Bases.drag = null; if (!d) return;
    if ((d.mode === 'floor' || d.mode === 'erase' || d.mode === 'wall') && d.changed) bChanged({ noList: true });
    if ((d.mode === 'move' || d.mode === 'moveObj') && d.moved) { invSave(); if (Bases.view === '3d') bases3DBuild(); }
  });
  c.addEventListener('dblclick', (e) => {
    const f = bCurFloor(); if (!f) return;
    const p = bPoint(e);
    const stack = bStack(f, p.sx, p.sy);
    const hit = stack.find((s) => s.id === Bases.selStorage) || stack[stack.length - 1];
    if (hit) basesOpenStorage(Bases.baseId, f.id, hit.id);
  });
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z0 = Bases.zoom; const z1 = Math.max(0.25, Math.min(4, z0 * (e.deltaY > 0 ? 0.9 : 1.1)));
    Bases.panX = mx - (mx - Bases.panX) * (z1 / z0); Bases.panY = my - (my - Bases.panY) * (z1 / z0);
    Bases.zoom = z1; basesDraw();
  }, { passive: false });
  c.addEventListener('mouseleave', () => { Bases.hover = null; basesDraw(); });
  new ResizeObserver(() => { if (Inv.sub === 'bases') basesResize(); }).observe(c.parentElement);
}

// Atalhos do editor. Captura antes do Esc global (que fecharia o
// servidor) e só quando a aba de bases está na tela.
function basesKeydown(e) {
  const pane = document.getElementById('tkpane-inventory');
  if (!pane || pane.classList.contains('hidden') || Inv.sub !== 'bases') return;
  const sm = document.getElementById('modal-inv-storage');
  if (sm && !sm.classList.contains('hidden')) return smKeydown(e);
  if (typeof topModal === 'function' && topModal()) return;
  if (e.target.matches('input, select, textarea')) return;
  const f = bCurFloor(); const st = f && f.storages.find((s) => s.id === Bases.selStorage);
  const keys = { v: 'select', p: 'floor', t: 'tri', w: 'wall', e: 'erase', b: 'storage', o: 'object' };
  const ob = f && f.objects.find((x) => x.id === Bases.selObj);
  if (e.key === 'Delete' && ob) { basesDeleteObject(ob); e.preventDefault(); }
  else if (e.key === 'Delete' && st) { basesDeleteStorage(st); e.preventDefault(); }
  else if ((e.key === 'r' || e.key === 'R') && Bases.tool === 'tri') { Bases.triR = (Bases.triR + 1) % 4; basesRenderTools(); basesDraw(); }
  else if (e.key === 'Escape' && (Bases.tool !== 'select' || Bases.selStorage || Bases.selObj)) {
    e.stopImmediatePropagation(); e.preventDefault();
    Bases.tool = 'select'; Bases.selStorage = null; Bases.selObj = null; basesRenderTools(); basesRenderDetails(); basesDraw();
  } else if (!e.ctrlKey && !e.altKey && keys[e.key.toLowerCase()] && Bases.view === '2d') {
    Bases.tool = keys[e.key.toLowerCase()]; basesRenderTools(); basesDraw();
  }
}

// ------------------------------------------------------------
// Visão 3D (Three.js)
// ------------------------------------------------------------
function basesSetView(v) {
  Bases.view = v;
  document.querySelectorAll('.bs-view').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  bCanvas().classList.toggle('hidden', v !== '2d');
  document.getElementById('bs-3d').classList.toggle('hidden', v !== '3d');
  document.getElementById('bs-tools2d').classList.toggle('hidden', v !== '2d');
  document.getElementById('bs-opts3d').classList.toggle('hidden', v !== '3d');
  document.getElementById('bs-hint').classList.toggle('hidden', v !== '2d');
  if (v === '2d') {
    requestAnimationFrame(() => {
      basesResize();
      if (Bases.centeredFor !== Bases.baseId + '|' + Bases.floorId) { Bases.centeredFor = Bases.baseId + '|' + Bases.floorId; basesCenterView(); }
    });
  } else bases3DBuild();
}

function bases3DInit() {
  if (Bases.three) return Bases.three;
  if (typeof THREE === 'undefined') { toast(IT('bases.no3d')); return null; }
  const host = document.getElementById('bs-3d');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  host.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d1410);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  scene.add(new THREE.HemisphereLight(0xe6f0e8, 0x1a221d, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65); sun.position.set(20, 40, 12); scene.add(sun);
  const group = new THREE.Group(); scene.add(group);
  const tip = document.createElement('div'); tip.className = 'b3d-tip hidden'; host.append(tip);
  const t = { renderer, scene, camera, controls, group, tip, ray: new THREE.Raycaster(), mouse: new THREE.Vector2(), running: false, pickables: [], framedBase: null };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const hit = bases3DPick(e);
    if (hit && hit.objId) {
      Bases.floorId = hit.floorId; Bases.selObj = hit.objId; Bases.selStorage = null;
      basesRenderFloors(); basesRenderDetails(); bases3DBuild();
    } else if (hit) {
      Bases.floorId = hit.floorId; Bases.selStorage = hit.storageId; Bases.selObj = null;
      basesRenderFloors(); basesRenderDetails();
      basesOpenStorage(Bases.baseId, hit.floorId, hit.storageId);
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    const hit = bases3DPick(e);
    if (hit) {
      tip.classList.remove('hidden'); tip.textContent = hit.label;
      const r = host.getBoundingClientRect();
      tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px';
      renderer.domElement.style.cursor = 'pointer';
    } else { tip.classList.add('hidden'); renderer.domElement.style.cursor = 'grab'; }
  });
  Bases.three = t; return t;
}

function bases3DPick(e) {
  const t = Bases.three; const r = t.renderer.domElement.getBoundingClientRect();
  t.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  t.ray.setFromCamera(t.mouse, t.camera);
  const hits = t.ray.intersectObjects(t.pickables, false);
  return hits.length ? hits[0].object.userData : null;
}

function bases3DResize() {
  const t = Bases.three; if (!t) return;
  const host = document.getElementById('bs-3d');
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  t.renderer.setSize(w, h); t.camera.aspect = w / h; t.camera.updateProjectionMatrix();
}

// Prisma triangular (base embaixo, r=0), deitado no plano XZ.
let triGeoCache = null;
function triGeo() {
  if (triGeoCache) return triGeoCache;
  const P = triPts(0);
  const sh = new THREE.Shape(); sh.moveTo(P[0][0], P[0][1]); sh.lineTo(P[1][0], P[1][1]); sh.lineTo(P[2][0], P[2][1]); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false });
  g.rotateX(Math.PI / 2);   // (x,y,0) -> (x,0,y); a espessura desce em y
  g.translate(0, 0.025, 0);
  triGeoCache = g; return g;
}

// Peças de uma parede no referencial local (comprimento em +x).
function wallParts(base, w, L) {
  const H = WALL_H, T = 0.06;
  const solid = { c: matOf(w.m) ? '#' + MATERIALS[w.m].c3.toString(16).padStart(6, '0') : '#93a096', solid: true };
  const P = [];
  const box = (x0, x1, y0, y1, mat, th = T) => P.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, d: th, ...mat });
  if (w.t === 'wall') { box(0, L, 0, H, solid); return P; }
  if (w.t === 'door') {
    const o = L * 0.35, c = L * 0.65, top = 0.38;
    box(0, o, 0, H, solid); box(c, L, 0, H, solid); box(o, c, top, H, solid);
    box(o + 0.01, c - 0.01, 0, top, { c: WALL_COLOR.door }, 0.03);
    return P;
  }
  if (w.t === 'window') {
    const o = L * 0.25, c = L * 0.75;
    box(0, o, 0, H, solid); box(c, L, 0, H, solid); box(o, c, 0, 0.18, solid); box(o, c, 0.38, H, solid);
    box(o, c, 0.18, 0.38, { c: WALL_COLOR.window, glass: true }, 0.015);
    return P;
  }
  if (w.t === 'garage') {
    const o = L * 0.08, c = L * 0.92, top = 0.42;
    box(0, o, 0, H, solid); box(c, L, 0, H, solid); box(o, c, top, H, solid);
    box(o, c, 0, top, { c: WALL_COLOR.garage, metal: true }, 0.04);
    return P;
  }
  const st = wallStyle(base, w);
  const o = 0.06, c = L - o, top = 0.42;
  box(0, o, 0, H, solid); box(c, L, 0, H, solid); box(o, c, top, H, solid);
  box(o + 0.01, c - 0.01, 0, top, { c: st.color }, 0.035);
  return P;
}

function bases3DBuild() {
  plEnsureBuiltins();
  const t = bases3DInit(); if (!t) return;
  const base = bCurBase(); if (!base) return;
  for (const o of [...t.group.children]) {
    t.group.remove(o);
    o.traverse((m) => {
      if (m.geometry && m.geometry !== triGeoCache) m.geometry.dispose();
      if (m.material) [].concat(m.material).forEach((x) => x.dispose());
    });
  }
  t.pickables = [];
  const curIdx = Math.max(0, base.floors.findIndex((f) => f.id === Bases.floorId));
  const hk = Inv.selectedKey;
  const glass = Bases.glassWalls;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, maxW = 1, maxH = 1;
  const m4 = new THREE.Matrix4(), rot = new THREE.Matrix4(), pre = new THREE.Matrix4(), post = new THREE.Matrix4();

  base.floors.forEach((f, i) => {
    maxW = Math.max(maxW, f.w); maxH = Math.max(maxH, f.h);
    if (Bases.onlyBelow && i > curIdx) return;
    const y = i * FLOOR_GAP; const dim = i !== curIdx;
    const floorMat = () => new THREE.MeshLambertMaterial({ color: dim ? 0x3a463e : 0x56695c, transparent: dim, opacity: dim ? 0.55 : 1 });

    // peças de chão: uma malha só por andar, extrudada das formas
    const porMat = new Map();
    for (const p of f.pieces) { const k = matOf(p.m) ? p.m : ''; if (!porMat.has(k)) porMat.set(k, []); porMat.get(k).push(p); }
    for (const [mk, lista] of porMat) {
      const shapes = lista.map((p) => {
        const c = centroid(p.v);
        // encolhe um fio para aparecer a junta entre peças
        const v = p.v.map(([px, pz]) => [px + (c[0] - px) * 0.015, pz + (c[1] - pz) * 0.015]);
        const sh = new THREE.Shape(); sh.moveTo(v[0][0], v[0][1]);
        for (let i = 1; i < v.length; i++) sh.lineTo(v[i][0], v[i][1]);
        sh.closePath();
        for (const [px, pz] of p.v) { x0 = Math.min(x0, px); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); z1 = Math.max(z1, pz); }
        return sh;
      });
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: 0.05, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); geo.translate(0, y + 0.025, 0);
      const fm = floorMat(); if (matOf(mk)) fm.color.setHex(MATERIALS[mk].c3);
      t.group.add(new THREE.Mesh(geo, fm));
    }

    // paredes
    for (const [k, w] of Object.entries(f.walls)) {
      if (w.link) continue;
      const pts = edgePoints(f, k); if (!pts) continue;
      const span = wallSpan(base, w);
      let b = pts[1];
      if (span > 1) { const last = edgePoints(f, edgeNext(k, span - 1)); if (last) b = last[1]; }
      const a = pts[0]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz);
      const g = new THREE.Group();
      for (const p of wallParts(base, w, L)) {
        const op = p.glass ? 0.35 : (glass || dim) ? (p.solid ? 0.28 : 0.6) : 1;
        const mat = new THREE.MeshLambertMaterial({ color: p.c, transparent: op < 1, opacity: op, depthWrite: op >= 1 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat);
        mesh.position.set(p.x, p.y, 0); g.add(mesh);
      }
      g.position.set(a[0], y + 0.025, a[1]);
      g.rotation.y = Math.atan2(-dz, dx);
      t.group.add(g);
    }

    // storages (empilhados sobem um em cima do outro)
    const alturaDe = (s) => 0.08 + 0.2 * Math.min(1, (bStorageInfo(s).total) / 60);
    for (const st of f.storages) {
      const { it, used, total } = bStorageInfo(st);
      const base0 = bStack(f, st.x, st.y).filter((o) => (o.z || 0) < (st.z || 0)).reduce((a, o) => a + alturaDe(o) + 0.004, 0);
      const has = hk && st.items.some((x) => x.key === hk);
      const color = new THREE.Color(has ? '#ffd166' : (RARITY_COLOR[it?.rarity] || '#8a8f98'));
      const fade = dim && !has;
      const mat = new THREE.MeshLambertMaterial({
        color, emissive: has ? new THREE.Color('#6b5200') : new THREE.Color(0x000000),
        transparent: fade, opacity: fade ? 0.55 : 1
      });
      const hgt = 0.08 + 0.2 * Math.min(1, total / 60);
      const size = 0.82 / SUB;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, hgt, size), mat);
      mesh.position.set((st.x + 0.5) / SUB, y + 0.025 + base0 + hgt / 2, (st.y + 0.5) / SUB);
      mesh.userData = {
        floorId: f.id, storageId: st.id,
        label: IT('bases.tip3d', { name: st.label || (it ? it.name : IT('storage')), floor: f.name, n: st.items.length, pct: Math.round(used / total * 100) })
      };
      t.group.add(mesh); t.pickables.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: st.id === Bases.selStorage ? 0x5cb8e0 : has ? 0xffffff : 0x0b0d10 }));
      edges.position.copy(mesh.position); t.group.add(edges);
      if (has) {
        // coluna de luz: acha o storage de longe
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.55 }));
        beam.position.set(mesh.position.x, y + 0.75, mesh.position.z); t.group.add(beam);
      }
      x0 = Math.min(x0, st.x / SUB); z0 = Math.min(z0, st.y / SUB); x1 = Math.max(x1, (st.x + 1) / SUB); z1 = Math.max(z1, (st.y + 1) / SUB);
    }
  });

  // objetos e áreas de ação (áreas só do andar atual, para não poluir)
  base.floors.forEach((f, i) => {
    if (Bases.onlyBelow && i > curIdx) return;
    const y = i * FLOOR_GAP; const dim = i !== curIdx;
    for (const o of f.objects || []) {
      const it = Inv.items.get(o.key) || {};
      const ci = plCatInfo(plCat(it));
      const r = plRadius(it); const h = 0.05 + Math.min(0.25, r * 1.2);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(ci.color), transparent: dim, opacity: dim ? 0.5 : 1 }));
      mesh.position.set(o.x, y + 0.025 + h / 2, o.y);
      mesh.userData = { objId: o.id, floorId: f.id, label: `${objLabel(o)} — ${IT('cat.' + plCat(it))}` };
      t.group.add(mesh); t.pickables.push(mesh);
      if (o.id === Bases.selObj) {
        const e2 = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x5cb8e0 }));
        e2.position.copy(mesh.position); t.group.add(e2);
      }
      if (Bases.showAreas && !dim) {
        for (const a of plAreas(it)) {
          const R = a.r / 6; const col = new THREE.Color(AREA_COLOR[a.kind] || '#ffffff');
          const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, R - 0.03), R, 96),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: a.dashed ? 0.25 : 0.7, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, y + 0.06, o.y); t.group.add(ring);
          if (!a.dashed) {
            const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 96),
              new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
            disc.rotation.x = -Math.PI / 2; disc.position.set(o.x, y + 0.055, o.y); t.group.add(disc);
          }
        }
      }
    }
  });

  const gsize = Math.max(maxW, maxH);
  const grid = new THREE.GridHelper(gsize, gsize, 0x3aa03a, 0x24302a);
  grid.position.set(gsize / 2, curIdx * FLOOR_GAP - 0.03, gsize / 2); t.group.add(grid);

  if (t.framedBase !== base.id) {
    t.framedBase = base.id;
    if (!Number.isFinite(x0)) { x0 = 0; z0 = 0; x1 = maxW; z1 = maxH; }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const span = Math.max(3, x1 - x0, z1 - z0, base.floors.length * FLOOR_GAP);
    const midY = (base.floors.length - 1) * FLOOR_GAP / 2;
    t.controls.target.set(cx, midY, cz);
    t.camera.position.set(cx + span * 0.7, midY + span * 0.9, cz + span * 1.0);
  }
  requestAnimationFrame(() => { bases3DResize(); bases3DLoop(); });
}

function bases3DLoop() {
  const t = Bases.three; if (!t || t.running) return; t.running = true;
  const tick = () => {
    const pane = document.getElementById('tkpane-inventory');
    if (Bases.view !== '3d' || Inv.sub !== 'bases' || !pane || pane.classList.contains('hidden')) { t.running = false; return; }
    t.controls.update(); t.renderer.render(t.scene, t.camera); requestAnimationFrame(tick);
  };
  tick();
}

// Vem do "Onde está": acende o item em todas as vistas e abre a
// base/andar onde há mais unidades dele.
function basesFocusItem(key) {
  Inv.selectedKey = key;
  const p = Inv.placed.get(key);
  if (p && p.locs.length) {
    const best = [...p.locs].sort((a, b) => b.qty - a.qty)[0];
    Bases.baseId = best.baseId; Bases.floorId = best.floorId; Bases.selStorage = best.storageId;
    if (Bases.three) Bases.three.framedBase = null;
  }
  basesRender();
}

// ------------------------------------------------------------
// Storage aberto: grade interna igual à do jogo
// ------------------------------------------------------------
const SLOT = 48;
const SM = { baseId: null, floorId: null, st: null, hand: null, sel: null, focusKey: null, drag: null };

function bFindStorage(baseId, floorId, stId) {
  const b = Inv.data.bases.find((x) => x.id === baseId);
  const f = b && b.floors.find((x) => x.id === floorId);
  return { base: b, floor: f, st: f && f.storages.find((x) => x.id === stId) };
}

function smOpen() { const m = document.getElementById('modal-inv-storage'); return m && !m.classList.contains('hidden'); }

function basesOpenStorage(baseId, floorId, stId, focusKey) {
  const { base, floor, st } = bFindStorage(baseId, floorId, stId); if (!st) return;
  if (Bases.baseId !== baseId || Bases.floorId !== floorId) {
    Bases.baseId = baseId; Bases.floorId = floorId; Bases.selStorage = stId; basesRender();
  } else { Bases.selStorage = stId; basesRenderDetails(); basesDraw(); }
  Object.assign(SM, { baseId, floorId, st, hand: null, sel: null, focusKey: focusKey || Inv.selectedKey || null, drag: null });
  const { it, cap } = bStorageInfo(st);
  document.getElementById('sm-title').textContent = st.label || (it ? it.name : IT('storage'));
  document.getElementById('sm-path').textContent = `${base.name} › ${floor.name} · ${cap.w}×${cap.h}`;
  document.getElementById('sm-search').value = '';
  smRenderPicker(); smRender(); smRenderSel();
  showModal('modal-inv-storage');
  setTimeout(() => document.getElementById('sm-search').focus(), 50);
}

const itemDims = (it, r) => { const w = it ? it.sx : 1, h = it ? it.sy : 1; return r ? { w: h, h: w } : { w, h }; };

function smOccupancy(ignore) {
  const { cap } = bStorageInfo(SM.st); const occ = new Array(cap.w * cap.h).fill(null);
  for (const x of SM.st.items) {
    if (x === ignore) continue;
    const d = itemDims(Inv.items.get(x.key), x.r);
    for (let yy = x.y; yy < x.y + d.h; yy++) for (let xx = x.x; xx < x.x + d.w; xx++) if (xx < cap.w && yy < cap.h) occ[yy * cap.w + xx] = x;
  }
  return occ;
}
function smFits(key, r, x, y, ignore, occ) {
  const { cap } = bStorageInfo(SM.st); const d = itemDims(Inv.items.get(key), r);
  if (x < 0 || y < 0 || x + d.w > cap.w || y + d.h > cap.h) return false;
  occ = occ || smOccupancy(ignore);
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) if (occ[yy * cap.w + xx]) return false;
  return true;
}
function smAutoPlace(key, occ) {
  const { cap } = bStorageInfo(SM.st);
  for (const r of [0, 1]) for (let y = 0; y < cap.h; y++) for (let x = 0; x < cap.w; x++) if (smFits(key, r, x, y, null, occ)) return { x, y, r };
  return null;
}

function smChanged() {
  invRecount(); invSave(); invUpdateStats();
  smRender(); smRenderSel(); basesRenderDetails(); basesDraw(); basesRenderList();
  if (Bases.view === '3d') bases3DBuild();
}

function smIconInner(it, d, r) {
  const u = invIcon(it);
  const rotCss = r ? `width:${d.h * SLOT - 6}px;height:${d.w * SLOT - 6}px` : '';
  if (u) return `<img src="${invEsc(u)}" alt="" draggable="false"${r ? ` class="rot" style="${rotCss}"` : ''}>`;
  return `<span class="inv-ph"${it ? ` data-ik="${invEsc(it.key)}"` : ''}${r ? ` data-rot="${rotCss}"` : ''}>${invEsc(it ? invTypeLabel(it.type).slice(0, 3).toUpperCase() : '?')}</span>`;
}

function smRender() {
  const { cap, used, total } = bStorageInfo(SM.st);
  const grid = document.getElementById('sm-grid');
  grid.style.width = cap.w * SLOT + 'px'; grid.style.height = cap.h * SLOT + 'px';
  grid.style.gridTemplateColumns = `repeat(${cap.w}, ${SLOT}px)`;
  let html = '<div class="sm-cell"></div>'.repeat(cap.w * cap.h);
  for (const x of SM.st.items) {
    const it = Inv.items.get(x.key); const d = itemDims(it, x.r);
    const cls = ['sm-item'];
    if (SM.sel === x) cls.push('sel');
    if (SM.focusKey && x.key === SM.focusKey) cls.push('focus');
    html += `<div class="${cls.join(' ')}" data-id="${invEsc(x.id)}" title="${invEsc(it ? it.name : IT('unknownItem'))}"
      style="left:${x.x * SLOT}px;top:${x.y * SLOT}px;width:${d.w * SLOT}px;height:${d.h * SLOT}px;--rc:${RARITY_COLOR[it?.rarity] || '#8a8f98'}">
      ${smIconInner(it, d, x.r)}${x.n ? `<span class="sm-amt">${x.n}</span>` : ''}</div>`;
  }
  html += '<div id="sm-ghost" class="hidden"></div>';
  grid.innerHTML = html;
  document.getElementById('sm-usage').textContent = IT('bases.usage', { used, total, n: SM.st.items.length });
  document.getElementById('sm-usage-bar').style.width = Math.min(100, used / total * 100) + '%';
}

function smRenderPicker() {
  const q = invNorm(document.getElementById('sm-search').value.trim());
  const qId = /^\d+$/.test(q) ? +q : null;
  const box = document.getElementById('sm-picker');
  let list;
  if (!q) {
    // sem busca: o que já está aqui e o que você tem fora das bases
    const keys = new Set([...SM.st.items.map((x) => x.key), ...Object.keys(Inv.data.counts)]);
    list = [...keys].map((k) => Inv.items.get(k)).filter(Boolean).slice(0, 60);
    if (!list.length) { box.innerHTML = `<p class="muted small">${invEsc(IT('sm.searchHint'))}</p>`; return; }
  } else {
    list = [];
    for (const it of Inv.items.values()) {
      if (qId != null ? (it.id === qId || String(it.id).startsWith(q)) : invNorm(it.name).includes(q)) list.push(it);
      if (list.length > 300) break;
    }
    list.sort((a, b) => (qId != null ? (b.id === qId) - (a.id === qId) : 0) || a.name.length - b.name.length);
    list = list.slice(0, 60);
  }
  box.innerHTML = list.map((it) => `
    <button class="sm-pick${SM.hand && SM.hand.key === it.key && !SM.hand.moving ? ' active' : ''}" data-key="${invEsc(it.key)}"
      title="${invEsc(IT('sm.pickTitle', { name: it.name, id: it.id ?? '—', w: it.sx, h: it.sy }))}">
      <span class="sm-pick-ico">${invIconHtml(it)}</span><span class="sm-pick-name">${invEsc(it.name)}</span>
      <span class="sm-pick-size">${it.sx}×${it.sy}</span></button>`).join('');
}

function smRenderSel() {
  const box = document.getElementById('sm-sel');
  const h = SM.hand && !SM.hand.moving ? Inv.items.get(SM.hand.key) : null;
  if (h) {
    box.innerHTML = `<h4>${invEsc(IT('sm.inHand'))}</h4>
      <div class="sm-sel-head"><span class="sm-sel-ico">${invIconHtml(h)}</span><b>${invEsc(h.name)}</b></div>
      <p class="muted small">${invEsc(IT('sm.handHint'))}</p>
      <label class="sm-row">${invEsc(IT('sm.addMany'))} <input type="number" id="sm-qty" min="1" max="500" value="1"></label>
      <div class="sm-row"><button class="btn-small primary" id="sm-addn">${invEsc(IT('sm.autoAdd'))}</button>
        <button class="btn-small" id="sm-hand-rot">↻ ${invEsc(IT('sm.rotate'))}</button></div>`;
    box.querySelector('#sm-addn').onclick = () => {
      const n = Math.max(1, Math.min(500, parseInt(box.querySelector('#sm-qty').value, 10) || 1));
      let added = 0; const occ = smOccupancy(null); const capW = bStorageInfo(SM.st).cap.w;
      for (let i = 0; i < n; i++) {
        const spot = smAutoPlace(h.key, occ); if (!spot) break;
        const x = { id: invUid(), key: h.key, x: spot.x, y: spot.y, r: spot.r }; SM.st.items.push(x);
        const d = itemDims(h, spot.r);
        for (let yy = spot.y; yy < spot.y + d.h; yy++) for (let xx = spot.x; xx < spot.x + d.w; xx++) occ[yy * capW + xx] = x;
        added++;
      }
      smChanged();
      toast(added === n ? IT('sm.added', { n: added }) : IT('sm.addedSome', { n: added, total: n }));
    };
    box.querySelector('#sm-hand-rot').onclick = () => { SM.hand.r ^= 1; };
    return;
  }
  const x = SM.sel;
  if (!x) { box.innerHTML = `<h4>${invEsc(IT('sm.item'))}</h4><p class="muted small">${invEsc(IT('sm.idleHint'))}</p>`; return; }
  const it = Inv.items.get(x.key);
  box.innerHTML = `<h4>${invEsc(IT('sm.selected'))}</h4>
    <div class="sm-sel-head"><span class="sm-sel-ico">${invIconHtml(it)}</span><div><b>${invEsc(it ? it.name : IT('unknownItem'))}</b>
      <small>ID ${it?.id ?? '—'} · ${it ? it.sx + '×' + it.sy : ''}</small></div></div>
    <label class="sm-row">${invEsc(IT('sm.amount'))} <input type="number" id="sm-amt" min="0" max="9999" value="${x.n || ''}" placeholder="—"></label>
    <div class="sm-row"><button class="btn-small" id="sm-rot">↻ ${invEsc(IT('sm.rotate'))}</button>
      <button class="btn-small" id="sm-dup">${invEsc(IT('sm.dup'))}</button>
      <button class="btn-small danger" id="sm-del">${invEsc(IT('sm.remove'))}</button></div>`;
  box.querySelector('#sm-amt').oninput = (e) => {
    const v = parseInt(e.target.value, 10); if (v > 0) x.n = v; else delete x.n; invSave(); smRender();
  };
  box.querySelector('#sm-rot').onclick = () => smRotate(x);
  box.querySelector('#sm-del').onclick = () => { SM.st.items = SM.st.items.filter((y) => y !== x); SM.sel = null; smChanged(); };
  box.querySelector('#sm-dup').onclick = () => {
    const spot = smAutoPlace(x.key); if (!spot) { toast(IT('sm.full')); return; }
    SM.st.items.push({ id: invUid(), key: x.key, x: spot.x, y: spot.y, r: spot.r, ...(x.n ? { n: x.n } : {}) }); smChanged();
  };
}

function smRotate(x) {
  if (!smFits(x.key, x.r ^ 1, x.x, x.y, x)) { toast(IT('sm.noRotate')); return; }
  x.r ^= 1; smChanged();
}

function smCellFromEvent(e) {
  const g = document.getElementById('sm-grid').getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - g.left) / SLOT), y: Math.floor((e.clientY - g.top) / SLOT),
    inside: e.clientX >= g.left && e.clientX < g.right && e.clientY >= g.top && e.clientY < g.bottom
  };
}

function smShowGhost(e) {
  const ghost = document.getElementById('sm-ghost'); if (!ghost) return;
  if (!SM.hand) { ghost.classList.add('hidden'); return; }
  const p = smCellFromEvent(e); if (!p.inside) { ghost.classList.add('hidden'); return; }
  const it = Inv.items.get(SM.hand.key); const d = itemDims(it, SM.hand.r);
  const gx = p.x - (SM.hand.ox || 0), gy = p.y - (SM.hand.oy || 0);
  const ok = smFits(SM.hand.key, SM.hand.r, gx, gy, SM.hand.moving || null);
  ghost.className = ok ? 'ok' : 'bad';
  ghost.style.left = gx * SLOT + 'px'; ghost.style.top = gy * SLOT + 'px';
  ghost.style.width = d.w * SLOT + 'px'; ghost.style.height = d.h * SLOT + 'px';
  const sig = SM.hand.key + '|' + SM.hand.r;
  if (ghost.dataset.sig !== sig) { ghost.dataset.sig = sig; ghost.innerHTML = smIconInner(it, d, SM.hand.r); }
}

function smKeydown(e) {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'r' || e.key === 'R') { if (SM.hand) { SM.hand.r ^= 1; } else if (SM.sel) smRotate(SM.sel); }
  else if (e.key === 'Escape' && (SM.hand || SM.sel)) {
    e.stopImmediatePropagation(); e.preventDefault();
    SM.hand = null; SM.sel = null; smRender(); smRenderSel(); smRenderPicker();
  } else if (e.key === 'Delete' && SM.sel) {
    const x = SM.sel; SM.st.items = SM.st.items.filter((y) => y !== x); SM.sel = null; smChanged();
  }
}

function basesInitStorageModal() {
  const grid = document.getElementById('sm-grid');
  grid.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('.sm-item');
    if (!el) { SM.hand = null; smRenderSel(); smShowGhost(e); return; }
    const x = SM.st.items.find((y) => y.id === el.dataset.id);
    SM.st.items = SM.st.items.filter((y) => y !== x); if (SM.sel === x) SM.sel = null; smChanged();
  });
  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('.sm-item');
    if (el && !SM.hand) {
      const x = SM.st.items.find((y) => y.id === el.dataset.id); const p = smCellFromEvent(e);
      SM.drag = { item: x, sx: e.clientX, sy: e.clientY, ox: p.x - x.x, oy: p.y - x.y, started: false };
      e.preventDefault();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!smOpen()) return;
    const d = SM.drag;
    if (d && !d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) {
      d.started = true; SM.hand = { key: d.item.key, r: d.item.r || 0, moving: d.item, ox: d.ox, oy: d.oy };
      const el = grid.querySelector(`.sm-item[data-id="${CSS.escape(d.item.id)}"]`); if (el) el.classList.add('lifted');
    }
    smShowGhost(e);
  });
  window.addEventListener('mouseup', (e) => {
    if (!smOpen()) return;
    const d = SM.drag; SM.drag = null;
    if (d && !d.started) { SM.sel = d.item; SM.hand = null; smRender(); smRenderSel(); smRenderPicker(); return; }
    if (!SM.hand) return;
    const p = smCellFromEvent(e);
    const gx = p.x - (SM.hand.ox || 0), gy = p.y - (SM.hand.oy || 0);
    if (SM.hand.moving) {
      const x = SM.hand.moving;
      if (p.inside && smFits(x.key, SM.hand.r, gx, gy, x)) { x.x = gx; x.y = gy; x.r = SM.hand.r; SM.sel = x; }
      SM.hand = null; smChanged(); return;
    }
    if (!p.inside || e.button !== 0) return;
    if (smFits(SM.hand.key, SM.hand.r, gx, gy, null)) {
      SM.st.items.push({ id: invUid(), key: SM.hand.key, x: gx, y: gy, r: SM.hand.r }); smChanged(); smShowGhost(e);
    } else toast(IT('sm.noFit'));
  });
  document.getElementById('sm-picker').addEventListener('click', (e) => {
    const b = e.target.closest('.sm-pick'); if (!b) return;
    SM.hand = { key: b.dataset.key, r: 0 }; SM.sel = null; smRenderPicker(); smRenderSel();
  });
  let qT;
  document.getElementById('sm-search').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(smRenderPicker, 120); });
  document.getElementById('sm-clear').addEventListener('click', async () => {
    if (!SM.st.items.length) return;
    if (!await Ask.confirm(IT('sm.confirmClear', { n: SM.st.items.length }))) return;
    SM.st.items = []; SM.sel = null; smChanged();
  });
  document.getElementById('sm-sort').addEventListener('click', () => {
    // maiores primeiro, iguais juntos
    const items = [...SM.st.items].sort((a, b) => {
      const A = Inv.items.get(a.key), B = Inv.items.get(b.key);
      return ((B ? B.sx * B.sy : 1) - (A ? A.sx * A.sy : 1)) || a.key.localeCompare(b.key);
    });
    SM.st.items = []; let lost = 0;
    for (const x of items) { const spot = smAutoPlace(x.key); if (!spot) { lost++; SM.st.items.push(x); continue; } Object.assign(x, spot); SM.st.items.push(x); }
    smChanged(); if (lost) toast(IT('sm.sortLost', { n: lost }));
  });
  document.getElementById('sm-close').addEventListener('click', () => hideModal('modal-inv-storage'));
}

// ------------------------------------------------------------
// Paredes customizadas (portas de mod que pegam vários vãos)
// ------------------------------------------------------------
function basesOpenCustomWalls() {
  const base = bCurBase(); if (!base) return;
  document.getElementById('cw-name').value = '';
  document.getElementById('cw-span').value = '2';
  document.getElementById('cw-color').value = '#e05c9a';
  basesRenderCustomWalls();
  showModal('modal-inv-walls');
  setTimeout(() => document.getElementById('cw-name').focus(), 40);
}

function basesRenderCustomWalls() {
  const base = bCurBase(); const box = document.getElementById('cw-list');
  box.innerHTML = base.customWalls.map((c) => {
    let used = 0;
    for (const f of base.floors) for (const w of Object.values(f.walls)) if (w.t === 'custom' && w.c === c.id) used++;
    return `<div class="cw-row"><span class="cw-sw" style="background:${invEsc(c.color)}"></span>
      <b>${invEsc(c.name)}</b><span class="muted small">${invEsc(IT('walls.spanN', { n: c.span }))} · ${invEsc(IT('walls.usedN', { n: used }))}</span>
      <button class="inv-x" data-del="${invEsc(c.id)}" title="${invEsc(I18N.t('common.delete'))}">${Icon.svg('trash', 13)}</button></div>`;
  }).join('') || `<p class="muted small">${invEsc(IT('walls.none'))}</p>`;
  box.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.del;
      const c = base.customWalls.find((x) => x.id === id);
      if (!await Ask.confirm(IT('walls.confirmDel', { name: c.name }))) return;
      for (const f of base.floors) for (const [k, w] of Object.entries(f.walls)) if (w.t === 'custom' && w.c === id) wallRemove(f, k);
      base.customWalls = base.customWalls.filter((x) => x.id !== id);
      basesRenderCustomWalls(); basesRenderTools(); bChanged({ noList: true });
    };
  });
}

function basesAddCustomWall() {
  const base = bCurBase(); if (!base) return;
  const name = document.getElementById('cw-name').value.trim();
  if (!name) { document.getElementById('cw-name').focus(); return; }
  const span = Math.max(1, Math.min(6, parseInt(document.getElementById('cw-span').value, 10) || 1));
  const color = document.getElementById('cw-color').value || '#e05c9a';
  const c = { id: invUid(), name, span, color };
  base.customWalls.push(c);
  Bases.wallType = 'custom'; Bases.customId = c.id; Bases.tool = 'wall';
  invSave(); basesRenderCustomWalls(); basesRenderTools();
  document.getElementById('cw-name').value = '';
  toast(IT('walls.created', { name }));
}

// ------------------------------------------------------------
// Ligação com o mapa (marcador do tipo "base")
// ------------------------------------------------------------
function basesLinkedMarkers(baseId) {
  if (typeof MapView === 'undefined') return [];
  return (MapView.markersData.markers || []).filter((m) => m.base && m.base.id === baseId && m.base.server === Inv.serverId);
}

async function basesPinOnMap(baseId) {
  const base = Inv.data.bases.find((b) => b.id === baseId); if (!base) return;
  switchTrackingTab('map');
  if (!MapView.image) { toast(I18N.t('map.noMap')); return; }
  // já está no mapa: centraliza
  const linked = basesLinkedMarkers(baseId);
  if (linked.length) {
    const i = MapView.markersData.markers.indexOf(linked[0]);
    const { px, py } = MapView.worldToImage(linked[0].x, linked[0].z);
    MapView.scale = Math.max(MapView.scale, 1.4);
    MapView.offsetX = MapView.canvas.width / 2 - px * MapView.scale;
    MapView.offsetY = MapView.canvas.height / 2 - py * MapView.scale;
    MapView.draw();
    if (i >= 0) openMarkerCard(i);
    return;
  }
  MapView.pendingBase = { id: baseId, server: Inv.serverId, name: base.name };
  MapView.setAddMode(true);
  toast(IT('bases.clickMap'));
}

// Chamado por map.js quando o marcador é criado com pendingBase.
function basesMarkerPlaced(m, pending) {
  m.type = 'base';
  m.name = pending.name;
  m.base = { server: pending.server, id: pending.id };
  if (Inv.serverId === pending.server && Inv.data) {
    const base = Inv.data.bases.find((b) => b.id === pending.id);
    if (base) { base.map = { mapName: MapView.mapName, x: m.x, z: m.z, markerId: m.id }; invSave(); }
  }
}

// Bloco "Layout da base" no card do marcador.
async function basesMarkerBlock(m) {
  const box = document.getElementById('mkc-base');
  if (!box) return;
  if (!m || m.type !== 'base') { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const sid = AppState.trackingId;
  await invEnsureCatalog();
  if (sid) await invLoadServer(sid);
  const linked = m.base && m.base.server === sid ? Inv.data.bases.find((b) => b.id === m.base.id) : null;
  let html = `<div class="mkb-head">${Icon.svg('home', 15)} <b>${invEsc(IT('bases.layout'))}</b></div>`;
  if (linked) {
    let st = 0, items = 0;
    for (const f of linked.floors) { st += f.storages.length; for (const s of f.storages) items += s.items.length; }
    html += `<p class="small">${invEsc(linked.name)} · ${invEsc(IT('bases.meta', { floors: linked.floors.length, st, items }))}</p>
      <div class="mkb-actions"><button class="btn-small primary" id="mkb-open">${invEsc(IT('bases.openLayout'))}</button>
      <button class="btn-small" id="mkb-unlink">${invEsc(IT('bases.unlink'))}</button></div>`;
  } else if (m.base && m.base.server && m.base.server !== sid) {
    html += `<p class="muted small">${invEsc(IT('bases.otherServer'))}</p>
      <div class="mkb-actions"><button class="btn-small" id="mkb-create">${invEsc(IT('bases.createHere'))}</button></div>`;
  } else {
    html += `<p class="muted small">${invEsc(IT('bases.noLayout'))}</p>
      <div class="mkb-actions"><button class="btn-small primary" id="mkb-create">${invEsc(IT('bases.createLayout'))}</button>
      ${Inv.data && Inv.data.bases.length ? `<button class="btn-small" id="mkb-link">${invEsc(IT('bases.linkExisting'))}</button>` : ''}</div>`;
  }
  box.innerHTML = html;
  const save = async () => { await MapView.saveMarkers(); MapView.draw(); };
  const link = (base) => {
    m.base = { server: sid, id: base.id };
    base.map = { mapName: MapView.mapName, x: m.x, z: m.z, markerId: m.id };
    invSave();
  };
  const open = box.querySelector('#mkb-open');
  if (open) open.onclick = () => basesOpenFromMarker(m);
  const unlink = box.querySelector('#mkb-unlink');
  if (unlink) unlink.onclick = async () => { if (linked) { linked.map = null; invSave(); } m.base = null; await save(); basesMarkerBlock(m); };
  const create = box.querySelector('#mkb-create');
  if (create) create.onclick = async () => {
    const nameEl = document.getElementById('mkc-name');
    const base = basesNew((nameEl && nameEl.value.trim()) || m.name);
    link(base); await save();
    basesOpenFromMarker(m);
  };
  const lnk = box.querySelector('#mkb-link');
  if (lnk) lnk.onclick = async () => {
    const id = await Ask.pick(IT('bases.linkExisting'), Inv.data.bases.map((b) => ({ valor: b.id, texto: b.name, sub: IT('bases.floorsN', { n: b.floors.length }) })));
    const base = id && Inv.data.bases.find((b) => b.id === id);
    if (!base) return;
    link(base); await save(); basesMarkerBlock(m);
  };
}

async function basesOpenFromMarker(m) {
  if (typeof saveMarkerCard === 'function') await saveMarkerCard(false);
  hideModal('modal-marker');
  Inv.sub = 'bases';
  switchTrackingTab('inventory');
  await openInventoryTab();
  if (m.base) basesSelect(m.base.id);
}

// Apagar a base solta o marcador (o ponto continua no mapa).
async function basesUnlinkMarkers(baseId) {
  const ms = basesLinkedMarkers(baseId);
  if (!ms.length) return;
  for (const m of ms) m.base = null;
  await MapView.saveMarkers(); MapView.draw();
}

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
function basesClosePops() {
  for (const id of ['bs-bases-pop', 'bs-floor-cfg']) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  const b = document.getElementById('bs-bases-btn'); if (b) b.classList.remove('open');
}

function initBases() {
  basesInitCanvas();
  basesInitStorageModal();
  window.addEventListener('keydown', basesKeydown, true);

  const addBase = () => {
    const b = basesNew(); invSave(); invUpdateStats();
    Bases.tool = 'floor';
    basesSelect(b.id);
  };
  document.getElementById('bs-add').addEventListener('click', () => { basesClosePops(); addBase(); });

  // Menus de sobrepor: lista de bases e configuração do andar.
  const pop = (btnId, popId) => {
    document.getElementById(btnId).addEventListener('click', (e) => {
      e.stopPropagation();
      const el = document.getElementById(popId); const open = el.classList.contains('hidden');
      basesClosePops();
      el.classList.toggle('hidden', !open);
      document.getElementById(btnId).classList.toggle('open', open);
    });
    document.getElementById(popId).addEventListener('click', (e) => e.stopPropagation());
  };
  pop('bs-bases-btn', 'bs-bases-pop');
  pop('bs-floor-cfg-btn', 'bs-floor-cfg');
  document.addEventListener('click', basesClosePops);

  // Painel de storages recolhível (lembra a escolha).
  const right = document.getElementById('bs-right');
  try { right.classList.toggle('collapsed', localStorage.getItem('inv.bsRight') === '0'); } catch { /* segue */ }
  document.getElementById('bs-right-toggle').addEventListener('click', () => {
    right.classList.toggle('collapsed');
    try { localStorage.setItem('inv.bsRight', right.classList.contains('collapsed') ? '0' : '1'); } catch { /* segue */ }
  });

  // Tela cheia do palco 2D/3D.
  document.getElementById('bs-full').addEventListener('click', () => {
    const st = document.getElementById('bs-stage');
    if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen().catch(() => {});
  });
  document.getElementById('bs-empty-add').addEventListener('click', addBase);

  document.getElementById('bs-list').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const b = Inv.data.bases.find((x) => x.id === li.dataset.id); if (!b) return;
    if (e.target.closest('.bl-del')) {
      if (!await Ask.confirm(IT('bases.confirmDel', { name: b.name }))) return;
      Inv.data.bases = Inv.data.bases.filter((x) => x.id !== b.id);
      basesUnlinkMarkers(b.id);
      if (Bases.baseId === b.id) Bases.baseId = null;
      invRecount(); invSave(); invUpdateStats(); basesRender();
      return;
    }
    basesClosePops();
    basesSelect(b.id);
  });

  document.getElementById('bs-name').addEventListener('input', (e) => {
    const b = bCurBase(); if (!b) return;
    b.name = e.target.value || IT('bases.defaultName', { n: '' }).trim();
    invSave(); basesRenderList();
  });
  document.getElementById('bs-pin').addEventListener('click', () => { const b = bCurBase(); if (b) basesPinOnMap(b.id); });

  document.getElementById('bs-floor-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.bs-floor'); if (!btn) return;
    Bases.floorId = btn.dataset.id; Bases.selStorage = null;
    basesRenderFloors(); basesRenderDetails(); basesDraw();
    if (Bases.view === '3d') bases3DBuild();
  });
  document.getElementById('bs-floor-name').addEventListener('input', (e) => {
    const f = bCurFloor(); if (!f) return; f.name = e.target.value || '—'; invSave(); basesRenderFloors();
  });
  const resize = () => {
    const f = bCurFloor(); if (!f) return;
    const w = Math.max(2, Math.min(FLOOR_MAX, parseInt(document.getElementById('bs-floor-w').value, 10) || f.w));
    const h = Math.max(2, Math.min(FLOOR_MAX, parseInt(document.getElementById('bs-floor-h').value, 10) || f.h));
    if (f.storages.some((s) => s.x >= w * SUB || s.y >= h * SUB)) { toast(IT('bases.resizeBlocked')); basesRenderFloors(); return; }
    f.w = w; f.h = h;
    f.pieces = f.pieces.filter((p) => { const c = centroid(p.v); return c[0] < w && c[1] < h; });
    wallsCleanup(f);
    Bases.centeredFor = null; bChanged({ noList: true }); basesSetView(Bases.view);
  };
  document.querySelectorAll('#bs-floor-cfg [data-grow]').forEach((btn) => btn.addEventListener('click', () => {
    const b = bCurBase(); if (!b) return;
    const n = Math.max(1, Math.min(50, parseInt(document.getElementById('bs-grow-n').value, 10) || 1));
    if (!basesGrow(b, btn.dataset.grow, n)) { toast(IT('bases.growMax', { n: FLOOR_MAX })); return; }
    Bases.centeredFor = null; bChanged({ noList: true }); basesSetView(Bases.view); basesRenderFloors();
  }));
  document.getElementById('bs-floor-w').addEventListener('change', resize);
  document.getElementById('bs-floor-h').addEventListener('change', resize);
  document.getElementById('bs-floor-add').addEventListener('click', () => {
    const b = bCurBase(); if (!b) return; const cur = bCurFloor();
    const f = basesNewFloor(IT('bases.floorN', { n: b.floors.length }), cur.w, cur.h);
    if (document.getElementById('bs-floor-copy').checked) {
      f.pieces = cur.pieces.map((p) => ({ ...p, id: invUid(), v: p.v.map((q) => [...q]) }));
      f.walls = JSON.parse(JSON.stringify(cur.walls));
    }
    b.floors.push(f); Bases.floorId = f.id; invSave(); basesRender();
  });
  document.getElementById('bs-floor-del').addEventListener('click', async () => {
    const b = bCurBase(); const f = bCurFloor(); if (!b || !f) return;
    if (b.floors.length === 1) { toast(IT('bases.needFloor')); return; }
    if (!await Ask.confirm(IT('bases.confirmDelFloor', { name: f.name, n: f.storages.length }))) return;
    b.floors = b.floors.filter((x) => x !== f); Bases.floorId = b.floors[0].id; bChanged(); basesRender();
  });

  document.getElementById('bs-tools2d').addEventListener('click', (e) => {
    const tb = e.target.closest('.bs-tool');
    if (tb) { Bases.tool = tb.dataset.tool; basesRenderTools(); basesDraw(); return; }
    const wt = e.target.closest('.bs-wt');
    if (wt) {
      Bases.wallType = wt.dataset.wt; Bases.tool = 'wall';
      if (wt.dataset.wt === 'custom' && !bCurBase().customWalls.length) basesOpenCustomWalls();
      basesRenderTools(); return;
    }
  });
  document.getElementById('bs-brush').addEventListener('change', (e) => { Bases.brush = +e.target.value; });
  try { const m = localStorage.getItem('inv.material'); if (MATERIALS[m]) Bases.material = m; } catch { /* segue */ }
  document.getElementById('bs-opt-mat').addEventListener('click', (e) => {
    const b = e.target.closest('.bs-mat'); if (!b) return;
    Bases.material = b.dataset.mat;
    try { localStorage.setItem('inv.material', Bases.material); } catch { /* segue */ }
    basesRenderTools();
  });
  const areas = (v) => { Bases.showAreas = v; basesRenderTools(); basesDraw(); if (Bases.view === '3d') bases3DBuild(); };
  document.getElementById('bs-areas').addEventListener('change', (e) => areas(e.target.checked));
  document.getElementById('bs-areas3d').addEventListener('change', (e) => areas(e.target.checked));
  document.querySelectorAll('#bs-right .bs-rtab').forEach((b) => b.addEventListener('click', () => { Bases.rightTab = b.dataset.tab; basesRenderPalette(); }));
  document.getElementById('bs-obj-cats').addEventListener('click', (e) => {
    const b = e.target.closest('.ob-chip'); if (!b) return;
    Bases.objCat = b.dataset.cat; basesRenderPalette();
  });
  document.getElementById('bs-tri-rot').addEventListener('click', () => { Bases.triR = (Bases.triR + 1) % 4; basesRenderTools(); basesDraw(); });
  document.getElementById('bs-custom-sel').addEventListener('change', (e) => { Bases.customId = e.target.value || null; basesRenderTools(); });
  document.getElementById('bs-custom-edit').addEventListener('click', basesOpenCustomWalls);
  document.getElementById('cw-add').addEventListener('click', basesAddCustomWall);
  document.getElementById('cw-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') basesAddCustomWall(); });
  document.getElementById('cw-close').addEventListener('click', () => hideModal('modal-inv-walls'));

  document.querySelectorAll('.bs-view').forEach((b) => b.addEventListener('click', () => basesSetView(b.dataset.view)));
  document.getElementById('bs-center').addEventListener('click', () => {
    if (Bases.view === '2d') basesCenterView(); else if (Bases.three) { Bases.three.framedBase = null; bases3DBuild(); }
  });
  document.getElementById('bs-only-below').addEventListener('change', (e) => { Bases.onlyBelow = e.target.checked; bases3DBuild(); });
  document.getElementById('bs-glass').addEventListener('change', (e) => { Bases.glassWalls = e.target.checked; bases3DBuild(); });

  let qT;
  document.getElementById('bs-st-search').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(basesRenderPalette, 120); });
  document.getElementById('bs-palette').addEventListener('click', (e) => {
    const b = e.target.closest('.st-pal'); if (!b) return;
    if (b.dataset.kind === 'obj') { Bases.pickObj = b.dataset.key; Bases.tool = 'object'; }
    else { Bases.pick = b.dataset.key; Bases.tool = 'storage'; }
    if (Bases.view !== '2d') basesSetView('2d');
    basesRenderPalette(); basesRenderTools();
  });
  document.querySelector('#bs-focus button').addEventListener('click', () => {
    Inv.selectedKey = null; basesRenderTools(); basesDraw(); if (Bases.view === '3d') bases3DBuild();
  });
}
