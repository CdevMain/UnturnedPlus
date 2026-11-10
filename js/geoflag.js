// ============================================================
// geoflag.js — Bandeirinha do país do servidor.
//
// O país vem do processo principal (geoip.js), que consulta o IP
// UMA vez e guarda em cache no disco. Aqui mantemos um cache em
// MEMÓRIA por cima disso, para redesenhar a home (o que acontece a
// cada tick de polling) não custar uma ida ao IPC por card.
//
// Por que imagem e não emoji: o Windows não tem fonte de emoji de
// bandeira. "🇧🇷" viraria "BR" em duas caixinhas no Electron. Então
// usamos o PNG do flagcdn.com e, se a imagem não carregar (sem
// internet), cai para o código do país num chip de texto — que
// continua informativo.
// ============================================================

// ------------------------------------------------------------
// iconFallback — usado nos onerror="" das imagens do app.
//
// Ícones de servidor são URLs externas (imgur, discord, cdn...)
// que falham o tempo todo: sem internet, link morto, hotlink
// bloqueado. O fallback antigo fazia `this.parentElement.
// textContent = '🎮'` e ESTOURAVA quando a imagem terminava de
// falhar depois do card já ter sido redesenhado — parentElement
// era null e a exceção subia sem tratamento.
// ------------------------------------------------------------
// O segundo argumento agora é um NOME DE ÍCONE ('gamepad',
// 'puzzle', 'folder'), não um emoji. Chamadas antigas que passavam
// emoji continuam funcionando: qualquer coisa que não seja um
// ícone conhecido cai no 'gamepad'.
function iconFallback(img, nome) {
  const parent = img && img.parentElement;
  if (!parent) return;                 // nó já saiu da tela: nada a fazer
  if (typeof Icon === 'undefined') { parent.textContent = ''; return; }
  const n = (typeof nome === 'string' && Icon.existe(nome)) ? nome : 'gamepad';
  parent.innerHTML = Icon.svg(n, 18);
}

// Variante que remove o container inteiro (usada no seletor de
// ícones da pasta, onde uma imagem quebrada não deve virar opção).
function iconFallbackRemove(img) {
  const parent = img && img.parentElement;
  if (parent) parent.remove();
  else if (img && img.remove) img.remove();
}

// Foto de perfil que falhou -> vira um círculo com a inicial.
//
// Aqui NÃO dá para mexer no pai: várias fotos dividem o mesmo
// contêiner (a pilha de amigos do card), e apagar o pai por causa
// de uma imagem quebrada levaria todas as outras junto.
function avatarFallback(img, letter) {
  if (!img) return;
  const span = document.createElement('span');
  span.className = img.className || 'friend-av';
  if (!span.classList.contains('letter')) span.classList.add('letter');
  span.textContent = (letter || '?').slice(0, 1).toUpperCase();
  if (img.title) span.title = img.title;
  if (img.parentNode) img.replaceWith(span);
}

const GeoFlag = (() => {
  'use strict';

  const memory = new Map();   // ip -> geo | null
  const inflight = new Map(); // ip -> Promise
  const listeners = new Set();

  function flagUrl(code) {
    return `https://flagcdn.com/32x24/${String(code).toLowerCase()}.png`;
  }

  // Chip pronto para injetar num innerHTML de card.
  function html(geo, { size = 'sm' } = {}) {
    if (!geo || !geo.countryCode) return '';
    const code = String(geo.countryCode).toUpperCase();
    const label = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || code;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<span class="geo-flag geo-${size}" title="${esc(label)}">` +
      `<img src="${flagUrl(code)}" alt="${code}" loading="lazy" ` +
      `onerror="this.replaceWith(Object.assign(document.createElement('b'),{className:'geo-code',textContent:'${code}'}))">` +
      `</span>`;
  }

  // Leitura síncrona do cache em memória (para o primeiro frame).
  function peek(ip) {
    return memory.has(ip) ? memory.get(ip) : undefined;
  }

  // Resolve (com rede, se preciso). Nunca lança.
  async function resolve(ip) {
    if (!ip) return null;
    if (memory.has(ip)) return memory.get(ip);
    if (inflight.has(ip)) return inflight.get(ip);

    const job = (async () => {
      let geo = null;
      try {
        geo = (await window.api.geoPeek(ip)) || (await window.api.geoLookup(ip)) || null;
      } catch { geo = null; }
      memory.set(ip, geo);
      if (geo) listeners.forEach((fn) => { try { fn(ip, geo); } catch {} });
      return geo;
    })().finally(() => inflight.delete(ip));

    inflight.set(ip, job);
    return job;
  }

  // Garante que um conjunto de IPs esteja resolvido e avisa quando
  // algum país novo chegar — a home usa isso para redesenhar UMA
  // vez, em vez de uma vez por card.
  async function warm(ips) {
    const unknown = [...new Set(ips.filter((ip) => ip && !memory.has(ip)))];
    if (!unknown.length) return false;
    const results = await Promise.all(unknown.map((ip) => resolve(ip)));
    return results.some(Boolean);
  }

  function onResolved(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // Texto legível para a tela de tracking.
  function describe(geo) {
    if (!geo) return null;
    const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
    return geo.isp ? `${place} · ${geo.isp}` : place;
  }

  return { html, peek, resolve, warm, onResolved, describe, flagUrl };
})();
