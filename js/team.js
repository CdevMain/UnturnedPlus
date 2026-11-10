// ============================================================
// team.js — Grupos na interface
//
// Duas coisas guiam esta tela:
//
// 1. **Sozinho continua funcionando igual.** Grupo é uma camada.
//    Quem não criar grupo vê a aba com um convite e nada muda no
//    resto do app. Os marcadores do grupo aparecem no mapa como
//    uma CAMADA separada, que dá para desligar.
//
// 2. **A rede está desligada.** Não existe servidor ainda. A tela
//    diz isso na cara, com todas as letras, em vez de fingir que
//    está "conectando". O botão de demonstração mostra como vai
//    ficar, usando o loopback do syncClient.
// ============================================================

const Team = {
  groups: [],
  currentId: null,
  items: [],
  positions: [],
  me: null,
  status: { enabled: false },
  showOnMap: true,
  openComments: new Set(),
  tab: 'chat',
  channels: [],
  channelId: null,
  messages: [],
  unread: {},
  invites: [],
  bans: [],
  profile: null,      // descrição, foto e regras (ver teamProfile.js)
  servers: [],
  attach: [],          // mídia anexada à mensagem em digitação
  caps: {},
  assignable: [],
  // ---- Time AO VIVO ----
  // Com conta ligada, os dados vêm do servidor em vez do disco. Em
  // vez de duplicar as funções de desenho, a resposta do servidor é
  // ADAPTADA para o mesmo formato do time local — assim uma única
  // tela serve aos dois modos, e corrigir um bug de layout corrige
  // nos dois.
  live: false,
  liveTeamId: null
};

// Espelho da tabela de papéis do servidor (src/services/teams.js).
// Precisa existir aqui porque a tela decide o que MOSTRAR antes de
// perguntar; o servidor continua sendo quem decide o que PERMITE —
// esta tabela nunca é a única barreira.
const LIVE_RANK = { owner: 5, admin: 4, moderator: 3, member: 2, guest: 1 };
const LIVE_MIN = {
  'group.edit': 4, 'group.transfer': 5, 'member.setRole': 4, 'member.kick': 3,
  'member.ban': 4, 'member.invite': 3, 'position.share': 2, 'chat.deleteAny': 3,
  // ISTO FALTAVA e dava um erro cruel: com conta ligada, a DONA do
  // time via "só quem é admin deste time pode vincular". A tabela
  // acima é consultada como `Team.caps['server.link']`; a chave não
  // existia, o valor vinha `undefined`, e `undefined` esconde o
  // botão exatamente como `false` esconderia.
  //
  // Faltar uma linha aqui não quebra nada visível na hora — só tira
  // um poder de quem tem esse poder, e em silêncio. Toda capacidade
  // usada pela tela precisa existir NAS DUAS tabelas (esta, do modo
  // ao vivo, e a de teamRoles.js, do modo local).
  'server.link': 4, 'server.unlink': 4,
  'item.create': 2, 'item.deleteOwn': 2, 'item.deleteAny': 3,
  'comment.create': 1, 'marker.share': 2,
  // Mesma lição do `server.link` acima: capacidade nova precisa
  // entrar NAS DUAS tabelas. Faltando aqui, quem tem conta ligada
  // perde o poder em silêncio — o botão simplesmente não nasce.
  'item.editOwn': 2, 'item.editAny': 3, 'item.edit': 2,
  'profile.edit': 4, 'rules.write': 4, 'news.write': 4
};

function capsDoPapel(role) {
  const meu = LIVE_RANK[role] || 0;
  const out = {};
  for (const [acao, min] of Object.entries(LIVE_MIN)) out[acao] = meu >= min;
  return out;
}

// Traduz o estado do servidor para o formato que a tela já sabe
// desenhar. É o coração do modo ao vivo: um lugar só onde os dois
// vocabulários se encontram (`userId`/`id`, `at`/`createdAt`,
// `text`/`content`).
function adaptarLive(st) {
  Team.live = true;
  // `userId` vai como TEXTO, sempre.
  //
  // O servidor manda id numérico, e os membros logo abaixo são
  // mapeados com `String(m.id)`. Guardando o meu como número, todo
  // `m.userId === Team.me.userId` comparava `"1" === 1` e dava
  // false: eu nunca era reconhecida na minha própria lista.
  //
  // O sintoma era discreto — a etiqueta "você" sumida, a minha foto
  // da Steam não aplicada na minha linha —, mas o efeito real é
  // pior: `souEu` é justamente o que impede os botões de EXPULSAR e
  // de TROCAR PAPEL de aparecerem na sua própria linha.
  Team.me = {
    userId: st.me && st.me.id != null ? String(st.me.id) : null,
    name: st.me ? (st.me.displayName || st.me.username) : ''
  };

  const meuPapel = st.team ? (st.team.myRole || 'member') : null;
  Team.caps = meuPapel ? capsDoPapel(meuPapel) : {};
  // Só ofereço papéis ABAIXO do meu: conceder o próprio nível ou
  // acima é o que o servidor recusa de qualquer forma.
  const meu = LIVE_RANK[meuPapel] || 0;
  Team.assignable = Object.keys(LIVE_RANK).filter((r) => LIVE_RANK[r] < meu && r !== 'owner');

  Team.groups = (st.teams || []).map((t) => ({
    id: String(t.id), name: t.name, myRole: t.myRole,
    ownerId: null, members: [], remote: true
  }));

  if (st.team) {
    Team.currentId = String(st.team.id);
    Team.liveTeamId = st.team.id;
    const g = Team.groups.find((x) => x.id === String(st.team.id));
    if (g) {
      g.ownerId = st.team.ownerId != null ? String(st.team.ownerId) : null;
      g.myRole = st.team.myRole;
      g.members = (st.members || []).map((m) => ({
        userId: String(m.id),
        name: m.displayName || m.username,
        role: m.role,
        joinedAt: 0,
        online: !!m.online,
        lastSeen: m.lastSeen || null,
        avatarUrl: m.avatarUrl || null,
        // O servidor JÁ mandava o steamId (ver teamLive.js) e este
        // mapeamento o jogava fora. Sem ele não dá para casar o
        // membro com a Steam, que é de onde vêm a foto e o apelido
        // pelos quais essas pessoas se reconhecem.
        steamId: m.steamId != null ? String(m.steamId) : null
      }));
    }
  } else {
    Team.currentId = Team.groups.length ? Team.groups[0].id : null;
    Team.liveTeamId = null;
  }

  // Posição no mapa. O servidor manda `at` em milissegundos e nada
  // mais; `stale` e `ageMs` são conta daqui, com o MESMO limite do
  // modo local (15 min) — duas telas com regras diferentes para a
  // mesma cor seria o pior dos dois mundos.
  const AGORA = Date.now();
  const VELHA_MS = 15 * 60 * 1000;
  Team.positions = (st.positions || []).map((p) => ({
    userId: String(p.userId),
    name: p.name || String(p.userId),
    x: Math.round(p.x), z: Math.round(p.z),
    map: p.map || null,
    at: p.at,
    ageMs: Math.max(0, AGORA - p.at),
    stale: (AGORA - p.at) > VELHA_MS
  }));

  Team.messages = (st.messages || []).map((m) => ({
    id: String(m.id),
    authorId: String(m.senderId),
    authorName: m.senderName || '',
    at: new Date(m.createdAt).getTime() || Date.now(),
    text: m.content || '',
    editedAt: m.editedAt ? new Date(m.editedAt).getTime() : null,
    deleted: !!m.deletedAt,
    mediaFull: []
  }));

  // No modo ao vivo não existe fila local: ou foi para o servidor,
  // ou deu erro na cara. O indicador mostra o estado da CONEXÃO.
  Team.status = {
    enabled: true, running: st.net === 'online', transport: 'server',
    lastError: st.net === 'online' ? null : (st.error || st.net), pending: 0
  };
}

async function initTeam() {
  if (!document.getElementById('panel-team')) return;

  Team.me = await window.api.teamMe();

  // ---- Empurrões do servidor ----
  // Mensagem nova, presença mudou, alguém entrou: o servidor avisa
  // e a tela redesenha. Sem isto o time "ao vivo" só atualizaria
  // quando a pessoa clicasse em alguma coisa — que é o oposto de
  // ao vivo.
  if (window.api.onLiveState) {
    window.api.onLiveState(() => { if (Team.live) loadTeam(); });
    window.api.onLiveMessages(() => { if (Team.live) loadTeam(); });
    window.api.onLivePresence(() => { if (Team.live) loadTeam(); });
    if (window.api.onLivePositions) {
      window.api.onLivePositions(() => { if (Team.live) loadTeam(); });
    }
    window.api.onLiveMessage((m) => {
      // Mensagem de outra pessoa com o app em segundo plano vira
      // notificação: chat que só avisa quando você já está olhando
      // não avisa nada.
      if (!Team.live || !m) return;
      const eu = Team.me && String(Team.me.userId);
      if (eu && String(m.senderId) === eu) return;
      if (document.hasFocus() && Team.tab === 'chat' && AppState.trackingId) return;
      window.api.showNotification({ type: 'team', name: m.senderName || '', server: m.content || '' });
    });
  }

  document.getElementById('team-create').addEventListener('click', createTeamGroup);
  document.getElementById('team-join').addEventListener('click', joinTeamGroup);
  document.getElementById('team-picker').addEventListener('change', async (e) => {
    Team.currentId = e.target.value || null;
    // Ao vivo, trocar de time é uma ida ao servidor: os membros, a
    // presença e o histórico são de lá.
    if (Team.live && Team.currentId) { await window.api.liveOpen(Number(Team.currentId)); await loadTeam(); }
    else renderTeam();
  });
  // O botão "Simular outro jogador" saiu. Ele existia para mostrar
  // como o painel ficaria com mais gente, numa época em que não
  // havia servidor. Agora há: quem quiser ver com duas pessoas
  // convida alguém. Um botão que inventa um membro falso num painel
  // que mostra membros reais é confusão esperando para acontecer.
  document.getElementById('team-here').addEventListener('click', shareMyPosition);
  document.getElementById('team-here-clear').addEventListener('click', async () => {
    const g = currentGroup();
    if (!g) return;
    await window.api.teamClearPosition(g.id);
    await loadTeam();
  });
  // O MESMO interruptor em dois lugares.
  //
  // Ele mora na aba Mapa do time (onde estava) e na barra do mapa do
  // servidor (onde a pessoa está quando quer ver os amigos). Dois
  // controles para o mesmo estado só funcionam se um refletir o
  // outro — por isso os dois passam por `ligarTimeNoMapa`, e não
  // cada um mexendo em `Team.showOnMap` por conta própria.
  const btnMapaTime = document.getElementById('btn-map-team');
  if (btnMapaTime) btnMapaTime.addEventListener('click', () => ligarTimeNoMapa(!Team.showOnMap));

  document.getElementById('team-show-map').addEventListener('change', (e) => {
    Team.showOnMap = e.target.checked;
    if (typeof MapView !== 'undefined') MapView.draw();
  });
  document.getElementById('team-leave').addEventListener('click', leaveTeamGroup);
  const bDel = document.getElementById('team-delete');
  if (bDel) bDel.addEventListener('click', deleteTeamGroup);

  // ---- menu de ações do grupo ----
  const menuBtn = document.getElementById('team-menu-btn');
  const menu = document.getElementById('team-menu');
  if (menuBtn && menu) {
    const fechar = () => menu.classList.add('hidden');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    // Clicar em qualquer item fecha: sem isto o menu fica aberto
    // por cima da tela que a ação acabou de mudar.
    menu.addEventListener('click', () => setTimeout(fechar, 0));
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== menuBtn) fechar();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  }
  const copiar = document.getElementById('team-copy-id');
  if (copiar) {
    copiar.addEventListener('click', () => {
      const g = currentGroup();
      if (!g) return;
      window.api.copyText(g.name || '');
      toast(I18N.t('team.copied'));
    });
  }

  // sub-abas
  for (const b of document.querySelectorAll('#team-tabs .team-tab')) {
    b.addEventListener('click', () => switchTeamTab(b.dataset.tt));
  }

  if (typeof initTeamProfile === 'function') initTeamProfile();
  if (typeof initTeamMapBar === 'function') initTeamMapBar();
  initTeamChat();
  initTeamInvites();
  initTeamVoice();
  if (typeof TeamMap !== 'undefined') TeamMap.init();
  if (typeof initTeamView === 'function') initTeamView();

  window.api.onTeamChanged(() => loadTeam());
  window.api.onTeamStatus((st) => { Team.status = st; renderTeamStatus(); });

  await loadTeam();
}

// Os servidores do time: da API, com o disco de reserva.
//
// `needs_deploy` (a rota ainda não existe no servidor) NÃO é erro
// para mostrar — é o estado normal enquanto o deploy não sobe. Erro
// de verdade também cai na reserva, mas aí o indicador de rede já
// está dizendo que a conexão está ruim; um segundo aviso sobre a
// mesma coisa é ruído.
async function servidoresDoTime(gid) {
  if (Team.live) {
    try {
      const r = await window.api.liveServers();
      if (r && r.ok) {
        Team.vinculoNaApi = true;
        // Espelha no disco para a próxima abertura ser instantânea.
        const locais = (await window.api.teamServers(gid)) || [];
        const naRede = new Set((r.servers || []).map((s) => String(s.bmId)));
        for (const s of r.servers || []) {
          if (locais.some((l) => l.bmId === String(s.bmId))) continue;
          await window.api.teamLinkServer(gid, {
            bmId: String(s.bmId), name: s.name,
            ip: (s.address || '').split(':')[0] || null,
            port: Number((s.address || '').split(':')[1]) || null,
            map: s.map || null
          }, { papelRemoto: 'owner' });
        }
        // Desvinculado por outra pessoa: sai daqui também, senão a
        // lista local vira uma memória de algo que o time desfez.
        for (const l of locais) {
          if (!naRede.has(String(l.bmId))) {
            await window.api.teamUnlinkServer(gid, l.bmId, { papelRemoto: 'owner' });
          }
        }
        return (await window.api.teamServers(gid)) || [];
      }
      Team.vinculoNaApi = false;
    } catch { Team.vinculoNaApi = false; }
  }
  return (await window.api.teamServers(gid)) || [];
}

function currentGroup() {
  return Team.groups.find((g) => g.id === Team.currentId) || null;
}

async function loadTeam() {
  // Com conta ligada, o time é o do SERVIDOR. Sem conta, continua o
  // do disco — quem joga sozinha nunca precisa criar conta para
  // usar o grupo, e essa promessa não muda.
  const conta = (typeof Conta !== 'undefined' && Conta.info) ? Conta.info : { signedIn: false };
  if (conta.signedIn) {
    const st = await window.api.liveState();
    if (!st.teams.length && !st.team) await window.api.liveLoad();
    adaptarLive({ ...(await window.api.liveState()), me: conta.user });

    // SERVIDORES VINCULADOS TAMBÉM NO MODO AO VIVO.
    //
    // O vínculo mora no DISCO mesmo com conta ligada, e isso é de
    // propósito: pela arquitetura que a Sara definiu, a API só
    // cuida de conta, conexão, arquivo temporário e voz — "as
    // informações serão salvas no computador do usuário". A chave é
    // o id do time do servidor, então o vínculo acompanha o time.
    //
    // Esta parte faltava por inteiro: o caminho ao vivo voltava
    // antes de carregar `Team.servers`, e o resultado era a aba
    // Servidores sempre vazia e o seletor de escopo pendurado sem
    // opção nenhuma — exatamente o que apareceu no print.
    if (Team.currentId) {
      // O VÍNCULO VEM DA API quando ela tem a rota (migração 003).
      //
      // Ele é a única parte do time que precisa ser IGUAL para todo
      // mundo: com listas diferentes, o "servidor 1" de uma pessoa
      // não é o da outra e o conteúdo aparece no escopo errado.
      //
      // O disco continua sendo escrito com o que veio da rede. Não
      // é redundância: é o que faz o app abrir e mostrar os
      // servidores do time ANTES de a rede responder — e continuar
      // funcionando com a internet caída.
      Team.servers = await servidoresDoTime(Team.currentId);
      renderTeamScope();
      const escopoLive = escopoDaConsulta();
      Team.items = (await window.api.teamItems(Team.currentId, { serverBmId: escopoLive })) || [];
    } else {
      Team.servers = [];
      Team.items = [];
      renderTeamScope();
    }

    await loadTeamProfile();
    renderTeam();
    // O chat também precisa ser desenhado. A primeira versão do
    // modo ao vivo voltava daqui direto, e a aba de chat ficava com
    // o conteúdo do modo local (ou vazia) mesmo com as mensagens já
    // carregadas em Team.messages — o dado estava lá e ninguém
    // mandava pintar.
    if (Team.currentId) {
      renderChannels();
      renderChatLog();
      renderChatBadge();
    }
    // Convites: só quando a aba está aberta. É uma ida ao servidor
    // e recarregar a cada push de presença seria pedir a lista
    // dezenas de vezes por minuto para ninguém ver.
    if (Team.currentId && Team.tab === 'members') await loadInvites();
    if (typeof MapView !== 'undefined' && MapView.canvas) MapView.draw();
    return;
  }
  Team.live = false;
  Team.groups = (await window.api.teamGroups()) || [];
  if (!Team.currentId || !currentGroup()) {
    Team.currentId = Team.groups.length ? Team.groups[0].id : null;
  }
  const g = currentGroup();

  // Servidores vinculados vêm ANTES dos itens: é a lista deles que
  // alimenta o seletor de escopo, e é o escopo que decide QUAIS
  // itens buscar. Na ordem inversa, a primeira pintura viria com o
  // escopo do grupo anterior.
  Team.servers = g ? (await window.api.teamServers(g.id)) || [] : [];
  if (typeof renderTeamScope === 'function') renderTeamScope();

  // `escopoDaConsulta()` devolve `undefined` para "todos" e o id do
  // servidor para "só este". Os dois casos vão para o store como
  // `serverBmId`, onde `undefined` = tudo e uma string = aquele
  // servidor mais os itens antigos, que não têm servidor nenhum.
  const escopo = (typeof escopoDaConsulta === 'function') ? escopoDaConsulta() : undefined;
  Team.items = g ? (await window.api.teamItems(g.id, { serverBmId: escopo })) || [] : [];
  Team.positions = g ? (await window.api.teamPositions(g.id, { serverBmId: escopo })) || [] : [];
  if (g) {
    const r = await window.api.teamRoles(g.id);
    Team.caps = r.capabilities || {};
    Team.assignable = r.assignable || [];
  } else { Team.caps = {}; Team.assignable = []; }
  Team.status = await window.api.teamSyncStatus();
  await loadTeamProfile();
  renderTeam();
  if (g && Team.tab === 'chat') await loadChat();
  if (g && Team.tab === 'members') await loadInvites();
  if (typeof MapView !== 'undefined' && MapView.canvas) MapView.draw();
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function renderTeam() {
  const vazio = document.getElementById('team-empty');
  const corpo = document.getElementById('team-body');
  const g = currentGroup();

  vazio.classList.toggle('hidden', !!g);
  corpo.classList.toggle('hidden', !g);
  // Marca o painel: várias regras de estilo só valem quando a
  // presença é medida de verdade (ver .team-live no styles.css).
  const painel = document.getElementById('panel-team');
  if (painel) painel.classList.toggle('team-live', !!Team.live);

  // O aviso amarelo só faz sentido SEM conta. Com conta ligada o
  // time já vive no servidor, e deixar "ainda não está no ar" na
  // tela seria mentir para quem acabou de entrar.
  const aviso = vazio.querySelector('.team-warn');
  if (aviso) aviso.classList.toggle('hidden', Team.live);

  const sel = document.getElementById('team-picker');
  sel.innerHTML = Team.groups
    .map((x) => `<option value="${escapeHtml(x.id)}"${x.id === Team.currentId ? ' selected' : ''}>${escapeHtml(x.name)}</option>`)
    .join('');
  sel.classList.toggle('hidden', Team.groups.length < 2);

  // O contador de grupos morava no selo da aba do servidor. A aba
  // saiu, então ele passou para o ladrilho "Times" do menu lateral,
  // que é o novo caminho até o time. Sem esta linha o número
  // simplesmente deixaria de existir, sem erro nenhum na tela.
  const badge = document.getElementById('drawer-teams-badge');
  if (badge) {
    const n = Team.groups.length;
    badge.textContent = n;
    badge.classList.toggle('hidden', !n);
  }

  renderTeamStatus();
  if (!g) return;

  document.getElementById('team-name').textContent = g.name;

  // O papel virou SELO, não frase. "Você é dono neste grupo" gastava
  // uma linha inteira para dizer uma palavra, e a palavra é o que
  // importa: ela define o que os botões vão deixar você fazer.
  const selo = document.getElementById('team-myrole');
  const papel = g.myRole || 'guest';
  selo.textContent = I18N.t('team.role_' + papel);
  selo.className = 'role-chip ' + papel;

  // A linha de baixo passa a carregar o que a pessoa realmente
  // quer saber ao abrir o painel: quantos somos e quantos estão
  // online agora.
  const membros = g.members || [];
  const online = membros.filter((m) => m.online).length;
  const sub = document.getElementById('team-sub');
  if (sub) {
    const partes = [I18N.t('team.memberCount', { n: membros.length })];
    // Sem servidor não existe presença de verdade: mostrar "0
    // online" ali seria inventar um dado que ninguém mediu.
    if (Team.live) partes.push(I18N.t('team.onlineCount', { n: online }));
    sub.textContent = partes.join('  ·  ');
  }

  // Cada botão aparece conforme a CAPACIDADE, não conforme o nome
  // do papel. Assim, mudar a tabela de permissões não exige caçar
  // `if (role === 'admin')` espalhado pela tela.
  // Excluir é do DONO, e só dele: um admin apagar o time inteiro é
  // poder demais para um clique. `group.delete` já diz isso na
  // tabela; aqui a tela obedece.
  const bDel = document.getElementById('team-delete');
  if (bDel) {
    const souDono = Team.me && String(g.ownerId || '') === String(Team.me.userId || '');
    bDel.classList.toggle('hidden', !souDono);
  }
  // O separador só faz sentido se houver algo acima dele.
  const sep = document.querySelector('#team-menu .tmn-sep');
  if (sep) sep.classList.toggle('hidden', !Team.caps['profile.edit']);
  document.getElementById('team-here').classList.toggle('hidden', !Team.caps['position.share']);

  if (typeof renderTeamProfile === 'function') renderTeamProfile();
  if (typeof renderTeamRules === 'function') renderTeamRules();
  if (typeof renderTeamNews === 'function') renderTeamNews();
  renderTeamMembers(g);
  renderTeamPositions(g);
  renderTeamItems(g);
  if (typeof renderTeamNotes === 'function') renderTeamNotes(g);
  if (typeof renderTeamServers === 'function') renderTeamServers(g);
  // O menu lateral também mostra os servidores dos times, e ele vive
  // fora deste painel — atualizar só aqui deixaria a lista do menu
  // velha até a próxima vez que alguém abrisse o time.
  if (typeof renderDrawerTeamServers === 'function') renderDrawerTeamServers();
  // O mapa do grupo é redesenhado junto com as listas — ele mostra
  // os mesmos dados, e deixar os dois fora de sincronia é pior do
  // que não ter o mapa.
  if (typeof renderTeamMapBar === 'function') renderTeamMapBar();
  if (typeof TeamMap !== 'undefined') { TeamMap.draw(); TeamMap.sincronizarLista(); }
  // O interruptor "mostrar o time" vive na barra do mapa do
  // SERVIDOR, fora deste painel. Ele precisa saber que agora existe
  // um time — senão só apareceria depois de a pessoa trocar de tela.
  if (typeof renderBotaoTimeNoMapa === 'function') renderBotaoTimeNoMapa();
}

function renderTeamStatus() {
  const el = document.getElementById('team-status');
  if (!el) return;
  const s = Team.status || {};
  // A frase muda conforme o estado REAL. "Offline" aqui não é
  // erro: é o estado esperado enquanto não houver servidor.
  let classe = 'off', txt = I18N.t('team.statusOffline');
  if (s.enabled && s.transport === 'loopback') { classe = 'demo'; txt = I18N.t('team.statusDemo'); }
  else if (s.enabled && s.running && !s.lastError) { classe = 'on'; txt = I18N.t('team.statusOn'); }
  else if (s.enabled && s.lastError) { classe = 'err'; txt = I18N.t('team.statusError', { e: s.lastError }); }
  el.className = 'team-status ' + classe;
  // O texto vive num <span> próprio: o selo tem uma bolinha de cor
  // ao lado e `textContent` no elemento inteiro apagaria ela.
  const alvo = document.getElementById('team-status-txt');
  if (alvo) alvo.textContent = txt; else el.textContent = txt;
  el.title = s.lastError ? String(s.lastError) : '';

  // A FILA DE SINCRONIZAÇÃO SAIU DA TELA.
  //
  // "7 alteração(ões) na fila" é diagnóstico do meu lado, não
  // informação para quem usa: a pessoa não pode fazer nada a
  // respeito, e um número subindo no canto só dá a impressão de que
  // alguma coisa está travada. O estado que importa (conectado ou
  // não) já está no selo ao lado.
}

// ------------------------------------------------------------
// QUEM É ESTA PESSOA, SEGUNDO A STEAM
// ------------------------------------------------------------
// A Sara: "faça que o usuário mostrado em lista tenha o nome da sua
// conta steam / seu nick do app e a foto seja da sua conta steam".
//
// Antes isto valia só para MIM: a foto e o apelido saíam de
// `SteamUI.profile`, e os outros ficavam com uma inicial num
// círculo cinza. Mas o app já conhece mais gente do que eu — a
// lista de amigos da Steam vem com steamId, apelido e foto, e o
// servidor manda o steamId de cada membro. Bastava cruzar os dois.
//
// A ordem importa:
//   1. sou eu       -> `SteamUI.profile`, que é sempre o mais atual
//   2. é meu amigo  -> a entrada dele na lista de amigos
//   3. nada disso   -> null, e a linha usa o que o servidor mandou
//
// Quem não é seu amigo na Steam continua com a inicial, e isso é
// honesto: o app não tem como saber a foto de um desconhecido sem
// pedir para o servidor — que é justamente o `avatarUrl` que o
// servidor já devolve quando existe.
function perfilDaSteam(m, souEu) {
  if (typeof SteamUI === 'undefined') return null;
  if (souEu && SteamUI.profile) return SteamUI.profile;
  const id = m && m.steamId ? String(m.steamId) : null;
  if (!id) return null;
  if (SteamUI.profile && String(SteamUI.profile.steamId) === id) return SteamUI.profile;
  return (SteamUI.friends || []).find((f) => String(f.steamId) === id) || null;
}

// O que a Steam sabe sobre o dono de uma posição.
//
// A posição só traz `userId` e `name` — quem sabe o steamId é a
// lista de membros. Então: id -> membro -> Steam.
function steamDaPosicao(userId) {
  const g = currentGroup();
  if (!g || userId == null) return { st: null, m: null };
  const alvo = String(userId);
  const m = (g.members || []).find((x) => String(x.userId) === alvo) || null;
  if (!m) return { st: null, m: null };
  const souEu = Team.me && String(Team.me.userId) === alvo;
  return { st: perfilDaSteam(m, souEu), m };
}

function fotoDoMembro(userId) {
  const { st, m } = steamDaPosicao(userId);
  return (st && st.avatar) || (m && m.avatarUrl) || null;
}

// O nome no mapa segue a MESMA regra da lista de membros: apelido da
// Steam quando ele existe. Duas telas chamando a mesma pessoa por
// nomes diferentes é o tipo de detalhe que faz duvidar se é a mesma
// pessoa.
function nomeNoMapa(pos) {
  const { st } = steamDaPosicao(pos.userId);
  return (st && st.personaName) || pos.name || '';
}

// ------------------------------------------------------------
// Cache de imagens para o CANVAS
// ------------------------------------------------------------
// `ctx.drawImage` exige uma imagem JÁ carregada — passar uma que
// ainda está baixando simplesmente não desenha nada, sem erro.
// Como o mapa redesenha a cada quadro, criar um `new Image()` por
// quadro seria uma requisição por quadro: o cache não é otimização,
// é o que impede o app de martelar a Steam.
//
// Enquanto a foto não chega, quem chamou desenha a bolinha de
// sempre; quando ela chega, `aoCarregar` pede UM redesenho e a foto
// aparece no lugar.
const _fotosCanvas = new Map();   // url -> { img, pronta, erro }

function imagemDeAvatar(url, aoCarregar) {
  if (!url) return null;
  let e = _fotosCanvas.get(url);
  if (!e) {
    const img = new Image();
    e = { img, pronta: false, erro: false };
    _fotosCanvas.set(url, e);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { e.pronta = true; if (aoCarregar) aoCarregar(); };
    // Foto que não carrega (perfil privado, sem rede) marca `erro` e
    // nunca mais é tentada nesta sessão. Sem isso, cada redesenho
    // faria a mesma requisição falhar de novo.
    img.onerror = () => { e.erro = true; };
    img.src = url;
  }
  return e.pronta ? e.img : null;
}

// Desenha a foto recortada em círculo, com anel colorido em volta.
// O anel é o que mantém a leitura antiga funcionando: a cor continua
// dizendo "isto é uma posição do grupo", e a foto passa a dizer DE
// QUEM. Trocar a cor pela foto sem o anel perderia metade da
// informação.
function fotoRedonda(ctx, img, x, y, raio, cor, k) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, raio, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x - raio, y - raio, raio * 2, raio * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, raio, 0, Math.PI * 2);
  ctx.lineWidth = 2.5 * k;
  ctx.strokeStyle = cor;
  ctx.stroke();
  // Um contorno escuro por fora do anel: sobre mapa claro (neve,
  // areia) um anel amarelo sozinho some.
  ctx.beginPath();
  ctx.arc(x, y, raio + 1.5 * k, 0, Math.PI * 2);
  ctx.lineWidth = 1 * k;
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.stroke();
}

function renderTeamMembers(g) {
  const box = document.getElementById('team-members');
  const eu = Team.me ? Team.me.userId : null;
  // Ordena por hierarquia: dono no topo, convidado embaixo.
  const ordem = { owner: 0, admin: 1, moderator: 2, member: 3, guest: 4 };
  let membros = [...(g.members || [])].sort(
    (a, b) => (ordem[a.role] ?? 9) - (ordem[b.role] ?? 9) || a.joinedAt - b.joinedAt);

  // Busca: aparece só quando a lista passa de 8. Num grupo de três
  // pessoas o campo é enfeite, e enfeite custa uma linha da tela.
  const busca = document.getElementById('members-search');
  const LIMIAR_BUSCA = 8;
  if (busca) {
    busca.classList.toggle('hidden', membros.length < LIMIAR_BUSCA);
    if (membros.length < LIMIAR_BUSCA) busca.value = '';
    const q = busca.value.trim().toLowerCase();
    if (q) membros = membros.filter((m) => String(m.name || '').toLowerCase().includes(q));
    if (!busca.dataset.ligado) {
      busca.dataset.ligado = '1';
      busca.addEventListener('input', () => renderTeamMembers(currentGroup()));
    }
  }

  const cont = document.getElementById('members-count');
  if (cont) {
    const total = (g.members || []).length;
    const on = (g.members || []).filter((m) => m.online).length;
    cont.textContent = Team.live ? `${on}/${total}` : String(total);
    cont.title = Team.live ? I18N.t('team.onlineOfTotal', { on, total }) : '';
  }

  if (!membros.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('team.noMemberMatch'))}</p>`;
    return;
  }

  box.innerHTML = membros.map((m) => {
    const souEu = m.userId === eu;
    const dono = m.userId === g.ownerId;
    // Só ofereço papéis que EU posso conceder, e só para quem está
    // abaixo de mim. Mostrar a opção e depois recusar é pior do que
    // não mostrar.
    const podeMexer = !dono && !souEu && Team.caps['member.setRole'] &&
                      Team.assignable.includes(m.role);
    const podeExpulsar = !dono && !souEu && Team.caps['member.kick'] &&
                         (Team.assignable.includes(m.role) || Team.caps['member.ban']);
    // A segunda linha diz há quanto tempo a pessoa não aparece.
    // "offline" sozinho não distingue quem saiu agora de quem
    // sumiu na semana passada, e para um grupo de raide essa é
    // justamente a diferença que importa.
    const visto = (!m.online && m.lastSeen) ? I18N.t('team.lastSeen', { t: idadeCurta(Date.now() - new Date(m.lastSeen).getTime()) })
                : m.online ? I18N.t('team.online')
                : '';

    const acoes = [];
    if (podeExpulsar) {
      acoes.push(`<button class="tm-act" data-kick="${escapeHtml(m.userId)}" title="${escapeHtml(I18N.t('team.kick'))}">${Icon.svg('eject', 14)}</button>`);
      acoes.push(`<button class="tm-act danger" data-ban="${escapeHtml(m.userId)}" title="${escapeHtml(I18N.t('team.ban'))}">${Icon.svg('ban', 14)}</button>`);
    }
    if (Team.caps['group.transfer'] && !dono) {
      acoes.push(`<button class="tm-act" data-crown="${escapeHtml(m.userId)}" title="${escapeHtml(I18N.t('team.transfer'))}">${Icon.svg('crown', 14)}</button>`);
    }

    // FOTO E NOME DE QUEM É.
    //
    // A lista mostrava a inicial num círculo cinza e o nome de
    // usuário da conta. Para MIM, o app já sabe fazer melhor: a
    // foto e o apelido da Steam estão em `SteamUI.profile` desde a
    // abertura. Usar isso deixa a lista parecida com o jogo, que é
    // onde essas pessoas se reconhecem.
    //
    // Agora vale para TODO MUNDO, não só para mim: `perfilDaSteam`
    // casa o membro pelo steamId com quem o app já conhece — você
    // mesma e a sua lista de amigos.
    const st = perfilDaSteam(m, souEu);
    const foto = (st && st.avatar) || m.avatarUrl || null;
    const nomeMostrado = (st && st.personaName) || m.name;
    // A linha de baixo mostra o nick do U+ quando ele é DIFERENTE do
    // nome da Steam. Repetir o mesmo nome duas vezes não informa
    // nada e ainda faz a linha parecer um erro.
    const nickApp = (nomeMostrado !== m.name) ? m.name : '';

    return `
      <div class="tm-row${m.online ? ' online' : ''}${souEu ? ' me' : ''}" data-user="${escapeHtml(m.userId)}">
        <span class="tm-avatar">${
          foto
            ? `<img src="${escapeHtml(foto)}" alt="" referrerpolicy="no-referrer"
                    onerror="avatarFallback(this,'${escapeHtml((nomeMostrado || '?').charAt(0).toUpperCase())}')">`
            : escapeHtml((nomeMostrado || '?').charAt(0).toUpperCase())
        }${
          Team.live ? `<i class="tm-dot${m.online ? ' on' : ''}" title="${
            escapeHtml(I18N.t(m.online ? 'team.online' : 'team.offline'))}"></i>` : ''}</span>
        <span class="tm-id">
          <span class="tm-name">${escapeHtml(nomeMostrado)}${souEu ? ` <em>${escapeHtml(I18N.t('team.you'))}</em>` : ''}</span>
          ${nickApp || visto ? `<span class="tm-seen">${
            escapeHtml([nickApp, visto].filter(Boolean).join(' · '))}</span>` : ''}
        </span>
        <span class="role-chip sm ${escapeHtml(m.role)}">${dono ? Icon.svg('crown', 11) + ' ' : ''}${escapeHtml(I18N.t('team.role_' + m.role))}</span>
        ${podeMexer ? `
          <select class="tm-role-sel" data-role-for="${escapeHtml(m.userId)}"
                  title="${escapeHtml(I18N.t('team.changeRole'))}">
            ${Team.assignable.map((r) => `<option value="${r}"${r === m.role ? ' selected' : ''}>${escapeHtml(I18N.t('team.role_' + r))}</option>`).join('')}
          </select>` : ''}
        ${acoes.length ? `<span class="tm-acts">${acoes.join('')}</span>` : ''}
      </div>`;
  }).join('');

  box.onchange = async (e) => {
    const sel = e.target.closest('[data-role-for]');
    if (!sel) return;
    const r = Team.live
      ? await window.api.liveRole(Number(sel.dataset.roleFor), sel.value)
      : await window.api.teamSetRole(g.id, sel.dataset.roleFor, sel.value);
    if (!r.ok) toast(erroTime(r));
    await loadTeam();
  };
  box.onclick = async (e) => {
    const kick = e.target.closest('[data-kick]');
    const ban = e.target.closest('[data-ban]');
    const crown = e.target.closest('[data-crown]');
    let r = null;
    if (kick) {
      if (!await Ask.confirm(I18N.t('team.confirmRemove'))) return;
      r = Team.live
        ? await window.api.liveKick(Number(kick.dataset.kick))
        : await window.api.teamRemoveMember(g.id, kick.dataset.kick);
    } else if (ban) {
      if (!await Ask.confirm(I18N.t('team.confirmBan'))) return;
      r = Team.live
        ? await window.api.liveBan(Number(ban.dataset.ban), null)
        : await window.api.teamBan(g.id, ban.dataset.ban, null);
    } else if (crown) {
      // Transferir posse é irreversível pelo lado de quem entrega.
      if (!await Ask.confirm(I18N.t('team.confirmTransfer'))) return;
      r = Team.live
        ? await window.api.liveTransfer(Number(crown.dataset.crown))
        : await window.api.teamTransfer(g.id, crown.dataset.crown);
    } else return;
    if (r && !r.ok) toast(erroTime(r));
    await loadTeam();
  };
}

function renderTeamPositions(g) {
  const box = document.getElementById('team-positions');
  if (!Team.positions.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('team.noPositions'))}</p>`;
    return;
  }
  // O local vem antes da coordenada: "Volk" diz para onde correr,
  // "X 320 · Z -140" só serve depois de já estar com o mapa aberto.
  box.innerHTML = Team.positions.map((p) => {
    const onde = (typeof MapView !== 'undefined' && MapView.whereIsText)
      ? MapView.whereIsText(p.x, p.z) : '';
    return `
    <div class="tp-row${p.stale ? ' stale' : ''}" data-pin="pos:${escapeHtml(String(p.userId || p.name))}"
         data-x="${Number(p.x)}" data-z="${Number(p.z)}" data-srv="${escapeHtml(p.serverBmId || '')}">
      <span class="tp-dot"></span>
      <span class="tp-name">${escapeHtml(p.name || p.userId)}</span>
      ${onde ? `<span class="tp-loc">${Icon.svg('pin', 12)} ${escapeHtml(onde)}</span>` : ''}
      <span class="tp-xy">X ${p.x} · Z ${p.z}</span>
      <span class="tp-age">${escapeHtml(idadeCurta(p.ageMs))}</span>
      <button class="tp-go" data-act="go"
              title="${escapeHtml(I18N.t('team.goToOnMap'))}">${Icon.svg('map', 13)}</button>
    </div>`;
  }).join('');

  // "Não consigo clicar pra ver a posição, tem que ir lá no mapa
  // ver." Agora a linha inteira responde: um clique acende o ponto
  // no mapa do grupo — que está ali do lado, sem trocar de aba — e
  // o botão do mapinha leva ao mapa grande já centralizado, com o
  // anel de destaque em volta.
  box.onclick = (e) => {
    const linha = e.target.closest('.tp-row');
    if (!linha) return;
    const x = Number(linha.dataset.x), z = Number(linha.dataset.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (e.target.closest('[data-act=go]')) { abrirNoMapa(x, z, linha.dataset.srv || null); return; }
    if (typeof TeamMap !== 'undefined') TeamMap.selecionar(linha.dataset.pin, { rolar: false });
  };
}

function idadeCurta(ms) {
  const s = Math.floor((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

// A LEGENDA DO MAPA DO TIME.
//
// Antes esta função desenhava TUDO que o grupo tinha compartilhado,
// numa coluna só. Agora as anotações têm aba própria (com tipo,
// busca e ligações) e aqui fica o que o mapa mostra: o que tem
// coordenada.
//
// Um item pode aparecer nos dois lugares, e isso é certo: uma ficha
// que marca onde a base do sujeito fica é dossiê na aba Notas e
// ponto no mapa aqui. Escolher um dos dois esconderia metade da
// informação de quem está olhando pelo outro lado.
function renderTeamItems(g) {
  const box = document.getElementById('team-mapitems');
  if (!box) return;
  const temCoordenada = (it) =>
    Number.isFinite(Number(it.data && it.data.x)) && Number.isFinite(Number(it.data && it.data.z));
  const raiz = Team.items.filter((it) => it.kind !== 'comment' && temCoordenada(it));
  if (!raiz.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('team.noMapItems'))}</p>`;
    return;
  }
  const ICON = { marker: 'pin', note: 'note', shot: 'image' };
  box.innerHTML = raiz.map((it) => {
    const meu = Team.me && it.authorId === Team.me.userId;
    const podeMexer = meu ? Team.caps['item.deleteOwn'] : Team.caps['item.deleteAny'];
    const aberto = Team.openComments.has(it.id);
    const coments = Team.items.filter((c) => c.parentId === it.id && c.kind === 'comment');
    const temLugar = true;   // a lista já é só do que tem coordenada
    return `
      <article class="ti-card${temLugar ? ' tem-lugar' : ''}" data-item="${escapeHtml(it.id)}"
               ${temLugar ? `data-pin="${escapeHtml(it.id)}" data-x="${Number(it.data.x)}" data-z="${Number(it.data.z)}" data-srv="${escapeHtml(it.serverBmId || '')}"` : ''}>
        <header class="ti-head">
          <span class="ti-ico">${Icon.svg(ICON[it.kind] || 'dot', 15)}</span>
          <strong class="ti-title">${escapeHtml(it.data.name || it.data.title || I18N.t('notes.untitled'))}</strong>
          <span class="ti-author">${escapeHtml(it.authorName || '')}</span>
          <button class="ti-comments" data-act="comments">${Icon.svg('comment', 13)} ${coments.length}</button>
          ${podeMexer ? `<button class="ti-del" data-act="del" title="${escapeHtml(I18N.t('common.delete'))}">${Icon.svg('close', 13)}</button>` : ''}
        </header>
        ${it.data.text ? `<p class="ti-text">${escapeHtml(it.data.text)}</p>` : ''}
        ${it.data.shotCount ? `<p class="ti-shots" title="${
          escapeHtml(I18N.t('team.shotsStayHint'))}">${Icon.svg('image', 12)} ${
          escapeHtml(I18N.t('team.shotsStay', { n: it.data.shotCount }))}</p>` : ''}
        ${temLugar ? `
          <p class="ti-xy">
            <span>X ${it.data.x} · Z ${it.data.z}</span>
            <button class="ti-go" data-act="go">${Icon.svg('map', 12)} ${escapeHtml(I18N.t('team.goToOnMap'))}</button>
          </p>` : ''}
        ${aberto ? `
          <div class="ti-thread">
            ${coments.map((c) => `
              <div class="ti-comment">
                <strong>${escapeHtml(c.authorName || '')}</strong>
                <span>${escapeHtml(c.data.text || '')}</span>
              </div>`).join('') || `<p class="muted small">${escapeHtml(I18N.t('team.noComments'))}</p>`}
            <div class="ti-reply">
              <input type="text" data-reply="${escapeHtml(it.id)}"
                     placeholder="${escapeHtml(I18N.t('team.commentPlaceholder'))}" />
              <button class="btn-small primary" data-act="send">${escapeHtml(I18N.t('team.comment'))}</button>
            </div>
          </div>` : ''}
      </article>`;
  }).join('');

  box.onclick = async (e) => {
    const card = e.target.closest('[data-item]');
    if (!card) return;
    const btn = e.target.closest('[data-act]');
    const id = card.dataset.item;

    // Clicar no CARD (fora dos botões) acende o ponto no mapa do
    // grupo. Não troca de aba: quem quiser o mapa grande clica em
    // "ver no mapa". Trocar a pessoa de tela sem ela pedir é o tipo
    // de coisa que faz perder o lugar onde estava lendo.
    if (!btn) {
      if (card.dataset.pin && typeof TeamMap !== 'undefined') {
        TeamMap.selecionar(card.dataset.pin, { rolar: false });
      }
      return;
    }

    if (btn.dataset.act === 'go') {
      abrirNoMapa(Number(card.dataset.x), Number(card.dataset.z), card.dataset.srv || null);
      return;
    }
    if (btn.dataset.act === 'comments') {
      if (Team.openComments.has(id)) Team.openComments.delete(id); else Team.openComments.add(id);
      renderTeamItems(g);
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!await Ask.confirm(I18N.t('team.confirmDeleteItem'))) return;
      const r = await window.api.teamDeleteItem(id);
      if (!r.ok) toast(erroTime(r));
      await loadTeam();
      return;
    }
    if (btn.dataset.act === 'send') {
      const input = card.querySelector(`[data-reply="${CSS.escape(id)}"]`);
      const txt = (input.value || '').trim();
      if (!txt) return;
      const r = await window.api.teamCreateItem(g.id, { kind: 'comment', parentId: id, data: { text: txt } });
      if (!r.ok) { toast(erroTime(r)); return; }
      input.value = '';
      await loadTeam();
    }
  };
}

// ------------------------------------------------------------
// Ações
// ------------------------------------------------------------

// Mostra o erro de um resultado do time.
//
// Existia espalhado como `toast(erroTime(r))`, e
// isso tinha dois furos: o modo local devolve `reason`, o servidor
// devolve `error` (metade dos lugares lia só um dos dois, e o toast
// saía como "team.err_undefined"); e quando a chave não existe o
// `I18N.t` devolve A PRÓPRIA CHAVE, então a pessoa via
// "team.err_rank_too_low" escrito na tela.
//
// Aqui: tenta a tradução, e se ela não existir mostra a mensagem
// genérica com o código cru entre parênteses — feio, mas honesto, e
// dá para você me mandar o código.
function erroTime(r, padrao = 'generic') {
  const codigo = (r && (r.reason || r.error)) || padrao;
  const chave = 'team.err_' + codigo;
  const txt = I18N.t(chave);
  if (txt && txt !== chave) return txt;
  const generico = I18N.t('team.err_generic');
  return `${generico === 'team.err_generic' ? 'Não deu certo.' : generico} (${codigo})`;
}
// Criar time abre o FORMULÁRIO (nome, descrição, foto), não uma
// caixinha de texto. Ver o comentário no topo de teamProfile.js:
// pedir a descrição depois é o mesmo que não pedir.
function createTeamGroup() {
  TeamForm.abrir({ modo: 'criar', nome: I18N.t('team.defaultName') });
}

// Entrar exige CÓDIGO + SENHA. O código diz qual é o grupo; a
// senha prova que a pessoa foi convidada. Código sozinho vaza
// fácil — aparece em print, em vídeo, em quem passou atrás.
function joinTeamGroup() {
  document.getElementById('join-code').value = '';
  document.getElementById('join-pass').value = '';
  document.getElementById('join-error').classList.add('hidden');
  showModal('modal-join');
  setTimeout(() => document.getElementById('join-code').focus(), 40);
}

async function confirmJoin() {
  const code = document.getElementById('join-code').value.trim();
  const password = document.getElementById('join-pass').value;
  const err = document.getElementById('join-error');
  if (!code || !password) {
    err.textContent = I18N.t('team.needBoth');
    err.classList.remove('hidden');
    return;
  }
  const r = Team.live
    ? await window.api.liveRedeem(code, password)
    : await window.api.teamJoinWithInvite({ code, password });
  if (r.ok) {
    hideModal('modal-join');
    // No modo ao vivo quem define o time atual é o servidor; o
    // `loadTeam` já lê de lá.
    if (!Team.live) Team.currentId = r.group.id;
    await loadTeam();
    toast(I18N.t('team.joined'));
    return;
  }
  // Motivo específico: "código errado" e "senha errada" são
  // problemas diferentes para quem está tentando entrar de boa fé.
  //
  // O modo local devolve `reason`, o servidor devolve `error`. Ler
  // só um dos dois deixava a caixa de erro VAZIA no outro modo —
  // que é a pior resposta possível para quem está tentando entrar.
  const motivo = r.reason || r.error || 'generic';
  const txt = I18N.t('team.err_' + motivo);
  err.textContent = (txt === 'team.err_' + motivo) ? I18N.t('team.err_generic') : txt;
  err.classList.remove('hidden');
}

async function renameTeamGroup() {
  const g = currentGroup();
  if (!g) return;
  const nome = await Ask.text(I18N.t('team.askName'), { valor: g.name });
  if (!nome) return;
  const r = Team.live
    ? await window.api.liveRename(nome)
    : await window.api.teamUpdateGroup(g.id, { name: nome });
  if (!r.ok) toast(erroTime(r));
  await loadTeam();
}

// ------------------------------------------------------------
// "MOSTRAR O TIME NO MAPA" — um estado, dois botões
// ------------------------------------------------------------
function ligarTimeNoMapa(ligado) {
  Team.showOnMap = !!ligado;
  const chk = document.getElementById('team-show-map');
  if (chk) chk.checked = Team.showOnMap;
  renderBotaoTimeNoMapa();
  if (typeof MapView !== 'undefined' && MapView.canvas) MapView.draw();
}

function renderBotaoTimeNoMapa() {
  const b = document.getElementById('btn-map-team');
  if (!b) return;
  // Para quem não tem time, o botão não existe: seria um
  // interruptor que não acende nada.
  const temTime = !!(Team.groups && Team.groups.length);
  b.classList.toggle('hidden', !temTime);
  b.classList.toggle('active', !!Team.showOnMap);
  b.setAttribute('aria-pressed', String(!!Team.showOnMap));
}

// ------------------------------------------------------------
// EXCLUIR O TIME
// ------------------------------------------------------------
// Diferente de SAIR, e por isso dois botões: sair tira você;
// excluir acaba com o time para todo mundo.
//
// NO SERVIDOR A EXCLUSÃO TEM CARÊNCIA DE 24 HORAS.
//
// Isso é pedido da Sara e é a decisão certa: apagar um time apaga
// o chat, as regras, as novidades e o que todo mundo compartilhou —
// é o clique mais destrutivo do app inteiro, e o único jeito de
// errá-lo é sem volta. Com carência, quem clicou por engano
// (ou quem foi expulso do próprio time por um dono revoltado)
// tem um dia para desfazer.
//
// O que a carência NÃO é: um "lixo" onde o time continua
// funcionando. Assim que é marcado, ele some para todo mundo. O que
// sobra é só o registro no banco, esperando o prazo.
async function deleteTeamGroup() {
  const g = currentGroup();
  if (!g) return;
  document.getElementById('team-menu').classList.add('hidden');

  const souDono = Team.me && String(g.ownerId || '') === String(Team.me.userId || '');
  if (!souDono) { toast(I18N.t('team.err_only_owner')); return; }

  // Confirmação com o NOME digitado. Para uma ação irreversível,
  // "tem certeza?" não é confirmação — é uma formalidade que a
  // pessoa clica no automático. Escrever o nome obriga a olhar.
  const escrito = await Ask.text(I18N.t('team.deleteAsk', { name: g.name }), {
    rotulo: I18N.t('team.deleteType', { name: g.name }),
    corpo: I18N.t(Team.live ? 'team.deleteBodyLive' : 'team.deleteBodyLocal'),
    ok: I18N.t('team.deleteConfirm')
  });
  if (!escrito) return;
  if (escrito.trim().toLowerCase() !== String(g.name).trim().toLowerCase()) {
    toast(I18N.t('team.deleteNameMismatch'));
    return;
  }

  if (Team.live) {
    // `liveDissolve` é a rota que já existe. Com o deploy 004 ela
    // passa a MARCAR a exclusão em vez de apagar na hora; o app não
    // muda por causa disso — ele já trata a resposta como "acabou".
    const r = await window.api.liveDissolve();
    if (!r.ok) { toast(erroTime(r)); return; }
    Team.currentId = null;
    await loadTeam();
    toast(I18N.t(r.scheduledFor ? 'team.deleteScheduled' : 'team.deleted'));
    return;
  }

  const r = await window.api.teamDeleteGroup(g.id);
  if (!r.ok) { toast(erroTime(r)); return; }
  Team.currentId = null;
  await loadTeam();
  toast(I18N.t('team.deleted'));
}

async function leaveTeamGroup() {
  if (Team.live) {
    // Dono sai DISSOLVENDO: o servidor não deixa o último dono
    // simplesmente abandonar o time (ficaria um grupo sem ninguém
    // que possa convidar ou promover). Perguntar a coisa certa
    // aqui evita o erro incompreensível lá.
    const g0 = currentGroup();
    const souDono = g0 && Team.me && String(g0.ownerId) === String(Team.me.userId);
    if (!await Ask.confirm(I18N.t(souDono ? 'team.confirmDissolve' : 'team.confirmLeave'))) return;
    const r = souDono ? await window.api.liveDissolve() : await window.api.liveLeave();
    if (!r.ok) { toast(erroTime(r)); return; }
    Team.currentId = null;
    await loadTeam();
    toast(I18N.t(souDono ? 'team.dissolved' : 'team.left'));
    return;
  }

  const g = currentGroup();
  if (!g) return;
  const dono = g.isOwner;
  if (!await Ask.confirm(I18N.t(dono ? 'team.confirmDissolve' : 'team.confirmLeave'))) return;
  const r = dono ? await window.api.teamDeleteGroup(g.id) : await window.api.teamLeaveGroup(g.id);
  if (!r.ok) { toast(erroTime(r)); return; }
  Team.currentId = null;
  await loadTeam();
}

// A posição é MANUAL de propósito. Num servidor comum o app não
// tem como saber onde o jogador está: o log do Unturned não traz
// coordenada e ler a memória do jogo é o que o BattlEye trata como
// cheat. Então: você clica no mapa e diz onde está.
async function shareMyPosition() {
  const g = currentGroup();
  if (!g) return;
  if (typeof MapView === 'undefined' || !MapView.image) { toast(I18N.t('map.noMap')); return; }

  toast(I18N.t('team.clickWhereYouAre'));
  // Mesma armadilha do "ver no mapa": desde que o time virou tela
  // própria, trocar a ABA do tracking não basta — a tela do tracking
  // pode estar escondida atrás da área do time, e a pessoa ficaria
  // olhando o painel do grupo esperando um mapa que não apareceu.
  if (typeof TeamView !== 'undefined' && TeamView.aberta) {
    TeamView.aberta = false;
    document.getElementById('view-team').classList.add('hidden');
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-tracking').classList.remove('hidden');
  }
  switchTrackingTab('map');
  MapView.awaitPositionPick = async (world) => {
    MapView.awaitPositionPick = null;
    const r = Team.live
      ? await window.api.livePosition({ x: world.x, z: world.z, map: MapView.mapName })
      : await window.api.teamSetPosition(g.id, {
          x: world.x, z: world.z, map: MapView.mapName,
          serverBmId: AppState.trackingId || null    // mesma razão do marcador
        });
    await loadTeam();
    // Ao vivo a posição depende do socket; sem ele não há para onde
    // mandar. Dizer "compartilhado" nesse caso seria mentir.
    if (r && r.ok === false) toast(erroTime(r));
    else toast(I18N.t('team.positionShared'));
  };
  MapView.setAddMode(false);
  MapView.canvas.style.cursor = 'crosshair';
}

// ------------------------------------------------------------
// Camada do grupo no mapa
// ------------------------------------------------------------
// Desenhada por cima dos marcadores locais, com cor própria, para
// nunca dar dúvida sobre o que é seu e o que é do grupo.
function drawTeamLayer(ctx) {
  if (!Team.showOnMap || !Team.currentId || !MapView.image) return;

  // Esta camada é desenhada com a transformação ZERADA, ou seja, em
  // pixels do BUFFER do canvas — que numa tela a 150% são 1,5× os
  // pixels que o CSS mostra. Então tudo que tem tamanho fixo (raio,
  // fonte, espessura) precisa ser multiplicado, senão o ponto do
  // grupo aparece com metade do tamanho do ponto local na mesma
  // tela. `markerCanvasPos` já devolve neste mesmo espaço.
  const k = MapView.dpr();

  for (const it of Team.items) {
    if (it.kind !== 'marker') continue;
    const p = MapView.markerCanvasPos({ x: it.data.x, z: it.data.z });
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#5cb8e0';
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = '#0c130e';
    ctx.stroke();
    ctx.font = `600 ${11 * k}px system-ui`;
    ctx.fillStyle = '#cfe9f6';
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 3 * k;
    const rotulo = `${it.data.name || ''} · ${it.authorName || ''}`;
    ctx.strokeText(rotulo, p.x + 10 * k, p.y + 4 * k);
    ctx.fillText(rotulo, p.x + 10 * k, p.y + 4 * k);
  }

  for (const pos of Team.positions) {
    const p = MapView.markerCanvasPos({ x: pos.x, z: pos.z });
    // Posição velha aparece esmaecida: mandar o grupo para onde
    // alguém estava há duas horas custa caro dentro do jogo.
    ctx.globalAlpha = pos.stale ? 0.35 : 1;

    // A FOTO no lugar da bolinha, quando ela existe. Numa partida
    // com quatro pessoas, quatro bolinhas amarelas idênticas
    // obrigam a ler quatro nomes para saber quem é quem; a cara da
    // pessoa é reconhecida antes de o olho chegar no texto.
    const img = imagemDeAvatar(fotoDoMembro(pos.userId), () => MapView.draw());
    let raio;
    if (img) {
      raio = 11 * k;
      fotoRedonda(ctx, img, p.x, p.y, raio, '#e6b450', k);
    } else {
      raio = 8 * k;
      ctx.beginPath();
      ctx.arc(p.x, p.y, raio, 0, Math.PI * 2);
      ctx.fillStyle = '#e6b450';
      ctx.fill();
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = '#1a1206';
      ctx.stroke();
    }

    // O nome afasta conforme o RAIO do que foi desenhado. Com um
    // deslocamento fixo, a foto (maior que a bolinha) ficava por
    // baixo das primeiras letras.
    const rotulo = nomeNoMapa(pos);
    const dx = p.x + raio + 5 * k;
    ctx.font = `700 ${11 * k}px system-ui`;
    ctx.fillStyle = '#ffe9b8';
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 3 * k;
    ctx.strokeText(rotulo, dx, p.y + 4 * k);
    ctx.fillText(rotulo, dx, p.y + 4 * k);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------
// COMPARTILHAR UMA ANOTAÇÃO
// ------------------------------------------------------------
// A Sara: o painel compartilhado "tem apenas o marcador" e precisa
// de mais coisas. Anotação é a próxima óbvia — é onde já mora o que
// a pessoa descobriu sobre o servidor.
//
// O QUE VAI, E O QUE NÃO VAI
//
// Vai o texto. NÃO vão os prints, e isso não é esquecimento: print é
// arquivo, e arquivo entre computadores é justamente o sistema de
// mídia efêmera que depende do servidor. Mandar o caminho local
// seria pior do que não mandar — do outro lado viraria uma imagem
// quebrada, e a pessoa acharia que perdeu a foto.
//
// Então o item compartilhado DIZ quantos prints a anotação tem, e
// que eles ficaram no computador de quem mandou. É uma informação
// verdadeira e útil ("pergunta pro fulano, ele tem foto disso") em
// vez de um link morto.
async function shareNoteWithTeam(note) {
  const g = currentGroup();
  if (!g) { toast(I18N.t('team.noGroup')); return; }
  if (!note) return;

  const prints = (note.shots || []).length;
  // Anotação presa a um marcador leva a coordenada junto: assim ela
  // também ganha o "ver no mapa" no painel compartilhado.
  const m = note.deMarcador ? acharMarcadorPorId(note.deMarcador) : null;

  const r = await window.api.teamCreateItem(g.id, {
    kind: 'note',
    data: {
      name: note.title || I18N.t('notes.untitled'),
      text: (typeof textoLimpo === 'function' ? textoLimpo(note.text) : String(note.text || ''))
        .slice(0, 4000),
      shotCount: prints,
      map: (typeof MapView !== 'undefined') ? MapView.mapName : null,
      ...(m ? { x: m.x, z: m.z, type: m.type } : {}),
      serverBmId: AppState.trackingId || null
    }
  });
  if (!r.ok) { toast(erroTime(r)); return; }
  await loadTeam();
  toast(prints
    ? I18N.t('team.noteSharedNoShots', { n: prints })
    : I18N.t('team.noteShared'));
}

// Enviar um marcador local para o grupo.
async function shareMarkerWithTeam(index) {
  const g = currentGroup();
  if (!g) { toast(I18N.t('team.noGroup')); return; }
  const m = MapView.markersData.markers[index];
  if (!m) return;
  const r = await window.api.teamCreateItem(g.id, {
    kind: 'marker',
    data: {
      name: m.name, x: m.x, z: m.z, type: m.type, map: MapView.mapName,
      // DE QUAL SERVIDOR. Sem isto, um marcador tirado no servidor A
      // aparecia no mapa do servidor B, onde aquela coordenada não
      // quer dizer nada. `AppState.trackingId` é o servidor aberto —
      // é dele que o marcador saiu.
      serverBmId: AppState.trackingId || null
    }
  });
  if (!r.ok) { toast(erroTime(r)); return; }
  await loadTeam();
  toast(I18N.t('team.shared'));
}

// ============================================================
// Sub-abas do grupo
// ============================================================
function switchTeamTab(nome) {
  const bar = document.getElementById('team-tabs');
  if (!bar) return;

  // ABA DESLIGADA.
  //
  // A voz fica visível e inerte: o áudio está pronto e a
  // sinalização depende do servidor. Escondê-la faria parecer que o
  // recurso nunca existiu; deixá-la clicável faria a pessoa cair
  // numa tela que só explica por que não funciona.
  //
  // Clicar responde — em vez de não fazer nada, que é
  // indistinguível de um botão quebrado.
  const alvo = bar.querySelector(`.team-tab[data-tt="${nome}"]`);
  if (alvo && alvo.classList.contains('off')) {
    toast(I18N.t('team.tabOff_' + nome));
    return;
  }

  Team.tab = nome;
  for (const b of document.querySelectorAll('#team-tabs .team-tab')) {
    b.classList.toggle('active', b.dataset.tt === nome);
  }
  for (const p of document.querySelectorAll('.team-pane')) {
    p.classList.toggle('hidden', p.id !== 'ttpane-' + nome);
  }
  if (nome === 'chat') loadChat();
  if (nome === 'voice') refreshVoiceDevices();
  if (nome === 'members') loadInvites();
  if (nome === 'servers' && typeof renderTeamServers === 'function') renderTeamServers(currentGroup());
  // O canvas do mapa do grupo tem tamanho ZERO enquanto o painel
  // está escondido, e desenhar nesse estado não pinta nada. Por
  // isso o redesenho é aqui, um quadro depois de o painel aparecer.
  if (nome === 'map' && typeof TeamMap !== 'undefined') {
    if (typeof renderTeamMapBar === 'function') renderTeamMapBar();
    requestAnimationFrame(() => { TeamMap.draw(); TeamMap.sincronizarLista(); });
  }
  if (nome === 'rules' && typeof renderTeamRules === 'function') renderTeamRules();
  if (nome === 'news' && typeof renderTeamNews === 'function') renderTeamNews();
  if (nome === 'notes' && typeof renderTeamNotes === 'function') renderTeamNotes(currentGroup());
  // A mesa desenha as linhas medindo os cartões — e cartão em
  // painel escondido mede zero. Por isso o desenho é um quadro
  // DEPOIS de a aba aparecer, e não junto com a troca.
  if (nome === 'board' && typeof BoardView !== 'undefined') {
    requestAnimationFrame(() => BoardView.montarTime(currentGroup()));
  }
}

// ============================================================
// CHAT
// ============================================================
function initTeamChat() {
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-media').addEventListener('click', attachMedia);
  document.getElementById('chat-new-channel').addEventListener('click', novoCanal);

  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', (e) => {
    // Enter envia, Shift+Enter quebra linha. É o que todo mundo já
    // espera de um chat; inverter isso irrita a cada mensagem.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  // A caixa cresce com o texto, até um teto.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  });

  // Ctrl+V com imagem cola direto no chat.
  input.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    const dataUrl = await new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
    });
    const r = await window.api.mediaFromDataUrl(dataUrl, Team.channelId);
    if (r.ok) { Team.attach.push(r.media); renderAttach(); }
    else toast(erroTime(r));
  });
}

async function loadChat() {
  // Ao vivo o histórico chega junto do estado do time; recarregar
  // aqui seria uma segunda ida ao servidor pela mesma coisa.
  if (Team.live) {
    // Os canais são uma consulta separada e podem não existir ainda
    // no servidor. Falhar aqui não pode derrubar o chat: sem canais,
    // o chat continua sendo a conversa única do time, que é o que
    // sempre foi.
    try {
      const r = await window.api.liveChannels();
      Team.channels = (r && r.ok) ? (r.channels || []) : [];
      Team.canaisNaApi = !!(r && r.ok);
    } catch { Team.channels = []; Team.canaisNaApi = false; }
    renderChannels(); renderChatLog(); renderChatBadge(); return;
  }

  const g = currentGroup();
  if (!g) return;
  Team.channels = (await window.api.teamChannels(g.id)) || [];
  Team.unread = (await window.api.teamUnread(g.id)) || {};
  if (!Team.channelId || !Team.channels.some((c) => c.id === Team.channelId)) {
    Team.channelId = Team.channels.length ? Team.channels[0].id : null;
  }
  Team.messages = Team.channelId ? (await window.api.teamMessages(Team.channelId)) || [] : [];
  renderChannels();
  renderChatLog();
  if (Team.channelId) {
    await window.api.teamMarkRead(g.id, Team.channelId);
    Team.unread[Team.channelId] = 0;
    renderChannels();
    renderChatBadge();
  }
}

function renderChatBadge() {
  const b = document.getElementById('tt-badge-chat');
  if (!b) return;
  const n = Object.values(Team.unread || {}).reduce((s, x) => s + x, 0);
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
}

function renderChannels() {
  // AO VIVO: os canais vêm do servidor (migração 003).
  //
  // Antes esta função desenhava um rótulo fixo "geral" e escondia o
  // botão de criar. Fazia sentido enquanto o servidor tinha uma
  // conversa por time e nada mais — mas a rota de canais existe, e
  // esconder o botão sem dizer por quê é o mesmo tipo de silêncio
  // que já custou caro aqui.
  //
  // Agora: se o servidor responde, os canais aparecem e dá para
  // criar. Se a rota ainda não subiu, o botão continua na tela e
  // EXPLICA — ver `criarCanalAoVivo`.
  if (Team.live) {
    const box = document.getElementById('chat-channel-list');
    if (box) {
      const lista = Team.channels && Team.channels.length
        ? Team.channels
        : [{ id: 'geral', name: I18N.t('team.liveChannel'), system: true }];
      box.innerHTML = lista.map((c) => `
        <button class="cc-item${(c.id === Team.channelId || lista.length === 1) ? ' on' : ''}"
                data-ch="${escapeHtml(c.id)}">
          <span class="cc-hash">#</span><span class="cc-name">${escapeHtml(c.name)}</span>
        </button>`).join('');
      box.onclick = async (e) => {
        const b = e.target.closest('[data-ch]');
        if (!b) return;
        Team.channelId = b.dataset.ch;
        renderChannels();
        renderChatLog();
      };
    }
    const novo = document.getElementById('chat-new-channel');
    // Criar canal é de admin — a mesma regra dos dois modos.
    if (novo) novo.classList.toggle('hidden', !Team.caps['channel.create']);
    // O clipe de anexo fica apagado enquanto a mídia não trafega
    // entre computadores. Apagado e clicável: o clique explica.
    const clipe = document.getElementById('chat-media');
    if (clipe) clipe.classList.add('off');
    return;
  }

  const box = document.getElementById('chat-channel-list');
  box.innerHTML = Team.channels.map((c) => {
    const n = Team.unread[c.id] || 0;
    return `<button class="cc-item${c.id === Team.channelId ? ' on' : ''}" data-ch="${escapeHtml(c.id)}">
      <span class="cc-hash">#</span><span class="cc-name">${escapeHtml(c.name)}</span>
      ${n ? `<span class="cc-badge">${n}</span>` : ''}
    </button>`;
  }).join('');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    Team.channelId = b.dataset.ch;
    await loadChat();
  };
  document.getElementById('chat-new-channel')
    .classList.toggle('hidden', !Team.caps['channel.create']);
}

function renderChatLog() {
  const box = document.getElementById('chat-log');
  if (!Team.messages.length) {
    // Estado vazio com peso: uma frase solta encostada no topo
    // parecia erro de carregamento. Centralizada, com o ícone da
    // aba, ela lê como "ainda não tem nada aqui" — que é o que é.
    box.innerHTML = `<div class="chat-empty">
      ${Icon.svg('comment', 30)}
      <p>${escapeHtml(I18N.t('team.noMessages'))}</p>
    </div>`;
    return;
  }
  const eu = Team.me ? Team.me.userId : null;
  box.innerHTML = Team.messages.map((m) => {
    if (m.deleted) {
      return `<div class="cm cm-gone"><em>${escapeHtml(I18N.t('team.messageDeleted'))}</em></div>`;
    }
    const meu = m.authorId === eu;
    const podeApagar = meu || Team.caps['chat.deleteAny'];
    const midia = (m.mediaFull || []).filter(Boolean);
    return `
      <div class="cm${meu ? ' mine' : ''}" data-msg="${escapeHtml(m.id)}">
        <div class="cm-head">
          <strong>${escapeHtml(m.authorName || '')}</strong>
          <time>${escapeHtml(horaCurta(m.at))}</time>
          ${m.editedAt ? `<em class="cm-edited">${escapeHtml(I18N.t('team.edited'))}</em>` : ''}
          ${podeApagar ? `<button class="cm-del" data-act="del">${Icon.svg('close', 12)}</button>` : ''}
        </div>
        ${m.text ? `<p class="cm-text">${escapeHtml(m.text)}</p>` : ''}
        ${midia.length ? `<div class="cm-media">${midia.map((x, i) => x.kind === 'video'
          ? `<video class="cm-vid" controls preload="metadata" src="${escapeHtml(x.url)}"></video>`
          : `<button class="cm-img" data-act="zoom" data-i="${i}"><img src="${escapeHtml(x.thumbUrl || x.url)}" alt="" loading="lazy"></button>`
        ).join('')}</div>` : ''}
      </div>`;
  }).join('');

  box.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-msg]');
    if (!btn || !card) return;
    const msg = Team.messages.find((m) => m.id === card.dataset.msg);
    if (!msg) return;
    if (btn.dataset.act === 'del') {
      if (!await Ask.confirm(I18N.t('team.confirmDeleteMsg'))) return;
      const r = Team.live
        ? await window.api.liveDeleteMessage(msg.id)
        : await window.api.teamDeleteMessage(msg.id);
      if (!r.ok) toast(erroTime(r));
      await loadChat();
    } else if (btn.dataset.act === 'zoom') {
      const midia = (msg.mediaFull || []).filter(Boolean);
      openShotLightbox(midia.map((x) => ({ url: x.url, bytes: x.bytes })), Number(btn.dataset.i));
    }
  };
  // Chat rola para o fim: o que importa é a última mensagem.
  box.scrollTop = box.scrollHeight;
}

function horaCurta(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' });
}

function renderAttach() {
  const box = document.getElementById('chat-attach');
  box.classList.toggle('hidden', !Team.attach.length);
  box.innerHTML = Team.attach.map((m, i) => `
    <div class="ca-item">
      ${m.kind === 'video' ? Icon.svg('video', 20) : `<img src="${escapeHtml(m.thumbUrl || m.url)}" alt="">`}
      <button data-rm="${i}">${Icon.svg('close', 12)}</button>
    </div>`).join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    Team.attach.splice(Number(b.dataset.rm), 1);
    renderAttach();
  };
}

async function attachMedia() {
  // O BUG QUE ISTO CONSERTA
  //
  // No modo ao vivo, `sendChat` mandava só o texto e ignorava
  // `Team.attach` — em silêncio. A pessoa escolhia a foto, via a
  // miniatura no compositor, apertava enviar, e a mensagem chegava
  // sem imagem nenhuma. Nada na tela dizia que a foto tinha sido
  // descartada.
  //
  // Mandar foto entre computadores é o servidor de mídia, que
  // depende do deploy. Enquanto ele não sobe, o botão AVISA em vez
  // de aceitar um anexo que vai ser jogado fora.
  if (Team.live) {
    toast(I18N.t('team.mediaNeedsDeploy'));
    return;
  }
  const r = await window.api.mediaPick(Team.channelId);
  if (!r.ok) return;
  Team.attach.push(...(r.media || []));
  renderAttach();
  // Arquivo recusado precisa aparecer: sumir em silêncio faz a
  // pessoa achar que anexou.
  for (const rej of r.rejected || []) {
    toast(I18N.t(rej.reason === 'too_big' ? 'team.tooBig' : 'team.badType',
      { file: rej.file, mb: Math.round((rej.limit || 0) / 1048576) }));
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');

  // Ao vivo: uma conversa por time (a que o servidor cria junto com
  // ele), sem canais. Canais múltiplos exigem uma conversa por
  // canal no servidor; enquanto isso não existe, oferecer a aba
  // seria prometer o que não entrega.
  if (Team.live) {
    const txt = (input.value || '').trim();
    // Cinto e suspensório: se um anexo chegar aqui de algum jeito,
    // ele não pode sumir calado. Ou vai junto, ou a pessoa fica
    // sabendo que não foi.
    if (Team.attach.length) {
      toast(I18N.t('team.mediaNeedsDeploy'));
      return;
    }
    if (!txt) return;
    const r = await window.api.liveSend(txt);
    if (!r.ok) { toast(erroTime(r)); return; }
    input.value = '';
    input.style.height = 'auto';
    await loadTeam();
    return;
  }

  if (!Team.channelId) return;
  const text = input.value;
  if (!text.trim() && !Team.attach.length) return;
  const r = await window.api.teamSend(Team.channelId, {
    text, media: Team.attach.map((m) => m.id)
  });
  if (!r.ok) { toast(erroTime(r)); return; }
  input.value = '';
  input.style.height = 'auto';
  Team.attach = [];
  renderAttach();
  await loadChat();
}

async function novoCanal() {
  const g = currentGroup();
  const nome = await Ask.text(I18N.t('team.askChannel'));
  if (!nome) return;

  if (Team.live) {
    const r = await window.api.liveCreateChannel({ name: nome });
    if (!r.ok) {
      // `needs_deploy` não é erro da pessoa nem culpa dela: é o
      // servidor que ainda não tem a rota. Merece frase própria, e
      // não o "não deu certo" genérico que faz procurar defeito no
      // que se digitou.
      toast(I18N.t(r.error === 'needs_deploy' ? 'team.channelsNeedDeploy' : 'team.err_generic'));
      return;
    }
    Team.channelId = r.channel && r.channel.id;
    await loadChat();
    toast(I18N.t('team.channelCreated', { name: nome }));
    return;
  }

  const r = await window.api.teamCreateChannel(g.id, { name: nome });
  if (!r.ok) { toast(erroTime(r)); return; }
  Team.channelId = r.channel.id;
  await loadChat();
}

// ============================================================
// CONVITES
// ============================================================
function initTeamInvites() {
  document.getElementById('invite-create').addEventListener('click', criarConvite);
  document.getElementById('inv-close').addEventListener('click', () => hideModal('modal-invite'));
  document.getElementById('inv-copy-both').addEventListener('click', () => {
    const c = document.getElementById('inv-code').textContent;
    const p = document.getElementById('inv-pass').textContent;
    window.api.copyText(I18N.t('team.inviteShare', { code: c, pass: p }));
    toast(I18N.t('team.copied'));
  });
  document.getElementById('modal-invite').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    window.api.copyText(document.getElementById(b.dataset.copy).textContent);
    toast(I18N.t('team.copied'));
  });
  document.getElementById('join-confirm').addEventListener('click', confirmJoin);
  document.getElementById('join-cancel').addEventListener('click', () => hideModal('modal-join'));
  document.getElementById('join-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmJoin();
  });
}

async function loadInvites() {
  // Ao vivo a lista vem do servidor. O formato do banco é
  // snake_case e traz datas cruas; o "morto ou vivo" é conta de
  // quem desenha, não coluna. Traduzir aqui deixa `renderInvites`
  // com um formato só para cuidar.
  if (Team.live) {
    if (!Team.liveTeamId) { Team.invites = []; Team.bans = []; renderInvites(); renderBans(); return; }
    const r = await window.api.liveInvites();
    if (!r.ok) {
      // Sem permissão para listar convite não é erro: é a resposta
      // certa para quem é membro comum. A caixa some e pronto.
      Team.invites = [];
      Team.bans = [];
      renderInvites();
      renderBans();
      return;
    }
    const agora = Date.now();
    Team.invites = (r.invites || []).map((i) => {
      const max = Number(i.max_uses ?? i.maxUses ?? 0);
      const usos = Number(i.uses || 0);
      const exp = i.expires_at || i.expiresAt;
      return {
        id: i.id,
        code: i.code,
        role: i.role,
        uses: usos,
        maxUses: max,
        revoked: !!(i.revoked_at || i.revokedAt),
        expired: !!(exp && new Date(exp).getTime() < agora),
        exhausted: max > 0 && usos >= max
      };
    });
    // Banidos do servidor ainda não têm rota de listagem; a caixa
    // fica vazia em vez de mostrar dado do modo local, que seria
    // de outro grupo.
    Team.bans = [];
    renderInvites();
    renderBans();
    return;
  }

  const g = currentGroup();
  if (!g) return;
  Team.invites = (await window.api.teamInvites(g.id)) || [];
  Team.bans = (await window.api.teamBans(g.id)) || [];
  renderInvites();
  renderBans();
}

function renderInvites() {
  const box = document.getElementById('invite-list');
  document.getElementById('invite-actions').classList.toggle('hidden', !Team.caps['member.invite']);

  const sel = document.getElementById('invite-role');
  sel.innerHTML = Team.assignable
    .map((r) => `<option value="${r}">${escapeHtml(I18N.t('team.role_' + r))}</option>`).join('');

  // Convites mortos vão para o fim: o que interessa é o que ainda
  // deixa alguém entrar. Antes eles ficavam na ordem de criação e
  // um convite revogado de ontem aparecia acima do válido de hoje.
  const vivos = Team.invites.filter((i) => !(i.revoked || i.expired || i.exhausted));
  const mortos = Team.invites.filter((i) => (i.revoked || i.expired || i.exhausted));
  const lista = [...vivos, ...mortos];

  const cont = document.getElementById('invites-count');
  if (cont) {
    cont.textContent = vivos.length ? String(vivos.length) : '';
    cont.title = vivos.length ? I18N.t('team.activeInvites', { n: vivos.length }) : '';
  }

  if (!lista.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('team.noInvites'))}</p>`;
    return;
  }
  box.innerHTML = lista.map((i) => {
    const morto = i.revoked || i.expired || i.exhausted;
    const estado = i.revoked ? 'team.invRevoked' : i.expired ? 'team.invExpired'
      : i.exhausted ? 'team.invUsedUp' : 'team.invActive';
    const usos = i.maxUses
      ? I18N.t('team.invUses', { n: i.uses, max: i.maxUses })
      : I18N.t('team.invUsesFree', { n: i.uses });
    return `<div class="inv-row${morto ? ' dead' : ''}">
      <span class="inv-main">
        <code class="inv-code">${escapeHtml(i.code)}</code>
        <span class="inv-meta">
          <span class="role-chip xs ${escapeHtml(i.role)}">${escapeHtml(I18N.t('team.role_' + i.role))}</span>
          <span class="inv-uses">${escapeHtml(usos)}</span>
        </span>
      </span>
      <span class="inv-state ${morto ? 'dead' : 'live'}">${escapeHtml(I18N.t(estado))}</span>
      ${morto ? '' : `<button class="tm-act danger" data-revoke="${escapeHtml(i.id)}"
                        title="${escapeHtml(I18N.t('team.revoke'))}">${Icon.svg('ban', 14)}</button>`}
    </div>`;
  }).join('');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-revoke]');
    if (!b) return;
    if (!await Ask.confirm(I18N.t('team.confirmRevoke'))) return;
    const r = Team.live
      ? await window.api.liveRevoke(Number(b.dataset.revoke))
      : await window.api.teamRevokeInvite(b.dataset.revoke);
    if (r && r.ok === false) toast(erroTime(r));
    await loadInvites();
  };
}

function renderBans() {
  const box = document.getElementById('team-bans');
  // "Banidos: ninguém banido" é uma seção que só ocupa espaço para
  // dizer que não tem nada. Ela aparece quando passa a ter.
  const wrap = document.getElementById('team-bans-wrap');
  if (wrap) wrap.classList.toggle('hidden', !Team.bans.length);
  if (!Team.bans.length) { box.innerHTML = ''; return; }
  box.innerHTML = Team.bans.map((b) => `
    <div class="tm-row"><span class="tm-name">${escapeHtml(b.userId)}</span>
    <span class="muted small">${escapeHtml(b.reason || '')}</span></div>`).join('');
}

async function criarConvite() {
  const g = currentGroup();
  const role = document.getElementById('invite-role').value || 'member';

  const r = Team.live
    ? await window.api.liveInvite({ role })
    : await window.api.teamCreateInvite(g.id, { role });
  if (!r.ok) { toast(erroTime(r)); return; }

  document.getElementById('inv-code').textContent = r.invite.code;
  document.getElementById('inv-pass').textContent = r.password;
  showModal('modal-invite');
  // A lista recarrega nos dois modos: o convite que acabou de sair
  // precisa aparecer nela, senão a pessoa fecha o modal e acha que
  // não gerou nada.
  await loadInvites();
}

// ============================================================
// VOZ
// ============================================================
function initTeamVoice() {
  if (typeof Voice === 'undefined') return;
  initPushToTalk();

  Voice.onLevel = (v) => {
    const bar = document.getElementById('voice-level');
    if (bar) bar.style.width = Math.round(v * 100) + '%';
  };
  Voice.onPeers = renderVoicePeers;

  document.getElementById('voice-test').addEventListener('click', testarVoz);
  document.getElementById('voice-refresh-dev').addEventListener('click', refreshVoiceDevices);
  document.getElementById('voice-input').addEventListener('change', async (e) => {
    Voice.inputDeviceId = e.target.value || null;
    if (Voice.localStream) { voiceStop(); await voiceStart(); }
  });
  document.getElementById('voice-output').addEventListener('change',
    (e) => voiceSetOutput(e.target.value));
  document.getElementById('voice-gain').addEventListener('input',
    (e) => voiceSetGain(Number(e.target.value) / 100));
  document.getElementById('voice-ptt').addEventListener('change', (e) => {
    Voice.pushToTalk = e.target.checked;
    applyMute();
    toast(I18N.t(e.target.checked ? 'voice.pttOn' : 'voice.pttOff'));
  });
  document.getElementById('voice-mute').addEventListener('click', () => {
    setMuted(!Voice.muted);
    document.getElementById('voice-mute').classList.toggle('active', Voice.muted);
  });
  document.getElementById('voice-deafen').addEventListener('click', () => {
    setDeafened(!Voice.deafened);
    document.getElementById('voice-deafen').classList.toggle('active', Voice.deafened);
    document.getElementById('voice-mute').classList.toggle('active', Voice.muted);
  });
}

async function refreshVoiceDevices() {
  if (typeof listDevices !== 'function') return;
  const d = await listDevices();
  const inp = document.getElementById('voice-input');
  const out = document.getElementById('voice-output');
  // Sem permissão, o navegador devolve a lista com os rótulos em
  // branco. Dizemos isso em vez de mostrar itens sem nome.
  const rotulo = (x, i) => x.label || I18N.t('voice.unnamed', { n: i + 1 });
  inp.innerHTML = d.inputs.map((x, i) => `<option value="${escapeHtml(x.id)}">${escapeHtml(rotulo(x, i))}</option>`).join('')
    || `<option value="">${escapeHtml(I18N.t('voice.noDevices'))}</option>`;
  out.innerHTML = d.outputs.map((x, i) => `<option value="${escapeHtml(x.id)}">${escapeHtml(rotulo(x, i))}</option>`).join('')
    || `<option value="">${escapeHtml(I18N.t('voice.noDevices'))}</option>`;
}

async function testarVoz() {
  const box = document.getElementById('voice-result');
  box.classList.remove('hidden');
  box.innerHTML = `<span class="muted">${escapeHtml(I18N.t('voice.testing'))}</span>`;

  const r = await voiceSelfTest();
  await refreshVoiceDevices();   // os rótulos só aparecem depois da permissão

  if (r.ok) {
    box.innerHTML = [
      `<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('voice.okMic'))}</span>`,
      `<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('voice.okRtc', { n: r.tracks }))}</span>`,
      `<span class="muted">${escapeHtml(I18N.t('voice.okNote'))}</span>`
    ].join('<br>');
    return;
  }
  const chave = r.stage === 'microphone' ? 'voice.err_' + r.reason : 'voice.err_' + r.stage;
  const txt = I18N.t(chave);
  box.innerHTML = `<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(txt === chave ? r.reason || r.stage : txt)}</span>`;
}

function renderVoicePeers(lista) {
  const box = document.getElementById('voice-peers');
  if (!box) return;
  if (!lista || !lista.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('voice.empty'))}</p>`;
    return;
  }
  box.innerHTML = lista.map((p) => `
    <div class="vp-row">
      <span class="vp-dot ${p.state === 'connected' ? 'on' : ''}"></span>
      <span class="vp-name">${escapeHtml(p.userId)}</span>
      <span class="muted small">${escapeHtml(p.state)}</span>
    </div>`).join('');
}
