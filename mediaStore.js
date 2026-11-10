// ============================================================
// mediaStore.js — Fotos e vídeos do grupo e do chat
//
// Separado do notesStore de propósito. O notesStore guarda prints
// SEUS, pequenos e para sempre. Aqui é mídia de conversa: chega
// muito mais, chega de outras pessoas, tem vídeo, e a maior parte
// perde a graça em uma semana. As duas coisas têm ciclo de vida
// diferente, então têm cofre diferente.
//
// Layout em userData:
//   media/<id>.<ext>        o arquivo
//   media/thumbs/<id>.jpg   miniatura (só imagem)
//   media/index.json        metadados
//
// ------------------------------------------------------------
// LIMITE DE TAMANHO É REGRA, NÃO SUGESTÃO
// ------------------------------------------------------------
// Vídeo entra fácil em centenas de MB. Sem teto, o primeiro amigo
// que arrastar um clipe de 2 GB enche o disco de todo mundo do
// grupo quando isso sincronizar. O teto é conferido ANTES de
// copiar o arquivo — não adianta descobrir depois de gravar.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let baseDir = null;

const IMG = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const VID = ['.mp4', '.webm', '.mov', '.mkv'];

const LIMITS = {
  image: 25 * 1024 * 1024,        // 25 MB
  video: 200 * 1024 * 1024,       // 200 MB
  totalWarn: 2 * 1024 * 1024 * 1024  // avisa a partir de 2 GB guardados
};

function init(userDataPath) {
  baseDir = path.join(userDataPath, 'media');
  fs.mkdirSync(path.join(baseDir, 'thumbs'), { recursive: true });
  return baseDir;
}

function indexFile() { return path.join(baseDir, 'index.json'); }

function readIndex() {
  try {
    const j = JSON.parse(fs.readFileSync(indexFile(), 'utf-8'));
    return Array.isArray(j.media) ? j : { media: [] };
  } catch { return { media: [] }; }
}

function writeIndex(data) {
  const tmp = indexFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, indexFile());
}

function kindOf(ext) {
  const e = String(ext).toLowerCase();
  if (IMG.includes(e)) return 'image';
  if (VID.includes(e)) return 'video';
  return null;
}

// O id JÁ inclui a extensão. Nunca deixe um id vindo da tela virar
// caminho: um "../../" aqui escreveria fora da pasta do app.
function mediaPath(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe.includes('..')) return null;
  return path.join(baseDir, safe);
}

function thumbPath(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe || safe.includes('..')) return null;
  return path.join(baseDir, 'thumbs', safe.replace(/\.[^.]+$/, '') + '.jpg');
}

function newId(ext) {
  return 'md_' + crypto.randomBytes(8).toString('hex') + ext;
}

// ------------------------------------------------------------
// Entrada
// ------------------------------------------------------------
function addFromFile(filePath, { scope = null, authorId = null } = {}) {
  const ext = (path.extname(filePath) || '').toLowerCase();
  const kind = kindOf(ext);
  if (!kind) return { ok: false, reason: 'unsupported_type', ext };

  let st;
  try { st = fs.statSync(filePath); }
  catch { return { ok: false, reason: 'unreadable' }; }

  // Confere ANTES de copiar: descobrir o excesso depois de gravar
  // 2 GB no disco de alguém não conserta nada.
  if (st.size > LIMITS[kind]) {
    return { ok: false, reason: 'too_big', kind, bytes: st.size, limit: LIMITS[kind] };
  }

  const id = newId(ext);
  fs.copyFileSync(filePath, mediaPath(id));
  return { ok: true, media: register(id, { kind, bytes: st.size, scope, authorId, name: path.basename(filePath) }) };
}

function addFromBuffer(buffer, ext, { scope = null, authorId = null, name = null } = {}) {
  const e = ext.startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase();
  const kind = kindOf(e);
  if (!kind) return { ok: false, reason: 'unsupported_type', ext: e };
  if (buffer.length > LIMITS[kind]) {
    return { ok: false, reason: 'too_big', kind, bytes: buffer.length, limit: LIMITS[kind] };
  }
  const id = newId(e);
  fs.writeFileSync(mediaPath(id), buffer);
  return { ok: true, media: register(id, { kind, bytes: buffer.length, scope, authorId, name }) };
}

function register(id, meta) {
  const data = readIndex();
  const m = {
    id, kind: meta.kind, bytes: meta.bytes,
    name: meta.name || null,
    scope: meta.scope || null,
    authorId: meta.authorId || null,
    addedAt: Date.now(),
    hasThumb: false
  };
  data.media.push(m);
  writeIndex(data);
  return m;
}

// A miniatura é gerada pela TELA (canvas), não aqui: o processo
// principal não tem decodificador de imagem, e trazer um só para
// isso significaria uma dependência nativa e um build mais frágil.
function saveThumb(id, buffer) {
  const p = thumbPath(id);
  if (!p) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
  const data = readIndex();
  const m = data.media.find((x) => x.id === id);
  if (m) { m.hasThumb = true; writeIndex(data); }
  return true;
}

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------
function get(id) {
  const m = readIndex().media.find((x) => x.id === id);
  if (!m) return null;
  const p = mediaPath(id);
  const existe = p && fs.existsSync(p);
  const t = thumbPath(id);
  return {
    ...m,
    path: existe ? p : null,
    missing: !existe,
    thumbPath: m.hasThumb && t && fs.existsSync(t) ? t : null
  };
}

function list(scope) {
  return readIndex().media
    .filter((m) => (scope ? m.scope === scope : true))
    .map((m) => get(m.id))
    .filter(Boolean);
}

function remove(id) {
  const data = readIndex();
  data.media = data.media.filter((m) => m.id !== id);
  writeIndex(data);
  for (const p of [mediaPath(id), thumbPath(id)]) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignora */ }
  }
  return true;
}

function stats() {
  const rows = readIndex().media;
  const bytes = rows.reduce((s, m) => s + (m.bytes || 0), 0);
  return {
    count: rows.length,
    images: rows.filter((m) => m.kind === 'image').length,
    videos: rows.filter((m) => m.kind === 'video').length,
    bytes,
    overWarn: bytes > LIMITS.totalWarn
  };
}

// Mídia que não pertence mais a nenhuma mensagem/item vivo.
function pruneOrphans(idsEmUso = []) {
  const vivos = new Set(idsEmUso);
  const mortos = readIndex().media.filter((m) => !vivos.has(m.id));
  for (const m of mortos) remove(m.id);
  return mortos.length;
}

// Limpeza por idade: mídia de conversa envelhece. Não roda sozinha
// — quem manda é o usuário, na tela de Dados.
function pruneOlderThan(days) {
  const limite = Date.now() - days * 24 * 3600 * 1000;
  const velhos = readIndex().media.filter((m) => m.addedAt < limite);
  for (const m of velhos) remove(m.id);
  return velhos.length;
}

function wipe() {
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* ignora */ }
  fs.mkdirSync(path.join(baseDir, 'thumbs'), { recursive: true });
  return true;
}

module.exports = {
  init, addFromFile, addFromBuffer, saveThumb,
  get, list, remove, stats, pruneOrphans, pruneOlderThan, wipe,
  mediaPath, thumbPath, kindOf, LIMITS, IMG, VID
};
