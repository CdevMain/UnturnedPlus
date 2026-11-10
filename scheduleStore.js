// ============================================================
// scheduleStore.js — Wipes e eventos por servidor
//
// Responde a UMA pergunta o tempo todo: "o que vai acontecer neste
// servidor, e falta quanto?". Wipe é só um evento com um tipo
// especial — mesma máquina de datas, mesmo aviso, mesma lista.
//
// ------------------------------------------------------------
// POR QUE WIPE NÃO É UM CAMPO SOLTO NO SERVIDOR
// ------------------------------------------------------------
// A tentação é `server.wipeDate = '2026-09-01'`. Quebra na primeira
// semana: quase todo servidor com wipe tem wipe RECORRENTE (toda
// quinta, dia 1 de cada mês, de 15 em 15 dias). Um campo de data só
// obriga a pessoa a reeditar toda vez que passa — e ela esquece, o
// app passa a mostrar uma data no passado, e aí não dá para confiar
// em mais nada que o app diga sobre tempo.
//
// Então: evento com REGRA de repetição. A data seguinte é
// calculada, nunca guardada.
//
// ------------------------------------------------------------
// FUSO HORÁRIO
// ------------------------------------------------------------
// Tudo é guardado como data/hora LOCAL da pessoa (campos separados:
// ano, mês, dia, hora, minuto), não como UTC. Um wipe "toda quinta
// às 20h" é 20h no relógio de quem joga. Guardar em UTC faria o
// horário andar sozinho no horário de verão — e o objetivo é
// justamente não errar a hora de estar online.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

let ARQUIVO = null;
let state = { events: [], seen: {} };

function novoId() { return 'ev_' + crypto.randomBytes(6).toString('hex'); }

// ------------------------------------------------------------
// Persistência
// ------------------------------------------------------------
function init(userDataDir) {
  ARQUIVO = path.join(userDataDir, 'schedule.json');
  read();
  return state;
}

function read() {
  try {
    const cru = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    state = {
      events: Array.isArray(cru.events) ? cru.events : [],
      // `seen` guarda qual OCORRÊNCIA já foi avisada, por carimbo de
      // tempo. Sem isso o aviso volta a cada abertura do app e a
      // pessoa aprende a ignorar — que é pior do que não avisar.
      seen: cru.seen && typeof cru.seen === 'object' ? cru.seen : {}
    };
  } catch { state = { events: [], seen: {} }; }
  return state;
}

function write() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(state, null, 2));
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------
// Modelo
// ------------------------------------------------------------
// {
//   id, serverId, kind: 'wipe'|'event',
//   title, note, color,
//   start: { y, m, d, hh, mm },       // primeira ocorrência, hora local
//   repeat: { type, every, weekdays[], day } | null,
//   durationMin,                       // 0 = instantâneo
//   remindBefore: [1440, 60],          // minutos antes; [] = sem aviso
//   muted, createdAt, updatedAt
// }
//
// repeat.type: 'daily' | 'weekly' | 'monthly' | 'interval'
//   daily    -> a cada `every` dias
//   weekly   -> nos dias da semana em `weekdays` (0=dom), a cada `every` semanas
//   monthly  -> no dia `day` do mês (31 cai para o último dia do mês curto)
//   interval -> a cada `every` DIAS a partir de `start` (ciclo de wipe puro)

const TIPOS_REPETICAO = ['daily', 'weekly', 'monthly', 'interval'];

function normalizaPartes(p = {}) {
  const n = (v, def) => (Number.isFinite(+v) ? Math.trunc(+v) : def);
  return {
    y: n(p.y, new Date().getFullYear()),
    m: Math.min(12, Math.max(1, n(p.m, 1))),
    d: Math.min(31, Math.max(1, n(p.d, 1))),
    hh: Math.min(23, Math.max(0, n(p.hh, 0))),
    mm: Math.min(59, Math.max(0, n(p.mm, 0)))
  };
}

// Partes -> Date local. `new Date(y, m-1, d, hh, mm)` é local por
// definição, que é exatamente o que queremos.
function paraData(p) {
  const q = normalizaPartes(p);
  return new Date(q.y, q.m - 1, q.d, q.hh, q.mm, 0, 0);
}

function deData(dt) {
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
           hh: dt.getHours(), mm: dt.getMinutes() };
}

// ------------------------------------------------------------
// Próxima ocorrência
// ------------------------------------------------------------
// Devolve o timestamp da próxima ocorrência em ou depois de `agora`,
// ou null se o evento já passou e não repete.
//
// A conta é feita em Date LOCAL de propósito. Somar `n * 86400000`
// erra no dia da virada do horário de verão (o dia tem 23 ou 25
// horas); `setDate(+n)` respeita o calendário.
function nextOccurrence(ev, agora = Date.now()) {
  const inicio = paraData(ev.start);
  const dur = Math.max(0, ev.durationMin || 0) * MIN;
  // Enquanto o evento está ACONTECENDO ele ainda é "o próximo":
  // some da tela na hora de entrar, que é quando mais importa.
  if (inicio.getTime() + dur > agora) return inicio.getTime();
  if (!ev.repeat || !TIPOS_REPETICAO.includes(ev.repeat.type)) return null;

  const r = ev.repeat;
  const passo = Math.max(1, Math.trunc(r.every || 1));

  if (r.type === 'daily' || r.type === 'interval') {
    const dt = new Date(inicio);
    // Salto direto para perto do alvo em vez de um dia por vez: um
    // ciclo diário criado há 3 anos daria mais de mil voltas.
    const diasPassados = Math.floor((agora - inicio.getTime()) / DIA);
    const saltos = Math.max(0, Math.floor(diasPassados / passo) - 1);
    dt.setDate(dt.getDate() + saltos * passo);
    for (let i = 0; i < 400; i++) {
      if (dt.getTime() + dur > agora) return dt.getTime();
      dt.setDate(dt.getDate() + passo);
    }
    return null;
  }

  if (r.type === 'weekly') {
    const dias = (r.weekdays || []).filter((d) => d >= 0 && d <= 6);
    if (!dias.length) return null;
    const dt = new Date(inicio);
    const semanasPassadas = Math.floor((agora - inicio.getTime()) / (7 * DIA));
    const saltos = Math.max(0, Math.floor(semanasPassadas / passo) - 1);
    dt.setDate(dt.getDate() + saltos * passo * 7);
    // A partir daí caminha dia a dia; no máximo algumas semanas.
    for (let i = 0; i < 400; i++) {
      if (dt.getTime() + dur > agora && dias.includes(dt.getDay())) {
        // Respeita "a cada N semanas" contando a partir do início.
        const semanas = Math.floor((dt - inicio) / (7 * DIA));
        if (passo === 1 || semanas % passo === 0) return dt.getTime();
      }
      dt.setDate(dt.getDate() + 1);
    }
    return null;
  }

  if (r.type === 'monthly') {
    const alvo = Math.min(31, Math.max(1, r.day || ev.start.d || 1));
    const base = new Date(inicio);
    for (let i = 0; i < 120; i++) {
      const ano = base.getFullYear();
      const mes = base.getMonth();
      // Dia 31 em fevereiro vira o último dia de fevereiro em vez de
      // escorregar para março — que é o que `setDate(31)` faria e
      // faria o wipe "do dia 31" aparecer no dia 3.
      const ultimo = new Date(ano, mes + 1, 0).getDate();
      const dt = new Date(ano, mes, Math.min(alvo, ultimo),
                          ev.start.hh || 0, ev.start.mm || 0);
      if (dt.getTime() + dur > agora && dt >= inicio) return dt.getTime();
      base.setMonth(base.getMonth() + 1, 1);
    }
    return null;
  }

  return null;
}

// A ocorrência ANTERIOR à de agora.
//
// Por que isto precisa existir: num wipe quinzenal, no segundo
// seguinte ao wipe a "próxima" já é daqui a 14 dias. O card passaria
// de "wipe em 1 min" para "wipe em 13d 23h" sem nunca dizer que o
// wipe aconteceu — e "o wipe já passou?" é justamente a pergunta de
// quem abre o app depois de um tempo fora.
//
// Achada andando para trás a partir da próxima, pelo mesmo caminho
// que gera as datas para a frente: assim as duas nunca discordam.
function lastOccurrence(ev, agora = Date.now()) {
  if (!ev.repeat) {
    const inicio = paraData(ev.start).getTime();
    return inicio <= agora ? inicio : null;
  }
  const prox = nextOccurrence(ev, agora);
  if (prox == null) return null;

  // Recua a partir da próxima até cair antes de agora. O limite de
  // voltas é o mesmo do caminho para a frente.
  const r = ev.repeat;
  const passo = Math.max(1, Math.trunc(r.every || 1));
  const inicio = paraData(ev.start).getTime();
  let cursor = prox;

  for (let i = 0; i < 400; i++) {
    const dt = new Date(cursor);
    if (r.type === 'daily' || r.type === 'interval') dt.setDate(dt.getDate() - passo);
    else if (r.type === 'weekly') dt.setDate(dt.getDate() - 1);
    else if (r.type === 'monthly') {
      const ano = dt.getFullYear(), mes = dt.getMonth() - 1;
      const ultimo = new Date(ano, mes + 1, 0).getDate();
      const alvo = Math.min(r.day || ev.start.d || 1, ultimo);
      dt.setFullYear(ano, mes, alvo);
    } else return null;

    cursor = dt.getTime();
    if (cursor < inicio) return null;         // antes do começo: não existiu
    if (cursor <= agora) {
      // No semanal, só vale se cair num dia marcado.
      if (r.type === 'weekly' && !(r.weekdays || []).includes(dt.getDay())) continue;
      return cursor;
    }
  }
  return null;
}

// Lista as próximas N ocorrências — a agenda precisa disso, não só
// da próxima.
function upcomingOccurrences(ev, quantas = 3, agora = Date.now()) {
  const out = [];
  let t = agora;
  for (let i = 0; i < quantas; i++) {
    const p = nextOccurrence(ev, t);
    if (p == null) break;
    out.push(p);
    t = p + Math.max(1, (ev.durationMin || 0) * MIN) + 1;
  }
  return out;
}

// ------------------------------------------------------------
// CRUD
// ------------------------------------------------------------
function validate(d = {}) {
  const titulo = String(d.title || '').trim().slice(0, 60);
  if (!titulo) return { ok: false, reason: 'no_title' };
  if (!d.serverId) return { ok: false, reason: 'no_server' };

  let repeat = null;
  if (d.repeat && d.repeat.type) {
    if (!TIPOS_REPETICAO.includes(d.repeat.type)) return { ok: false, reason: 'bad_repeat' };
    const every = Math.max(1, Math.min(365, Math.trunc(d.repeat.every || 1)));
    repeat = { type: d.repeat.type, every };
    if (d.repeat.type === 'weekly') {
      const dias = [...new Set((d.repeat.weekdays || []).map(Number).filter((x) => x >= 0 && x <= 6))];
      // Semanal sem nenhum dia marcado nunca aconteceria: recusa em
      // vez de guardar um evento que não vai disparar nunca.
      if (!dias.length) return { ok: false, reason: 'no_weekday' };
      repeat.weekdays = dias.sort();
    }
    if (d.repeat.type === 'monthly') {
      repeat.day = Math.min(31, Math.max(1, Math.trunc(d.repeat.day || normalizaPartes(d.start).d)));
    }
  }

  const avisos = [...new Set((d.remindBefore || [])
    .map(Number).filter((x) => Number.isFinite(x) && x > 0 && x <= 60 * 24 * 30))]
    .sort((a, b) => b - a);

  return {
    ok: true,
    value: {
      serverId: String(d.serverId),
      kind: d.kind === 'wipe' ? 'wipe' : 'event',
      title: titulo,
      note: String(d.note || '').slice(0, 500),
      color: /^#[0-9a-f]{6}$/i.test(d.color || '') ? d.color : null,
      start: normalizaPartes(d.start),
      repeat,
      durationMin: Math.max(0, Math.min(60 * 24 * 7, Math.trunc(d.durationMin || 0))),
      remindBefore: avisos,
      muted: !!d.muted
    }
  };
}

function createEvent(d) {
  const v = validate(d);
  if (!v.ok) return v;
  const ev = { id: novoId(), ...v.value, createdAt: Date.now(), updatedAt: Date.now() };
  state.events.push(ev);
  write();
  return { ok: true, event: ev };
}

function updateEvent(id, d) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return { ok: false, reason: 'no_event' };
  const v = validate({ ...ev, ...d, serverId: d.serverId || ev.serverId });
  if (!v.ok) return v;
  Object.assign(ev, v.value, { updatedAt: Date.now() });
  // Mudou a regra: os avisos já dados não valem mais para as novas
  // datas. Limpar evita o caso "mudei o wipe para amanhã e o app
  // não avisou porque achava que já tinha avisado".
  for (const k of Object.keys(state.seen)) if (k.startsWith(id + ':')) delete state.seen[k];
  write();
  return { ok: true, event: ev };
}

function deleteEvent(id) {
  const antes = state.events.length;
  state.events = state.events.filter((e) => e.id !== id);
  for (const k of Object.keys(state.seen)) if (k.startsWith(id + ':')) delete state.seen[k];
  write();
  return { ok: antes !== state.events.length };
}

// Apagar o servidor apaga a agenda dele — senão sobra evento órfão
// avisando sobre um servidor que não está mais na lista.
function deleteByServer(serverId) {
  const ids = state.events.filter((e) => e.serverId === String(serverId)).map((e) => e.id);
  state.events = state.events.filter((e) => e.serverId !== String(serverId));
  for (const k of Object.keys(state.seen)) {
    if (ids.some((id) => k.startsWith(id + ':'))) delete state.seen[k];
  }
  write();
  return ids.length;
}

function listEvents(serverId = null) {
  const rows = serverId ? state.events.filter((e) => e.serverId === String(serverId)) : state.events.slice();
  return rows;
}

// ------------------------------------------------------------
// Leitura para a interface
// ------------------------------------------------------------
// Cada item já vem com a próxima data resolvida e o quanto falta,
// para a tela não ter que recalcular (e divergir).
// Janela em que um wipe recém-passado ainda é notícia. Seis horas
// cobre "dormi e acordei"; mais que isso e a informação vira ruído,
// porque o que importa volta a ser o próximo.
const RECEM = 6 * HORA;

function decorate(ev, agora = Date.now()) {
  const prox = nextOccurrence(ev, agora);
  const dur = Math.max(0, ev.durationMin || 0) * MIN;
  const ultimo = lastOccurrence(ev, agora);
  return {
    ...ev,
    nextAt: prox,
    inMs: prox == null ? null : prox - agora,
    // "acontecendo agora" é diferente de "vai acontecer": a tela
    // mostra AO VIVO em vez de "faltam -12 minutos".
    happening: prox != null && prox <= agora && agora < prox + dur,
    lastAt: ultimo,
    sinceMs: ultimo == null ? null : agora - ultimo,
    // Aconteceu há pouco: a tela diz "o wipe foi há 3h" em vez de
    // pular direto para "em 13 dias" como se nada tivesse ocorrido.
    justHappened: ultimo != null && (agora - ultimo) <= RECEM,
    past: prox == null
  };
}

function agenda({ serverId = null, limit = 50, agora = Date.now() } = {}) {
  return listEvents(serverId)
    .map((e) => decorate(e, agora))
    .filter((e) => !e.past)
    .sort((a, b) => a.nextAt - b.nextAt)
    .slice(0, limit);
}

// O wipe do servidor é o evento `kind:'wipe'` mais próximo. Se a
// pessoa cadastrou mais de um (acontece: wipe de mapa e wipe de
// bases), o que vale para o card é o que vem primeiro.
function nextWipe(serverId, agora = Date.now()) {
  const w = listEvents(serverId)
    .filter((e) => e.kind === 'wipe')
    .map((e) => decorate(e, agora))
    .filter((e) => !e.past)
    .sort((a, b) => a.nextAt - b.nextAt);
  return w[0] || null;
}

// ------------------------------------------------------------
// Avisos
// ------------------------------------------------------------
// `due` devolve o que precisa ser avisado AGORA e ainda não foi.
// Marcar como visto é passo separado (`markNotified`) para o aviso
// não se perder se a janela de notificação falhar em abrir.
function due(agora = Date.now(), janelaMs = 5 * MIN) {
  const saida = [];
  for (const ev of state.events) {
    if (ev.muted) continue;
    const prox = nextOccurrence(ev, agora - janelaMs);
    if (prox == null) continue;

    // Marco zero: a hora do evento em si.
    const marcos = [{ minutos: 0, quando: prox }];
    for (const min of ev.remindBefore || []) marcos.push({ minutos: min, quando: prox - min * MIN });

    for (const marco of marcos) {
      // A janela existe porque o relógio do app não bate exatamente
      // no minuto: sem ela, um aviso cairia entre duas verificações
      // e nunca sairia.
      if (marco.quando > agora || marco.quando < agora - janelaMs) continue;
      const chave = `${ev.id}:${prox}:${marco.minutos}`;
      if (state.seen[chave]) continue;
      saida.push({ key: chave, event: ev, occurrenceAt: prox, beforeMin: marco.minutos });
    }
  }
  return saida;
}

function markNotified(keys) {
  const agora = Date.now();
  for (const k of [].concat(keys || [])) state.seen[k] = agora;
  // Poda: chave de ocorrência velha não serve para mais nada e o
  // arquivo cresceria para sempre num app que fica aberto meses.
  const limite = agora - 30 * DIA;
  for (const [k, t] of Object.entries(state.seen)) if (t < limite) delete state.seen[k];
  write();
  return true;
}

// ------------------------------------------------------------
// Texto de contagem — no store, não na tela
// ------------------------------------------------------------
// Fica aqui porque o card da home, o overlay e a notificação
// precisam da MESMA contagem. Três lugares formatando por conta
// própria é como "faltam 2 dias" num canto e "faltam 1 dia" no
// outro para o mesmo instante.
function countdownParts(ms) {
  if (ms == null) return null;
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return { neg, d, h, m, totalMin: Math.floor(Math.abs(ms) / MIN) };
}

// Grau de urgência para a cor do selo. Não é enfeite: é o que faz a
// pessoa olhar. Tudo cinza é igual a nada avisado.
function urgency(inMs) {
  if (inMs == null) return 'none';
  if (inMs <= 0) return 'now';
  if (inMs <= HORA) return 'imminent';
  if (inMs <= DIA) return 'soon';
  if (inMs <= 3 * DIA) return 'near';
  return 'far';
}

module.exports = {
  init, read, write,
  createEvent, updateEvent, deleteEvent, deleteByServer, listEvents,
  nextOccurrence, lastOccurrence, upcomingOccurrences, decorate, agenda, nextWipe,
  due, markNotified, countdownParts, urgency, validate,
  _state: () => state
};
