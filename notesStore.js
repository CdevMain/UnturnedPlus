// ============================================================
// notesStore.js — Anotações e prints (processo principal)
//
// A ideia é simples e vale explicar, porque ela decide o formato
// do arquivo: você joga, vê alguma coisa que quer lembrar (a base
// de um clã, onde caiu um airdrop, o preço de um item na loja) e
// anota ali mesmo, com um print junto. Semanas depois essa
// anotação precisa ainda estar lá, e precisa ir junto no backup.
//
// Por isso:
//   - Cada anotação tem um `id` estável (nunca o índice de um
//     array — índice muda quando você apaga o vizinho).
//   - Toda anotação pertence a um ESCOPO, que é só uma string:
//         server:<bmId>            anotação do servidor
//         marker:<Mapa>:<idMarcador>   anotação de um ponto do mapa
//     O escopo é opaco para este arquivo. Isso é de propósito: dá
//     para pendurar anotação em qualquer coisa nova depois sem
//     mexer aqui.
//   - Os prints NÃO ficam dentro do JSON. Ficam como arquivos em
//     shots/, e a anotação guarda só o id. Um JSON de 40 MB de
//     base64 fica lento para ler a cada abertura de tela; um
//     índice de 4 KB não fica.
//
// Layout em userData:
//   notes/index.json      { notes: [ {...} ] }
//   notes/shots/<id>.png  os prints
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let baseDir = null;

function init(userDataPath) {
  baseDir = path.join(userDataPath, 'notes');
  fs.mkdirSync(shotsDir(), { recursive: true });
  return baseDir;
}

function indexFile() { return path.join(baseDir, 'index.json'); }
function shotsDir() { return path.join(baseDir, 'shots'); }

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

// ------------------------------------------------------------
// Tipos e ligações
// ------------------------------------------------------------
const TIPOS = ['note', 'ficha', 'raid'];

// A MESMA validação do teamStore. Duas cópias divergiriam, e o
// buraco apareceria justamente do lado que ninguém olhou.
const PROTO_OK = /^https?:\/\//i;
function fotoValida(url) {
  const u = String(url || '').trim();
  return (u && PROTO_OK.test(u)) ? u.slice(0, 500) : null;
}
const RELS = ['ally', 'team', 'enemy', 'related'];

// A normalização do nome NÃO é reescrita aqui: é a de
// fichasStore.js, importada.
//
// A primeira versão tinha uma cópia "equivalente" — e ela não era.
// A de lá preserva espaço e pontuação e só baixa a caixa; a minha
// apagava tudo que não fosse letra ou número. `Zé Ruela` virava
// `ze ruela` de um lado e `zeruela` do outro, e o efeito é o pior
// possível: a ficha do jogador e o dossiê do MESMO jogador deixam
// de se encontrar, sem erro nenhum na tela, só um dossiê que
// "não aparece" para quem está olhando a lista.
//
// Duas normalizações é uma a mais. Esta é a única.
const chaveDeJogador = require('./fichasStore').chaveDe;

function limparLigacoes(links, antiga) {
  const base = Array.isArray(links) ? links : (antiga ? antiga.links : null);
  if (!Array.isArray(base)) return [];
  const vistas = new Set();
  const out = [];
  for (const l of base) {
    const to = l && typeof l.to === 'string' ? l.to : null;
    if (!to || vistas.has(to)) continue;
    vistas.add(to);
    out.push({ to, rel: RELS.includes(l.rel) ? l.rel : 'related' });
    if (out.length >= 60) break;
  }
  return out;
}

function readIndex() {
  try {
    const j = JSON.parse(fs.readFileSync(indexFile(), 'utf-8'));
    return Array.isArray(j.notes) ? j : { notes: [] };
  } catch {
    return { notes: [] };
  }
}

function writeIndex(data) {
  fs.mkdirSync(baseDir, { recursive: true });
  // Escrita atômica: um crash no meio do write deixaria o índice
  // truncado, e o usuário perderia TODAS as anotações de uma vez.
  const tmp = indexFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, indexFile());
  return true;
}

// ------------------------------------------------------------
// Anotações
// ------------------------------------------------------------

function list(scope) {
  const all = readIndex().notes;
  const rows = scope ? all.filter((n) => n.scope === scope) : all;
  // Fixadas primeiro, depois da mais recente para a mais antiga.
  return rows.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function get(id) {
  return readIndex().notes.find((n) => n.id === id) || null;
}

function save(note) {
  const data = readIndex();
  const now = Date.now();
  const i = data.notes.findIndex((n) => n.id === note.id);

  const antiga = i >= 0 ? data.notes[i] : null;
  const clean = {
    id: note.id || newId('note'),
    scope: String(note.scope || ''),
    // TIPO DA ANOTAÇÃO
    //
    // Tudo aqui continua sendo uma anotação: mesmo arquivo, mesma
    // busca, mesmo backup, mesmos prints. O tipo só muda quais
    // campos a tela oferece e como o cartão aparece na mesa.
    //
    //   note   texto e fotos, para registrar
    //   ficha  dossiê de um jogador
    //   raid   plano de raid, com a conta da calculadora junto
    //
    // Tipo desconhecido vira `note` em vez de ser recusado: uma
    // versão futura do app pode gravar um tipo que esta não
    // conhece, e perder a anotação inteira por causa disso seria
    // muito pior do que mostrá-la como texto.
    type: TIPOS.includes(note.type) ? note.type : 'note',
    icon: note.icon ? String(note.icon).slice(0, 40) : null,
    title: String(note.title || '').slice(0, 120),
    text: String(note.text || '').slice(0, 20000),
    color: /^#[0-9a-f]{6}$/i.test(note.color || '') ? note.color : null,
    pinned: !!note.pinned,
    shots: Array.isArray(note.shots) ? note.shots.filter((s) => typeof s === 'string') : [],
    // Marcadores CITADOS por esta anotação. É uma lista de ids de
    // marcador, não de escopos: uma anotação geral do servidor pode
    // apontar para vários pontos do mapa ("rota: A -> B -> C") sem
    // deixar de ser uma anotação do servidor. O mapa a que os ids
    // pertencem vai junto, senão dois mapas com ids iguais (o que
    // não acontece hoje, mas é barato garantir) se misturariam.
    markers: Array.isArray(note.markers)
      ? [...new Set(note.markers.filter((m) => typeof m === 'string' && m).slice(0, 30))]
      : [],
    markerMap: note.markerMap ? String(note.markerMap).slice(0, 80) : null,

    // FICHA: o jogador de quem é o dossiê. Guardamos o nome como
    // foi visto E a chave normalizada, porque a lista de jogadores
    // do Unturned devolve só o nome — não existe SteamID no A2S — e
    // a mesma pessoa aparece com maiúscula diferente, espaço a
    // mais, caractere decorativo. A chave é o que casa; o nome é o
    // que se mostra.
    player: note.player ? String(note.player).slice(0, 60) : null,
    playerKey: note.player ? chaveDeJogador(note.player) : null,
    // FOTO DO DOSSIÊ, por link externo — mesma regra da foto do
    // time: só http(s). Este endereço acaba dentro de um `src` na
    // tela, e um `javascript:` ali é execução de código vinda de
    // texto que alguém escreveu.
    photo: fotoValida(note.photo),

    // PLANO DE RAID: o que a pessoa montou na calculadora, salvo
    // junto. É uma FOTOGRAFIA do resultado, não um cálculo vivo:
    // se o servidor mudar o multiplicador de armadura amanhã, o
    // plano de ontem continua dizendo o que foi decidido ontem —
    // que é a informação que o time precisa para se organizar.
    raid: note.raid && typeof note.raid === 'object'
      ? {
          lines: Array.isArray(note.raid.lines) ? note.raid.lines.slice(0, 40) : [],
          buys: Array.isArray(note.raid.buys) ? note.raid.buys.slice(0, 40) : [],
          total: note.raid.total == null ? null : Number(note.raid.total),
          note: note.raid.note ? String(note.raid.note).slice(0, 400) : null
        }
      : null,

    // LIGAÇÕES com outras anotações do MESMO escopo. Ver linkNotes.
    links: limparLigacoes(note.links, antiga),

    // Onde o cartão está na mesa de investigação. Fica na anotação
    // (e não num arquivo de layout à parte) porque é dado do
    // usuário: ele arrastou para ali por um motivo, e isso tem que
    // sobreviver ao backup como o resto.
    board: note.board && Number.isFinite(Number(note.board.x))
      ? { x: Math.round(Number(note.board.x)), y: Math.round(Number(note.board.y) || 0) }
      : (antiga ? antiga.board || null : null),

    createdAt: (antiga ? antiga.createdAt : null) || now,
    updatedAt: now
  };

  if (i >= 0) data.notes[i] = clean; else data.notes.push(clean);
  writeIndex(data);
  return clean;
}

function remove(id, { keepShots = false } = {}) {
  const data = readIndex();
  const note = data.notes.find((n) => n.id === id);
  if (!note) return false;
  data.notes = data.notes.filter((n) => n.id !== id);
  writeIndex(data);
  // Prints só existem para a anotação: apagar a anotação e deixar
  // o arquivo para trás só engorda a pasta com lixo invisível.
  if (!keepShots) for (const s of note.shots || []) removeShot(s);
  return true;
}

// Todas as anotações cujo escopo começa com um prefixo. Serve para
// a pergunta "quais são TODAS as anotações de marcador deste mapa?"
// — que a aba de notas do servidor faz para mostrar, num lugar só,
// o que está espalhado pelos pontos.
function listByPrefix(prefix) {
  const p = String(prefix || '');
  if (!p) return [];
  return readIndex().notes
    .filter((n) => String(n.scope || '').startsWith(p))
    .sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

// Tira um marcador de TODAS as anotações que o citam. Chamado
// quando o marcador é apagado: deixar o id para trás produziria
// uma citação que aponta para o nada — e o painel mostraria um
// chip "(marcador apagado)" para sempre.
function forgetMarker(markerId) {
  const data = readIndex();
  let n = 0;
  for (const nota of data.notes) {
    if (!Array.isArray(nota.markers) || !nota.markers.includes(markerId)) continue;
    nota.markers = nota.markers.filter((m) => m !== markerId);
    n += 1;
  }
  if (n) writeIndex(data);
  return n;
}

// Apaga tudo de um escopo (usado quando o servidor sai da lista).
function removeScope(scope) {
  const data = readIndex();
  const doomed = data.notes.filter((n) => n.scope === scope);
  if (!doomed.length) return 0;
  data.notes = data.notes.filter((n) => n.scope !== scope);
  writeIndex(data);
  for (const n of doomed) for (const s of n.shots || []) removeShot(s);
  return doomed.length;
}

// Quantas anotações/prints cada escopo tem — o card mostra isso
// como um selo sem precisar carregar o conteúdo todo.
function counts(scopes) {
  const all = readIndex().notes;
  const out = {};
  for (const s of scopes || []) out[s] = { notes: 0, shots: 0 };
  for (const n of all) {
    if (!out[n.scope]) {
      if (scopes && scopes.length) continue;
      out[n.scope] = { notes: 0, shots: 0 };
    }
    out[n.scope].notes++;
    out[n.scope].shots += (n.shots || []).length;
  }
  return out;
}

// ------------------------------------------------------------
// Prints
// ------------------------------------------------------------

function shotPath(id) {
  // O id JÁ inclui a extensão (shot_ab12.png). Nunca deixe um id
  // vindo do renderer virar caminho: um "../../" aqui escreveria
  // fora da pasta do app.
  const safe = String(id).replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe.includes('..')) return null;
  return path.join(shotsDir(), safe);
}

function shotExists(id) {
  const p = shotPath(id);
  return !!p && fs.existsSync(p);
}

// Copia um arquivo de imagem para dentro da pasta do app.
function addShotFromFile(filePath) {
  const ext = (path.extname(filePath) || '.png').toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return null;
  const id = newId('shot') + ext;
  fs.mkdirSync(shotsDir(), { recursive: true });
  fs.copyFileSync(filePath, shotPath(id));
  return shotMeta(id);
}

// Grava bytes crus (vindos do Ctrl+V ou de um canvas).
function addShotFromBuffer(buffer, ext = '.png') {
  const id = newId('shot') + (ext.startsWith('.') ? ext : '.' + ext);
  fs.mkdirSync(shotsDir(), { recursive: true });
  fs.writeFileSync(shotPath(id), buffer);
  return shotMeta(id);
}

function shotMeta(id) {
  const p = shotPath(id);
  if (!p || !fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  return { id, path: p, bytes: st.size, addedAt: st.mtimeMs };
}

function removeShot(id) {
  const p = shotPath(id);
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
}

// Prints que não pertencem mais a nenhuma anotação. Isso acontece
// se o índice for restaurado de um backup mais antigo que a pasta.
function orphanShots() {
  const used = new Set();
  for (const n of readIndex().notes) for (const s of n.shots || []) used.add(s);
  let files = [];
  try { files = fs.readdirSync(shotsDir()); } catch { return []; }
  return files.filter((f) => !used.has(f));
}

function pruneOrphans() {
  const orphans = orphanShots();
  for (const f of orphans) removeShot(f);
  return orphans.length;
}

// ------------------------------------------------------------
// Backup — aqui os prints VIRAM base64, porque um backup precisa
// ser um arquivo só que o usuário consegue mandar por Discord.
// ------------------------------------------------------------

// ------------------------------------------------------------
// LIGAÇÃO ENTRE ANOTAÇÕES
// ------------------------------------------------------------
// É o que sustenta as duas coisas que a Sara pediu: a mesa de
// investigação ("com ligação para cada") e a linha entre dois nomes
// na lista de jogadores.
//
// Regras, e o motivo de cada uma:
//
// 1. SIMÉTRICA, gravada nos dois lados. Meia relação é pior que
//    nenhuma: o cartão aparece ligado de um lado da mesa e solto do
//    outro, e não há como a pessoa perceber que é bug.
//
// 2. SÓ DENTRO DO MESMO ESCOPO. Ligar uma ficha do servidor A a uma
//    do servidor B faria a linha aparecer numa lista de jogadores
//    onde aquele nome nunca esteve. O isolamento por servidor é
//    pedido explícito, e ligação é justamente o que fura
//    isolamento se ninguém segurar.
//
// 3. Ligar de novo TROCA a relação em vez de duplicar. Marcar
//    "aliado" e depois "inimigo" tem que virar inimigo, não os dois.
function linkNotes(aId, bId, rel = 'related') {
  if (aId === bId) return { ok: false, reason: 'same_note' };
  const data = readIndex();
  const a = data.notes.find((n) => n.id === aId);
  const b = data.notes.find((n) => n.id === bId);
  if (!a || !b) return { ok: false, reason: 'no_note' };
  if (a.scope !== b.scope) return { ok: false, reason: 'other_scope' };

  const r = RELS.includes(rel) ? rel : 'related';
  for (const [x, y] of [[a, b], [b, a]]) {
    x.links = (Array.isArray(x.links) ? x.links : []).filter((l) => l.to !== y.id);
    x.links.push({ to: y.id, rel: r });
    x.updatedAt = Date.now();
  }
  writeIndex(data);
  return { ok: true, rel: r };
}

function unlinkNotes(aId, bId) {
  const data = readIndex();
  const a = data.notes.find((n) => n.id === aId);
  const b = data.notes.find((n) => n.id === bId);
  if (!a || !b) return { ok: false, reason: 'no_note' };
  for (const [x, y] of [[a, b], [b, a]]) {
    x.links = (Array.isArray(x.links) ? x.links : []).filter((l) => l.to !== y.id);
    x.updatedAt = Date.now();
  }
  writeIndex(data);
  return { ok: true };
}

// Onde o cartão fica na mesa. Grava direto, sem passar por save():
// arrastar um cartão não é editar a anotação, e carimbar
// `updatedAt` a cada pixel jogaria a nota para o topo da lista por
// ordem de "modificada" só porque alguém arrumou o layout.
function setBoardPos(id, x, y) {
  const data = readIndex();
  const n = data.notes.find((z) => z.id === id);
  if (!n) return { ok: false, reason: 'no_note' };
  n.board = { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) };
  writeIndex(data);
  return { ok: true, board: n.board };
}

// Tudo que a mesa precisa, numa consulta só: os cartões e as
// arestas já sem repetição e sem ponta solta.
function board(scope) {
  const notes = list(scope);
  const vivos = new Set(notes.map((n) => n.id));
  const vistas = new Set();
  const links = [];
  for (const n of notes) {
    for (const l of (n.links || [])) {
      if (!vivos.has(l.to)) continue;
      const chave = [n.id, l.to].sort().join('|');
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      links.push({ a: n.id, b: l.to, rel: l.rel });
    }
  }
  return { notes, links };
}

// As fichas de um escopo, indexadas pela chave do jogador. É o que
// a lista de jogadores consulta a cada atualização — por isso
// devolve um mapa pronto em vez de obrigar a tela a varrer tudo a
// cada nome.
function fichasDoEscopo(scope) {
  const out = {};
  for (const n of list(scope)) {
    if (n.type !== 'ficha' || !n.playerKey) continue;
    // Duas fichas para o mesmo jogador: fica a mais recente. `list`
    // já vem da mais nova para a mais velha, então a primeira ganha.
    if (!out[n.playerKey]) out[n.playerKey] = n;
  }
  return out;
}

function exportNotes(scopes, { includeShots = true } = {}) {
  const all = readIndex().notes;
  const rows = scopes && scopes.length ? all.filter((n) => scopes.includes(n.scope)) : all;
  const shots = {};
  if (includeShots) {
    for (const n of rows) {
      for (const s of n.shots || []) {
        const p = shotPath(s);
        if (p && fs.existsSync(p)) {
          try { shots[s] = fs.readFileSync(p).toString('base64'); } catch { /* ignora */ }
        }
      }
    }
  }
  return {
    notes: rows.map((n) => (includeShots ? n : { ...n, shots: [] })),
    shots
  };
}

// mode: 'merge' mantém o que existe, 'replace' troca a anotação de
// mesmo id. Em ambos, um id novo sempre entra.
function importNotes(payload, { mode = 'merge' } = {}) {
  if (!payload || !Array.isArray(payload.notes)) return { notes: 0, shots: 0 };
  const data = readIndex();
  const byId = new Map(data.notes.map((n) => [n.id, n]));
  let nNotes = 0, nShots = 0;

  for (const [id, b64] of Object.entries(payload.shots || {})) {
    const p = shotPath(id);
    if (!p) continue;
    if (fs.existsSync(p) && mode === 'merge') continue;
    try {
      fs.mkdirSync(shotsDir(), { recursive: true });
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      nShots++;
    } catch { /* ignora print corrompido, a anotação ainda vale */ }
  }

  for (const raw of payload.notes) {
    if (!raw || !raw.id) continue;
    const exists = byId.has(raw.id);
    if (exists && mode === 'merge') continue;
    // Descarta referências a prints que não vieram no backup.
    const shots = (raw.shots || []).filter((s) => shotExists(s));
    const clean = { ...raw, shots };
    if (exists) {
      data.notes[data.notes.findIndex((n) => n.id === raw.id)] = clean;
    } else {
      data.notes.push(clean);
    }
    nNotes++;
  }

  writeIndex(data);
  return { notes: nNotes, shots: nShots };
}

function wipe() {
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* ignora */ }
  fs.mkdirSync(shotsDir(), { recursive: true });
  return true;
}

module.exports = {
  linkNotes, unlinkNotes, setBoardPos, board, fichasDoEscopo, chaveDeJogador,
  TIPOS, RELS,
  listByPrefix, forgetMarker,
  init, list, get, save, remove, removeScope, counts,
  shotPath, shotMeta, shotExists, addShotFromFile, addShotFromBuffer, removeShot,
  orphanShots, pruneOrphans,
  exportNotes, importNotes, wipe,
  newId
};
