// ============================================================
// logview.js — Visualizador do log do Unturned, ao vivo.
//
// Fica na aba "Log do Unturned" do painel de Logs, ao lado da
// atividade do servidor (join/leave vindos do Query Port).
//
// O que ele faz de diferente de um "tail" comum:
//   • CLASSIFICA cada linha (conexão, servidor, jogadores,
//     workshop, mapa, sessão, erro) e deixa filtrar por categoria;
//   • DESTACA na linha exatamente o que o app usa — IP:porta, IDs
//     do Workshop, nomes entre aspas, SteamIDs — que é o pedido de
//     "mostrar em destaque as informações importantes";
//   • esconde por padrão o ruído do Unity (mais de 90% do arquivo
//     é aviso de asset e de render), com um botão "mostrar tudo".
// ============================================================

const LogView = {
  events: [],
  maxRows: 2500,
  loaded: false,
  tab: 'activity',
  filters: new Set(['connection', 'server', 'player', 'workshop', 'level', 'session', 'error']),
  search: '',
  autoscroll: true,
  showNoise: false
};

// Nome do ícone, não o desenho: quem monta a linha chama
// `Icon.svg(...)`. Guardar o SVG inteiro aqui obrigaria a escolher
// o tamanho neste ponto, longe de onde ele é usado.
const LOG_CAT_ICON = {
  connection: 'plug', server: 'monitor', player: 'user', workshop: 'puzzle',
  level: 'map', session: 'gamepad', error: 'warning', other: 'file'
};

// ------------------------------------------------------------
// Destaque dos dados que o app realmente usa.
//
// Escapamos o texto ANTES e trabalhamos sobre o texto escapado —
// as entidades (&quot;, &lt;) não colidem com os padrões abaixo, e
// assim nenhuma linha de log consegue injetar HTML.
// ------------------------------------------------------------
const HL_PATTERNS = [
  { cls: 'hl-ip',     re: /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g },
  { cls: 'hl-steam',  re: /\bsteamid:\d+\b/gi },
  { cls: 'hl-id',     re: /\b\d{7,12}\b/g },
  { cls: 'hl-quoted', re: /&quot;[^&]*?&quot;/g }
];

function highlightLogText(raw) {
  const escaped = escapeHtml(raw);
  const marks = [];

  for (const { cls, re } of HL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(escaped)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Um trecho já marcado por um padrão anterior (mais
      // específico) vence — evita quebrar "1.2.3.4:27015" em pedaços.
      if (marks.some((k) => start < k.end && end > k.start)) continue;
      marks.push({ start, end, cls, text: m[0] });
    }
  }

  if (!marks.length) return escaped;
  marks.sort((a, b) => a.start - b.start);

  let out = '';
  let pos = 0;
  for (const k of marks) {
    out += escaped.slice(pos, k.start);
    out += `<mark class="${k.cls}">${k.text}</mark>`;
    pos = k.end;
  }
  return out + escaped.slice(pos);
}

function logTime(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString();
}

function logRowHtml(e) {
  const icon = Icon.svg(LOG_CAT_ICON[e.cat] || LOG_CAT_ICON.other, 14);
  return `<div class="log-row cat-${escapeHtml(e.cat)} sev-${escapeHtml(e.sev)}${e.noise ? ' noise' : ''}">` +
    `<span class="log-time">${escapeHtml(logTime(e.t))}</span>` +
    `<span class="log-badge" title="${escapeHtml(e.cat)}">${icon}</span>` +
    `<span class="log-text">${highlightLogText(e.raw)}</span>` +
    `</div>`;
}

// "Mostrar tudo" tem que mostrar TUDO mesmo: se ele só liberasse
// as linhas de ruído mas mantivesse os filtros de categoria, o
// usuário marcaria a caixa, não veria diferença nenhuma (quase todo
// o ruído é da categoria "outros", que nasce desmarcada) e
// concluiria que o botão está quebrado.
function logPasses(e) {
  if (LogView.search && !e.raw.toLowerCase().includes(LogView.search)) return false;
  if (LogView.showNoise) return true;
  if (e.noise) return false;
  return LogView.filters.has(e.cat);
}

function scrollLogToEnd() {
  const box = document.getElementById('log-stream');
  if (box) box.scrollTop = box.scrollHeight;
}

function renderLogStream() {
  const box = document.getElementById('log-stream');
  if (!box) return;

  const rows = LogView.events.filter(logPasses);
  if (!rows.length) {
    box.innerHTML = `<p class="muted small log-empty">${escapeHtml(I18N.t('log.empty'))}</p>`;
    return;
  }
  box.innerHTML = rows.map(logRowHtml).join('');
  if (LogView.autoscroll) scrollLogToEnd();
}

function updateLogStatus(state) {
  const el = document.getElementById('log-status');
  if (!el) return;

  if (state && state.available === false) {
    el.textContent = I18N.t('log.notFound');
    return;
  }
  const parts = [];
  if (state && state.file) parts.push(state.file);
  if (state && state.current && state.current.name) {
    parts.push(I18N.t('log.connectedTo', { name: state.current.name }));
  }
  parts.push(I18N.t('log.lineCount', { n: LogView.events.filter(logPasses).length, total: LogView.events.length }));
  el.textContent = parts.join(' · ');
}

async function loadLogEvents() {
  try {
    const [events, state] = await Promise.all([
      window.api.getLogEvents(1500, true),
      window.api.getLogState()
    ]);
    LogView.events = Array.isArray(events) ? events : [];
    LogView.loaded = true;
    renderLogStream();
    updateLogStatus(state);
  } catch (e) {
    LogView.events = [];
    renderLogStream();
    updateLogStatus({ available: false });
  }
}

// Linhas novas empurradas pelo processo principal.
function onLiveLogEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  LogView.events.push(...events);
  if (LogView.events.length > LogView.maxRows) {
    LogView.events = LogView.events.slice(-LogView.maxRows);
    // Cortamos o histórico: precisa redesenhar tudo.
    if (LogView.tab === 'live') renderLogStream();
    return;
  }

  if (LogView.tab !== 'live' || !LogView.loaded) return;

  const box = document.getElementById('log-stream');
  if (!box) return;
  const fresh = events.filter(logPasses);
  if (!fresh.length) { updateLogStatus(null); return; }

  const empty = box.querySelector('.log-empty');
  if (empty) box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', fresh.map(logRowHtml).join(''));
  if (LogView.autoscroll) scrollLogToEnd();
  updateLogStatus(null);
}

// ---------------- abas ----------------
function setLogTab(tab) {
  LogView.tab = tab;
  for (const btn of document.querySelectorAll('.log-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  document.getElementById('pane-activity').classList.toggle('hidden', tab !== 'activity');
  document.getElementById('pane-live').classList.toggle('hidden', tab !== 'live');

  if (tab === 'live') {
    if (!LogView.loaded) loadLogEvents();
    else { renderLogStream(); updateLogStatus(null); }
  }
}

// ---------------- exportar ----------------
function exportLog() {
  const rows = LogView.events.filter(logPasses);
  if (!rows.length) { toast(I18N.t('log.empty')); return; }
  const text = rows.map((e) => `[${logTime(e.t)}] [${e.cat}] ${e.raw}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unturned-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(I18N.t('log.exported', { n: rows.length }));
}

// ---------------- ligações da interface ----------------
function initLogView() {
  for (const btn of document.querySelectorAll('.log-tab')) {
    btn.addEventListener('click', () => setLogTab(btn.dataset.tab));
  }

  for (const chip of document.querySelectorAll('#log-filters .log-chip')) {
    // O HTML já marca quais nascem ativos; espelhamos no estado.
    if (chip.classList.contains('active')) LogView.filters.add(chip.dataset.cat);
    else LogView.filters.delete(chip.dataset.cat);

    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      if (LogView.filters.has(cat)) { LogView.filters.delete(cat); chip.classList.remove('active'); }
      else { LogView.filters.add(cat); chip.classList.add('active'); }
      renderLogStream();
      updateLogStatus(null);
    });
  }

  const search = document.getElementById('log-search');
  if (search) {
    search.addEventListener('input', () => {
      LogView.search = search.value.trim().toLowerCase();
      renderLogStream();
      updateLogStatus(null);
    });
  }

  const auto = document.getElementById('log-autoscroll');
  if (auto) auto.addEventListener('change', () => {
    LogView.autoscroll = auto.checked;
    if (LogView.autoscroll) scrollLogToEnd();
  });

  const noise = document.getElementById('log-noise');
  if (noise) noise.addEventListener('change', () => {
    LogView.showNoise = noise.checked;
    // Com "mostrar tudo" ligado os filtros não valem — deixamos
    // isso explícito na tela em vez de o usuário ficar clicando
    // em chips que não fazem nada.
    const box = document.getElementById('log-filters');
    if (box) box.classList.toggle('filters-off', LogView.showNoise);
    renderLogStream();
    updateLogStatus(null);
  });

  const reload = document.getElementById('log-reload');
  if (reload) reload.addEventListener('click', async () => {
    const state = await window.api.reloadLog();
    LogView.loaded = false;
    await loadLogEvents();
    updateLogStatus(state);
    toast(I18N.t('log.reloaded'));
  });

  const exportBtn = document.getElementById('log-export');
  if (exportBtn) exportBtn.addEventListener('click', exportLog);

  const reveal = document.getElementById('log-reveal');
  if (reveal) reveal.addEventListener('click', async () => {
    const ok = await window.api.revealLog();
    if (!ok) toast(I18N.t('log.notFound'));
  });

  window.api.onLogEvents(onLiveLogEvents);
}
