// ============================================================
// dossier.js — os TIPOS de anotação, e o adaptador que faz os
// mesmos tipos funcionarem no servidor e no time
//
// O PEDIDO
//
//   "faça alguns tipos de notas.
//    notas  — texto e fotos apenas para registrar infos
//    fichas — fichas de jogadores onde podemos colocar um icon,
//             fotos e notas, além de vincular outras infos e
//             atribuir outras fichas como aliados / team
//    plan raid — atribuir fotos e usa o sistema da calculadora
//    (...) isso funciona no server e no teams."
//
// ------------------------------------------------------------
// A DECISÃO CENTRAL: UM TIPO, DOIS DONOS
// ------------------------------------------------------------
// A mesma anotação vive em dois lugares com donos diferentes:
//
//   no SERVIDOR  ela é uma nota do disco, escopo "server:<bmId>",
//                dona da própria vida, sem permissão nenhuma;
//   no TIME      ela é um item do grupo, com autor, papel, quem
//                pode apagar, e escopo por servidor vinculado.
//
// A tentação é escrever a tela duas vezes. Já tentei isso neste
// app com o painel de anotações e o resultado é sempre o mesmo:
// dois cartões que começam iguais e, três semanas depois, um tem
// um botão que o outro não tem, e ninguém lembra por quê.
//
// Aqui existe um ADAPTADOR. Ele responde cinco perguntas —
// listar, salvar, apagar, ligar, desligar — e devolve tudo no
// mesmo formato de cartão. A tela conhece só o adaptador.
//
// Consequência prática: o cartão de ficha, a mesa de investigação
// e a linha entre nomes na lista de jogadores são UM código só,
// que roda nos dois lados.
// ============================================================

const Dossier = (() => {
  'use strict';

  // ------------------------------------------------------------
  // Os tipos
  // ------------------------------------------------------------
  // `cor` não é decoração: é o que faz a mesa de investigação ser
  // legível de longe, antes de ler título nenhum.
  const TIPOS = {
    note:  { icone: 'note', cor: '#6ee06e', chave: 'notes.typeNote' },
    ficha: { icone: 'user', cor: '#8ab4ff', chave: 'notes.typeFicha' },
    raid:  { icone: 'bomb', cor: '#ff9d5c', chave: 'notes.typeRaid' },
    // `news` só existe do lado do time, e não aparece no seletor de
    // tipo: quem escreve novidade usa o botão da aba Novidades.
    // Está aqui para o cartão saber se desenhar caso apareça.
    news:  { icone: 'news', cor: '#d9b3ff', chave: 'team.tabNews' }
  };

  // Ícones que uma ficha pode usar. Poucos e de propósito: o ícone
  // serve para reconhecer a pessoa de relance na mesa, e vinte
  // opções parecidas atrapalham mais do que ajudam.
  const ICONES_FICHA = ['user', 'skull', 'crown', 'star', 'eye',
                        'target', 'gun', 'shield', 'home', 'flag'];

  // As relações. `related` é o padrão e o vazio de significado:
  // "tem a ver, ainda não sei como" é uma informação legítima numa
  // investigação.
  const RELS = {
    ally:    { cor: '#6ee06e', chave: 'notes.relAlly' },
    team:    { cor: '#8ab4ff', chave: 'notes.relTeam' },
    enemy:   { cor: '#ff6b6b', chave: 'notes.relEnemy' },
    related: { cor: '#9aa8a0', chave: 'notes.relRelated' }
  };

  function tipoDe(t) { return TIPOS[t] || TIPOS.note; }
  function relDe(r) { return RELS[r] || RELS.related; }

  // ------------------------------------------------------------
  // ADAPTADOR: anotações do disco (servidor, marcador)
  // ------------------------------------------------------------
  function local(scope) {
    return {
      tipo: 'local',
      escopo: scope,
      // Sem grupo não há papel: no disco da própria pessoa, ela
      // pode tudo. Devolver `true` fixo aqui é honesto — inventar
      // uma permissão só para parecer simétrico com o time
      // esconderia que os dois casos são diferentes de verdade.
      pode: () => true,

      async listar() {
        const notas = (await window.api.notesList(scope)) || [];
        return notas.map((n) => ({
          id: n.id,
          type: n.type || 'note',
          title: n.title || '',
          text: n.text || '',
          icon: n.icon || null,
          photo: n.photo || null,
          color: n.color || null,
          player: n.player || null,
          playerKey: n.playerKey || null,
          raid: n.raid || null,
          links: n.links || [],
          shots: n.shots || [],
          board: n.board || null,
          pinned: !!n.pinned,
          author: null,
          at: n.updatedAt || n.createdAt || 0,
          bruto: n
        }));
      },

      async salvar(cartao) {
        return window.api.noteSave({
          ...(cartao.bruto || {}),
          id: cartao.id || null,
          scope,
          type: cartao.type,
          title: cartao.title,
          text: cartao.text,
          icon: cartao.icon,
          photo: cartao.photo,
          color: cartao.color,
          player: cartao.player,
          raid: cartao.raid,
          pinned: cartao.pinned,
          shots: (cartao.shots || []).map((s) => (typeof s === 'string' ? s : s.id))
        });
      },

      apagar: (id) => window.api.noteDelete(id),
      ligar: (a, b, rel) => window.api.notesLink(a, b, rel),
      desligar: (a, b) => window.api.notesUnlink(a, b),
      moverNaMesa: (id, x, y) => window.api.notesBoardPos(id, x, y)
    };
  }

  // ------------------------------------------------------------
  // ADAPTADOR: itens de um time
  // ------------------------------------------------------------
  // `papelRemoto` acompanha toda escrita porque o time pode ser do
  // servidor: nesse caso o grupo não existe no store local e a
  // checagem de papel precisa vir daqui. Ver `podeAqui` no
  // teamStore.js — foi o que fazia criar nota em time ao vivo
  // responder `no_group` sem nada aparecer na tela.
  function time(groupId) {
    const ops = () => ({ papelRemoto: (typeof papelRemoto === 'function') ? papelRemoto() : null });

    return {
      tipo: 'time',
      groupId,
      pode: (acao) => !!(Team.caps && Team.caps[acao]),

      async listar() {
        const itens = (Team.items || []).filter((it) =>
          it.kind === 'note' && it.data && it.data.type !== 'news');
        return itens.map((it) => ({
          id: it.id,
          type: (it.data && it.data.type) || 'note',
          title: (it.data && (it.data.title || it.data.name)) || '',
          text: (it.data && it.data.text) || '',
          icon: (it.data && it.data.icon) || null,
          photo: (it.data && it.data.photo) || null,
          color: (it.data && it.data.color) || null,
          player: (it.data && it.data.player) || null,
          playerKey: (it.data && it.data.playerKey) || null,
          raid: (it.data && it.data.raid) || null,
          links: (it.data && it.data.links) || [],
          // Prints não atravessam computadores enquanto o servidor
          // de mídia não estiver no ar. O cartão mostra QUANTOS
          // ficaram para trás em vez de fingir uma imagem quebrada
          // — ver `shotCount` em shareNoteWithTeam.
          shots: [],
          shotCount: (it.data && it.data.shotCount) || 0,
          board: (it.data && it.data.board) || null,
          pinned: false,
          author: it.authorName || '',
          authorId: it.authorId,
          at: it.updatedAt || it.createdAt || 0,
          bruto: it
        }));
      },

      async salvar(cartao) {
        const data = {
          type: cartao.type,
          title: cartao.title,
          text: cartao.text,
          icon: cartao.icon,
          photo: cartao.photo,
          color: cartao.color,
          player: cartao.player,
          playerKey: cartao.player && typeof chaveDeNome === 'function'
            ? chaveDeNome(cartao.player) : null,
          raid: cartao.raid,
          shotCount: cartao.shotCount || 0,
          serverBmId: cartao.serverBmId !== undefined
            ? cartao.serverBmId
            : (typeof escopoDaConsulta === 'function' ? (escopoDaConsulta() || null) : null)
        };
        if (cartao.id) {
          return window.api.teamUpdateItem(cartao.id, { data }, ops());
        }
        return window.api.teamCreateItem(groupId, {
          kind: 'note', data, papelRemoto: ops().papelRemoto
        });
      },

      apagar: (id) => window.api.teamDeleteItem(id, ops()),
      ligar: (a, b, rel) => window.api.teamLinkItems(a, b, rel, ops()),
      desligar: (a, b) => window.api.teamUnlinkItems(a, b, ops()),
      moverNaMesa: async (id, x, y) => {
        const it = (Team.items || []).find((z) => z.id === id);
        const data = { ...(it ? it.data : {}), board: { x: Math.round(x), y: Math.round(y) } };
        return window.api.teamUpdateItem(id, { data }, ops());
      }
    };
  }

  // ------------------------------------------------------------
  // As arestas de uma lista de cartões
  // ------------------------------------------------------------
  // Sem repetição (A-B e B-A viram uma linha só) e sem ponta solta
  // (o outro lado pode ter sido apagado). É a mesma conta que o
  // store faz; ela existe também aqui porque a mesa desenha a
  // partir do que está NA TELA — se o filtro esconder um cartão, a
  // linha até ele não pode continuar sendo desenhada para o vazio.
  function arestas(cartoes) {
    const vivos = new Map(cartoes.map((c) => [c.id, c]));
    const vistas = new Set();
    const out = [];
    for (const c of cartoes) {
      for (const l of (c.links || [])) {
        if (!vivos.has(l.to)) continue;
        const chave = [c.id, l.to].sort().join('|');
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        out.push({ a: c.id, b: l.to, rel: l.rel || 'related' });
      }
    }
    return out;
  }

  // Relação entre dois cartões, se houver. É o que a lista de
  // jogadores pergunta para decidir a cor da linha entre dois nomes.
  function relacaoEntre(cartaoA, idB) {
    const l = (cartaoA.links || []).find((x) => x.to === idB);
    return l ? (l.rel || 'related') : null;
  }

  // ------------------------------------------------------------
  // Resumo curto de um plano de raid
  // ------------------------------------------------------------
  // Uma linha, para caber no cartão e na mesa. O plano inteiro fica
  // no corpo da anotação; aqui só o que responde "quanto custa?".
  function resumoRaid(raid) {
    if (!raid) return '';
    const compras = (raid.buys || [])
      .map((c) => `${c.name} ×${c.units}`)
      .join(', ');
    return compras || (raid.note || '');
  }

  // ------------------------------------------------------------
  // ADAPTADOR: as NOVIDADES de um time
  // ------------------------------------------------------------
  // É o adaptador do time com duas amarras: só enxerga `news` e só
  // grava `news`. Existe para a novidade ser escrita no MESMO editor
  // das anotações — título e texto na mesma tela, com o mesmo
  // Ctrl+V de print — em vez de duas caixinhas de pergunta em
  // sequência, que era o que estava aqui e obrigava a pessoa a
  // decidir o título antes de ter escrito o texto.
  function novidades(groupId) {
    const base = time(groupId);
    return {
      ...base,
      tipoFixo: 'news',
      async listar() {
        return (Team.items || [])
          .filter((it) => it.kind === 'note' && it.data && it.data.type === 'news')
          .map((it) => ({
            id: it.id, type: 'news',
            title: (it.data && it.data.title) || '',
            text: (it.data && it.data.text) || '',
            icon: null, color: null, player: null, raid: null,
            links: [], shots: [], board: null, pinned: false,
            author: it.authorName || '', authorId: it.authorId,
            at: it.updatedAt || it.createdAt || 0, bruto: it
          }));
      },
      salvar(cartao) {
        // A novidade é do TIME, não de um servidor: ela vale nos dois
        // servidores vinculados. `serverBmId: null` é o que impede o
        // filtro de escopo de escondê-la — o oposto do que vale para
        // um marcador.
        return base.salvar({ ...cartao, type: 'news', serverBmId: null });
      }
    };
  }

  return { TIPOS, RELS, ICONES_FICHA, tipoDe, relDe, local, time, novidades,
           arestas, relacaoEntre, resumoRaid };
})();

// A normalização do nome do jogador, do lado da tela.
//
// Precisa ser IGUAL à de fichasStore.js (que o notesStore importa),
// senão a ficha gravada com uma chave é procurada com outra e o
// dossiê "não aparece" para quem está olhando a lista de jogadores
// — sem erro nenhum, que é o pior jeito de quebrar.
function chaveDeNome(nome) {
  return String(nome || '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
