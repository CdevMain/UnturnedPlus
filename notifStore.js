// ============================================================
// notifStore.js — A central de notificações
//
// O problema que ela resolve: um balão que aparece por 4 segundos
// e some é um aviso PERDIDO. Se você estava no jogo, de costas, ou
// simplesmente piscou, aquilo nunca existiu. Metade das coisas que
// o app tem para avisar (o wipe é amanhã, fulano entrou no
// servidor do time, o evento começou) só valem se ficarem
// disponíveis depois.
//
// Então toda notificação passa a ter dois destinos:
//   1. o balão, que continua sendo o aviso imediato;
//   2. esta lista, que é a memória.
//
// ------------------------------------------------------------
// DECISÕES
// ------------------------------------------------------------
// Teto de 200 e 14 dias. Uma lista sem limite vira um arquivo de
// megabytes num app que fica aberto o dia inteiro rastreando
// servidores cheios, e ninguém rola até a entrada de duas semanas
// atrás.
//
// Gravação em lote (250 ms). Entrada e saída de jogador chegam em
// rajada quando um servidor reinicia: gravar a cada uma seriam
// dezenas de escritas em disco por segundo.
//
// `dedupeKey` opcional. O mesmo wipe não pode virar cinco linhas
// porque o vigia rodou cinco vezes; a chave é o que garante uma
// entrada por acontecimento.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TETO = 200;
const DIAS = 14;
const ATRASO_GRAVACAO = 250;

let arquivo = null;
let cache = null;
let timerGravar = null;

function init(userDataPath) {
  arquivo = path.join(userDataPath, 'notifications.json');
  cache = ler();
  return arquivo;
}

function ler() {
  try {
    const j = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
    return Array.isArray(j.items) ? j : { items: [] };
  } catch {
    return { items: [] };
  }
}

function gravarJa() {
  if (!arquivo || !cache) return;
  try {
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
    fs.renameSync(tmp, arquivo);
  } catch { /* a central não pode derrubar o app */ }
}

// Junta as escritas de uma rajada numa só.
function agendarGravacao() {
  if (timerGravar) return;
  timerGravar = setTimeout(() => { timerGravar = null; gravarJa(); }, ATRASO_GRAVACAO);
  if (timerGravar.unref) timerGravar.unref();
}

function podar() {
  const limite = Date.now() - DIAS * 86400_000;
  cache.items = cache.items.filter((n) => (n.at || 0) >= limite).slice(0, TETO);
}

// ------------------------------------------------------------
// Escrita
// ------------------------------------------------------------

// kind: join | leave | wipe | event | airdrop | team | system
function add({ kind, title, body, bmId, dedupeKey, at }) {
  if (!cache) return null;
  const agora = Number(at) || Date.now();

  if (dedupeKey) {
    // Mesmo acontecimento chegando duas vezes: atualiza a hora em
    // vez de criar outra linha. Sem isto, o vigia do schedule
    // rodando de 60 em 60 segundos encheria a lista com o mesmo
    // wipe até ele acontecer.
    const ja = cache.items.find((n) => n.dedupeKey === dedupeKey);
    if (ja) { ja.at = agora; agendarGravacao(); return ja; }
  }

  const item = {
    id: 'n_' + crypto.randomBytes(6).toString('hex'),
    kind: String(kind || 'system'),
    title: String(title || '').slice(0, 120),
    body: String(body || '').slice(0, 240),
    bmId: bmId || null,
    dedupeKey: dedupeKey || null,
    at: agora,
    read: false
  };
  cache.items.unshift(item);
  podar();
  agendarGravacao();
  return item;
}

function list({ limit = 60, unreadOnly = false } = {}) {
  if (!cache) return [];
  const base = unreadOnly ? cache.items.filter((n) => !n.read) : cache.items;
  return base.slice(0, Math.max(1, Math.min(200, limit)));
}

function unread() {
  return cache ? cache.items.filter((n) => !n.read).length : 0;
}

function markRead(ids) {
  if (!cache) return 0;
  const alvo = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  let n = 0;
  for (const item of cache.items) {
    if (item.read) continue;
    if (alvo && !alvo.has(item.id)) continue;
    item.read = true; n += 1;
  }
  if (n) agendarGravacao();
  return n;
}

function remove(id) {
  if (!cache) return false;
  const antes = cache.items.length;
  cache.items = cache.items.filter((n) => n.id !== id);
  if (cache.items.length !== antes) { agendarGravacao(); return true; }
  return false;
}

function clear() {
  if (!cache) return 0;
  const n = cache.items.length;
  cache.items = [];
  agendarGravacao();
  return n;
}

// Chamado ao fechar: a rajada pendente não pode se perder.
function flush() {
  if (timerGravar) { clearTimeout(timerGravar); timerGravar = null; }
  gravarJa();
}

module.exports = { init, add, list, unread, markRead, remove, clear, flush, TETO, DIAS };
