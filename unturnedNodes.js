// ============================================================
// unturnedNodes.js — Leitor do Environment/Nodes.dat do Unturned
//
// Daqui saem os NOMES DAS LOCALIZAÇÕES e a posição dos AIRDROPS de
// qualquer mapa — oficial ou de Workshop — sem abrir o editor do
// jogo. Também descobre o TAMANHO DO MUNDO e a escala da imagem,
// que é o que faz o marcador cair no lugar certo.
//
// ------------------------------------------------------------
// COMO O FORMATO FOI DECIFRADO
// ------------------------------------------------------------
// O arquivo é binário e não documentado. Foi resolvido com um
// solver sobre os arquivos reais de 9 mapas (Monolith, Yukon,
// Alpha Valley, Washington, PEI, Germany, Russia, Tutorial,
// Destruction), exigindo duas coisas ao mesmo tempo:
//   1. consumir exatamente a quantidade de nós declarada, e
//   2. terminar EXATAMENTE no último byte do arquivo.
// Com os tipos limitados a 0..9, a solução é ÚNICA para cada
// versão do arquivo. Os 9 mapas fecham no byte exato.
//
//   byte    versão do arquivo (5, 6 e 9 observadas)
//   byte    quantidade de nós
//   por nó:
//     float x, float y, float z    (12 bytes, coordenada do mundo)
//     byte  tipo
//     payload conforme o tipo:
//       0  LOCALIZAÇÃO -> byte tamanho + nome UTF-8   (variável)
//       1  ?           -> 7 bytes
//       2  ?           -> 0 bytes
//       3  ?           -> 4 bytes
//       4  ?           -> 5 bytes
//       5  AIRDROP     -> uint16 (id do item que cai)
//       6  ?           -> 21 bytes
//
// Só damos nome ao que dá para PROVAR: o tipo 0 carrega uma string
// que são os nomes das cidades, e o tipo 5 carrega um uint16
// constante por mapa (956 = o item do airdrop). Os outros são
// zonas do editor; sabemos o tamanho deles — que é o que importa
// para não perder o alinhamento — mas não o significado, então não
// inventamos nome para eles.
//
// A versão anterior deste arquivo parava no primeiro tipo
// desconhecido. Era por isso que o Russia entregava só 23 dos 25
// nomes: o tipo 6 (21 bytes) aparece no meio da lista dele.
//
// ------------------------------------------------------------
// ESCALA DA IMAGEM — por que não é o tamanho do mundo
// ------------------------------------------------------------
// A conta óbvia (esticar o Map.png sobre o tamanho nominal do
// mundo) está ERRADA. O Map.png do PEI tem 1923x1927 px para um
// mundo de 2048 m; esticar introduz 6,5% de erro, que na borda do
// mapa vira ~60 m de deslocamento.
//
// Verificado desenhando as duas hipóteses sobre as pontes do PEI
// (Confederation e Liberation), que são estruturas finas e
// inconfundíveis: a hipótese "1 pixel = 1 metro, imagem centrada
// na origem" cai em cima das duas pontes; a hipótese "esticar"
// cai na grama ao lado. Alpha Valley (1024px/1024m) e Russia
// (4096px/4096m) também são 1:1.
//
// Sem dependência do Electron: dá para testar isoladamente.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const NODE_LOCATION = 0;
const NODE_AIRDROP = 5;

// Tamanho do payload de cada tipo, além dos 12 bytes de posição e
// do byte de tipo. `null` = tamanho variável (só a localização).
const PAYLOAD = {
  0: null,   // localização: byte de tamanho + string
  1: 7,
  2: 0,
  3: 4,
  4: 5,
  5: 2,      // airdrop: uint16 com o id do item
  6: 21
};

// O maior valor de tipo que aceitamos. Serve de guarda: se o
// alinhamento se perder, o byte lido vira lixo e quase sempre cai
// acima disso, então paramos em vez de despejar coordenadas
// aleatórias no mapa de quem está usando.
const MAX_TYPE = 9;

function parseNodes(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const out = {
    version: null, declared: 0, nodes: [],
    complete: false, reason: null, bytesRead: 0
  };

  if (b.length < 2) { out.reason = 'empty'; return out; }

  out.version = b.readUInt8(0);
  out.declared = b.readUInt8(1);
  let o = 2;

  for (let i = 0; i < out.declared; i++) {
    if (o + 13 > b.length) { out.reason = 'truncated'; break; }

    const x = b.readFloatLE(o);
    const y = b.readFloatLE(o + 4);
    const z = b.readFloatLE(o + 8);
    const type = b.readUInt8(o + 12);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      out.reason = 'bad_float'; break;
    }
    if (type > MAX_TYPE) { out.reason = `unknown_type_${type}`; break; }
    o += 13;

    if (type === NODE_LOCATION) {
      if (o >= b.length) { out.reason = 'truncated'; break; }
      const len = b.readUInt8(o);
      if (o + 1 + len > b.length) { out.reason = 'truncated'; break; }
      const name = b.slice(o + 1, o + 1 + len).toString('utf8');
      o += 1 + len;
      out.nodes.push({ type: 'location', name, x, y, z });
      continue;
    }

    const size = PAYLOAD[type];
    if (size == null) { out.reason = `unknown_type_${type}`; break; }
    if (o + size > b.length) { out.reason = 'truncated'; break; }
    const payload = b.slice(o, o + size);
    o += size;

    if (type === NODE_AIRDROP) {
      out.nodes.push({ type: 'airdrop', itemId: payload.readUInt16LE(0), x, y, z });
    } else {
      // Zona do editor: guardamos a posição para o total bater e
      // seguimos. Não vira marcador porque não sabemos o que é.
      out.nodes.push({ type: 'zone', rawType: type, x, y, z });
    }
  }

  out.bytesRead = o;
  // "Completo" é uma afirmação forte: consumimos todos os nós
  // declarados E terminamos no último byte. Qualquer sobra
  // significa que a nossa tabela não descreve este arquivo.
  out.complete = (out.nodes.length === out.declared) && (o === b.length);
  if (!out.complete && !out.reason) {
    out.reason = o === b.length ? 'count_mismatch' : 'trailing_bytes';
  }

  out.locations = out.nodes.filter((n) => n.type === 'location').length;
  out.airdrops = out.nodes.filter((n) => n.type === 'airdrop').length;
  return out;
}

// ------------------------------------------------------------
// Tamanho do mundo
// ------------------------------------------------------------
// Em ordem de confiança:
//   1. contagem de tiles do Landscape (512 m cada) — funciona para
//      qualquer mapa, inclusive de Workshop com tamanho fora do
//      padrão. Confirmado: PEI 4x4 = 2048 m, Russia 8x8 = 4096 m,
//      Alpha Valley 2x2 = 1024 m.
//   2. o byte de tamanho do Level.dat (ELevelSize).
//   3. nada: devolve null e quem chamou decide.
//
// A tabela fixa de nomes de mapa que existia antes estava errada
// (dizia 512 m para o Alpha Valley, que tem 1024) e não servia
// para mapa nenhum de Workshop.
const TILE_METERS = 512;

const LEVEL_SIZE_METERS = {
  0: 512,    // TINY
  1: 1024,   // SMALL   — Monolith, Alpha Valley
  2: 2048,   // MEDIUM  — Washington, PEI, Yukon
  3: 4096,   // LARGE   — Germany, Russia
  4: 8192    // INSANE
};

function worldSizeFromTiles(mapDir) {
  const dir = path.join(mapDir, 'Landscape', 'Heightmaps');
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of files) {
    const m = /^Tile_(-?\d+)_(-?\d+)_/.exec(f);
    if (!m) continue;
    const tx = parseInt(m[1], 10), tz = parseInt(m[2], 10);
    minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
    minZ = Math.min(minZ, tz); maxZ = Math.max(maxZ, tz);
  }
  if (!Number.isFinite(minX)) return null;

  const w = (maxX - minX + 1) * TILE_METERS;
  const h = (maxZ - minZ + 1) * TILE_METERS;
  return Math.max(w, h);
}

function worldSizeFromLevelDat(mapDir) {
  try {
    const b = fs.readFileSync(path.join(mapDir, 'Level.dat'));
    if (b.length < 2) return null;
    // Layout: versão + campos + [tamanho] + [tipo]. Na versão 1 o
    // byte de tamanho é o último; na 2 em diante vem o tipo depois.
    const version = b.readUInt8(0);
    const idx = version >= 2 ? b.length - 2 : b.length - 1;
    if (idx < 1) return null;
    return LEVEL_SIZE_METERS[b.readUInt8(idx)] || null;
  } catch {
    return null;
  }
}

function readWorldSize(mapDir) {
  const porTiles = worldSizeFromTiles(mapDir);
  if (porTiles) return { meters: porTiles, source: 'landscape_tiles' };
  const porLevel = worldSizeFromLevelDat(mapDir);
  if (porLevel) return { meters: porLevel, source: 'level_dat' };
  return { meters: null, source: 'unknown' };
}

// ------------------------------------------------------------
// Escala: quantos metros vale um pixel do Map.png
// ------------------------------------------------------------
// Os mapas oficiais renderizam a 1 px = 1 m (às vezes com a borda
// aparada, como o PEI: 1923 px para 2048 m de mundo). Só quando a
// imagem for MUITO menor que o mundo é que ela foi de fato
// reduzida, e aí a escala passa a ser a razão entre os dois.
function metersPerPixel(worldMeters, imageWidth) {
  if (!imageWidth) return 1;
  if (!worldMeters) return 1;
  const razao = imageWidth / worldMeters;
  // Até 25% de diferença tratamos como imagem 1:1 aparada.
  if (razao > 0.75) return 1;
  return worldMeters / imageWidth;
}

// ------------------------------------------------------------
// Arquivos
// ------------------------------------------------------------
function findNodesFile(mapDir) {
  const candidatos = [
    path.join(mapDir, 'Environment', 'Nodes.dat'),  // formato atual
    path.join(mapDir, 'Level', 'Nodes.dat')         // mapas antigos
  ];
  for (const p of candidatos) {
    try { if (fs.statSync(p).isFile()) return p; } catch { /* segue */ }
  }
  return null;
}

function readMapNodes(mapDir) {
  const file = findNodesFile(mapDir);
  if (!file) return { ok: false, reason: 'no_nodes_file', nodes: [] };

  let buf;
  try { buf = fs.readFileSync(file); }
  catch (e) { return { ok: false, reason: 'read_error', error: e.message, nodes: [] }; }

  const r = parseNodes(buf);
  const world = readWorldSize(mapDir);
  return { ok: true, file, worldSize: world.meters, worldSizeSource: world.source, ...r };
}

// ------------------------------------------------------------
// Nós -> marcadores do app
// ------------------------------------------------------------
// O id é DERIVADO do tipo e da coordenada, não sorteado. Isso
// importa porque dá para pendurar anotações e prints num ponto
// extraído e depois rodar a extração de novo (mapa atualizado,
// outra versão do jogo). Com id sorteado, a segunda extração
// criaria pontos "novos" e as anotações ficariam órfãs.
function autoMarkerId(type, x, z) {
  return `auto_${type[0]}${x}_${z}`;
}

// `official: true` marca o que veio do ARQUIVO DO JOGO.
//
// Não é a mesma coisa que `auto`. `auto` diz "foi extraído, uma
// nova extração pode substituir". `official` diz "este nome é o
// nome que o mapa tem" — e por isso não é editável: renomear
// Novosibirsk para "base do fulano" apaga a única referência
// confiável que o app tem para dizer ONDE as coisas ficam.
//
// Airdrop numerado NÃO é official: o número é invenção nossa (o
// arquivo só diz que existe um ponto de queda ali), então renomear
// para "airdrop do porto" é legítimo.
function nodesToMarkers(nodes) {
  const out = [];
  let airdropIndex = 0;
  for (const n of nodes || []) {
    const x = Math.round(n.x), z = Math.round(n.z);
    if (n.type === 'location') {
      out.push({ id: autoMarkerId('location', x, z), name: n.name, type: 'location',
                 x, z, auto: true, official: true });
    } else if (n.type === 'airdrop') {
      airdropIndex += 1;
      out.push({ id: autoMarkerId('airdrop', x, z), name: `Airdrop ${airdropIndex}`,
                 type: 'airdrop', x, z, auto: true });
    }
  }
  return out;
}

module.exports = {
  parseNodes,
  readMapNodes,
  findNodesFile,
  nodesToMarkers,
  autoMarkerId,
  readWorldSize,
  worldSizeFromTiles,
  worldSizeFromLevelDat,
  metersPerPixel,
  LEVEL_SIZE_METERS,
  TILE_METERS,
  PAYLOAD,
  NODE_LOCATION,
  NODE_AIRDROP
};
