// ============================================================
// help.js — "info tags", introdução do primeiro uso, menu da
// conta, abas do tracking e o selo de notícias.
//
// Tudo aqui existe por um motivo só: o app vai para a mão de
// gente que não acompanhou o desenvolvimento. Cada botão "?" é uma
// frase curta no lugar onde a dúvida aparece — não um manual em
// outra tela, que ninguém abre.
//
// O "?" é um botão de verdade, não title="". O title do navegador
// demora ~1s, some sozinho e não aceita quebra de linha; e no
// Electron ele fica feio fora do tema. Aqui o balão abre no hover
// E no clique (para quem usa touch ou teclado).
// ============================================================

// ------------------------------------------------------------
// Info tags ("?")
// ------------------------------------------------------------
const Help = { bubble: null, current: null, hideTimer: null };

function initHelp() {
  Help.bubble = document.getElementById('help-bubble');
  if (!Help.bubble) return;

  // Delegado no documento: os "?" nascem e morrem junto com os
  // cards renderizados, então não dá para pendurar listener neles.
  document.addEventListener('mouseover', (e) => {
    const dot = e.target.closest('.help-dot');
    if (dot) showHelp(dot);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.help-dot')) scheduleHideHelp();
  });
  document.addEventListener('click', (e) => {
    const dot = e.target.closest('.help-dot');
    if (dot) {
      e.preventDefault();
      e.stopPropagation();   // não dispara o clique do card/label por baixo
      if (Help.current === dot) hideHelp(); else showHelp(dot);
    } else if (!e.target.closest('#help-bubble')) {
      hideHelp();
    }
  }, true);

  // O balão fica preso na posição de quando abriu; rolar a página
  // deixaria ele flutuando no lugar errado.
  window.addEventListener('scroll', hideHelp, true);
  window.addEventListener('resize', hideHelp);

  Help.bubble.addEventListener('mouseenter', () => clearTimeout(Help.hideTimer));
  Help.bubble.addEventListener('mouseleave', scheduleHideHelp);

  applyHelpVisibility();
}

function showHelp(dot) {
  if (!helpEnabled()) return;
  clearTimeout(Help.hideTimer);
  const key = dot.dataset.help;
  const text = I18N.t(key);
  // Chave sem tradução voltaria como o próprio nome da chave, e o
  // usuário veria "backup.shotsHelp" num balão. Melhor não abrir.
  if (!text || text === key) return;

  Help.current = dot;
  Help.bubble.textContent = text;
  Help.bubble.classList.remove('hidden');

  const r = dot.getBoundingClientRect();
  const b = Help.bubble.getBoundingClientRect();
  let left = r.left + r.width / 2 - b.width / 2;
  let top = r.bottom + 8;
  // Não deixa sair da tela por nenhum dos quatro lados.
  left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
  if (top + b.height > window.innerHeight - 8) top = r.top - b.height - 8;
  Help.bubble.style.left = left + 'px';
  Help.bubble.style.top = Math.max(8, top) + 'px';
}

function scheduleHideHelp() {
  clearTimeout(Help.hideTimer);
  Help.hideTimer = setTimeout(hideHelp, 180);
}

function hideHelp() {
  clearTimeout(Help.hideTimer);
  Help.current = null;
  if (Help.bubble) Help.bubble.classList.add('hidden');
}

function helpEnabled() {
  return !AppState.config || AppState.config.helpDots !== false;
}

// Desligar não remove os "?" do DOM — só some com eles no CSS.
// Assim religar é instantâneo e não exige re-render de nada.
function applyHelpVisibility() {
  document.body.classList.toggle('no-help', !helpEnabled());
  if (!helpEnabled()) hideHelp();
}

// ------------------------------------------------------------
// Abas do tracking
//
// O painel único empilhava informação, mapa, jogadores e log num
// scroll infinito e as coisas se sobrepunham. Cada aba agora é um
// pedaço; a de mapa avisa o canvas para se redesenhar, porque um
// canvas escondido tem largura 0 e desenharia em branco.
// ------------------------------------------------------------
const TrackingTabs = { current: 'overview' };

function initTrackingTabs() {
  const bar = document.getElementById('tk-tabs');
  if (!bar) return;
  for (const btn of bar.querySelectorAll('.tk-tab')) {
    btn.addEventListener('click', () => switchTrackingTab(btn.dataset.tk));
  }
}

function switchTrackingTab(name) {
  const bar = document.getElementById('tk-tabs');
  if (!bar) return;
  TrackingTabs.current = name;

  for (const btn of bar.querySelectorAll('.tk-tab')) {
    btn.classList.toggle('active', btn.dataset.tk === name);
  }
  for (const pane of document.querySelectorAll('.tk-pane')) {
    pane.classList.toggle('hidden', pane.id !== 'tkpane-' + name);
  }

  if (name === 'map') {
    // O canvas mediu 0 enquanto estava escondido.
    requestAnimationFrame(() => { if (MapView.canvas) MapView.draw(); });
  }
  if (name === 'notes') refreshTrackingNotes();
  // A mesa mede os cartões para desenhar as linhas, e cartão em
  // painel escondido mede zero. Por isso o desenho é um quadro
  // depois de o painel aparecer.
  if (name === 'board' && typeof BoardView !== 'undefined') {
    requestAnimationFrame(() => BoardView.montarServidor());
  }
  if (name === 'team' && typeof loadTeam === 'function') loadTeam();
  // Inventário e bases do servidor: carrega na primeira vez que a
  // aba aparece (e quando o servidor mudou desde a última).
  if (name === 'inventory' && typeof openInventoryTab === 'function') openInventoryTab();
  if (name === 'logs' && typeof LogView !== 'undefined' && LogView.tab === 'live') loadLogEvents();
}

// Painel de notas do servidor em foco.
async function refreshTrackingNotes() {
  const box = document.getElementById('tk-notes');
  if (!box || !AppState.trackingId) return;
  const scope = 'server:' + AppState.trackingId;
  if (!NotesPanel.state(box) || NotesPanel.state(box).scope !== scope) {
    await NotesPanel.mount(box, scope, { onChange: setNotesBadge });
  } else {
    await NotesPanel.reload(box);
  }
}

// O painel já sabe quantas notas carregou; contar de novo pelo
// disco seria uma segunda leitura para chegar ao mesmo número.
function setNotesBadge(notes) {
  const n = (notes || []).length;
  const badge = document.getElementById('tab-badge-notes');
  const count = document.getElementById('notes-count');
  if (badge) { badge.textContent = n; badge.classList.toggle('hidden', !n); }
  if (count) count.textContent = n;
}

// Usado quando o servidor abre e a aba de notas ainda nem foi vista.
async function updateNotesBadge() {
  if (!AppState.trackingId) return;
  const scope = 'server:' + AppState.trackingId;
  const c = await window.api.notesCounts([scope]);
  setNotesBadge(new Array((c[scope] || {}).notes || 0));
}

// ------------------------------------------------------------
// Card do marcador
//
// Um card só faz as duas coisas: criar e editar. Nome e tipo ficam
// aqui dentro — antes eram digitados numa barra ANTES do clique no
// mapa, o que obriga a batizar um ponto que você ainda não viu.
//
// Criar agora é: clica no mapa -> o card abre com o nome vazio e o
// cursor nele -> escreve, escolhe o tipo, anexa foto, salva.
// ------------------------------------------------------------
const MarkerCard = { index: null, novo: false, cover: null, dirty: false };

function initMarkerCard() {
  const modal = document.getElementById('modal-marker');
  if (!modal) return;

  document.getElementById('mkc-close').addEventListener('click', closeMarkerCard);
  document.getElementById('mkc-save').addEventListener('click', () => saveMarkerCard(true));
  document.getElementById('mkc-delete').addEventListener('click', deleteMarkerFromCard);
  document.getElementById('mkc-goto').addEventListener('click', () => {
    const m = markerAtCard();
    if (!m) return;
    saveMarkerCard(false);
    hideModal('modal-marker');
    centerMapOnMarker(MarkerCard.index);
  });

  document.getElementById('mkc-name').addEventListener('input', () => { MarkerCard.dirty = true; });
  document.getElementById('mkc-duplicate').addEventListener('click', duplicateOfficialMarker);
  document.getElementById('mkc-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveMarkerCard(true);
  });

  document.getElementById('mkc-types').addEventListener('click', (e) => {
    const chip = e.target.closest('.type-chip');
    if (!chip) return;
    const m = markerAtCard();
    if (!m) return;
    // Guarda o que já foi digitado ANTES de redesenhar. Sem isto,
    // trocar o tipo no meio da digitação apagava o nome: o render
    // reescreve o campo a partir do modelo, que ainda estava vazio.
    commitMarkerName();
    m.type = chip.dataset.type;
    m.auto = false;
    MapView.lastMarkerType = m.type;   // o próximo marcador nasce do mesmo tipo
    MarkerCard.dirty = true;
    renderMarkerCard();
    MapView.draw();
  });

  document.getElementById('mkc-cover-pick').addEventListener('click', pickMarkerCover);

  // Mover: fecha o card, o próximo clique no mapa é o destino. É o
  // caminho para quem achou o ponto pela lista — quem já está com
  // ele na tela arrasta direto (modo ✋ ou Shift).
  document.getElementById('mkc-move').addEventListener('click', () => {
    const m = markerAtCard();
    if (!m) return;
    saveMarkerCard(false);
    const index = MarkerCard.index;
    if (MapView.pedirNovaPosicao(index, () => openMarkerCard(index))) {
      hideModal('modal-marker');
      const painel = document.getElementById('panel-map');
      if (painel) painel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function markerAtCard() {
  return MapView.markersData.markers[MarkerCard.index] || null;
}

// Passa o texto do campo para o modelo. Chamado antes de qualquer
// re-render do card — é o que impede o formulário de comer o que
// você acabou de escrever.
function commitMarkerName() {
  const el = document.getElementById('mkc-name');
  const m = markerAtCard();
  if (!el || !m) return;
  // Local oficial não muda de nome nem por caminho indireto. O
  // campo já é readOnly, mas a trava fica aqui também: é este
  // ponto que TODO caminho de gravação atravessa.
  if (m.official) return;
  const v = el.value.trim();
  if (v && v !== m.name) { m.name = v; MarkerCard.dirty = true; }
}

// A saída honesta para quem quer um nome próprio: cria um marcador
// SEU na mesma coordenada, com o local oficial no nome, e deixa o
// oficial intacto. Melhor do que converter o oficial em manual, que
// é o que acontecia antes — ali o nome do mapa se perdia para
// sempre e o índice de locais ficava com um buraco.
async function duplicateOfficialMarker() {
  const m = markerAtCard();
  if (!m) return;
  const copia = {
    id: 'mk_' + Math.random().toString(36).slice(2, 10),
    name: m.name,
    type: 'custom',
    x: m.x, z: m.z
  };
  MapView.markersData.markers.push(copia);
  await MapView.saveMarkers();
  MapView.draw();
  openMarkerCard(MapView.markersData.markers.length - 1, { novo: true });
  toast(I18N.t('markers.duplicated'));
}

function openMarkerCard(index, opts = {}) {
  const m = MapView.markersData.markers[index];
  if (!m) return;
  if (!m.id) { m.id = 'mk_' + Math.random().toString(36).slice(2, 10); MapView.saveMarkers(); }
  MarkerCard.index = index;
  MarkerCard.novo = !!opts.novo;
  MarkerCard.dirty = false;
  renderMarkerCard();
  showModal('modal-marker');
  // Ao criar, o cursor já vai para o nome: é a única coisa que
  // falta para o ponto ficar útil.
  if (MarkerCard.novo) {
    const el = document.getElementById('mkc-name');
    setTimeout(() => { el.focus(); el.select(); }, 40);
  }
}

async function renderMarkerCard() {
  const m = markerAtCard();
  if (!m) return;
  const st = MapView.style(m.type);

  const nomeEl = document.getElementById('mkc-name');
  nomeEl.value = m.name || '';
  document.getElementById('mkc-coords').textContent = `X ${m.x}  ·  Z ${m.z}`;
  document.getElementById('mkc-cover-ico').innerHTML = MapView.iconHtml(m.type, 18);

  // Local oficial do jogo: o NOME é só leitura. O resto do card
  // (nota, foto, capa) continua aberto — o que é seu fica junto do
  // que é do mapa, sem sobrescrever.
  const oficial = !!m.official;
  nomeEl.readOnly = oficial;
  nomeEl.classList.toggle('locked', oficial);
  nomeEl.title = oficial ? I18N.t('markers.officialLocked') : '';
  document.getElementById('mkc-locked').classList.toggle('hidden', !oficial);
  // Local oficial não se move: a coordenada dele é a referência que
  // o índice de locais usa para dizer onde as outras coisas ficam.
  const btnMover = document.getElementById('mkc-move');
  btnMover.disabled = oficial;
  btnMover.title = oficial ? I18N.t('markers.moveLocked') : '';
  // Trocar o TIPO de um local oficial também descaracteriza: ele
  // deixaria de contar como referência no índice de locais.
  for (const chip of document.querySelectorAll('#mkc-types .type-chip')) {
    chip.classList.toggle('on', chip.dataset.type === m.type);
    chip.disabled = oficial;
  }

  const src = document.getElementById('mkc-source');
  src.textContent = m.auto ? I18N.t(oficial ? 'markers.official' : 'markers.auto') : '';
  src.classList.toggle('hidden', !m.auto);

  // Onde este ponto fica. Para o próprio local oficial não faz
  // sentido ("Novosibirsk está em Novosibirsk").
  const onde = document.getElementById('mkc-where');
  const txt = oficial ? '' : (MapView.whereIsText ? MapView.whereIsText(m.x, m.z) : '');
  onde.innerHTML = txt ? Icon.svg('pin', 12) + ' ' + escapeHtml(txt) : '';
  onde.classList.toggle('hidden', !txt);

  renderMarkerCover(m);
  // Marcador do tipo Base: atalho para o layout da base.
  if (typeof basesMarkerBlock === 'function') basesMarkerBlock(m);

  const box = document.getElementById('mkc-notes');
  const scope = `marker:${MapView.mapName}:${m.id}`;
  if (!NotesPanel.state(box) || NotesPanel.state(box).scope !== scope) {
    await NotesPanel.mount(box, scope, {
      compact: true,
      onChange: () => offerCoverFromNotes(markerAtCard() || m)
    });
  } else {
    await NotesPanel.reload(box);
  }
}

async function renderMarkerCover(m) {
  const img = document.getElementById('mkc-cover-img');
  const vazio = document.getElementById('mkc-cover-empty');
  if (!m.cover) {
    img.removeAttribute('src'); img.style.display = 'none';
    vazio.classList.remove('hidden');
    return;
  }
  const meta = await window.api.shotMeta(m.cover);
  if (!meta) {
    // A capa apontava para um print que não existe mais.
    m.cover = null;
    await MapView.saveMarkers();
    img.style.display = 'none'; vazio.classList.remove('hidden');
    return;
  }
  img.src = meta.url; img.style.display = '';
  vazio.classList.add('hidden');
}

// Se o ponto ainda não tem capa e você acabou de anexar um print
// numa anotação dele, o primeiro vira capa sozinho. É quase sempre
// o que se quer, e continua trocável pelo botão.
async function offerCoverFromNotes(m) {
  if (m.cover) return;
  const notas = await window.api.notesList(`marker:${MapView.mapName}:${m.id}`);
  for (const n of notas || []) {
    const s = (n.shots || []).find((x) => !x.missing);
    if (s) { m.cover = s.id; await MapView.saveMarkers(); renderMarkerCover(m); return; }
  }
}

async function pickMarkerCover() {
  const m = markerAtCard();
  if (!m) return;
  commitMarkerName();
  const add = await window.api.shotsPick();
  if (!add || !add.length) return;
  m.cover = add[0].id;
  MarkerCard.dirty = true;
  await MapView.saveMarkers();
  renderMarkerCover(m);
  toast(I18N.t('markers.coverSet'));
}

async function saveMarkerCard(fechar) {
  const m = markerAtCard();
  if (!m) return;
  commitMarkerName();
  if (!String(m.name || '').trim()) m.name = I18N.t('map.markerDefault');
  if (MarkerCard.dirty) m.auto = false;
  await MapView.saveMarkers();
  MapView.draw();
  MarkerCard.novo = false;
  MarkerCard.dirty = false;
  if (fechar) {
    hideModal('modal-marker');
    toast(I18N.t('markers.saved'));
  }
}

// Fechar sem nome num ponto recém-criado seria deixar lixo no mapa;
// salvamos com o nome padrão em vez de perguntar.
function closeMarkerCard() {
  commitMarkerName();
  const m = markerAtCard();
  if (m && !String(m.name || '').trim()) {
    m.name = I18N.t('map.markerDefault');
    MapView.saveMarkers();
    MapView.draw();
  } else if (MarkerCard.dirty) {
    saveMarkerCard(false);
  }
  hideModal('modal-marker');
}

async function deleteMarkerFromCard() {
  const m = markerAtCard();
  if (!m) return;
  if (!await Ask.confirm(I18N.t('markers.confirmDeleteOne', { name: m.name || '' }))) return;
  // As anotações do ponto morrem com ele — ficariam órfãs, presas
  // a um id que nada mais referencia.
  if (m.id) {
    await window.api.notesDeleteScope(`marker:${MapView.mapName}:${m.id}`);
    // As MENÇÕES em anotações gerais também têm que sair: um id que
    // não aponta mais para nada viraria um chip morto para sempre.
    await window.api.notesForgetMarker(m.id);
  }
  MapView.markersData.markers.splice(MarkerCard.index, 1);
  await MapView.saveMarkers();
  MapView.draw();
  hideModal('modal-marker');
  toast(I18N.t('map.markerRemoved', { name: m.name || '' }));
}

// ------------------------------------------------------------
// Menu da conta (canto superior direito)
// ------------------------------------------------------------
function initUserMenu() {
  const btn = document.getElementById('btn-user');
  const menu = document.getElementById('user-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) renderUserMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add('hidden');
  });

  document.getElementById('um-connect').addEventListener('click', () => {
    menu.classList.add('hidden');
    openSettings();
    setSettingsTab('steam');
  });
  document.getElementById('um-profile').addEventListener('click', () => {
    const id = AppState.config.steam && AppState.config.steam.steamId;
    if (id) window.api.openExternal(`https://steamcommunity.com/profiles/${id}`);
    menu.classList.add('hidden');
  });
  document.getElementById('um-friends').addEventListener('click', () => {
    menu.classList.add('hidden');
    closeTracking();
    const sec = document.getElementById('section-friends');
    if (sec && !sec.classList.contains('hidden')) sec.scrollIntoView({ behavior: 'smooth' });
    else toast(I18N.t('user.friendsOff'));
  });
  document.getElementById('um-settings').addEventListener('click', () => {
    menu.classList.add('hidden'); openSettings();
  });
  document.getElementById('um-welcome').addEventListener('click', () => {
    menu.classList.add('hidden'); openWelcome(true);
  });

  renderUserAvatar();
}

// UM ponto de entrada para "mudou quem eu sou".
//
// Antes o chip do canto e o cabeçalho do menu se pintavam sozinhos,
// cada um lendo o perfil na sua hora. Bastava um deles não ser
// chamado para a tela mostrar "Conectar Steam" no topo e o nome
// certo dentro do menu, ao mesmo tempo. Agora quem conecta a Steam
// chama isto e as duas partes andam juntas.
function atualizarIdentidade(profile) {
  renderUserAvatar(profile);
  const menu = document.getElementById('user-menu');
  if (menu && !menu.classList.contains('hidden')) renderUserMenu();
}

// Chamado também quando a integração Steam conecta.
function renderUserAvatar(profile) {
  const p = profile || (typeof SteamUI !== 'undefined' ? SteamUI.profile : null);
  const img = document.getElementById('user-avatar');
  const fb = document.getElementById('user-fallback');
  if (!img || !fb) return;
  if (p && p.avatar) {
    img.src = p.avatar;
    img.classList.remove('hidden');
    fb.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    fb.classList.remove('hidden');
  }

  // O NOME ao lado da foto. Sem conta ligada, o mesmo espaço convida
  // a ligar em vez de ficar vazio ocupando o canto à toa.
  const nome = document.getElementById('user-chip-name');
  const sub = document.getElementById('user-chip-sub');
  const chip = document.getElementById('btn-user');
  if (!nome || !sub || !chip) return;

  const ligado = !!(p && (p.personaName || p.steamId));
  chip.classList.toggle('connected', ligado);
  if (ligado) {
    nome.textContent = p.personaName || p.steamId;
    // Tira o data-i18n: senão trocar de idioma sobrescreve o nome
    // da pessoa pelo rótulo "Conectar Steam".
    nome.removeAttribute('data-i18n');
    // O SteamID embaixo desambigua contas com o mesmo apelido, que
    // é comum entre amigos.
    sub.textContent = p.steamId || '';
    sub.classList.toggle('hidden', !p.steamId);
    chip.title = (p.personaName || '') + (p.steamId ? ' · ' + p.steamId : '');
  } else {
    nome.setAttribute('data-i18n', 'user.connectShort');
    nome.textContent = I18N.t('user.connectShort');
    sub.textContent = '';
    sub.classList.add('hidden');
    chip.title = I18N.t('user.menu');
  }
}

// O menu que abre ao clicar na pílula da conta.
function renderUserMenu() {
  const p = (typeof SteamUI !== 'undefined' ? SteamUI.profile : null);
  const img = document.getElementById('um-avatar');
  const fb = document.getElementById('um-fallback');
  if (p && p.avatar) { img.src = p.avatar; img.classList.remove('hidden'); fb.classList.add('hidden'); }
  else { img.classList.add('hidden'); fb.classList.remove('hidden'); }

  document.getElementById('um-name').textContent =
    p ? (p.personaName || p.steamId) : I18N.t('user.notConnected');
  document.getElementById('um-sub').textContent =
    p ? (p.steamId || (AppState.config.steam || {}).steamId || '') : I18N.t('user.connectHint');

  // Sem conta, as opções que dependem dela não aparecem — botão que
  // não funciona é pior do que botão ausente.
  const on = !!p;
  document.getElementById('um-connect').classList.toggle('hidden', on);
  document.getElementById('um-profile').classList.toggle('hidden', !on);
  document.getElementById('um-friends').classList.toggle('hidden', !on);
}

// ------------------------------------------------------------
// Notícias do Unturned+ (selo "1" no canto do botão)
// ------------------------------------------------------------
const News = { items: [], unread: 0 };

function initNews() {
  // Ficam no próprio app por enquanto: são as novidades DESTA
  // versão. Quando houver um endpoint, é só trocar a origem — o
  // resto (selo, leitura, persistência do "já vi") continua igual.
  // Mais recente primeiro. O `id` é o que marca "já vi" — nunca
  // reaproveite um id antigo num item novo, senão ele nasce lido.
  News.items = [
    { id: 'v114-bandeja', date: '2026-08', titleKey: 'news.n10Title', bodyKey: 'news.n10Body' },
    { id: 'v114-mapa',    date: '2026-08', titleKey: 'news.n9Title',  bodyKey: 'news.n9Body' },
    { id: 'v18-idioma',  date: '2026-08', titleKey: 'news.n8Title', bodyKey: 'news.n8Body' },
    { id: 'v17-locais',  date: '2026-08', titleKey: 'news.n7Title', bodyKey: 'news.n7Body' },
    { id: 'v16-agenda',  date: '2026-08', titleKey: 'news.n6Title', bodyKey: 'news.n6Body' },
    { id: 'v15-times',   date: '2026-08', titleKey: 'news.n5Title', bodyKey: 'news.n5Body' },
    { id: 'v14-mapa',    date: '2026-08', titleKey: 'news.n4Title', bodyKey: 'news.n4Body' },
    { id: 'v3-notes',    date: '2026-08', titleKey: 'news.n3Title', bodyKey: 'news.n3Body' },
    { id: 'v2-steam',    date: '2026-07', titleKey: 'news.n2Title', bodyKey: 'news.n2Body' },
    { id: 'v1-log',      date: '2026-07', titleKey: 'news.n1Title', bodyKey: 'news.n1Body' }
  ];
  const seen = new Set((AppState.config.newsSeen || []));
  News.unread = News.items.filter((n) => !seen.has(n.id)).length;
  renderNewsBadge();
  renderNewsList();
}

function renderNewsBadge() {
  const b = document.getElementById('news-badge');
  if (!b) return;
  b.textContent = News.unread > 9 ? '9+' : String(News.unread);
  b.classList.toggle('hidden', News.unread <= 0);
}

function renderNewsList() {
  const box = document.getElementById('news-list');
  if (!box) return;
  const seen = new Set(AppState.config.newsSeen || []);
  box.innerHTML = News.items.map((n) => `
    <article class="news-item${seen.has(n.id) ? '' : ' unread'}">
      <div class="news-head">
        <strong>${escapeHtml(I18N.t(n.titleKey))}</strong>
        <time class="muted small">${escapeHtml(n.date)}</time>
      </div>
      <p class="muted small">${escapeHtml(I18N.t(n.bodyKey))}</p>
    </article>`).join('');
}

async function openNews() {
  renderNewsList();
  showModal('modal-news');
  // Marcar como lido só ao ABRIR — não ao iniciar o app — senão o
  // selo apareceria e sumiria antes de a pessoa olhar.
  AppState.config.newsSeen = News.items.map((n) => n.id);
  News.unread = 0;
  renderNewsBadge();
  renderNewsList();
  await window.api.setConfig(AppState.config);
}

// ------------------------------------------------------------
// Introdução do primeiro uso
// ------------------------------------------------------------
const Welcome = { step: 0, forced: false, steps: [] };

function welcomeSteps() {
  return [
    {
      icon: 'wave',
      titleKey: 'welcome.s1Title',
      bodyKey: 'welcome.s1Body',
      render: () => ''
    },
    {
      icon: 'gamepad',
      titleKey: 'welcome.s2Title',
      bodyKey: 'welcome.s2Body',
      render: () => `
        <button class="btn primary wz-action" id="wz-locate">${escapeHtml(I18N.t('welcome.locate'))}</button>
        <p class="muted small wz-result" id="wz-locate-result"></p>`
    },
    {
      icon: 'globe',
      titleKey: 'welcome.s3Title',
      bodyKey: 'welcome.s3Body',
      render: () => `
        <label class="field"><span>${escapeHtml(I18N.t('settings.language'))}</span>
          <select id="wz-lang">
            <option value="pt-BR">Português (BR)</option>
            <option value="en-US">English (US)</option>
          </select></label>
        <label class="check"><input type="checkbox" id="wz-flags" checked />
          <span>${escapeHtml(I18N.t('settings.showFlags'))}</span></label>
        <label class="check"><input type="checkbox" id="wz-help" checked />
          <span>${escapeHtml(I18N.t('settings.helpDots'))}</span></label>`
    },
    {
      icon: 'plus',
      titleKey: 'welcome.s4Title',
      bodyKey: 'welcome.s4Body',
      render: () => `
        <button class="btn primary wz-action" id="wz-add">${escapeHtml(I18N.t('home.addServer'))}</button>
        <p class="muted small">${escapeHtml(I18N.t('welcome.s4Hint'))}</p>`
    }
  ];
}

function openWelcome(forced = false) {
  Welcome.steps = welcomeSteps();
  Welcome.step = 0;
  Welcome.forced = forced;
  renderWelcome();
  showModal('modal-welcome');
}

function renderWelcome() {
  const s = Welcome.steps[Welcome.step];
  document.getElementById('wz-steps').innerHTML = Welcome.steps
    .map((_, i) => `<span class="wz-dot${i === Welcome.step ? ' on' : ''}${i < Welcome.step ? ' done' : ''}"></span>`)
    .join('');

  document.getElementById('wz-body').innerHTML = `
    <div class="wz-icon">${Icon.svg(s.icon, 26)}</div>
    <h2>${escapeHtml(I18N.t(s.titleKey))}</h2>
    <p class="wz-text">${escapeHtml(I18N.t(s.bodyKey))}</p>
    ${s.render()}`;

  document.getElementById('wz-back').classList.toggle('hidden', Welcome.step === 0);
  document.getElementById('wz-next').textContent =
    I18N.t(Welcome.step === Welcome.steps.length - 1 ? 'welcome.finish' : 'welcome.next');

  // Ações que só existem em alguns passos.
  const locate = document.getElementById('wz-locate');
  if (locate) {
    locate.addEventListener('click', async () => {
      const out = document.getElementById('wz-locate-result');
      out.textContent = I18N.t('welcome.locating');
      const r = await window.api.locateUnturned();
      out.textContent = r && r.path
        ? I18N.t('welcome.located', { path: r.path })
        : I18N.t('map.installNotFound');
    });
  }
  const lang = document.getElementById('wz-lang');
  if (lang) {
    lang.value = AppState.config.language || 'pt-BR';
    lang.addEventListener('change', async () => {
      AppState.config.language = lang.value;
      await window.api.setConfig(AppState.config);
      await I18N.load(lang.value);
      renderWelcome();   // a própria introdução muda de idioma na hora
    });
    document.getElementById('wz-flags').checked = AppState.config.showFlags !== false;
    document.getElementById('wz-help').checked = AppState.config.helpDots !== false;
  }
  const add = document.getElementById('wz-add');
  if (add) add.addEventListener('click', () => { finishWelcome(); openAddModal(); });
}

async function finishWelcome() {
  const flags = document.getElementById('wz-flags');
  const help = document.getElementById('wz-help');
  if (flags) AppState.config.showFlags = flags.checked;
  if (help) AppState.config.helpDots = help.checked;
  AppState.config.welcomeDone = true;
  await window.api.setConfig(AppState.config);
  applyHelpVisibility();
  hideModal('modal-welcome');
  renderHome();
}

function initWelcome() {
  const modal = document.getElementById('modal-welcome');
  if (!modal) return;
  document.getElementById('wz-next').addEventListener('click', () => {
    if (Welcome.step < Welcome.steps.length - 1) { Welcome.step++; renderWelcome(); }
    else finishWelcome();
  });
  document.getElementById('wz-back').addEventListener('click', () => {
    if (Welcome.step > 0) { Welcome.step--; renderWelcome(); }
  });
  document.getElementById('wz-skip').addEventListener('click', finishWelcome);

  // Primeira execução: config sem `welcomeDone`.
  if (!AppState.config.welcomeDone) setTimeout(() => openWelcome(false), 400);
}
