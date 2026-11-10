// ============================================================
// teamChat.js — Canais e mensagens do grupo
//
// Modelo deliberadamente simples: canais dentro do grupo,
// mensagens dentro do canal, anexos por id de mídia. Sem threads
// aninhadas — num grupo de 4 a 10 pessoas jogando, thread é
// cerimônia; responder citando resolve.
//
// ------------------------------------------------------------
// O QUE ESTA CAMADA NÃO FAZ
// ------------------------------------------------------------
// Não entrega mensagem para ninguém. Ela guarda, ordena e aplica
// permissão. Levar de um app para o outro é trabalho do
// syncClient — a mensagem vira uma operação na mesma fila que
// todo o resto, e chega no outro lado por `applyRemote`.
//
// Consequência boa: chat offline funciona. Você escreve com o
// servidor fora do ar, a mensagem fica na fila e sai quando
// voltar, na ordem certa.
// ============================================================

'use strict';

const crypto = require('crypto');

function novoId(p) { return p + '_' + crypto.randomBytes(8).toString('hex'); }

// ------------------------------------------------------------
// Canais
// ------------------------------------------------------------
function defaultChannels(groupId) {
  return [
    { id: novoId('ch'), groupId, name: 'geral', topic: null, system: true, createdAt: Date.now() },
    { id: novoId('ch'), groupId, name: 'avisos', topic: null, system: true, createdAt: Date.now() }
  ];
}

function createChannel(groupId, { name, topic = null, createdBy = null } = {}) {
  // Nome de canal no estilo do Discord: minúsculo, sem espaço.
  // Não é enfeite — some a ambiguidade entre "Base" e "base".
  const limpo = String(name || '')
    .toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_À-ÿ]/g, '')
    .slice(0, 24);
  if (!limpo) return { ok: false, reason: 'bad_name' };
  return {
    ok: true,
    channel: { id: novoId('ch'), groupId, name: limpo, topic, system: false, createdBy, createdAt: Date.now() }
  };
}

// ------------------------------------------------------------
// Mensagens
// ------------------------------------------------------------
// { id, groupId, channelId, authorId, authorName, text,
//   media[], replyTo, pinned, editedAt, deleted, at }
function createMessage(groupId, channelId, { text = '', media = [], replyTo = null,
                                             authorId, authorName } = {}) {
  const t = String(text || '').slice(0, 4000);
  const anexos = (media || []).filter((m) => typeof m === 'string');
  // Mensagem vazia sem anexo não é mensagem.
  if (!t.trim() && !anexos.length) return { ok: false, reason: 'empty' };

  return {
    ok: true,
    message: {
      id: novoId('msg'),
      groupId, channelId,
      authorId, authorName,
      text: t,
      media: anexos,
      replyTo,
      pinned: false,
      editedAt: null,
      deleted: false,
      at: Date.now()
    }
  };
}

// Apagar é MARCAR. Numa conversa com várias cópias, remover de vez
// faz a mensagem voltar quando alguém sincroniza um estado antigo.
// E deixar o rastro ("mensagem apagada") é honesto: some o conteúdo,
// não some o fato.
function markDeleted(msg, byId) {
  msg.deleted = true;
  msg.deletedBy = byId;
  msg.text = '';
  msg.media = [];
  msg.deletedAt = Date.now();
  return msg;
}

function editMessage(msg, text) {
  msg.text = String(text || '').slice(0, 4000);
  msg.editedAt = Date.now();
  return msg;
}

// ------------------------------------------------------------
// Leitura
// ------------------------------------------------------------
// `before` pagina para trás (histórico), que é como se lê chat.
function listMessages(todas, { channelId, limit = 80, before = null } = {}) {
  let rows = todas.filter((m) => m.channelId === channelId);
  rows.sort((a, b) => a.at - b.at);
  if (before) rows = rows.filter((m) => m.at < before);
  return rows.slice(-limit);
}

// Quantas mensagens novas desde a última leitura do canal.
function unreadCount(todas, channelId, lastReadAt, myId) {
  return todas.filter((m) =>
    m.channelId === channelId &&
    !m.deleted &&
    m.at > (lastReadAt || 0) &&
    m.authorId !== myId          // o que eu mesmo escrevi não é "novo"
  ).length;
}

// Menções: "@nome". Serve para o selo do canal ficar vermelho em
// vez de cinza — a diferença entre "tem conversa" e "falaram com
// você" é o que faz alguém abrir o app.
function mentions(text, membros) {
  const achados = [];
  for (const m of membros || []) {
    const nome = String(m.name || '').trim();
    if (!nome) continue;
    const re = new RegExp('@' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(text || '')) achados.push(m.userId);
  }
  return achados;
}

module.exports = {
  defaultChannels, createChannel,
  createMessage, markDeleted, editMessage,
  listMessages, unreadCount, mentions
};
