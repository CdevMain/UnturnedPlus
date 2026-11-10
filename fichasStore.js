// ============================================================
// fichasStore.js — a ficha de cada jogador que você encontra
//
// O PEDIDO
//
// "Preciso que faça o sistema de fichas, para poder vincular
//  jogadores a outros como time e como aliados. Isso deve ser claro
//  na listagem."
//
// Traduzindo para o que o app precisa saber quando você abre a lista
// de quem está online: **quem é essa gente para mim?**
//
// Duas perguntas diferentes, e é importante não confundir:
//
//   1. QUE RELAÇÃO eu tenho com esta pessoa?   -> aliado / inimigo /
//      neutro. É sobre você e ela.
//   2. COM QUEM ela anda?                      -> o grupo dela.
//      É sobre ela e os outros — o "time" no sentido de "esses três
//      jogam juntos e aparecem juntos".
//
// Uma não deriva da outra: dá para ter um grupo rival onde um dos
// membros é seu conhecido, e dá para ter aliado que não anda com
// ninguém. Por isso são dois campos, não um só.
//
// POR QUE O NOME, E NÃO O STEAM ID
//
// Doeria menos usar o SteamID64, mas o A2S_PLAYER — que é de onde
// vem a lista de quem está online — devolve SÓ O NOME. Não existe id
// nenhum ali. Então a chave é o nome, normalizado.
//
// Isso tem uma consequência honesta que a tela precisa admitir: se a
// pessoa troca de nome, a ficha não segue junto. É por isso que a
// ficha guarda `aliases` — os outros nomes pelos quais você já viu
// aquela pessoa. Quem sabe que "Gunner" virou "Gunner2" registra, e
// as duas passam a cair na mesma ficha.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

let baseDir = null;
let state = null;

const VINCULOS = ['ally', 'enemy', 'neutral'];

function init(userDataPath) {
  baseDir = path.join(userDataPath, 'fichas');
  fs.mkdirSync(baseDir, { recursive: true });
  state = ler();
  return baseDir;
}

function arquivo() { return path.join(baseDir, 'fichas.json'); }

function vazio() {
  return {
    version: 1,
    fichas: {},    // chave -> ficha
    grupos: {}     // id -> { id, name, color, createdAt }
  };
}

function ler() {
  try { return { ...vazio(), ...JSON.parse(fs.readFileSync(arquivo(), 'utf-8')) }; }
  catch { return vazio(); }
}

function gravar() {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(state, null, 2));
}

// A chave é o nome sem diferença de caixa e sem espaço nas pontas.
//
// Nome do Unturned aceita caractere invisível e espaço duplo, e o
// jogador que vira "Gunner " (com espaço) NÃO pode virar uma ficha
// nova — do ponto de vista de quem olha a tela é a mesma pessoa.
function chaveDe(nome) {
  return String(nome || '')
    .replace(/[​-‍﻿]/g, '')   // invisíveis
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function novoId(prefixo) {
  return prefixo + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ------------------------------------------------------------
// Ler
// ------------------------------------------------------------
function ficha(nome) {
  const k = chaveDe(nome);
  if (!k) return null;
  return state.fichas[k] || null;
}

// A ficha COM o grupo já resolvido. É o formato que a tela usa: ela
// não deveria precisar cruzar duas tabelas para desenhar uma linha.
function fichaCheia(nome) {
  const f = ficha(nome);
  if (!f) return null;
  return { ...f, group: f.groupId ? (state.grupos[f.groupId] || null) : null };
}

// Várias de uma vez. A lista de jogadores online chama isto UMA vez
// por atualização; chamar `fichaCheia` por linha faria uma leitura
// de objeto por jogador a cada segundo de polling.
function paraLista(nomes = []) {
  const out = {};
  for (const nome of nomes) {
    const f = fichaCheia(nome);
    if (f) out[chaveDe(nome)] = f;
  }
  return out;
}

function todas() {
  return Object.values(state.fichas)
    .map((f) => ({ ...f, group: f.groupId ? (state.grupos[f.groupId] || null) : null }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function grupos() {
  return Object.values(state.grupos)
    .map((g) => ({
      ...g,
      members: Object.values(state.fichas).filter((f) => f.groupId === g.id)
        .map((f) => f.name)
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ------------------------------------------------------------
// Escrever
// ------------------------------------------------------------
function garantir(nome) {
  const k = chaveDe(nome);
  if (!k) return null;
  if (!state.fichas[k]) {
    state.fichas[k] = {
      key: k,
      name: String(nome).trim(),
      link: 'neutral',
      groupId: null,
      note: '',
      aliases: [],
      firstSeen: Date.now(),
      updatedAt: Date.now()
    };
  }
  return state.fichas[k];
}

function definirVinculo(nome, link) {
  if (!VINCULOS.includes(link)) return { ok: false, reason: 'bad_link' };
  const f = garantir(nome);
  if (!f) return { ok: false, reason: 'bad_name' };
  f.link = link;
  f.updatedAt = Date.now();
  gravar();
  return { ok: true, ficha: fichaCheia(nome) };
}

function anotar(nome, nota) {
  const f = garantir(nome);
  if (!f) return { ok: false, reason: 'bad_name' };
  f.note = String(nota || '').slice(0, 2000);
  f.updatedAt = Date.now();
  gravar();
  return { ok: true, ficha: fichaCheia(nome) };
}

// ------------------------------------------------------------
// Grupos — "esses jogam juntos"
// ------------------------------------------------------------
function criarGrupo({ name, color = null } = {}) {
  const nome = String(name || '').trim();
  if (!nome) return { ok: false, reason: 'bad_name' };
  // Nome repetido devolve o que já existe em vez de criar um
  // segundo: dois grupos "NCE" na lista não ajudam ninguém, e o
  // segundo nasceria vazio.
  const igual = Object.values(state.grupos)
    .find((g) => g.name.toLowerCase() === nome.toLowerCase());
  if (igual) return { ok: true, grupo: igual, already: true };

  const g = { id: novoId('gp'), name: nome, color, createdAt: Date.now() };
  state.grupos[g.id] = g;
  gravar();
  return { ok: true, grupo: g };
}

function renomearGrupo(groupId, name) {
  const g = state.grupos[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  const nome = String(name || '').trim();
  if (!nome) return { ok: false, reason: 'bad_name' };
  g.name = nome;
  gravar();
  return { ok: true, grupo: g };
}

// Apagar o grupo NÃO apaga as fichas.
//
// A ficha é o que você anotou sobre uma pessoa; o grupo é só uma
// forma de organizá-las. Levar as anotações junto ao desfazer um
// agrupamento seria destruir o trabalho de quem anotou.
function apagarGrupo(groupId) {
  if (!state.grupos[groupId]) return { ok: false, reason: 'no_group' };
  delete state.grupos[groupId];
  for (const f of Object.values(state.fichas)) {
    if (f.groupId === groupId) { f.groupId = null; f.updatedAt = Date.now(); }
  }
  gravar();
  return { ok: true };
}

function porGrupo(nome, groupId) {
  const f = garantir(nome);
  if (!f) return { ok: false, reason: 'bad_name' };
  if (groupId && !state.grupos[groupId]) return { ok: false, reason: 'no_group' };
  f.groupId = groupId || null;
  f.updatedAt = Date.now();
  gravar();
  return { ok: true, ficha: fichaCheia(nome) };
}

// Agrupar VÁRIOS de uma vez, criando o grupo se preciso. É o caminho
// real: você vê três nomes juntos no servidor e quer marcar os três
// como um bando, sem criar o grupo antes num outro lugar.
function agrupar(nomes = [], { groupId = null, name = null } = {}) {
  let gid = groupId;
  if (!gid) {
    const r = criarGrupo({ name });
    if (!r.ok) return r;
    gid = r.grupo.id;
  }
  if (!state.grupos[gid]) return { ok: false, reason: 'no_group' };
  const feitos = [];
  for (const nome of nomes) {
    const f = garantir(nome);
    if (!f) continue;
    f.groupId = gid;
    f.updatedAt = Date.now();
    feitos.push(f.name);
  }
  gravar();
  return { ok: true, grupo: state.grupos[gid], membros: feitos };
}

// ------------------------------------------------------------
// Outros nomes da mesma pessoa
// ------------------------------------------------------------
// A chave é o nome, e nome muda. `aliases` é o remendo honesto: quem
// PERCEBE que trocou registra, e as duas grafias passam a resolver
// para a mesma ficha.
function apelidar(nomePrincipal, outroNome) {
  const f = garantir(nomePrincipal);
  if (!f) return { ok: false, reason: 'bad_name' };
  const k = chaveDe(outroNome);
  if (!k || k === f.key) return { ok: false, reason: 'bad_name' };

  // Se o outro nome já tinha ficha própria, o conteúdo é FUNDIDO em
  // vez de descartado — a anotação que você fez sob o nome antigo é
  // exatamente o que você quer manter.
  const antiga = state.fichas[k];
  if (antiga) {
    if (!f.note && antiga.note) f.note = antiga.note;
    else if (antiga.note && f.note !== antiga.note) f.note = `${f.note}\n---\n${antiga.note}`;
    if (f.link === 'neutral' && antiga.link !== 'neutral') f.link = antiga.link;
    if (!f.groupId && antiga.groupId) f.groupId = antiga.groupId;
    for (const a of antiga.aliases || []) if (!f.aliases.includes(a)) f.aliases.push(a);
    delete state.fichas[k];
  }
  if (!f.aliases.includes(k)) f.aliases.push(k);
  f.updatedAt = Date.now();
  gravar();
  return { ok: true, ficha: fichaCheia(nomePrincipal) };
}

// Resolve um nome para a ficha, olhando também os apelidos.
function resolver(nome) {
  const k = chaveDe(nome);
  if (!k) return null;
  if (state.fichas[k]) return fichaCheia(nome);
  const dono = Object.values(state.fichas).find((f) => (f.aliases || []).includes(k));
  return dono ? { ...dono, group: dono.groupId ? (state.grupos[dono.groupId] || null) : null } : null;
}

function apagar(nome) {
  const k = chaveDe(nome);
  if (!state.fichas[k]) return { ok: false, reason: 'no_ficha' };
  delete state.fichas[k];
  gravar();
  return { ok: true };
}

function stats() {
  const v = Object.values(state.fichas);
  return {
    fichas: v.length,
    aliados: v.filter((f) => f.link === 'ally').length,
    inimigos: v.filter((f) => f.link === 'enemy').length,
    grupos: Object.keys(state.grupos).length
  };
}

function exportAll() { return JSON.parse(JSON.stringify(state)); }
function importAll(d) {
  if (!d || typeof d !== 'object') return { ok: false };
  state.fichas = { ...d.fichas, ...state.fichas };
  state.grupos = { ...d.grupos, ...state.grupos };
  gravar();
  return { ok: true };
}

module.exports = {
  init, chaveDe, ficha, fichaCheia, resolver, paraLista, todas, grupos,
  definirVinculo, anotar, apelidar, apagar,
  criarGrupo, renomearGrupo, apagarGrupo, porGrupo, agrupar,
  stats, exportAll, importAll, VINCULOS
};
