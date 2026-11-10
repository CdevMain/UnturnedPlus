// ============================================================
// steamWorkshop.js — Detalhes dos mods direto da Steam
//
// Antes o app só tinha o ID numérico do mod ("2175971309") vindo
// das rules do A2S, e o nome quando o log do jogo por acaso o
// registrava. Aqui buscamos na Steam o que a página do Workshop
// mostra: TÍTULO, ÍCONE (preview), tags (Asset Type / Object
// Type), tamanho, datas de publicação e atualização, inscrições e
// visualizações.
//
// Endpoint: ISteamRemoteStorage/GetPublishedFileDetails/v1/
//   • é POST com corpo form-urlencoded;
//   • NÃO precisa de chave de API (é o mesmo endpoint que o
//     próprio cliente da Steam usa para listar itens);
//   • aceita vários IDs por requisição (mandamos em lotes).
//
// Cache em disco (userData/workshop.json): nome e ícone de um mod
// praticamente não mudam, e um servidor com 29 mods não pode
// disparar 29 requisições a cada vez que a tela abre.
//
// Este módulo é PURO em relação ao Electron: recebe a função de
// POST por injeção, então dá para testar fora do app.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 50;                        // IDs por requisição
const TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 dias
const MISS_TTL_MS = 12 * 60 * 60 * 1000;      // item sumido/banido: tenta de novo em 12h

function isValidId(id) {
  return /^\d{6,20}$/.test(String(id || ''));
}

// A Steam devolve file_size ora como número, ora como string.
function toNumber(v) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : null;
}

// Normaliza um item da resposta para o formato que a interface usa.
function normalizeItem(raw) {
  if (!raw || !raw.publishedfileid) return null;
  const id = String(raw.publishedfileid);

  // result !== 1 significa item removido, privado ou inexistente.
  if (raw.result !== undefined && raw.result !== 1) {
    return { id, missing: true, at: Date.now() };
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => (typeof t === 'string' ? t : (t && (t.display_name || t.tag)))).filter(Boolean)
    : [];

  return {
    id,
    title: raw.title || null,
    preview: raw.preview_url || null,
    description: raw.description || null,
    tags,
    fileSize: toNumber(raw.file_size),
    createdAt: raw.time_created ? raw.time_created * 1000 : null,
    updatedAt: raw.time_updated ? raw.time_updated * 1000 : null,
    subscriptions: toNumber(raw.subscriptions),
    favorited: toNumber(raw.favorited),
    views: toNumber(raw.views),
    banned: !!raw.banned,
    banReason: raw.ban_reason || null,
    creator: raw.creator || null,
    appId: toNumber(raw.consumer_app_id),
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    at: Date.now()
  };
}

class SteamWorkshop {
  // `httpPostForm(url, fields, opts) -> Promise<objeto JSON>` é
  // injetado pelo main.js (usa a stack de rede do Electron).
  constructor({ cacheFile, httpPostForm }) {
    this.cacheFile = cacheFile;
    this.httpPostForm = httpPostForm;
    this.cache = null;
    this.pending = new Map(); // id -> Promise (dedupe entre chamadas simultâneas)
    this.dirty = false;
    this.flushTimer = null;
  }

  _load() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8')) || {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  _scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 1500);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  flush() {
    if (!this.dirty || !this.cache) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache), 'utf-8');
      this.dirty = false;
    } catch { /* cache é opcional */ }
  }

  _fresh(entry) {
    if (!entry) return false;
    const ttl = entry.missing ? MISS_TTL_MS : TTL_MS;
    return Date.now() - (entry.at || 0) < ttl;
  }

  // Leitura só do cache, sem rede — a interface desenha o que já
  // tem no primeiro frame e completa depois.
  peek(ids) {
    const cache = this._load();
    const out = {};
    for (const id of ids || []) {
      const entry = cache[String(id)];
      if (entry && !entry.missing) out[String(id)] = entry;
    }
    return out;
  }

  async _fetchBatch(ids) {
    const fields = { itemcount: String(ids.length) };
    ids.forEach((id, i) => { fields[`publishedfileids[${i}]`] = String(id); });

    const json = await this.httpPostForm(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      fields,
      { timeoutMs: 12000 }
    );

    const list = json && json.response && json.response.publishedfiledetails;
    if (!Array.isArray(list)) throw new Error('Resposta inesperada da Steam.');

    const cache = this._load();
    const found = {};
    for (const raw of list) {
      const item = normalizeItem(raw);
      if (!item) continue;
      cache[item.id] = item;
      if (!item.missing) found[item.id] = item;
    }
    this._scheduleFlush();
    return found;
  }

  // Busca os detalhes de vários mods. Nunca lança: o que falhar
  // simplesmente não aparece no resultado, e a interface continua
  // mostrando o ID (que é o comportamento antigo).
  async details(ids) {
    const wanted = [...new Set((ids || []).map(String).filter(isValidId))];
    if (!wanted.length) return {};

    const cache = this._load();
    const out = {};
    const missing = [];

    for (const id of wanted) {
      const entry = cache[id];
      if (this._fresh(entry)) {
        if (!entry.missing) out[id] = entry;
      } else if (this.pending.has(id)) {
        // já tem alguém buscando este ID
      } else {
        missing.push(id);
      }
    }

    // Espera o que já estava em voo (evita requisição duplicada
    // quando a home e a tela de tracking pedem ao mesmo tempo).
    const inflight = wanted.filter((id) => this.pending.has(id));
    if (inflight.length) {
      const results = await Promise.all(inflight.map((id) => this.pending.get(id)));
      results.forEach((item, i) => { if (item) out[inflight[i]] = item; });
    }

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const job = this._fetchBatch(batch).catch(() => ({}));
      // Marca cada ID do lote como "em voo" para o dedupe.
      for (const id of batch) {
        this.pending.set(id, job.then((found) => found[id] || null));
      }
      let found = {};
      try { found = await job; } catch { found = {}; }
      for (const id of batch) this.pending.delete(id);
      Object.assign(out, found);
    }

    return out;
  }

  clearCache() {
    this.cache = {};
    this.dirty = true;
    this.flush();
    return true;
  }
}

module.exports = { SteamWorkshop, normalizeItem, isValidId };
