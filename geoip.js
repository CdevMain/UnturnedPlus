// ============================================================
// geoip.js — Localização física do servidor (para a bandeirinha
// no card).
//
// Como funciona:
//   • Cada IP é consultado UMA VEZ. O resultado vai para um cache
//     em disco (userData/geo.json) e nunca mais é consultado.
//   • Consultas simultâneas do mesmo IP compartilham a mesma
//     promessa (dedupe) — abrir a home com 20 servidores do mesmo
//     provedor não dispara 20 requisições.
//   • Falhas viram cache NEGATIVO com validade curta, então um
//     provedor fora do ar não faz o app martelar a rede.
//
// Provedores (nesta ordem, todos gratuitos e sem chave):
//   1. ipwho.is       — HTTPS, sem limite publicado
//   2. ip-api.com     — HTTP, 45 req/min
// Se os dois falharem, o card simplesmente não mostra bandeira.
// Nada no app depende disso para funcionar.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h para tentar de novo
const REQUEST_TIMEOUT = 6000;

// IPs que não fazem sentido consultar (rede local / reservados).
function isPrivateIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                          // multicast/reservado
  return false;
}

class GeoIp {
  // `httpGetJson` é injetado pelo main.js (usa a stack de rede do
  // Electron, respeitando proxy/DNS do sistema). Isso deixa este
  // módulo testável com um fetch falso.
  constructor({ cacheFile, httpGetJson }) {
    this.cacheFile = cacheFile;
    this.httpGetJson = httpGetJson;
    this.cache = null;
    this.pending = new Map();
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

  // Gravação preguiçosa: agrupa várias resoluções numa escrita só.
  _scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 1500);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  flush() {
    if (!this.dirty || !this.cache) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2), 'utf-8');
      this.dirty = false;
    } catch { /* cache é opcional; perder não quebra nada */ }
  }

  // Devolve o que já está em cache, sem rede. Usado pela interface
  // para desenhar a bandeira no primeiro frame.
  peek(ip) {
    const hit = this._load()[ip];
    if (!hit) return null;
    if (hit.failed && Date.now() - (hit.at || 0) > NEGATIVE_TTL_MS) return null;
    return hit.failed ? null : hit;
  }

  async _fetchIpWhoIs(ip) {
    const j = await this.httpGetJson(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeoutMs: REQUEST_TIMEOUT });
    if (!j || j.success === false || !j.country_code) return null;
    return {
      countryCode: String(j.country_code).toUpperCase(),
      country: j.country || null,
      region: j.region || null,
      city: j.city || null,
      isp: (j.connection && (j.connection.isp || j.connection.org)) || null,
      source: 'ipwho.is'
    };
  }

  async _fetchIpApi(ip) {
    const j = await this.httpGetJson(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp`,
      { timeoutMs: REQUEST_TIMEOUT }
    );
    if (!j || j.status !== 'success' || !j.countryCode) return null;
    return {
      countryCode: String(j.countryCode).toUpperCase(),
      country: j.country || null,
      region: j.regionName || null,
      city: j.city || null,
      isp: j.isp || null,
      source: 'ip-api.com'
    };
  }

  async lookup(ip) {
    if (!ip || isPrivateIp(ip)) return null;

    const cache = this._load();
    const hit = cache[ip];
    if (hit && !hit.failed) return hit;
    if (hit && hit.failed && Date.now() - (hit.at || 0) < NEGATIVE_TTL_MS) return null;

    if (this.pending.has(ip)) return this.pending.get(ip);

    const job = (async () => {
      let result = null;
      for (const fn of [this._fetchIpWhoIs, this._fetchIpApi]) {
        try {
          result = await fn.call(this, ip);
          if (result) break;
        } catch { /* tenta o próximo provedor */ }
      }
      if (result) {
        cache[ip] = { ...result, ip, at: Date.now() };
      } else {
        cache[ip] = { ip, failed: true, at: Date.now() };
      }
      this._scheduleFlush();
      return result;
    })().finally(() => this.pending.delete(ip));

    this.pending.set(ip, job);
    return job;
  }

  // Permite o usuário fixar o país à mão (VPS costuma cair no país
  // do datacenter, que nem sempre é o que a comunidade considera).
  setManual(ip, countryCode, countryName) {
    if (!ip || !countryCode) return null;
    const cache = this._load();
    cache[ip] = {
      ip,
      countryCode: String(countryCode).toUpperCase().slice(0, 2),
      country: countryName || null,
      manual: true,
      at: Date.now()
    };
    this._scheduleFlush();
    return cache[ip];
  }
}

module.exports = { GeoIp, isPrivateIp };
