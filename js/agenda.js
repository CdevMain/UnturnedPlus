// ============================================================
// agenda.js — Wipes e eventos na interface
//
// Três lugares mostram a mesma agenda, e todos leem do mesmo lugar:
//   • selo no card da home ("wipe em 2 dias")
//   • modal da Agenda (lista completa, filtro por servidor)
//   • aba do servidor no tracking
//
// A contagem NUNCA é formatada aqui de improviso: passa por
// `countdownText`, que é a mesma função para os três. Duas
// formatações diferentes é como aparece "faltam 2 dias" num canto e
// "faltam 1 dia" no outro para o mesmo instante.
// ============================================================

const Agenda = {
  filtro: '',
  editando: null,
  cache: {},         // resumo por servidor, para o card não pedir a cada render
  tick: null
};

// ------------------------------------------------------------
// Texto de contagem — um lugar só
// ------------------------------------------------------------
function countdownText(inMs) {
  if (inMs == null) return '';
  if (inMs <= 0) return I18N.t('sched.now');
  const min = Math.floor(inMs / 60000);
  const dias = Math.floor(min / 1440);
  const horas = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  // Acima de um dia, minuto é ruído: ninguém se organiza por "2
  // dias, 3 horas e 47 minutos".
  if (dias >= 1) return I18N.t('sched.inDH', { d: dias, h: horas });
  if (horas >= 1) return I18N.t('sched.inHM', { h: horas, m: mins });
  return I18N.t('sched.inMin', { n: Math.max(1, mins) });
}

// "há 3h". Só passado, sempre curto.
function agoText(ms) {
  const min = Math.floor((ms || 0) / 60000);
  if (min < 60) return I18N.t('sched.agoMin', { n: Math.max(1, min) });
  return I18N.t('sched.agoHours', { n: Math.floor(min / 60) });
}

function urgencyOf(inMs) {
  if (inMs == null) return 'none';
  if (inMs <= 0) return 'now';
  if (inMs <= 3600e3) return 'imminent';
  if (inMs <= 86400e3) return 'soon';
  if (inMs <= 3 * 86400e3) return 'near';
  return 'far';
}

function formatWhen(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  const lang = (AppState.config && AppState.config.language) === 'en-US' ? 'en-US' : 'pt-BR';
  return d.toLocaleString(lang, { weekday: 'short', day: '2-digit', month: '2-digit',
                                  hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------
// Resumo para os cards da home
// ------------------------------------------------------------
async function refreshScheduleSummary() {
  try { Agenda.cache = await window.api.schedSummary(); } catch { Agenda.cache = {}; }
  renderAgendaBadge();
  return Agenda.cache;
}

// Devolve o HTML do selo do card, ou string vazia. Chamado pelo
// list.js dentro do template do card.
function wipeChipHtml(serverId) {
  const s = Agenda.cache[String(serverId)];
  if (!s || !s.wipe) return '';
  const inMs = s.wipe.nextAt - Date.now();
  // Wipe que acabou de acontecer tem prioridade sobre o próximo.
  // Sem isto, no segundo seguinte ao wipe o card já diria "wipe em
  // 13d" — e quem abriu o app justamente para saber se o wipe rolou
  // ficaria sem resposta.
  if (s.wipe.justHappened && !s.wipe.happening) {
    return `<span class="wipe-chip done" data-sid="${escapeHtml(String(serverId))}"` +
           ` title="${escapeHtml(formatWhen(s.wipe.lastAt))}">${Icon.svg('broom', 12)} ` +
           escapeHtml(I18N.t('sched.wipeWas', { t: agoText(s.wipe.sinceMs) })) + '</span>';
  }
  const u = urgencyOf(inMs);
  const txt = s.wipe.happening ? I18N.t('sched.wipeNow')
                               : I18N.t('sched.wipeIn', { t: countdownText(inMs) });
  return `<span class="wipe-chip ${u}" data-sid="${escapeHtml(String(serverId))}"` +
         ` title="${escapeHtml(formatWhen(s.wipe.nextAt))}">${Icon.svg('broom', 12)} ${escapeHtml(txt)}</span>`;
}

// Selo vermelho no botão da Agenda: quantos itens acontecem nas
// próximas 24h. O menu inteiro só vale a pena abrir se tiver algo
// perto — o número diz isso sem abrir.
function renderAgendaBadge() {
  const el = document.getElementById('drawer-events-badge');
  if (!el) return;
  const agora = Date.now();
  let n = 0;
  for (const s of Object.values(Agenda.cache || {})) {
    if (s.next && s.next.nextAt - agora <= 86400e3) n += 1;
  }
  el.textContent = String(n);
  el.classList.toggle('hidden', n === 0);
}

// ------------------------------------------------------------
// Modal da agenda
// ------------------------------------------------------------
async function openAgenda(serverId = '') {
  Agenda.filtro = serverId || '';
  await refreshScheduleSummary();
  preencherFiltro();
  await renderAgenda();
  showModal('modal-agenda');
}

function preencherFiltro() {
  const sel = document.getElementById('ag-filter');
  const atual = Agenda.filtro;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('sched.allServers'))}</option>` +
    (AppState.config.servers || [])
      .map((s) => `<option value="${escapeHtml(String(s.bmId))}">${escapeHtml(s.name || s.ip || s.bmId)}</option>`)
      .join('');
  sel.value = atual;
}

async function renderAgenda() {
  const box = document.getElementById('ag-list');
  let itens;
  try { itens = await window.api.schedAgenda({ serverId: Agenda.filtro || null }); }
  catch { itens = []; }

  if (!itens.length) {
    box.innerHTML = `<p class="muted small ag-empty">${escapeHtml(I18N.t('sched.empty'))}</p>`;
    return;
  }

  const nomes = new Map((AppState.config.servers || []).map((s) => [String(s.bmId), s.name || s.ip]));
  const agora = Date.now();
  let ultimoDia = '';

  box.innerHTML = itens.map((e) => {
    const inMs = e.nextAt - agora;
    const u = urgencyOf(inMs);
    // Cabeçalho de dia: separa "hoje" de "semana que vem" sem a
    // pessoa ter que ler data por data.
    const dia = new Date(e.nextAt).toDateString();
    const sep = dia !== ultimoDia ? `<div class="ag-day">${escapeHtml(diaRotulo(e.nextAt))}</div>` : '';
    ultimoDia = dia;

    return sep + `
      <div class="ag-item ${u}${e.muted ? ' muted-item' : ''}" data-id="${escapeHtml(e.id)}">
        <span class="ag-ico">${Icon.svg(e.kind === 'wipe' ? 'broom' : 'calendar', 16)}</span>
        <div class="ag-body">
          <div class="ag-name">
            ${escapeHtml(e.title)}
            ${e.muted ? `<span class="ag-mutedtag" title="${escapeHtml(I18N.t('sched.muted'))}">${Icon.svg('bellOff', 12)}</span>` : ''}
            ${e.repeat ? `<span class="ag-rep" title="${escapeHtml(repeatLabel(e))}">${Icon.svg('repeat', 12)}</span>` : ''}
          </div>
          <div class="ag-meta">
            <span>${escapeHtml(nomes.get(String(e.serverId)) || I18N.t('sched.unknownServer'))}</span>
            <span>·</span>
            <span>${escapeHtml(formatWhen(e.nextAt))}</span>
          </div>
          ${e.note ? `<div class="ag-note">${escapeHtml(e.note)}</div>` : ''}
        </div>
        <span class="ag-count ${u}">${escapeHtml(e.happening ? I18N.t('sched.happening') : countdownText(inMs))}</span>
        <button class="btn-icon small ag-edit" data-act="edit" title="${escapeHtml(I18N.t('common.edit'))}">${Icon.svg('edit', 14)}</button>
      </div>`;
  }).join('');

  box.querySelectorAll('.ag-item').forEach((el) => {
    el.querySelector('[data-act=edit]').addEventListener('click', () => openEvent(el.dataset.id));
  });
}

function diaRotulo(ts) {
  const d = new Date(ts);
  const hoje = new Date();
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  if (mesmo(d, hoje)) return I18N.t('sched.today');
  if (mesmo(d, amanha)) return I18N.t('sched.tomorrow');
  const lang = (AppState.config && AppState.config.language) === 'en-US' ? 'en-US' : 'pt-BR';
  return d.toLocaleDateString(lang, { weekday: 'long', day: '2-digit', month: 'long' });
}

function repeatLabel(e) {
  if (!e.repeat) return '';
  const r = e.repeat;
  if (r.type === 'interval' || r.type === 'daily') return I18N.t('sched.everyNDays', { n: r.every });
  if (r.type === 'monthly') return I18N.t('sched.everyMonthDay', { d: r.day });
  if (r.type === 'weekly') {
    const nomes = I18N.t('sched.weekShort').split(',');
    return (r.weekdays || []).map((d) => nomes[d] || d).join(', ');
  }
  return '';
}

// ------------------------------------------------------------
// Editor de evento
// ------------------------------------------------------------
const DIAS_PADRAO = [
  { min: 60, key: 'sched.r1h' },
  { min: 180, key: 'sched.r3h' },
  { min: 720, key: 'sched.r12h' },
  { min: 1440, key: 'sched.r1d' },
  { min: 4320, key: 'sched.r3d' }
];

async function openEvent(id = null, serverId = null) {
  Agenda.editando = null;
  const ev = id ? (await window.api.schedList()).find((e) => e.id === id) : null;
  Agenda.editando = ev || null;

  document.getElementById('ev-title').textContent =
    I18N.t(ev ? 'sched.editTitle' : 'sched.newTitle');
  document.getElementById('ev-delete').classList.toggle('hidden', !ev);
  document.getElementById('ev-error').classList.add('hidden');

  // Servidores
  const sel = document.getElementById('ev-server');
  sel.innerHTML = (AppState.config.servers || [])
    .map((s) => `<option value="${escapeHtml(String(s.bmId))}">${escapeHtml(s.name || s.ip || s.bmId)}</option>`)
    .join('');
  sel.value = String(ev ? ev.serverId : (serverId || Agenda.filtro || (AppState.config.servers[0] || {}).bmId || ''));

  // Tipo
  const tipo = ev ? ev.kind : 'wipe';
  document.querySelectorAll('#ev-kind input').forEach((r) => { r.checked = r.value === tipo; });

  // Quando: a data começa em HOJE em vez de vazia. Campo de data
  // vazio é o jeito mais fácil de a pessoa salvar 01/01/1970.
  const base = ev ? new Date(ev.start.y, ev.start.m - 1, ev.start.d, ev.start.hh, ev.start.mm) : new Date();
  document.getElementById('ev-date').value =
    `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  document.getElementById('ev-time').value =
    ev ? `${String(ev.start.hh).padStart(2, '0')}:${String(ev.start.mm).padStart(2, '0')}` : '20:00';
  document.getElementById('ev-dur').value = ev ? (ev.durationMin || 0) : 0;

  // Repetição
  const rep = ev && ev.repeat ? ev.repeat : null;
  document.getElementById('ev-repeat').value = rep ? rep.type : '';
  document.getElementById('ev-every').value = rep ? rep.every : 14;
  document.getElementById('ev-monthday').value = rep && rep.day ? rep.day : base.getDate();

  const nomes = I18N.t('sched.weekShort').split(',');
  const marcados = rep && rep.weekdays ? rep.weekdays : [base.getDay()];
  document.getElementById('ev-days').innerHTML = nomes.map((n, i) =>
    `<label class="ev-day"><input type="checkbox" value="${i}"${marcados.includes(i) ? ' checked' : ''} />
     <span>${escapeHtml(n)}</span></label>`).join('');

  // Avisos
  const avisos = ev ? (ev.remindBefore || []) : [1440, 60];
  document.getElementById('ev-reminds').innerHTML = DIAS_PADRAO.map((r) =>
    `<label class="ev-remind"><input type="checkbox" value="${r.min}"${avisos.includes(r.min) ? ' checked' : ''} />
     <span>${escapeHtml(I18N.t(r.key))}</span></label>`).join('');

  document.getElementById('ev-name').value = ev ? ev.title : '';
  document.getElementById('ev-note').value = ev ? (ev.note || '') : '';
  document.getElementById('ev-muted').checked = !!(ev && ev.muted);

  aplicarModoRepeticao();
  atualizarPreviaEvento();
  showModal('modal-event');
  setTimeout(() => document.getElementById('ev-name').focus(), 40);
}

// Só aparece o que a repetição escolhida usa. Mostrar os três
// blocos juntos faz a pessoa preencher campo que não vale.
function aplicarModoRepeticao() {
  const t = document.getElementById('ev-repeat').value;
  document.getElementById('ev-every-row').classList.toggle('hidden', t !== 'interval');
  document.getElementById('ev-week-row').classList.toggle('hidden', t !== 'weekly');
  document.getElementById('ev-month-row').classList.toggle('hidden', t !== 'monthly');
}

function lerFormularioEvento() {
  const [ano, mes, dia] = (document.getElementById('ev-date').value || '').split('-').map(Number);
  const [hh, mm] = (document.getElementById('ev-time').value || '00:00').split(':').map(Number);
  const tipoRep = document.getElementById('ev-repeat').value;

  let repeat = null;
  if (tipoRep === 'interval') {
    repeat = { type: 'interval', every: +document.getElementById('ev-every').value || 1 };
  } else if (tipoRep === 'weekly') {
    repeat = { type: 'weekly', every: 1,
      weekdays: [...document.querySelectorAll('#ev-days input:checked')].map((i) => +i.value) };
  } else if (tipoRep === 'monthly') {
    repeat = { type: 'monthly', every: 1, day: +document.getElementById('ev-monthday').value || 1 };
  }

  return {
    serverId: document.getElementById('ev-server').value,
    kind: (document.querySelector('#ev-kind input:checked') || {}).value || 'event',
    title: document.getElementById('ev-name').value.trim(),
    note: document.getElementById('ev-note').value,
    start: { y: ano, m: mes, d: dia, hh, mm },
    repeat,
    durationMin: +document.getElementById('ev-dur').value || 0,
    remindBefore: [...document.querySelectorAll('#ev-reminds input:checked')].map((i) => +i.value),
    muted: document.getElementById('ev-muted').checked
  };
}

// Prévia ao vivo: mostra as próximas três datas ANTES de salvar.
// É o que evita descobrir só na semana seguinte que a regra estava
// errada — regra de repetição é fácil de escrever e difícil de ler.
async function atualizarPreviaEvento() {
  const el = document.getElementById('ev-preview');
  const d = lerFormularioEvento();
  if (!d.title || !d.start.y) { el.textContent = ''; return; }
  try {
    const r = await window.api.schedPreview(d);
    if (!r || !r.ok) { el.textContent = ''; return; }
    if (!r.dates.length) { el.textContent = I18N.t('sched.previewNone'); el.className = 'ev-preview warn'; return; }
    el.className = 'ev-preview';
    el.textContent = I18N.t('sched.previewNext') + ' ' + r.dates.map(formatWhen).join('  ·  ');
  } catch { el.textContent = ''; }
}

async function salvarEvento() {
  const err = document.getElementById('ev-error');
  const d = lerFormularioEvento();
  const r = Agenda.editando
    ? await window.api.schedUpdate(Agenda.editando.id, d)
    : await window.api.schedCreate(d);

  if (!r.ok) {
    err.textContent = I18N.t('sched.err_' + r.reason);
    err.classList.remove('hidden');
    return;
  }
  hideModal('modal-event');
  await refreshScheduleSummary();
  await renderAgenda();
  if (typeof refreshAllCards === 'function') refreshAllCards();
  toast(I18N.t(Agenda.editando ? 'sched.saved' : 'sched.created'));
  Agenda.editando = null;
}

async function excluirEvento() {
  if (!Agenda.editando) return;
  await window.api.schedDelete(Agenda.editando.id);
  hideModal('modal-event');
  await refreshScheduleSummary();
  await renderAgenda();
  if (typeof refreshAllCards === 'function') refreshAllCards();
  toast(I18N.t('sched.deleted'));
  Agenda.editando = null;
}

// ------------------------------------------------------------
// Ligação
// ------------------------------------------------------------
function initAgenda() {
  document.getElementById('ag-close').addEventListener('click', () => hideModal('modal-agenda'));
  document.getElementById('ag-new').addEventListener('click', () => openEvent(null));
  document.getElementById('ag-filter').addEventListener('change', (e) => {
    Agenda.filtro = e.target.value; renderAgenda();
  });

  document.getElementById('ev-cancel').addEventListener('click', () => {
    hideModal('modal-event'); Agenda.editando = null;
  });
  document.getElementById('ev-save').addEventListener('click', salvarEvento);
  document.getElementById('ev-delete').addEventListener('click', excluirEvento);
  document.getElementById('ev-repeat').addEventListener('change', () => {
    aplicarModoRepeticao(); atualizarPreviaEvento();
  });
  for (const id of ['ev-date', 'ev-time', 'ev-every', 'ev-monthday', 'ev-name', 'ev-dur']) {
    document.getElementById(id).addEventListener('input', atualizarPreviaEvento);
  }
  document.getElementById('ev-days').addEventListener('change', atualizarPreviaEvento);
  document.querySelectorAll('#ev-kind input').forEach((r) =>
    r.addEventListener('change', atualizarPreviaEvento));

  const add = document.getElementById('tk-sched-add');
  if (add) add.addEventListener('click', () => openEvent(null, AppState.trackingId));

  // O main avisa quando disparou um aviso: os selos mudam de cor
  // sozinhos em vez de esperar o próximo minuto.
  if (window.api.onScheduleChanged) {
    window.api.onScheduleChanged(() => {
      refreshScheduleSummary().then(() => {
        if (typeof refreshAllCards === 'function') refreshAllCards();
        if (!document.getElementById('modal-agenda').classList.contains('hidden')) renderAgenda();
      });
    });
  }

  // A contagem anda sozinha. Um minuto basta: é a menor unidade que
  // a tela mostra, e menos que isso seria redesenhar à toa.
  Agenda.tick = setInterval(() => {
    const aberta = !document.getElementById('modal-agenda').classList.contains('hidden');
    if (aberta) renderAgenda();
    refreshWipeChips();
    renderAgendaBadge();
  }, 60 * 1000);

  refreshScheduleSummary();
}

// ------------------------------------------------------------
// Bloco da agenda dentro do tracking
// ------------------------------------------------------------
async function renderServerSchedule(serverId) {
  const box = document.getElementById('tk-sched-list');
  if (!box) return;
  let itens = [];
  try { itens = await window.api.schedAgenda({ serverId: String(serverId) }); } catch { /* sem agenda */ }

  if (!itens.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('sched.empty'))}</p>`;
    return;
  }
  const agora = Date.now();
  // Três é o suficiente para "o que vem por aí": o resto está na
  // Agenda, e uma lista longa aqui empurraria o painel para baixo.
  box.innerHTML = itens.slice(0, 3).map((e) => {
    const inMs = e.nextAt - agora;
    const u = urgencyOf(inMs);
    return `<div class="tks-row ${u}" data-id="${escapeHtml(e.id)}">
      <span>${Icon.svg(e.kind === 'wipe' ? 'broom' : 'calendar', 14)}</span>
      <span class="tks-name">${escapeHtml(e.title)}</span>
      <span class="tks-when">${escapeHtml(formatWhen(e.nextAt))}</span>
      <span class="ag-count ${u}">${escapeHtml(e.happening ? I18N.t('sched.happening') : countdownText(inMs))}</span>
    </div>`;
  }).join('');

  box.querySelectorAll('.tks-row').forEach((el) => {
    el.addEventListener('click', () => openEvent(el.dataset.id));
  });
}

// Atualiza só os selos sem redesenhar os cards inteiros — redesenhar
// tudo a cada minuto perderia o hover e a rolagem.
function refreshWipeChips() {
  for (const el of document.querySelectorAll('.wipe-chip[data-sid]')) {
    const s = Agenda.cache[el.dataset.sid];
    if (!s || !s.wipe) { el.remove(); continue; }
    const inMs = s.wipe.nextAt - Date.now();
    el.className = 'wipe-chip ' + urgencyOf(inMs);
    el.dataset.sid = el.dataset.sid;
    // `innerHTML` e não `textContent`: agora tem um SVG junto do
    // texto, e textContent escreveria a marcação como letra.
    el.innerHTML = Icon.svg('broom', 12) + ' ' + escapeHtml(inMs <= 0
      ? I18N.t('sched.wipeNow')
      : I18N.t('sched.wipeIn', { t: countdownText(inMs) }));
  }
}
