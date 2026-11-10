// ============================================================
// teamRoles.js — Hierarquia e permissões
//
// Um arquivo separado, sem dependência de nada, por dois motivos:
// dá para testar a tabela de permissões isolada, e a MESMA tabela
// vai rodar no servidor quando ele existir. Regra de permissão
// duplicada em dois lugares diverge — é questão de tempo.
//
// ------------------------------------------------------------
// A HIERARQUIA É UM NÚMERO
// ------------------------------------------------------------
// Cada papel tem um `rank`. A regra que resolve 90% dos casos:
//
//     você só age sobre quem tem rank ESTRITAMENTE MENOR
//
// É isso que impede a guerra de admins (um admin expulsando o
// outro em looping) sem precisar de caso especial. Um admin não
// remove outro admin; só o dono remove admin.
//
//   owner      100  dono. Dissolve o grupo, transfere a posse.
//   admin       80  gerencia membros e convites, edita tudo.
//   moderator   60  modera conteúdo e chat. Não mexe em papéis.
//   member      40  cria, comenta, edita o que é seu.
//   guest       20  lê e comenta. Não cria nem entra na voz.
// ============================================================

'use strict';

const ROLES = {
  owner:     { rank: 100, key: 'owner' },
  admin:     { rank: 80,  key: 'admin' },
  moderator: { rank: 60,  key: 'moderator' },
  member:    { rank: 40,  key: 'member' },
  guest:     { rank: 20,  key: 'guest' }
};

const ROLE_KEYS = Object.keys(ROLES);

function rank(role) {
  return (ROLES[role] && ROLES[role].rank) || 0;
}

function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

// Papéis que `assigner` pode CONCEDER: qualquer um abaixo dele.
// Um admin não cria outro admin; quem faz isso é o dono.
function assignableBy(role) {
  return ROLE_KEYS.filter((r) => rank(r) < rank(role));
}

// ------------------------------------------------------------
// Tabela de capacidades
// ------------------------------------------------------------
// `rank mínimo` para cada ação. Ações sobre PESSOAS e sobre ITENS
// DE OUTROS têm regra extra, tratada em `can()`.
const CAPS = {
  // conteúdo
  'item.create':      rank('member'),
  'comment.create':   rank('guest'),
  'item.editOwn':     rank('member'),
  'item.deleteOwn':   rank('member'),
  'item.editAny':     rank('moderator'),
  'item.deleteAny':   rank('moderator'),

  // chat
  'chat.read':        rank('guest'),
  'chat.send':        rank('guest'),
  'chat.deleteOwn':   rank('guest'),
  'chat.deleteAny':   rank('moderator'),
  'chat.pin':         rank('moderator'),
  'channel.create':   rank('admin'),
  'channel.delete':   rank('admin'),

  // voz
  'voice.join':       rank('member'),
  'voice.muteOthers': rank('moderator'),
  'voice.kick':       rank('moderator'),

  // mídia
  'media.upload':     rank('member'),

  // pessoas
  'member.invite':    rank('admin'),
  'member.kick':      rank('moderator'),
  'member.setRole':   rank('admin'),
  'member.ban':       rank('admin'),

  // grupo
  'group.edit':       rank('admin'),
  'group.delete':     rank('owner'),
  'group.transfer':   rank('owner'),
  'invite.manage':    rank('admin'),

  // mapa
  'position.share':   rank('guest'),
  'marker.share':     rank('member'),

  // SERVIDORES VINCULADOS
  //
  // Vincular decide o que o grupo inteiro passa a ver e onde ele se
  // organiza — é gestão, não conteúdo. Por isso `admin`, no mesmo
  // nível de convidar gente e editar o grupo, e não `member`.
  //
  // É o que a Sara descreveu: "eu participo de outro time, que não é
  // meu. Eu posso vincular servidores, SE eu tiver a opção de
  // vincular." No time dela ela é dona e pode; em time dos outros,
  // só se lhe derem admin.
  'server.link':      rank('admin'),
  'server.unlink':    rank('admin'),

  // PERFIL, REGRAS E NOTÍCIAS DO TIME
  //
  // "aba customizadas para regras e news do time (apenas dono e adm
  // podem escrever)". Ler é de todo mundo — regra que só o admin
  // enxerga não regula ninguém —, então não existe `rules.read`: a
  // ausência de capacidade de leitura É a leitura liberada.
  //
  // `profile.edit` está separado de `group.edit` de propósito. Hoje
  // os dois valem admin e dava para reaproveitar, mas são coisas
  // diferentes: `group.edit` mexe no NOME, que é a identidade do
  // time em todo lugar; `profile.edit` mexe em descrição e foto.
  // Se um dia a Sara quiser deixar o moderador arrumar a descrição
  // sem poder renomear o time, é uma linha aqui em vez de uma
  // refatoração.
  'profile.edit':     rank('admin'),
  'rules.write':      rank('admin'),
  'news.write':       rank('admin')
};

// ------------------------------------------------------------
// can()
// ------------------------------------------------------------
// ctx:
//   actorRole   papel de quem está agindo (obrigatório)
//   actorId     id de quem está agindo
//   targetRole  papel de QUEM está sofrendo a ação (para member.*)
//   targetId    id de quem/do que sofre a ação
//   authorId    autor do item (para item.*/chat.*)
function can(action, ctx = {}) {
  const { actorRole, actorId, targetRole, targetId, authorId } = ctx;
  if (!isRole(actorRole)) return false;

  const meu = rank(actorRole);

  // --- ações sobre PESSOAS ---
  if (action === 'member.kick' || action === 'member.setRole' || action === 'member.ban') {
    if (meu < CAPS[action]) return false;
    if (!isRole(targetRole)) return false;
    // Ninguém age sobre si mesmo por aqui (sair do grupo é outra ação).
    if (actorId && targetId && actorId === targetId) return false;
    // A regra da hierarquia: só sobre quem está abaixo.
    return rank(targetRole) < meu;
  }

  // --- ações sobre CONTEÚDO ---
  if (action === 'item.edit' || action === 'item.delete') {
    const meuItem = authorId && actorId && authorId === actorId;
    if (meuItem) return meu >= CAPS[action === 'item.edit' ? 'item.editOwn' : 'item.deleteOwn'];
    return meu >= CAPS[action === 'item.edit' ? 'item.editAny' : 'item.deleteAny'];
  }
  if (action === 'chat.delete') {
    const minha = authorId && actorId && authorId === actorId;
    return meu >= CAPS[minha ? 'chat.deleteOwn' : 'chat.deleteAny'];
  }

  // --- resto: só o rank mínimo ---
  const min = CAPS[action];
  if (min === undefined) return false;   // ação desconhecida nunca é permitida
  return meu >= min;
}

// Tudo que um papel pode fazer — usado pela tela para esconder o
// que não adianta mostrar, e pelo teste para varrer a tabela.
function capabilitiesOf(role) {
  const out = {};
  for (const a of Object.keys(CAPS)) out[a] = rank(role) >= CAPS[a];
  return out;
}

module.exports = { ROLES, ROLE_KEYS, CAPS, rank, isRole, assignableBy, can, capabilitiesOf };
