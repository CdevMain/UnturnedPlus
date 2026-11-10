// ============================================================
// bmScrape.js — Leitura do site PÚBLICO do BattleMetrics
// (SEM usar api.battlemetrics.com com token/autenticação).
//
// Estratégia: abrimos a página pública num BrowserWindow
// invisível (Chromium real) e lemos o TEXTO VISÍVEL da página
// (os mesmos rótulos que qualquer visitante vê: "Rank · #192",
// "Player count · 0/32", "Server Events · fulano joined the
// game 5 minutes ago" etc). Isso é bem mais resistente a
// mudanças no site do que depender de uma estrutura JS interna
// (framework, nomes de variável client-side), que muda a cada
// deploy sem aviso.
//
// AVISO: se a BattleMetrics reformular o texto/rótulos da
// página (ex: trocar "Player count" por outra palavra), essa
// extração para de encontrar aquele campo específico — os
// outros campos continuam funcionando normalmente, e o campo
// afetado só volta null. Use debugDump() pra inspecionar.
//
// Considere também: a BattleMetrics tem uma API pública oficial
// que é mais estável que isso. Esse scraper é uma alternativa
// para quando você especificamente não quer depender dela.
// ============================================================
const { BrowserWindow } = require('electron');

const BASE = 'https://www.battlemetrics.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ------------------------------------------------------------
// Script executado DENTRO da página (contexto do Chromium real),
// lê o DOM já renderizado e devolve um JSON com os campos que
// aparecem visivelmente pra qualquer visitante.
// ------------------------------------------------------------
const EXTRACT_JS = `
(function () {
  function leafElements() {
    return Array.from(document.querySelectorAll('body *')).filter(el => el.children.length === 0);
  }

  // Acha o valor que vem depois de um rótulo (ex: "Rank").
  //
  // A versão antiga exigia que o texto da folha fosse EXATAMENTE o
  // rótulo. Bastava a página renderizar "Rank:" ou "Rank " com um
  // espaço não-quebrável para a busca falhar e o campo vir vazio —
  // sem erro nenhum, o que torna a falha invisível. Como não temos
  // controle sobre o HTML de terceiro, a comparação precisa ser
  // tolerante ao que não muda o SIGNIFICADO: espaço, dois-pontos e
  // caixa.
  function normal(t) {
    return String(t || '')
      .replace(/\u00a0/g, ' ')   // espaço não-quebrável
      .replace(/\s+/g, ' ')
      .replace(/:$/, '')
      .trim()
      .toLowerCase();
  }

  function findLabelValue(label, leaves) {
    const alvo = normal(label);
    for (const el of leaves) {
      if (normal(el.textContent) !== alvo) continue;

      // 1) o irmão seguinte com conteúdo (o caso <dt>/<dd>)
      let sib = el.nextElementSibling;
      while (sib && !sib.textContent.trim()) sib = sib.nextElementSibling;
      if (sib && sib.textContent.trim()) return sib.textContent.trim();

      // 2) o resto do texto do pai, tirando o rótulo
      const pai = el.parentElement;
      if (pai) {
        const t = pai.textContent.replace(/\u00a0/g, ' ').trim();
        if (normal(t).startsWith(alvo)) {
          const resto = t.slice(String(label).length).replace(/^[:\s]+/, '').trim();
          if (resto) return resto;
        }
        // 3) o irmão do PAI (rótulo e valor em blocos separados)
        let ps = pai.nextElementSibling;
        while (ps && !ps.textContent.trim()) ps = ps.nextElementSibling;
        if (ps && ps.textContent.trim()) return ps.textContent.trim();
      }
    }
    return null;
  }

  // Plano B só para o RANK, que é o campo que mais interessa e o que
  // mais muda de lugar na página: procura no texto inteiro por
  // "Rank" seguido de um número (com # e milhar opcionais).
  function findServerEvents(leaves) {
    const headIdx = leaves.findIndex(el => /^server events$/i.test(el.textContent.trim()));
    if (headIdx === -1) return [];
    const out = [];
    for (let i = headIdx + 1; i < leaves.length && out.length < 150; i++) {
      const t = leaves[i].textContent.trim();
      if (!t) continue;
      if (/joined the game|left the game|responded to query|failed to respond/i.test(t)) {
        out.push(t);
      }
    }
    return out;
  }

  const leaves = leafElements();
  const h1 = document.querySelector('h1');

  return JSON.stringify({
    name: h1 ? h1.textContent.trim() : null,
    playerCount: findLabelValue('Player count', leaves),
    address: findLabelValue('Address', leaves),
    status: findLabelValue('Status', leaves),
    map: findLabelValue('Map', leaves),
    gameMode: findLabelValue('Game Mode', leaves),
    uptime: findLabelValue('Uptime', leaves),
    passwordProtected: findLabelValue('Password Protected', leaves),
    events: findServerEvents(leaves)
  });
})();
`;

const EXTRACT_SEARCH_JS = `
(function () {
  const links = Array.from(document.querySelectorAll('a[href*="/servers/unturned/"]'));
  const seen = new Set();
  const rows = [];
  for (const a of links) {
    const m = a.getAttribute('href').match(/\\/servers\\/unturned\\/(\\d+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const row = a.closest('tr') || a.closest('li') || a.closest('[class*="row"]') || a.parentElement;
    const rowText = row ? row.textContent.replace(/\\s+/g, ' ').trim() : a.textContent.trim();
    rows.push({ id, name: a.textContent.trim(), rowText });
  }
  return JSON.stringify(rows);
})();
`;

// ------------------------------------------------------------
// Núcleo: abre a página, espera o JS client-side terminar de
// renderizar, roda o script de extração acima.
// ------------------------------------------------------------
function scrapePage(url, extractScript, { settleMs = 2500, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });

    let settled = false;
    const cleanup = () => { clearTimeout(hardTimer); if (!win.isDestroyed()) win.destroy(); };
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      err ? reject(err) : resolve(result);
    };

    const hardTimer = setTimeout(() => finish(new Error('Timeout carregando a página do BattleMetrics.')), timeoutMs);

    // -3 (ERR_ABORTED) é normal em redirects internos do Chromium e não indica falha real;
    // erros em sub-frames (ex: iframes de terceiros) também não devem invalidar a página toda.
    win.webContents.on('did-fail-load', (_e, errorCode, desc, _url, isMainFrame) => {
      if (errorCode === -3 || !isMainFrame) return;
      finish(new Error(`Falha ao carregar página (${errorCode}): ${desc}`));
    });

    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const raw = await win.webContents.executeJavaScript(extractScript, true);
          finish(null, JSON.parse(raw));
        } catch (e) {
          finish(e);
        }
      }, settleMs);
    });

    win.webContents.setUserAgent(USER_AGENT);
    win.loadURL(url);
  });
}

// ------------------------------------------------------------
// Parsing dos campos de texto pra tipos utilizáveis
// ------------------------------------------------------------
function parseServerFields(bmId, raw) {
  const out = { id: String(bmId), name: raw.name || null, raw };

  // O rank do BattleMetrics NÃO é lido aqui. Saiu a pedido da Sara:
  // era o único campo que obrigava a raspar a página em toda
  // atualização, e ela não o queria na tela. O que sobrou desta
  // função é a resolução de IP:porta na hora de adicionar servidor
  // por ID — essa continua sendo a única razão de o scrape existir.

  if (raw.playerCount) {
    const m = raw.playerCount.match(/(\d+)\s*\/\s*(\d+)/);
    out.players = m ? parseInt(m[1], 10) : null;
    out.maxPlayers = m ? parseInt(m[2], 10) : null;
  } else { out.players = null; out.maxPlayers = null; }

  if (raw.address) {
    const m = raw.address.match(/([\d.]+):(\d+)/);
    out.ip = m ? m[1] : null;
    out.port = m ? parseInt(m[2], 10) : null;
  } else { out.ip = null; out.port = null; }

  out.status = raw.status ? raw.status.toLowerCase() : null;
  out.map = raw.map || null;
  out.gameMode = raw.gameMode || null;
  out.uptime = raw.uptime || null;
  out.passwordProtected = raw.passwordProtected ? /true/i.test(raw.passwordProtected) : null;

  return out;
}

function parseEvents(rawEvents) {
  const events = [];
  for (const line of rawEvents || []) {
    const m = line.match(/^(.*?)(joined|left) the game(.*)$/i);
    if (m) {
      events.push({
        type: /joined/i.test(m[2]) ? 'join' : 'leave',
        name: m[1].trim(),
        relative: m[3].trim() || null
      });
      continue;
    }
    const q = line.match(/^Server (responded to query|failed to respond)(.*)$/i);
    if (q) {
      events.push({
        type: /failed/i.test(q[1]) ? 'query_failed' : 'query_ok',
        relative: q[2].trim() || null
      });
    }
  }
  return events;
}

// Converte "5 minutes ago" / "an hour ago" / "2 days ago" numa Date aproximada.
function relativeToDate(relative) {
  if (!relative) return null;
  const now = Date.now();
  const m = relative.match(/^an?\s+(minute|hour|day|month|year)\s+ago$/i);
  if (m) return new Date(now - unitMs(m[1]));
  const n = relative.match(/^(\d+)\s+(minute|hour|day|month|year)s?\s+ago$/i);
  if (n) return new Date(now - parseInt(n[1], 10) * unitMs(n[2]));
  return null;
}
function unitMs(unit) {
  const table = { minute: 60e3, hour: 3600e3, day: 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 };
  return table[unit.toLowerCase()] || 0;
}

// ------------------------------------------------------------
// API pública deste módulo
// ------------------------------------------------------------

// Info inicial + histórico de eventos (join/leave) de um servidor específico
async function scrapeServer(bmId) {
  const url = `${BASE}/servers/unturned/${bmId}`;
  const raw = await scrapePage(url, EXTRACT_JS);
  const server = parseServerFields(bmId, raw);

  if (!server.name && server.players == null && !server.ip) {
    throw new Error(
      'Não consegui ler nenhum campo conhecido na página do BattleMetrics (o texto/rótulos podem ter mudado). ' +
      'Use debugDump() para inspecionar a página atual.'
    );
  }

  const events = parseEvents(raw.events).map(e => ({ ...e, approxTime: relativeToDate(e.relative) }));
  const history = { events };
  return { server, history };
}

// Busca por nome ou IP:porta na listagem pública de servidores de Unturned
async function scrapeSearch(query) {
  const url = `${BASE}/servers/unturned?filter[search]=${encodeURIComponent(query)}`;
  const rows = await scrapePage(url, EXTRACT_SEARCH_JS, { settleMs: 3000 });

  return rows.map((r) => {
    const ipMatch = r.rowText.match(/([\d.]+):(\d+)/);
    const playersMatch = r.rowText.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      id: r.id,
      name: r.name,
      ip: ipMatch ? ipMatch[1] : null,
      port: ipMatch ? parseInt(ipMatch[2], 10) : null,
      players: playersMatch ? parseInt(playersMatch[1], 10) : null,
      maxPlayers: playersMatch ? parseInt(playersMatch[2], 10) : null
    };
  });
}

// Ferramenta de diagnóstico: devolve o HTML renderizado cru pra você inspecionar
// caso algum campo pare de ser encontrado (mudança de rótulo/layout no site).
async function debugDump(bmId) {
  const url = `${BASE}/servers/unturned/${bmId}`;
  return scrapePage(url, `(() => JSON.stringify({ html: document.documentElement.outerHTML }))()`, { timeoutMs: 20000 });
}

module.exports = { scrapeServer, scrapeSearch, debugDump };
