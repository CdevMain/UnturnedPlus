// ============================================================
// teamStore.js — Grupos: identidade, membros, papéis e conteúdo
// compartilhado (processo principal)
//
// A regra que orienta tudo aqui: **o app funciona igual sozinho.**
// Grupo é uma CAMADA por cima do que já existe, nunca um pré-
// requisito. Quem nunca criar grupo não deve nem perceber que este
// arquivo existe; quem criar continua vendo os próprios marcadores
// no mesmo servidor, lado a lado com os do grupo.
//
// Por isso todo item guarda `origin`:
//     'local'          -> seu, só seu
//     'group:<id>'     -> do grupo
// A tela decide o que mostrar; o dado nunca se mistura.
//
// ------------------------------------------------------------
// OFFLINE PRIMEIRO
// ------------------------------------------------------------
// Nada aqui depende de rede. Toda alteração:
//   1. é aplicada no estado local na hora,
//   2. vira uma OPERAÇÃO na fila de saída (outbox).
// Quando existir servidor, o syncClient esvazia essa fila e aplica
// as operações que chegarem dos outros. Enquanto não existir, a
// fila só cresce e o app funciona — que é exatamente o modo em que
// ele vai rodar até a hospedagem existir.
//
// Isso não é "preparado para o futuro" por preguiça: escrever
// primeiro o caminho online e depois tentar fazer funcionar sem
// rede é o que produz app que trava quando a conexão cai.
//
// ------------------------------------------------------------
// PAPÉIS
// ------------------------------------------------------------
//   admin  : mexe em qualquer coisa do grupo (itens de qualquer
//            um, membros, papéis, nome/foto do grupo)
//   member : CRIA marcadores, notas e prints; COMENTA no que já
//            existe; edita e apaga o que é seu.
//
// A checagem mora em `can()`, num lugar só. Espalhar `if admin`
// pela interface é como se perde permissão em algum canto.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Roles = require('./teamRoles');
const Invites = require('./teamInvites');
const Chat = require('./teamChat');

let baseDir = null;
let state = null;

const ROLES = Roles.ROLE_KEYS;
const KINDS = ['marker', 'note', 'shot', 'comment'];

// ------------------------------------------------------------
// Arquivo
// ------------------------------------------------------------
function init(userDataPath) {
  baseDir = path.join(userDataPath, 'teams');
  fs.mkdirSync(baseDir, { recursive: true });
  state = read();
  return baseDir;
}

function file() { return path.join(baseDir, 'teams.json'); }

function novoId(prefixo) {
  return prefixo + '_' + crypto.randomBytes(8).toString('hex');
}

function vazio() {
  return {
    version: 1,
    identity: null,     // { userId, name, avatar, steamId }
    groups: {},         // id -> grupo
    items: {},          // id -> item compartilhado
    positions: {},      // "groupId:userId" -> posição
    channels: {},       // id -> canal
    messages: {},       // id -> mensagem
    invites: {},        // id -> convite (com hash da senha)
    reads: {},          // "groupId:channelId" -> último lido (ms)
    bans: {},           // "groupId:userId" -> { at, by, reason }
    links: {},          // "groupId:bmId" -> servidor vinculado (ver linkServer)
    profiles: {},       // groupId -> { description, photo, rules, ... }
    outbox: [],         // operações ainda não enviadas
    clock: 0            // contador local, para ordenar operações
  };
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    return { ...vazio(), ...j };
  } catch {
    return vazio();
  }
}

function write() {
  fs.mkdirSync(baseDir, { recursive: true });
  // Escrita atômica: um crash no meio deixaria o arquivo truncado
  // e levaria junto grupo, membros e tudo que foi compartilhado.
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, file());
  return true;
}

// ------------------------------------------------------------
// Identidade
// ------------------------------------------------------------
// O `userId` é local e estável. NÃO é o SteamID: o SteamID é opcional
// (só quem conectou a conta tem) e é um dado que a pessoa pode não
// querer entregar para um grupo qualquer. O SteamID vai junto se
// existir, mas quem manda é o userId.
function ensureIdentity(patch = {}) {
  if (!state.identity) {
    state.identity = {
      userId: novoId('u'),
      name: patch.name || 'Jogador',
      avatar: patch.avatar || null,
      steamId: patch.steamId || null,
      createdAt: Date.now()
    };
  } else {
    for (const k of ['name', 'avatar', 'steamId']) {
      if (patch[k] !== undefined) state.identity[k] = patch[k];
    }
  }
  write();
  return state.identity;
}

function me() { return state.identity; }

// ------------------------------------------------------------
// Operações (o que vai para o servidor um dia)
// ------------------------------------------------------------
function enqueue(type, payload) {
  state.clock += 1;
  const op = {
    opId: novoId('op'),
    type,
    payload,
    authorId: state.identity ? state.identity.userId : null,
    clock: state.clock,
    at: Date.now()
  };
  state.outbox.push(op);
  // Trava de segurança: sem servidor a fila cresceria para sempre.
  // 5000 operações é muito mais do que um grupo gera em meses; se
  // passar disso, algo está errado e o mais antigo já não importa.
  if (state.outbox.length > 5000) state.outbox.splice(0, state.outbox.length - 5000);
  return op;
}

function pendingOps(limit = 200) { return state.outbox.slice(0, limit); }

function ackOps(opIds) {
  const set = new Set(opIds || []);
  state.outbox = state.outbox.filter((o) => !set.has(o.opId));
  write();
  return state.outbox.length;
}

// ------------------------------------------------------------
// Grupos
// ------------------------------------------------------------
// O código de convite é curto e legível em voz alta (sem 0/O/1/I,
// que ninguém consegue ditar no Discord sem errar).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function gerarCodigo(n = 6) {
  let s = '';
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s;
}

function createGroup({ name, photo, description, rules, serverId } = {}) {
  const eu = ensureIdentity();
  const g = {
    id: novoId('g'),
    name: String(name || 'Meu grupo').slice(0, 40),
    photo: photo || null,
    code: gerarCodigo(),
    serverId: serverId || null,
    ownerId: eu.userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    members: [{
      userId: eu.userId,
      name: eu.name,
      avatar: eu.avatar,
      steamId: eu.steamId,
      role: 'owner',           // quem cria é o DONO
      joinedAt: Date.now(),
      lastSeen: Date.now()
    }]
  };
  state.groups[g.id] = g;
  // Descrição, foto e regras já entram no perfil se vieram no
  // formulário de criação. Criar o grupo e depois gravar o perfil
  // em duas operações separadas deixaria uma janela em que o time
  // existe sem nada do que a pessoa acabou de escrever — e se a
  // segunda falhasse, o texto sumia sem aviso.
  if (description != null || photo != null || rules != null) {
    state.profiles[g.id] = perfilLimpo({ description, photo, rules },
      { id: g.id, createdAt: Date.now() });
  }
  for (const c of Chat.defaultChannels(g.id)) state.channels[c.id] = c;
  enqueue('group.create', g);
  write();
  return g;
}

function listGroups() {
  return Object.values(state.groups).sort((a, b) => a.createdAt - b.createdAt);
}

function getGroup(id) { return state.groups[id] || null; }

function memberOf(groupId, userId) {
  const g = state.groups[groupId];
  if (!g) return null;
  return g.members.find((m) => m.userId === userId) || null;
}

function myRole(groupId) {
  const eu = me();
  if (!eu) return null;
  const m = memberOf(groupId, eu.userId);
  return m ? m.role : null;
}

// ------------------------------------------------------------
// Permissões — um lugar só
// ------------------------------------------------------------
// A tabela mora em teamRoles.js — a MESMA que vai rodar no
// servidor. Regra de permissão duplicada em dois lugares diverge;
// é questão de tempo.
function can(groupId, action, alvo = null) {
  const eu = me();
  if (!eu) return false;
  const papel = myRole(groupId);
  if (!papel) return false;                 // não é do grupo

  const ctx = { actorRole: papel, actorId: eu.userId };

  // Ação sobre PESSOA: precisa do papel do alvo para a hierarquia.
  if (action.startsWith('member.') && alvo && alvo.userId) {
    const m = memberOf(groupId, alvo.userId);
    ctx.targetRole = m ? m.role : null;
    ctx.targetId = alvo.userId;
  }
  // Ação sobre CONTEÚDO: precisa do autor.
  if (alvo && alvo.authorId) ctx.authorId = alvo.authorId;

  return Roles.can(action, ctx);
}

// Papéis que EU posso conceder neste grupo.
function assignableRoles(groupId) {
  const papel = myRole(groupId);
  return papel ? Roles.assignableBy(papel) : [];
}

function capabilities(groupId) {
  const papel = myRole(groupId);
  return papel ? Roles.capabilitiesOf(papel) : {};
}

function updateGroup(groupId, patch = {}) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  if (!can(groupId, 'group.edit')) return { ok: false, reason: 'forbidden' };

  if (patch.name !== undefined) g.name = String(patch.name).slice(0, 40);
  if (patch.photo !== undefined) g.photo = patch.photo;
  if (patch.serverId !== undefined) g.serverId = patch.serverId;
  // Descrição/foto/regras moram no perfil, mas quem chama não
  // precisa saber disso: mandar tudo junto em `updateGroup` é o que
  // a tela faz naturalmente ao salvar um formulário só.
  if (patch.description !== undefined || patch.rules !== undefined) {
    setProfile(groupId, {
      description: patch.description, rules: patch.rules,
      photo: patch.photo
    });
  }
  g.updatedAt = Date.now();

  enqueue('group.update', { groupId, patch });
  write();
  return { ok: true, group: g };
}

function deleteGroup(groupId) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  const eu = me();
  // Só o dono dissolve o grupo. Um admin qualquer poder apagar o
  // grupo inteiro é poder demais para um clique.
  if (!eu || g.ownerId !== eu.userId) return { ok: false, reason: 'only_owner' };

  delete state.groups[groupId];
  for (const [id, it] of Object.entries(state.items)) {
    if (it.groupId === groupId) delete state.items[id];
  }
  for (const k of Object.keys(state.positions)) {
    if (k.startsWith(groupId + ':')) delete state.positions[k];
  }
  enqueue('group.delete', { groupId });
  write();
  return { ok: true };
}

function leaveGroup(groupId) {
  const g = state.groups[groupId];
  const eu = me();
  if (!g || !eu) return { ok: false, reason: 'no_group' };
  g.members = g.members.filter((m) => m.userId !== eu.userId);
  enqueue('member.leave', { groupId, userId: eu.userId });
  // Sair apaga a cópia local do grupo: sem servidor não há como
  // continuar recebendo, e deixar o grupo na lista dá a impressão
  // falsa de que ainda está dentro.
  delete state.groups[groupId];
  write();
  return { ok: true };
}

// ------------------------------------------------------------
// Membros
// ------------------------------------------------------------
function addMember(groupId, membro) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  if (!can(groupId, 'member.invite')) return { ok: false, reason: 'forbidden' };
  if (g.members.some((m) => m.userId === membro.userId)) {
    return { ok: false, reason: 'already_member' };
  }
  const novo = {
    userId: membro.userId,
    name: String(membro.name || 'Jogador').slice(0, 40),
    avatar: membro.avatar || null,
    steamId: membro.steamId || null,
    // Só dá para conceder papel abaixo do seu.
    role: assignableRoles(groupId).includes(membro.role) ? membro.role : 'member',
    joinedAt: Date.now(),
    lastSeen: null
  };
  g.members.push(novo);
  enqueue('member.add', { groupId, member: novo });
  write();
  return { ok: true, member: novo };
}

function setRole(groupId, userId, role) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  if (!Roles.isRole(role)) return { ok: false, reason: 'bad_role' };
  const m = g.members.find((x) => x.userId === userId);
  if (!m) return { ok: false, reason: 'no_member' };
  // O dono vem ANTES da hierarquia. A hierarquia já bloquearia
  // (ninguém tem rank acima do dono), mas devolveria "forbidden" —
  // e quem está tentando merece saber que o problema é o dono ser
  // dono, não falta de permissão genérica.
  if (userId === g.ownerId) return { ok: false, reason: 'owner_locked' };
  if (!can(groupId, 'member.setRole', { userId })) return { ok: false, reason: 'forbidden' };
  // E não dá para promover alguém acima de você.
  if (!assignableRoles(groupId).includes(role)) return { ok: false, reason: 'above_you' };

  m.role = role;
  enqueue('member.role', { groupId, userId, role });
  write();
  return { ok: true, member: m };
}

function removeMember(groupId, userId) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  if (userId === g.ownerId) return { ok: false, reason: 'owner_locked' };
  if (!can(groupId, 'member.kick', { userId })) return { ok: false, reason: 'forbidden' };
  g.members = g.members.filter((m) => m.userId !== userId);
  enqueue('member.remove', { groupId, userId });
  write();
  return { ok: true };
}

// ------------------------------------------------------------
// PERMISSÃO QUANDO O GRUPO NÃO É DAQUI
// ------------------------------------------------------------
// Com conta ligada o time vive no SERVIDOR: ele não está em
// `state.groups`. Mas o conteúdo (notas, fichas, planos, vínculos)
// continua salvo no disco desta máquina, porque foi assim que a
// Sara desenhou — a API cuida de conta, conexão, arquivo temporário
// e voz; o resto é do computador do usuário.
//
// O resultado é um grupo "fantasma": existe para a tela, não existe
// para o store. `can()` respondia `false` para ele em tudo, e o
// sintoma era o pior tipo — nada quebrava, só que criar qualquer
// item num time ao vivo devolvia `no_group` em silêncio.
//
// `linkServer` já tinha resolvido isso para si com `papelRemoto`.
// Aqui a solução vira UMA função, usada por todo mundo, para não
// existir um terceiro jeito de checar permissão daqui a dois meses.
function podeAqui(groupId, acao, { papelRemoto = null, alvo = null } = {}) {
  if (state.groups[groupId]) return can(groupId, acao, alvo) ? { ok: true } : { ok: false, reason: 'forbidden' };
  if (!papelRemoto) return { ok: false, reason: 'no_group' };
  // Time remoto: mesma tabela de ranks, sem a hierarquia sobre
  // pessoas (que só o servidor sabe resolver). Para conteúdo isso
  // basta, e vale repetir o que já valia para o vínculo: esta é uma
  // regra de CORREÇÃO, não uma barreira. A barreira é o servidor.
  const ctx = { actorRole: papelRemoto, actorId: (me() || {}).userId };
  if (alvo && alvo.authorId) ctx.authorId = alvo.authorId;
  return Roles.can(acao, ctx) ? { ok: true } : { ok: false, reason: 'forbidden' };
}

// ------------------------------------------------------------
// PERFIL DO TIME — descrição, foto e regras
// ------------------------------------------------------------
// Por que o perfil não mora dentro do grupo:
//
// O NOME mora. Nome é a identidade do time e aparece em todo lugar
// (menu, cards, seletor), e no modo ao vivo é o servidor quem o
// guarda — `liveRename` existe. Descrição, foto e regras ainda não
// têm rota no servidor; guardá-las dentro do objeto do grupo faria
// o modo ao vivo, onde o grupo vem pronto de fora, perder os três
// campos a cada resposta do servidor.
//
// Num dicionário separado, indexado pelo id do time (local OU
// remoto), os dois modos funcionam com o mesmo código, e no dia em
// que a rota existir é só passar a preencher daqui em vez do disco.
//
// A FOTO É UM LINK EXTERNO, e é o que a Sara pediu: "foto do time
// (link externo)". Só http(s) entra. Um `javascript:` ou um
// `data:` num src que a tela põe na página é execução de código
// vinda de texto que outra pessoa do time escreveu.
const PROTO_OK = /^https?:\/\//i;

function fotoValida(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!PROTO_OK.test(u)) return null;
  return u.slice(0, 500);
}

function perfilLimpo(patch = {}, base = {}) {
  const p = {
    id: base.id || null,
    description: base.description || '',
    photo: base.photo || null,
    rules: base.rules || '',
    rulesUpdatedAt: base.rulesUpdatedAt || null,
    rulesBy: base.rulesBy || null,
    createdAt: base.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  if (patch.description !== undefined && patch.description !== null) {
    p.description = String(patch.description).slice(0, 600);
  }
  if (patch.photo !== undefined) p.photo = fotoValida(patch.photo);
  if (patch.rules !== undefined && patch.rules !== null) {
    const novo = String(patch.rules).slice(0, 20000);
    // Só carimba quem/quando se o texto MUDOU. Abrir a aba, não
    // mexer em nada e salvar não pode fazer parecer que alguém
    // reescreveu as regras hoje.
    if (novo !== p.rules) {
      p.rules = novo;
      p.rulesUpdatedAt = Date.now();
      p.rulesBy = (me() || {}).name || null;
    }
  }
  return p;
}

function getProfile(groupId) {
  const g = state.groups[groupId] || null;
  const p = state.profiles[groupId] || null;
  return {
    id: groupId,
    description: (p && p.description) || '',
    photo: (p && p.photo) || (g && g.photo) || null,
    rules: (p && p.rules) || '',
    rulesUpdatedAt: (p && p.rulesUpdatedAt) || null,
    rulesBy: (p && p.rulesBy) || null,
    updatedAt: (p && p.updatedAt) || null
  };
}

// `acao` diz QUAL permissão exigir: mexer na descrição/foto é
// `profile.edit`; reescrever as regras é `rules.write`. São botões
// diferentes na tela e podem divergir depois.
function setProfile(groupId, patch = {}, { papelRemoto = null } = {}) {
  const acao = (patch.rules !== undefined && patch.description === undefined && patch.photo === undefined)
    ? 'rules.write' : 'profile.edit';
  const perm = podeAqui(groupId, acao, { papelRemoto });
  if (!perm.ok) return perm;

  const base = state.profiles[groupId] || { id: groupId };
  const novo = perfilLimpo(patch, base);
  // Foto recusada não pode sair em silêncio: a pessoa colou um link
  // e ficaria olhando para o avatar antigo sem entender.
  const pediuFoto = patch.photo !== undefined && String(patch.photo || '').trim() !== '';
  if (pediuFoto && !novo.photo) return { ok: false, reason: 'bad_photo' };

  state.profiles[groupId] = novo;
  const g = state.groups[groupId];
  if (g && novo.photo !== undefined) { g.photo = novo.photo; g.updatedAt = Date.now(); }
  enqueue('group.profile', { groupId, patch: novo });
  write();
  return { ok: true, profile: getProfile(groupId) };
}

// ------------------------------------------------------------
// Conteúdo compartilhado
// ------------------------------------------------------------
// Um tipo só para tudo (marcador, nota, print, comentário) porque
// as regras de permissão, edição e sincronização são idênticas.
// `data` é livre por tipo; `parentId` é o que liga um comentário
// ao item comentado.
function createItem(groupId, { kind, data, parentId = null, papelRemoto = null } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, reason: 'bad_kind' };
  // Notícia do time é escrita só por dono/admin; o resto do
  // conteúdo segue a regra normal de criação. A checagem tem que
  // ser aqui e não só na tela: esconder o botão evita o engano,
  // não a chamada.
  const tipo = (data && data.type) || null;
  const acao = kind === 'comment' ? 'comment.create'
    : (tipo === 'news' ? 'news.write' : 'item.create');
  const perm = podeAqui(groupId, acao, { papelRemoto });
  if (!perm.ok) return perm;
  if (parentId && !state.items[parentId]) return { ok: false, reason: 'no_parent' };

  const eu = me();
  const it = {
    id: novoId('it'),
    groupId,
    kind,
    parentId,
    // De QUAL servidor é este item. Um marcador em X 320 / Z -140 só
    // quer dizer alguma coisa dentro do mapa onde foi tirado; sem
    // este campo, dois servidores do mesmo time misturavam
    // coordenadas que não têm nada a ver uma com a outra.
    //
    // Comentário herda o servidor do pai — senão a conversa de um
    // item sumiria ao filtrar, e um comentário órfão é pior que
    // comentário nenhum.
    serverBmId: parentId
      ? ((state.items[parentId] && state.items[parentId].serverBmId) || null)
      : ((data && data.serverBmId) || null),
    authorId: eu.userId,
    authorName: eu.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    data: data || {}
  };
  state.items[it.id] = it;
  enqueue('item.create', it);
  write();
  return { ok: true, item: it };
}

function updateItem(itemId, patch = {}, { papelRemoto = null } = {}) {
  const it = state.items[itemId];
  if (!it || it.deleted) return { ok: false, reason: 'no_item' };
  const perm = podeAqui(it.groupId, 'item.edit', { papelRemoto, alvo: it });
  if (!perm.ok) return perm;
  it.data = { ...it.data, ...(patch.data || {}) };
  it.updatedAt = Date.now();
  it.editedBy = me().userId;
  enqueue('item.update', { itemId, patch: { data: patch.data || {} } });
  write();
  return { ok: true, item: it };
}

// Apagar é MARCAR como apagado, não sumir com o registro. Num
// sistema com várias cópias, remover de vez faz o item voltar
// quando outra pessoa sincroniza uma versão antiga.
function deleteItem(itemId, { papelRemoto = null } = {}) {
  const it = state.items[itemId];
  if (!it) return { ok: false, reason: 'no_item' };
  const perm = podeAqui(it.groupId, 'item.delete', { papelRemoto, alvo: it });
  if (!perm.ok) return perm;
  it.deleted = true;
  it.updatedAt = Date.now();
  it.deletedBy = me().userId;
  enqueue('item.delete', { itemId });
  // Comentários acompanham o item comentado.
  for (const c of Object.values(state.items)) {
    if (c.parentId === itemId && !c.deleted) { c.deleted = true; c.updatedAt = Date.now(); }
  }
  write();
  return { ok: true };
}

// `serverBmId` filtra por SERVIDOR.
//
// A Sara: "se um jogador está jogando em dois servidores que são do
// mesmo time, ele consegue entrar no do servidor um e tem todas as
// informações lá, no do servidor dois e tem todas as informações
// lá". Ou seja, o que foi marcado no servidor 1 não pode aparecer
// misturado com o do servidor 2 — são mapas diferentes, e uma
// coordenada de um não quer dizer nada no outro.
//
// Três modos, de propósito:
//   undefined -> tudo do grupo (é o que a área do time usa para
//                mostrar os dois servidores lado a lado)
//   'x'       -> só o do servidor x, MAIS os itens antigos que não
//                têm servidor nenhum
//   null      -> só os sem servidor
//
// Os itens antigos entram junto porque foram criados antes de o
// vínculo existir. Escondê-los seria apagar da vista o que a pessoa
// já tinha compartilhado — perda de dado, na prática.
function listItems(groupId, { kind = null, parentId = undefined, serverBmId } = {}) {
  return Object.values(state.items)
    .filter((it) => it.groupId === groupId && !it.deleted)
    .filter((it) => (kind ? it.kind === kind : true))
    .filter((it) => (parentId === undefined ? true : it.parentId === parentId))
    .filter((it) => {
      if (serverBmId === undefined) return true;
      // Comentário segue o pai: filtrar comentário por servidor
      // esconderia a conversa de um item que está visível.
      if (it.kind === 'comment') return true;
      const dele = it.serverBmId || null;
      if (serverBmId === null) return dele === null;
      return dele === serverBmId || dele === null;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ------------------------------------------------------------
// LIGAÇÃO ENTRE ITENS — a mesa de investigação
// ------------------------------------------------------------
// "uma aba customizada para ver todas as notas em algo como se
// fosse uma mesa de investigação com ligação para cada."
//
// A ligação é SIMÉTRICA e gravada nos DOIS itens. Poderia ser uma
// aresta só, guardada de um lado, e a tela procuraria dos dois —
// mas aí "A é aliado de B" e "B é aliado de A" viram dois fatos
// que podem discordar. Discordaram uma vez e o cartão some da mesa
// de um jeito impossível de explicar. Gravando dos dois lados, a
// consulta é local ao item e nunca há metade de uma relação.
//
// `rel` diz o QUE liga: aliado, time, inimigo ou só relacionado.
// Não é enfeite — é o que a lista de jogadores usa para escolher a
// cor da linha entre dois nomes.
const RELS = ['ally', 'team', 'enemy', 'related'];

function relLimpa(rel) {
  return RELS.includes(rel) ? rel : 'related';
}

function ligacoesDe(it) {
  return Array.isArray(it.data && it.data.links) ? it.data.links : [];
}

function linkItems(aId, bId, rel = 'related', { papelRemoto = null } = {}) {
  if (aId === bId) return { ok: false, reason: 'same_item' };
  const a = state.items[aId], b = state.items[bId];
  if (!a || !b || a.deleted || b.deleted) return { ok: false, reason: 'no_item' };
  if (a.groupId !== b.groupId) return { ok: false, reason: 'other_group' };
  const perm = podeAqui(a.groupId, 'item.edit', { papelRemoto, alvo: a });
  if (!perm.ok) return perm;

  const r = relLimpa(rel);
  for (const [x, y] of [[a, b], [b, a]]) {
    const lista = ligacoesDe(x).filter((l) => l.to !== y.id);
    lista.push({ to: y.id, rel: r });
    x.data = { ...x.data, links: lista };
    x.updatedAt = Date.now();
  }
  enqueue('item.link', { aId, bId, rel: r });
  write();
  return { ok: true, rel: r };
}

function unlinkItems(aId, bId, { papelRemoto = null } = {}) {
  const a = state.items[aId], b = state.items[bId];
  if (!a || !b) return { ok: false, reason: 'no_item' };
  const perm = podeAqui(a.groupId, 'item.edit', { papelRemoto, alvo: a });
  if (!perm.ok) return perm;
  for (const [x, y] of [[a, b], [b, a]]) {
    x.data = { ...x.data, links: ligacoesDe(x).filter((l) => l.to !== y.id) };
    x.updatedAt = Date.now();
  }
  enqueue('item.unlink', { aId, bId });
  write();
  return { ok: true };
}

// Arestas do grupo inteiro, já sem repetição (A-B e B-A viram uma
// linha só) e sem ponta solta (item apagado do outro lado).
function itemLinks(groupId) {
  const vivos = new Set(Object.values(state.items)
    .filter((it) => it.groupId === groupId && !it.deleted).map((it) => it.id));
  const vistas = new Set();
  const out = [];
  for (const id of vivos) {
    for (const l of ligacoesDe(state.items[id])) {
      if (!vivos.has(l.to)) continue;
      const chave = [id, l.to].sort().join('|');
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      out.push({ a: id, b: l.to, rel: relLimpa(l.rel) });
    }
  }
  return out;
}

// ------------------------------------------------------------
// SERVIDORES VINCULADOS A UM GRUPO
// ------------------------------------------------------------
// Antes o grupo pairava sobre tudo: o que você compartilhava valia
// para o app inteiro, sem dizer de qual servidor era. A Sara pediu o
// contrário — "o time não pode atuar em todos os servidores, cada
// servidor tem que ser linkado a um time" — e é o que faz sentido:
// marcador é coordenada, e coordenada só quer dizer algo dentro do
// mapa onde foi tirada.
//
// O vínculo é do GRUPO, não do servidor: o mesmo servidor pode estar
// em mais de um grupo (você joga no mesmo servidor com dois times
// diferentes) sem que um veja o do outro.
// `papelRemoto` existe para o time que vive no SERVIDOR.
//
// Com conta ligada o grupo não está em `state.groups` — ele é do
// servidor —, mas o vínculo continua sendo salvo aqui no disco (a
// API só cuida de conta, conexão, arquivo temporário e voz). Sem
// este parâmetro, `linkServer` respondia `no_group` para todo time
// ao vivo, e vincular simplesmente não funcionava com conta.
//
// A checagem de papel continua, usando a MESMA tabela de ranks. E
// vale dizer o que ela é: uma regra de CORREÇÃO, não uma barreira
// de segurança — o arquivo é da própria pessoa e ela pode editar à
// mão. A barreira de verdade é o servidor, quando `team_servers`
// existir lá.
function linkServer(groupId, servidor = {}, { papelRemoto = null } = {}) {
  const g = state.groups[groupId];
  if (g) {
    if (!can(groupId, 'server.link')) return { ok: false, reason: 'forbidden' };
  } else if (papelRemoto) {
    if (Roles.rank(papelRemoto) < Roles.rank('admin')) return { ok: false, reason: 'forbidden' };
  } else {
    return { ok: false, reason: 'no_group' };
  }
  const bmId = String(servidor.bmId || '').trim();
  if (!bmId) return { ok: false, reason: 'bad_server' };

  const chave = `${groupId}:${bmId}`;
  if (state.links[chave]) return { ok: true, link: state.links[chave], already: true };

  const eu = me();
  const link = {
    groupId, bmId,
    name: servidor.name || bmId,
    ip: servidor.ip || null,
    port: servidor.port || null,
    map: servidor.map || null,
    addedAt: Date.now(),
    addedBy: eu ? eu.userId : null,
    addedByName: eu ? eu.name : null
  };
  state.links[chave] = link;
  enqueue('server.link', link);
  write();
  return { ok: true, link };
}

function unlinkServer(groupId, bmId, { papelRemoto = null } = {}) {
  if (state.groups[groupId]) {
    if (!can(groupId, 'server.unlink')) return { ok: false, reason: 'forbidden' };
  } else if (papelRemoto) {
    if (Roles.rank(papelRemoto) < Roles.rank('admin')) return { ok: false, reason: 'forbidden' };
  } else {
    return { ok: false, reason: 'no_group' };
  }
  const chave = `${groupId}:${bmId}`;
  if (!state.links[chave]) return { ok: false, reason: 'no_link' };
  delete state.links[chave];
  enqueue('server.unlink', { groupId, bmId });
  write();
  // O que foi compartilhado NÃO é apagado junto. Desvincular é
  // desfazer uma organização, não jogar fora o conteúdo — e um
  // clique que apaga marcador de todo mundo sem avisar seria uma
  // armadilha. Os itens ficam, sem servidor.
  return { ok: true };
}

function listServers(groupId) {
  return Object.values(state.links)
    .filter((l) => l.groupId === groupId)
    .sort((a, b) => a.addedAt - b.addedAt);
}

// Todos os grupos aos quais ESTE servidor está vinculado. É o que a
// tela do servidor usa para mostrar "este servidor é do time NCE".
function groupsForServer(bmId) {
  return Object.values(state.links)
    .filter((l) => l.bmId === String(bmId))
    .map((l) => {
      const g = state.groups[l.groupId];
      if (!g) return null;
      return {
        id: g.id,
        name: g.name,
        members: (g.members || []).length,
        myRole: myRole(g.id),
        linkedAt: l.addedAt
      };
    })
    .filter(Boolean);
}

function countComments(itemId) {
  return Object.values(state.items)
    .filter((c) => c.parentId === itemId && c.kind === 'comment' && !c.deleted).length;
}

// ------------------------------------------------------------
// Posição dos membros no mapa
// ------------------------------------------------------------
// IMPORTANTE, e não dá para maquiar: num servidor comum o app NÃO
// tem como descobrir sozinho onde o jogador está. O Client.log do
// Unturned não traz coordenada, e ler a memória do jogo é o que o
// BattlEye trata como cheat externo.
//
// Então a fonte padrão é MANUAL: a pessoa marca onde está. O campo
// `source` existe para o dia em que houver fonte automática (um
// plugin no servidor, por exemplo) — aí só muda quem chama isto.
function setPosition(groupId, { x, z, map = null, source = 'manual', serverBmId = null } = {}) {
  const eu = me();
  if (!eu || !state.groups[groupId]) return { ok: false, reason: 'no_group' };
  const pos = {
    groupId, userId: eu.userId, name: eu.name,
    x: Math.round(x), z: Math.round(z), map,
    // Mesma razão do item: "estou aqui" num servidor não é uma
    // posição válida em outro. A chave continua sendo só
    // grupo+usuário — você está num lugar de cada vez, então marcar
    // no servidor 2 substitui o que estava no 1, e é isso mesmo que
    // deve acontecer.
    serverBmId: serverBmId || null,
    source, at: Date.now()
  };
  state.positions[`${groupId}:${eu.userId}`] = pos;
  enqueue('position.set', pos);
  write();
  return { ok: true, position: pos };
}

function clearPosition(groupId) {
  const eu = me();
  if (!eu) return { ok: false };
  delete state.positions[`${groupId}:${eu.userId}`];
  enqueue('position.clear', { groupId, userId: eu.userId });
  write();
  return { ok: true };
}

// `maxAgeMs`: posição velha é pior que nenhuma — mandar o grupo
// para onde alguém estava há duas horas custa caro no jogo.
function listPositions(groupId, { maxAgeMs = 15 * 60 * 1000, serverBmId } = {}) {
  const agora = Date.now();
  return Object.values(state.positions)
    .filter((p) => p.groupId === groupId)
    .filter((p) => {
      if (serverBmId === undefined) return true;
      const dele = p.serverBmId || null;
      if (serverBmId === null) return dele === null;
      return dele === serverBmId || dele === null;
    })
    .map((p) => ({ ...p, stale: agora - p.at > maxAgeMs, ageMs: agora - p.at }));
}

// ------------------------------------------------------------
// Transferência de posse
// ------------------------------------------------------------
// Existe porque grupo sem dono ativo trava: ninguém dissolve,
// ninguém promove admin. O dono antigo vira admin — tirar todo o
// poder de quem acabou de entregar as chaves seria hostil.
function transferOwnership(groupId, novoDonoId) {
  const g = state.groups[groupId];
  const eu = me();
  if (!g || !eu) return { ok: false, reason: 'no_group' };
  if (g.ownerId !== eu.userId) return { ok: false, reason: 'only_owner' };
  const alvo = g.members.find((m) => m.userId === novoDonoId);
  if (!alvo) return { ok: false, reason: 'no_member' };

  const antigo = g.members.find((m) => m.userId === g.ownerId);
  if (antigo) antigo.role = 'admin';
  alvo.role = 'owner';
  g.ownerId = novoDonoId;
  g.updatedAt = Date.now();
  enqueue('group.transfer', { groupId, from: eu.userId, to: novoDonoId });
  write();
  return { ok: true, group: g };
}

// ------------------------------------------------------------
// Convites com senha
// ------------------------------------------------------------
function createInvite(groupId, opts = {}) {
  if (!state.groups[groupId]) return { ok: false, reason: 'no_group' };
  if (!can(groupId, 'member.invite')) return { ok: false, reason: 'forbidden' };
  // Não dá para convidar para um papel acima do seu.
  const papel = opts.role || 'member';
  if (!assignableRoles(groupId).includes(papel)) return { ok: false, reason: 'above_you' };

  const eu = me();
  const { invite, plainPassword } = Invites.createInvite({ ...opts, role: papel, createdBy: eu.userId });
  invite.groupId = groupId;
  state.invites[invite.id] = invite;
  // A operação leva o HASH, nunca a senha. A senha sai daqui uma
  // vez só, para a tela mostrar, e depois não existe mais.
  enqueue('invite.create', { groupId, invite });
  write();
  return { ok: true, invite: Invites.publicInvite(invite), password: plainPassword };
}

function listInvites(groupId) {
  if (!can(groupId, 'invite.manage')) return [];
  return Object.values(state.invites)
    .filter((i) => i.groupId === groupId)
    .map(Invites.publicInvite)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function revokeInvite(inviteId) {
  const inv = state.invites[inviteId];
  if (!inv) return { ok: false, reason: 'no_invite' };
  if (!can(inv.groupId, 'invite.manage')) return { ok: false, reason: 'forbidden' };
  inv.revoked = true;
  enqueue('invite.revoke', { inviteId, groupId: inv.groupId });
  write();
  return { ok: true };
}

// Entrar exige CÓDIGO + SENHA. Local isto só funciona para convite
// que já está nesta máquina (útil no teste e quando o grupo veio
// por backup); com servidor, ele é quem procura o convite pelo
// código e confere a senha.
function joinWithInvite({ code, password }) {
  const eu = ensureIdentity();
  const inv = Object.values(state.invites)
    .find((i) => i.code === String(code || '').trim().toUpperCase());
  if (!inv) return { ok: false, reason: 'bad_code' };

  const banido = state.bans[`${inv.groupId}:${eu.userId}`];
  if (banido) return { ok: false, reason: 'banned' };

  const check = Invites.checkInvite(inv, { code, password });
  if (!check.ok) return check;

  // O convite é válido mas a cópia local do grupo não existe aqui.
  // Isso é o caso normal enquanto não há servidor: o grupo mora no
  // app de quem convidou, e nada traz ele até esta máquina. Dizer
  // "grupo não encontrado" faz a pessoa achar que digitou errado —
  // o problema não é o código, é que falta o servidor.
  const g = state.groups[inv.groupId];
  if (!g) return { ok: false, reason: 'needs_server' };
  if (g.members.some((m) => m.userId === eu.userId)) return { ok: false, reason: 'already_member' };

  const membro = {
    userId: eu.userId, name: eu.name, avatar: eu.avatar, steamId: eu.steamId,
    role: check.role, joinedAt: Date.now(), lastSeen: Date.now(), viaInvite: inv.id
  };
  g.members.push(membro);
  Invites.useInvite(inv);
  enqueue('member.join', { groupId: g.id, member: membro, inviteId: inv.id });
  write();
  return { ok: true, group: g, role: check.role };
}

// Banir remove E impede de voltar pelo mesmo convite. Sem isso,
// expulsar alguém que ainda tem o código e a senha não resolve nada.
function banMember(groupId, userId, reason = null) {
  const g = state.groups[groupId];
  if (!g) return { ok: false, reason: 'no_group' };
  if (userId === g.ownerId) return { ok: false, reason: 'owner_locked' };
  if (!can(groupId, 'member.ban', { userId })) return { ok: false, reason: 'forbidden' };
  g.members = g.members.filter((m) => m.userId !== userId);
  state.bans[`${groupId}:${userId}`] = { at: Date.now(), by: me().userId, reason };
  enqueue('member.ban', { groupId, userId, reason });
  write();
  return { ok: true };
}

function listBans(groupId) {
  return Object.entries(state.bans)
    .filter(([k]) => k.startsWith(groupId + ':'))
    .map(([k, v]) => ({ userId: k.split(':')[1], ...v }));
}

// ------------------------------------------------------------
// Canais
// ------------------------------------------------------------
function listChannels(groupId) {
  return Object.values(state.channels)
    .filter((c) => c.groupId === groupId)
    .sort((a, b) => (b.system ? 1 : 0) - (a.system ? 1 : 0) || a.createdAt - b.createdAt);
}

function createChannel(groupId, data = {}) {
  if (!state.groups[groupId]) return { ok: false, reason: 'no_group' };
  if (!can(groupId, 'channel.create')) return { ok: false, reason: 'forbidden' };
  const r = Chat.createChannel(groupId, { ...data, createdBy: me().userId });
  if (!r.ok) return r;
  if (listChannels(groupId).some((c) => c.name === r.channel.name)) {
    return { ok: false, reason: 'duplicate_name' };
  }
  state.channels[r.channel.id] = r.channel;
  enqueue('channel.create', r.channel);
  write();
  return r;
}

function deleteChannel(channelId) {
  const c = state.channels[channelId];
  if (!c) return { ok: false, reason: 'no_channel' };
  if (!can(c.groupId, 'channel.delete')) return { ok: false, reason: 'forbidden' };
  if (c.system) return { ok: false, reason: 'system_channel' };
  delete state.channels[channelId];
  for (const m of Object.values(state.messages)) {
    if (m.channelId === channelId) delete state.messages[m.id];
  }
  enqueue('channel.delete', { channelId, groupId: c.groupId });
  write();
  return { ok: true };
}

// ------------------------------------------------------------
// Mensagens
// ------------------------------------------------------------
function listMessages(channelId, opts = {}) {
  const c = state.channels[channelId];
  if (!c || !can(c.groupId, 'chat.read')) return [];
  return Chat.listMessages(Object.values(state.messages), { channelId, ...opts });
}

function sendMessage(channelId, data = {}) {
  const c = state.channels[channelId];
  if (!c) return { ok: false, reason: 'no_channel' };
  if (!can(c.groupId, 'chat.send')) return { ok: false, reason: 'forbidden' };
  // Anexo é privilégio à parte: guest fala, mas não sobe arquivo.
  if ((data.media || []).length && !can(c.groupId, 'media.upload')) {
    return { ok: false, reason: 'no_upload' };
  }
  const eu = me();
  const r = Chat.createMessage(c.groupId, channelId, {
    ...data, authorId: eu.userId, authorName: eu.name
  });
  if (!r.ok) return r;
  state.messages[r.message.id] = r.message;
  enqueue('chat.send', r.message);
  write();
  return r;
}

function editMessage(messageId, text) {
  const m = state.messages[messageId];
  if (!m || m.deleted) return { ok: false, reason: 'no_message' };
  const eu = me();
  // Editar mensagem dos outros nunca — nem moderador. Moderador
  // APAGA; reescrever a fala de alguém é outra coisa.
  if (m.authorId !== eu.userId) return { ok: false, reason: 'not_yours' };
  Chat.editMessage(m, text);
  enqueue('chat.edit', { messageId, text: m.text });
  write();
  return { ok: true, message: m };
}

function deleteMessage(messageId) {
  const m = state.messages[messageId];
  if (!m || m.deleted) return { ok: false, reason: 'no_message' };
  const c = state.channels[m.channelId];
  if (!c) return { ok: false, reason: 'no_channel' };
  if (!can(c.groupId, 'chat.delete', { authorId: m.authorId })) return { ok: false, reason: 'forbidden' };
  Chat.markDeleted(m, me().userId);
  enqueue('chat.delete', { messageId });
  write();
  return { ok: true };
}

function markRead(groupId, channelId) {
  state.reads[`${groupId}:${channelId}`] = Date.now();
  write();
  return { ok: true };
}

function unreadByChannel(groupId) {
  const eu = me();
  const todas = Object.values(state.messages);
  const out = {};
  for (const c of listChannels(groupId)) {
    out[c.id] = Chat.unreadCount(todas, c.id, state.reads[`${groupId}:${c.id}`], eu ? eu.userId : null);
  }
  return out;
}

// ------------------------------------------------------------
// Aplicar o que vem do servidor
// ------------------------------------------------------------
// Conflito: vence quem tem `updatedAt` maior; empate desempata pelo
// userId (critério arbitrário, mas IGUAL em todas as máquinas — que
// é o que importa para todo mundo convergir para o mesmo estado).
function applyRemote(ops = []) {
  let aplicadas = 0;
  for (const op of ops) {
    try {
      switch (op.type) {
        case 'group.create':
        case 'group.update': {
          const g = op.payload.group || op.payload;
          const id = g.id || op.payload.groupId;
          if (!id) break;
          const atual = state.groups[id];
          if (!atual) { state.groups[id] = g; aplicadas++; break; }
          if ((g.updatedAt || 0) >= (atual.updatedAt || 0)) {
            state.groups[id] = { ...atual, ...g };
            aplicadas++;
          }
          break;
        }
        case 'group.delete':
          delete state.groups[op.payload.groupId]; aplicadas++; break;

        case 'member.add': {
          const g = state.groups[op.payload.groupId];
          if (g && !g.members.some((m) => m.userId === op.payload.member.userId)) {
            g.members.push(op.payload.member); aplicadas++;
          }
          break;
        }
        case 'member.role': {
          const g = state.groups[op.payload.groupId];
          const m = g && g.members.find((x) => x.userId === op.payload.userId);
          if (m) { m.role = op.payload.role; aplicadas++; }
          break;
        }
        case 'member.remove':
        case 'member.leave': {
          const g = state.groups[op.payload.groupId];
          if (g) { g.members = g.members.filter((m) => m.userId !== op.payload.userId); aplicadas++; }
          break;
        }

        case 'item.create': {
          const it = op.payload;
          if (!state.items[it.id]) { state.items[it.id] = it; aplicadas++; }
          break;
        }
        case 'item.update': {
          const it = state.items[op.payload.itemId];
          if (!it) break;
          const quando = op.at || 0;
          if (quando > (it.updatedAt || 0) ||
              (quando === it.updatedAt && String(op.authorId) > String(it.editedBy || ''))) {
            it.data = { ...it.data, ...(op.payload.patch.data || {}) };
            it.updatedAt = quando;
            it.editedBy = op.authorId;
            aplicadas++;
          }
          break;
        }
        case 'item.delete': {
          const it = state.items[op.payload.itemId];
          if (it && !it.deleted) { it.deleted = true; it.updatedAt = op.at || Date.now(); aplicadas++; }
          break;
        }

        case 'position.set': {
          const p = op.payload;
          const chave = `${p.groupId}:${p.userId}`;
          const atual = state.positions[chave];
          if (!atual || p.at >= atual.at) { state.positions[chave] = p; aplicadas++; }
          break;
        }
        case 'chat.send': {
          const m = op.payload;
          if (!state.messages[m.id]) { state.messages[m.id] = m; aplicadas++; }
          break;
        }
        case 'chat.edit': {
          const m = state.messages[op.payload.messageId];
          if (m && !m.deleted) { m.text = op.payload.text; m.editedAt = op.at; aplicadas++; }
          break;
        }
        case 'chat.delete': {
          const m = state.messages[op.payload.messageId];
          if (m && !m.deleted) { Chat.markDeleted(m, op.authorId); aplicadas++; }
          break;
        }
        case 'channel.create': {
          const c = op.payload;
          if (!state.channels[c.id]) { state.channels[c.id] = c; aplicadas++; }
          break;
        }
        case 'channel.delete':
          delete state.channels[op.payload.channelId]; aplicadas++; break;

        case 'member.join': {
          const g = state.groups[op.payload.groupId];
          if (g && !g.members.some((m) => m.userId === op.payload.member.userId)) {
            g.members.push(op.payload.member); aplicadas++;
          }
          break;
        }
        case 'member.ban': {
          const g = state.groups[op.payload.groupId];
          if (g) g.members = g.members.filter((m) => m.userId !== op.payload.userId);
          state.bans[`${op.payload.groupId}:${op.payload.userId}`] =
            { at: op.at, by: op.authorId, reason: op.payload.reason };
          aplicadas++;
          break;
        }
        case 'group.transfer': {
          const g = state.groups[op.payload.groupId];
          if (g) {
            const antigo = g.members.find((m) => m.userId === op.payload.from);
            const novo = g.members.find((m) => m.userId === op.payload.to);
            if (antigo) antigo.role = 'admin';
            if (novo) novo.role = 'owner';
            g.ownerId = op.payload.to;
            aplicadas++;
          }
          break;
        }
        case 'invite.create': {
          const inv = op.payload.invite;
          if (inv && !state.invites[inv.id]) { state.invites[inv.id] = inv; aplicadas++; }
          break;
        }
        case 'invite.revoke': {
          const inv = state.invites[op.payload.inviteId];
          if (inv) { inv.revoked = true; aplicadas++; }
          break;
        }

        case 'position.clear':
          delete state.positions[`${op.payload.groupId}:${op.payload.userId}`]; aplicadas++; break;

        default:
          break;   // tipo desconhecido: ignora, não derruba a sincronização
      }
    } catch {
      // Uma operação malformada não pode impedir as outras.
    }
  }
  if (aplicadas) write();
  return { applied: aplicadas, total: ops.length };
}

// ------------------------------------------------------------
// Diagnóstico e limpeza
// ------------------------------------------------------------
function stats() {
  const itens = Object.values(state.items).filter((i) => !i.deleted);
  return {
    identity: !!state.identity,
    groups: Object.keys(state.groups).length,
    items: itens.length,
    comments: itens.filter((i) => i.kind === 'comment').length,
    positions: Object.keys(state.positions).length,
    channels: Object.keys(state.channels).length,
    messages: Object.values(state.messages).filter((m) => !m.deleted).length,
    invites: Object.values(state.invites).filter((i) => !i.revoked).length,
    bans: Object.keys(state.bans).length,
    outbox: state.outbox.length
  };
}

function exportAll() { return JSON.parse(JSON.stringify(state)); }

function importAll(data, { mode = 'merge' } = {}) {
  if (!data || typeof data !== 'object') return { ok: false };
  if (mode === 'replace') { state = { ...vazio(), ...data }; write(); return { ok: true }; }
  state.groups = { ...data.groups, ...state.groups };
  state.items = { ...data.items, ...state.items };
  if (!state.identity && data.identity) state.identity = data.identity;
  write();
  return { ok: true };
}

function wipe() {
  state = vazio();
  write();
  return true;
}

// Só para teste: permite trocar a identidade e simular outro membro.
function __setIdentity(id) { state.identity = id; write(); }

module.exports = {
  init, ensureIdentity, me,
  createGroup, listGroups, getGroup, updateGroup, deleteGroup, leaveGroup,
  addMember, setRole, removeMember, memberOf, myRole, can,
  assignableRoles, capabilities, transferOwnership,
  createInvite, listInvites, revokeInvite, joinWithInvite, banMember, listBans,
  listChannels, createChannel, deleteChannel,
  listMessages, sendMessage, editMessage, deleteMessage, markRead, unreadByChannel,
  createItem, updateItem, deleteItem, listItems, countComments,
  setPosition, clearPosition, listPositions,
  linkServer, unlinkServer, listServers, groupsForServer,
  getProfile, setProfile, linkItems, unlinkItems, itemLinks,
  pendingOps, ackOps, applyRemote,
  stats, exportAll, importAll, wipe,
  gerarCodigo, ROLES, KINDS,
  __setIdentity
};
