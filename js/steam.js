// ============================================================
// steam.js — Conta Steam e amigos na interface
//
// O processo principal (steamAccount.js) faz o trabalho pesado.
// Aqui a gente só guarda o resultado e desenha:
//
//   • a foto/nome da conta nas configurações;
//   • a seção "Amigos jogando" na home;
//   • as fotinhas dos amigos no card do servidor correspondente;
//   • um card com CONTORNO TRACEJADO para o servidor onde tem
//     amigo mas que ainda não está na sua lista.
//
// Nada disso é obrigatório: com a integração desligada (o padrão),
// este arquivo não faz uma requisição sequer.
// ============================================================

const SteamUI = {
  status: 'disabled',   // disabled | no_steamid | no_key | no_friends | friends_unavailable | ok | error
  profile: null,
  friends: [],
  servers: [],          // [{ address, ip, port, friends: [...] }]
  withoutAddress: [],
  timer: null,
  loading: false,
  lastAt: 0,
  steamId: null,        // descoberto na abertura (config ou detecção)
  steamPath: null
};

// Mensagem honesta para cada situação — "no_key" e "perfil privado"
// são problemas bem diferentes e precisam de instruções diferentes.
function steamStatusMessage(status) {
  switch (status) {
    case 'no_key': return I18N.t('friends.needKey');
    case 'no_steamid': return I18N.t('friends.needSteamId');
    case 'friends_unavailable': return I18N.t('friends.unavailable');
    case 'no_friends': return I18N.t('friends.none');
    case 'error': return I18N.t('friends.error');
    default: return null;
  }
}

// ---------------- consulta ----------------
async function refreshSteamFriends({ silent = true } = {}) {
  const cfg = AppState.config;
  if (!cfg || !cfg.steam || !cfg.steam.enabled) {
    SteamUI.status = 'disabled';
    SteamUI.friends = []; SteamUI.servers = []; SteamUI.withoutAddress = [];
    renderFriendsSection();
    return SteamUI;
  }
  if (SteamUI.loading) return SteamUI;
  SteamUI.loading = true;

  try {
    const r = await window.api.steamFriends();
    SteamUI.status = r.status || 'error';
    SteamUI.friends = r.friends || [];
    SteamUI.servers = r.servers || [];
    SteamUI.withoutAddress = r.withoutAddress || [];
    SteamUI.lastAt = Date.now();
  } catch (e) {
    SteamUI.status = 'error';
    SteamUI.friends = []; SteamUI.servers = []; SteamUI.withoutAddress = [];
  } finally {
    SteamUI.loading = false;
  }

  if (!silent) {
    const msg = steamStatusMessage(SteamUI.status);
    toast(msg || I18N.t('friends.refreshed', { n: SteamUI.servers.length }));
  }
  renderHome();
  return SteamUI;
}

function startSteamAutoRefresh() {
  if (SteamUI.timer) clearInterval(SteamUI.timer);
  const cfg = AppState.config;
  if (!cfg || !cfg.steam || !cfg.steam.enabled) return;
  const sec = Math.max(30, cfg.steam.refreshSec || 120);
  SteamUI.timer = setInterval(() => refreshSteamFriends(), sec * 1000);
  refreshSteamFriends();
}

// ---------------- amigos por servidor ----------------
function friendsOnServer(ip, port) {
  if (!ip) return [];
  const key = `${ip}:${port}`;
  const entry = SteamUI.servers.find((s) => s.address === key);
  return entry ? entry.friends : [];
}

// Pilha de fotinhas usada no card do servidor.
function friendAvatarsHtml(friends, max = 4) {
  if (!friends || !friends.length) return '';
  const shown = friends.slice(0, max);
  const extra = friends.length - shown.length;
  return `<span class="friend-stack" title="${escapeHtml(friends.map((f) => f.personaName).join(', '))}">` +
    shown.map((f) => {
      const letter = escapeHtml((f.personaName || '?').slice(0, 1).toUpperCase());
      return f.avatar
        ? `<img class="friend-av" src="${escapeHtml(f.avatar)}" alt="${letter}" referrerpolicy="no-referrer"
             onerror="avatarFallback(this,'${letter}')">`
        : `<span class="friend-av letter">${letter}</span>`;
    }).join('') +
    (extra > 0 ? `<span class="friend-av more">+${extra}</span>` : '') +
    `</span>`;
}

// ---------------- seção "Amigos jogando" ----------------
// Servidor com amigo que NÃO está na sua lista vira um card
// fantasma: contorno tracejado e um botão para adicionar.
function ghostCardHtml(entry) {
  const names = entry.friends.map((f) => f.personaName).filter(Boolean).join(', ');
  return `
    <div class="server-card ghost" data-ghost="${escapeHtml(entry.address)}">
      <div class="card-head">
        <div class="card-icon">${Icon.svg('user', 20)}</div>
        <div class="card-headtext">
          <div class="card-title">
            <span class="card-name">${escapeHtml(names || entry.address)}</span>
          </div>
          <div class="card-address">
            ${AppState.config.showFlags !== false ? GeoFlag.html(GeoFlag.peek(entry.ip)) : ''}
            <span class="copy-ip" data-copy="${escapeHtml(entry.address)}"
                  title="${escapeHtml(I18N.t('card.copyIp'))}">${escapeHtml(entry.address)}</span>
          </div>
        </div>
      </div>

      <div class="ghost-note">${escapeHtml(I18N.t('friends.notInList'))}</div>

      <div class="card-foot">
        <div class="card-friends">${friendAvatarsHtml(entry.friends, 6)}</div>
        <div class="ghost-actions">
          <button class="btn-small primary" data-ghost-add="${escapeHtml(entry.address)}"
                  data-i18n="friends.add">Adicionar à lista</button>
          <button class="btn-small" data-ghost-join="${escapeHtml(entry.address)}"
                  data-i18n="tracking.join">Entrar no servidor</button>
        </div>
      </div>
    </div>`;
}

function renderFriendsSection() {
  const section = document.getElementById('section-friends');
  const grid = document.getElementById('grid-friends');
  const note = document.getElementById('friends-note');
  if (!section) return;

  const cfg = AppState.config;
  const on = cfg && cfg.steam && cfg.steam.enabled && cfg.steam.showFriendServers !== false;

  // Ligado nas configurações mas SEM conta de verdade: a seção
  // aparecia como "Amigos jogando 0" com um botão de atualizar que
  // nunca ia trazer nada. Cabeçalho vazio ocupando o topo da home
  // é pior do que seção nenhuma — quem não conectou já tem o
  // convite na pílula do canto.
  const temConta = !!(SteamUI.profile || (cfg.steam && cfg.steam.steamId));
  if (!on || (!temConta && !SteamUI.servers.length)) {
    section.classList.add('hidden');
    grid.innerHTML = '';
    delete grid.dataset.sig;
    return;
  }

  section.classList.remove('hidden');

  const saved = cfg.servers || [];
  const isSaved = (ip, port) => saved.some((s) => s.ip === ip && Number(s.port) === Number(port));

  const savedEntries = SteamUI.servers.filter((e) => isSaved(e.ip, e.port));
  const ghostEntries = SteamUI.servers.filter((e) => !isSaved(e.ip, e.port));

  document.getElementById('count-friends').textContent = SteamUI.servers.length;

  // Aviso do que está faltando (chave, SteamID, perfil privado...)
  const msg = steamStatusMessage(SteamUI.status);
  const extraNote = SteamUI.withoutAddress.length
    ? I18N.t('friends.noAddress', { n: SteamUI.withoutAddress.length })
    : null;
  const noteText = [msg, extraNote].filter(Boolean).join(' · ');
  note.textContent = noteText;
  note.classList.toggle('hidden', !noteText);

  const sig = JSON.stringify([
    SteamUI.status,
    SteamUI.servers.map((e) => [e.address, e.friends.map((f) => f.steamId)]),
    saved.map((s) => `${s.ip}:${s.port}`),
    I18N.lang
  ]);
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;

  // Servidores já salvos entram como card normal (com as fotinhas);
  // os demais entram como card fantasma.
  const savedServers = savedEntries
    .map((e) => saved.find((s) => s.ip === e.ip && Number(s.port) === Number(e.port)))
    .filter(Boolean);

  grid.innerHTML = ghostEntries.map(ghostCardHtml).join('');

  // Cards fantasma: copiar IP, adicionar e entrar.
  for (const el of grid.querySelectorAll('[data-copy]')) {
    el.addEventListener('click', (e) => { e.stopPropagation(); copyIp(el.dataset.copy, el); });
  }
  for (const btn of grid.querySelectorAll('[data-ghost-add]')) {
    btn.textContent = I18N.t('friends.add');
    btn.addEventListener('click', () => addServerByAddress(btn.dataset.ghostAdd));
  }
  for (const btn of grid.querySelectorAll('[data-ghost-join]')) {
    btn.textContent = I18N.t('tracking.join');
    btn.addEventListener('click', () => window.api.openExternal(`steam://connect/${btn.dataset.ghostJoin}`));
  }

  // Depois dos fantasmas, os cards de verdade.
  if (savedServers.length) {
    const holder = document.createElement('div');
    holder.className = 'cards-grid friends-saved';
    grid.appendChild(holder);
    fillGrid(holder, sortServers(savedServers));
  }

  if (AppState.config.showFlags !== false) {
    GeoFlag.warm(SteamUI.servers.map((e) => e.ip));
  }
}

// Adiciona um servidor a partir de "ip:porta" (usado no card fantasma).
async function addServerByAddress(address) {
  const m = String(address || '').match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (!m) { toast(I18N.t('current.badAddress')); return; }
  const ip = m[1], port = parseInt(m[2], 10);
  const bmId = `local_${ip}_${port}`;
  if (AppState.config.servers.some((s) => s.bmId === bmId)) { toast(I18N.t('add.errorDuplicate')); return; }

  const probe = await tryProbe(ip, port, null);
  LiveData[bmId] = {
    ...(LiveData[bmId] || {}),
    name: probe.name || address, map: probe.map, icon: probe.icon,
    description: probe.description, mods: probe.mods, modCount: probe.modCount
  };
  AppState.config.servers.push({
    bmId, name: probe.name || address, ip, port,
    queryPort: probe.queryPort || null, tags: [], favorite: false,
    folderId: AppState.currentFolderId || null
  });
  await saveAppConfig();
  await window.api.restartPolling();
  toast(I18N.t('add.success', { name: probe.name || address }));
  refreshAllCards();
}

// ------------------------------------------------------------
// IDENTIDADE DA STEAM, NA ABERTURA DO APP
//
// O BUG: quem carregava o perfil era `loadSteamProfileCard`, e a
// primeira linha dela é
//
//     if (!nameEl) return;
//
// onde `nameEl` é um campo que só existe DENTRO do modal de
// configurações. Ou seja: com o modal fechado — que é o estado
// normal do app — a função saía na primeira linha e o perfil nunca
// era buscado. A foto e o nome só apareciam depois de abrir as
// configurações, e era por isso que precisava clicar em "Conectar
// Steam" duas vezes: o segundo clique abria a tela que, de efeito
// colateral, fazia a busca.
//
// Agora são DUAS funções com responsabilidades separadas:
//
//   carregarIdentidadeSteam()  descobre quem você é. Não toca em
//                              nenhum elemento das configurações,
//                              então roda no boot.
//   loadSteamProfileCard()     pinta os campos do modal, e chama a
//                              de cima para ter o que pintar.
//
// A regra geral que isso ensina: função que BUSCA dado não pode
// depender de tela aberta. Se ela desiste porque um elemento não
// existe, ela deixou de ser busca e virou renderização.
// ------------------------------------------------------------
async function carregarIdentidadeSteam() {
  const cfg = AppState.config;
  if (!cfg || !cfg.steam) return null;

  let steamId = cfg.steam.steamId;
  let steamPath = null;

  // Sem SteamID salvo, tenta descobrir pela instalação local. É o
  // caso de quem nunca abriu as configurações — e justamente quem
  // mais precisa que funcione sozinho.
  if (!steamId && cfg.steam.autoDetect !== false) {
    try {
      const d = await window.api.steamDetect();
      steamId = d && d.steamId;
      steamPath = d && d.steamPath;
    } catch { /* sem Steam instalada */ }
  }

  SteamUI.steamPath = steamPath;
  if (!steamId) {
    SteamUI.profile = null;
    atualizarIdentidade();
    return null;
  }

  SteamUI.steamId = steamId;
  try {
    const p = await window.api.steamProfile(steamId);
    SteamUI.profile = p || null;
  } catch {
    SteamUI.profile = null;
  }
  // O canto da tela reflete o que achamos, mesmo que seja "nada":
  // um chip preso em "Conectar Steam" com a conta ligada é pior do
  // que um chip vazio.
  atualizarIdentidade();
  return SteamUI.profile;
}

// ---------------- perfil nas configurações ----------------
async function loadSteamProfileCard() {
  const nameEl = document.getElementById('steam-name');
  const idEl = document.getElementById('steam-id');
  const avEl = document.getElementById('steam-avatar');

  // A busca acontece SEMPRE; a pintura, só se a tela estiver aberta.
  await carregarIdentidadeSteam();
  if (!nameEl) return;

  const steamId = SteamUI.steamId;
  if (SteamUI.steamPath && idEl) idEl.title = SteamUI.steamPath;

  if (!steamId) {
    nameEl.textContent = I18N.t('settings.steamNotConnected');
    idEl.textContent = I18N.t('settings.steamNoId');
    avEl.innerHTML = Icon.svg('gamepad', 20);
    SteamUI.profile = null;
    // O canto da tela tem que acompanhar. Sem esta chamada, o perfil
    // era gravado aqui e o chip lá em cima só se atualizava na
    // PRÓXIMA abertura do app — que é exatamente o sintoma de "a
    // foto só aparece quando eu clico".
    atualizarIdentidade();
    return;
  }

  idEl.textContent = steamId;

  const p = SteamUI.profile;
  if (p) {
    nameEl.textContent = p.personaName || I18N.t('settings.steamNoName');
    if (p.avatar) {
      avEl.innerHTML = `<img src="${escapeHtml(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this,'gamepad')">`;
    }
  } else {
    nameEl.textContent = I18N.t('settings.steamProfileFail');
  }
}

// Botão "Testar conexão" — mostra exatamente o que funcionou.
async function testSteamConnection() {
  const box = document.getElementById('steam-test-result');
  box.classList.remove('hidden');
  box.innerHTML = `<span class="muted">${escapeHtml(I18N.t('settings.testing'))}</span>`;

  // Salvamos antes: o teste usa a config do disco.
  await saveSettingsSilently();

  let r;
  try { r = await window.api.steamTest(); }
  catch (e) { box.innerHTML = `<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(e.message)}</span>`; return; }

  const lines = [];
  lines.push(r.steamPath
    ? `<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('settings.testSteamPath', { path: r.steamPath }))}</span>`
    : `<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(I18N.t('settings.testNoSteamPath'))}</span>`);

  lines.push(r.steamId
    ? `<span class="test-ok">${Icon.svg('check', 13)} SteamID: ${escapeHtml(r.steamId)}</span>`
    : `<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(I18N.t('friends.needSteamId'))}</span>`);

  if (r.profile) {
    lines.push(`<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('settings.testProfile', { name: r.profile.personaName || '' }))}</span>`);
  } else if (r.steamId) {
    lines.push(`<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(I18N.t('settings.steamProfileFail'))}</span>`);
  }

  const f = r.friends;
  if (!f || f.status === 'no_key') {
    lines.push(`<span class="test-warn">! ${escapeHtml(I18N.t('friends.needKey'))}</span>`);
  } else if (f.status === 'ok') {
    lines.push(`<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('settings.testFriends', { n: f.friendCount, p: f.playing.length }))}</span>`);
  } else {
    lines.push(`<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(steamStatusMessage(f.status) || f.status)}</span>`);
  }

  box.innerHTML = lines.join('<br>');
  loadSteamProfileCard();
  refreshSteamFriends();
}
