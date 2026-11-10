// ============================================================
// config.js — estado global e painel de configurações
// ============================================================
const AppState = {
  config: null,
  trackingId: null,     // bmId do servidor em tracking
  deleteMode: false,
  selectedForDelete: new Set(),
  refreshTimer: null,
  lastPlayers: {},      // bmId -> Set de nomes (para detectar join/leave)
  currentServer: null,  // dados do servidor em que o jogador está agora
  currentFolderId: null // pasta aberta na home (null = raiz)
};

async function loadAppConfig() {
  AppState.config = await window.api.getConfig();
  return AppState.config;
}

async function saveAppConfig() {
  await window.api.setConfig(AppState.config);
}

// Recarrega a config a partir do disco e redesenha.
// Necessário depois de qualquer operação de PASTA: quem mexe em
// `folders` e em `folderId` é o processo principal, então sem
// reler a interface continuaria desenhando o estado antigo.
async function reloadAppConfig() {
  const scroll = window.scrollY;
  await loadAppConfig();
  renderHome();
  window.scrollTo(0, scroll);
}

// ============================================================
// Painel de configurações (abas: Geral / Steam / Overlay / Atalhos)
// ============================================================
const OVERLAY_ACCENTS = ['#6ee06e', '#5cb8e0', '#e6b450', '#e05c5c', '#a98bff', '#e05c9a', '#e6efe8'];

const $cfg = (id) => document.getElementById(id);

function setSettingsTab(tab) {
  for (const btn of document.querySelectorAll('.settings-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  for (const pane of document.querySelectorAll('.settings-pane')) {
    pane.classList.toggle('hidden', pane.id !== `pane-${tab}`);
  }
  // A aba de dados conta anotações e prints no disco: só vale a
  // leitura quando ela está de fato à vista.
  if (tab === 'data' && typeof renderDataStats === 'function') renderDataStats();
}

function renderAccentRow(selected) {
  const box = $cfg('cfg-ov-accent-row');
  box.innerHTML = OVERLAY_ACCENTS.map((c) => `
    <button type="button" class="color-dot${c.toLowerCase() === String(selected).toLowerCase() ? ' active' : ''}"
            data-accent="${c}" style="--dot:${c}" aria-label="${c}"></button>`).join('');
  for (const dot of box.querySelectorAll('.color-dot')) {
    dot.addEventListener('click', () => {
      $cfg('cfg-ov-accent').value = dot.dataset.accent;
      renderAccentRow(dot.dataset.accent);
    });
  }
}

function renderHotkeyValues(hotkeys) {
  for (const [action, accel] of Object.entries(hotkeys || {})) {
    const el = $cfg(`hk-${action}`);
    if (!el) continue;
    el.textContent = accel || I18N.t('settings.hkNone');
    el.classList.toggle('empty', !accel);
  }
}

// Estado da pasta do jogo. A frase muda conforme o que existe de
// verdade lá dentro — dizer só "definida" esconderia o caso de
// apontar para uma pasta que não tem Bundles/Items, em que a
// calculadora de raid continua nos valores de reserva.
async function pintarPastaDoJogo() {
  const campo = document.getElementById('cfg-game-path');
  const dica = document.getElementById('cfg-game-hint');
  if (!campo || !dica) return;
  const info = await window.api.gamePathInfo();

  campo.value = info.path || '';
  campo.placeholder = I18N.t('settings.gamePathPh');

  let chave = 'settings.gameMissing', classe = 'warn';
  if (info.exists && info.hasMaps && info.hasItems) { chave = 'settings.gameOk'; classe = 'ok'; }
  else if (info.exists && info.hasMaps) { chave = 'settings.gameNoItems'; classe = 'warn'; }
  else if (info.exists) { chave = 'settings.gameNoMaps'; classe = 'warn'; }
  dica.textContent = I18N.t(chave);
  dica.className = 'fp-hint small ' + classe;
}

function initPastaDoJogo() {
  const pick = document.getElementById('cfg-game-pick');
  if (!pick) return;
  pick.addEventListener('click', async () => {
    const r = await window.api.gamePickPath();
    if (r.canceled) return;
    if (!r.ok) { toast(I18N.t('settings.gameBad')); return; }
    // RELER a config do disco. Sem isto a pasta some ao fechar as
    // Configurações, e o motivo é sutil: quem gravou `unturnedPath`
    // foi o PROCESSO PRINCIPAL, mas `AppState.config` (a cópia do
    // renderer) continuava com o valor antigo — e `saveSettings`
    // manda a config INTEIRA de volta, sobrescrevendo a pasta com
    // o vazio de antes. Dois donos da mesma config, um apagando o
    // outro.
    await loadAppConfig();
    await pintarPastaDoJogo();
    toast(I18N.t('settings.gameSet'));
    // A calculadora tem que reler: o catálogo em cache era de outra
    // instalação (ou do fallback).
    if (typeof Raid !== 'undefined') Raid.carregado = false;
  });
  document.getElementById('cfg-game-auto').addEventListener('click', async () => {
    const info = await window.api.gamePathInfo();
    if (!info.detected) { toast(I18N.t('settings.gameNotFound')); return; }
    // Reaproveita o caminho de "localizar" que já existe e que
    // também sincroniza os mapas.
    await window.api.locateUnturned();
    await loadAppConfig();   // mesmo motivo do botão de cima
    await pintarPastaDoJogo();
    toast(I18N.t('settings.gameSet'));
    if (typeof Raid !== 'undefined') Raid.carregado = false;
  });
}

function openSettings() {
  const cfg = AppState.config;

  // ---- Geral ----
  $cfg('cfg-language').value = cfg.language;
  $cfg('cfg-token').value = cfg.apiToken || '';
  $cfg('cfg-refresh').value = cfg.refreshInterval;
  $cfg('cfg-flags').checked = cfg.showFlags !== false;
  // `=== true` e não `!== false`: esta opção é DESLIGADA por padrão,
  // então config antiga (sem a chave) tem que ler como desligada.
  $cfg('cfg-tray').checked = cfg.closeToTray === true;
  pintarPastaDoJogo();
  $cfg('cfg-watch').checked = cfg.currentServerWatch !== false;
  $cfg('cfg-help').checked = cfg.helpDots !== false;

  // ---- Steam ----
  const st = cfg.steam || {};
  $cfg('cfg-steam-enabled').checked = !!st.enabled;
  $cfg('cfg-steam-auto').checked = st.autoDetect !== false;
  $cfg('cfg-steam-id').value = st.steamId || '';
  $cfg('cfg-steam-key').value = st.apiKey || '';
  $cfg('cfg-steam-friends-cards').checked = st.showFriendsOnCards !== false;
  $cfg('cfg-steam-friend-servers').checked = st.showFriendServers !== false;
  $cfg('steam-test-result').classList.add('hidden');

  // ---- Overlay ----
  const ui = cfg.overlayUi || {};
  $cfg('cfg-ov-width').value = ui.width;
  $cfg('cfg-ov-height').value = ui.height;
  $cfg('cfg-ov-opacity').value = ui.opacity;
  $cfg('cfg-ov-opacity-value').textContent = `${ui.opacity}%`;
  $cfg('cfg-ov-scale').value = ui.scale;
  $cfg('cfg-ov-scale-value').textContent = `${ui.scale}%`;
  $cfg('cfg-ov-accent').value = ui.accent || '#6ee06e';
  $cfg('cfg-ov-ontop').checked = ui.alwaysOnTop !== false;
  renderAccentRow(ui.accent);
  const sec = ui.sections || {};
  for (const key of ['description', 'stats', 'airdrop', 'events', 'online']) {
    $cfg(`cfg-ov-sec-${key}`).checked = sec[key] !== false;
  }

  // ---- Notificações ----
  const n = cfg.notify || {};
  $cfg('cfg-nt-enabled').checked = !!n.enabled;
  $cfg('cfg-nt-join').checked = n.onJoin !== false;
  $cfg('cfg-nt-leave').checked = !!n.onLeave;
  $cfg('cfg-nt-friends').checked = !!n.onlyFriends;
  $cfg('cfg-nt-mode').value = n.mode || 'both';
  $cfg('cfg-nt-sound').value = n.sound || 'blip';
  $cfg('cfg-nt-volume').value = n.volume;
  $cfg('cfg-nt-volume-value').textContent = `${n.volume}%`;
  $cfg('cfg-nt-position').value = n.position || 'top-right';
  $cfg('cfg-nt-duration').value = n.durationSec;

  // ---- Atalhos ----
  renderHotkeyValues(cfg.hotkeys);
  $cfg('hotkey-error').classList.add('hidden');
  $cfg('hotkey-result').classList.add('hidden');

  setSettingsTab('general');
  showModal('modal-settings');
  loadSteamProfileCard();
}

// Passa os campos da tela para a config em memória.
function collectSettings() {
  const cfg = AppState.config;

  cfg.apiToken = $cfg('cfg-token').value.trim();
  cfg.refreshInterval = Math.max(10, parseInt($cfg('cfg-refresh').value, 10) || 30);
  cfg.showFlags = $cfg('cfg-flags').checked;
  cfg.closeToTray = $cfg('cfg-tray').checked;
  cfg.currentServerWatch = $cfg('cfg-watch').checked;
  cfg.helpDots = $cfg('cfg-help').checked;

  cfg.steam = {
    ...cfg.steam,
    enabled: $cfg('cfg-steam-enabled').checked,
    autoDetect: $cfg('cfg-steam-auto').checked,
    steamId: $cfg('cfg-steam-id').value.trim(),
    apiKey: $cfg('cfg-steam-key').value.trim(),
    showFriendsOnCards: $cfg('cfg-steam-friends-cards').checked,
    showFriendServers: $cfg('cfg-steam-friend-servers').checked
  };

  const num = (id, dflt) => {
    const v = parseInt($cfg(id).value, 10);
    return Number.isFinite(v) ? v : dflt;
  };

  cfg.overlayUi = {
    ...cfg.overlayUi,
    width: num('cfg-ov-width', 360),
    height: num('cfg-ov-height', 560),
    opacity: num('cfg-ov-opacity', 84),
    scale: num('cfg-ov-scale', 100),
    accent: /^#[0-9a-fA-F]{6}$/.test($cfg('cfg-ov-accent').value.trim())
      ? $cfg('cfg-ov-accent').value.trim() : '#6ee06e',
    alwaysOnTop: $cfg('cfg-ov-ontop').checked,
    sections: {
      description: $cfg('cfg-ov-sec-description').checked,
      stats: $cfg('cfg-ov-sec-stats').checked,
      airdrop: $cfg('cfg-ov-sec-airdrop').checked,
      events: $cfg('cfg-ov-sec-events').checked,
      online: $cfg('cfg-ov-sec-online').checked
    }
  };

  cfg.notify = {
    ...cfg.notify,
    enabled: $cfg('cfg-nt-enabled').checked,
    onJoin: $cfg('cfg-nt-join').checked,
    onLeave: $cfg('cfg-nt-leave').checked,
    onlyFriends: $cfg('cfg-nt-friends').checked,
    mode: $cfg('cfg-nt-mode').value,
    sound: $cfg('cfg-nt-sound').value,
    volume: num('cfg-nt-volume', 60),
    position: $cfg('cfg-nt-position').value,
    durationSec: num('cfg-nt-duration', 4)
  };

  return cfg;
}

// Salva sem fechar o modal — usado pelos botões de teste, que
// precisam da config já gravada no disco para valer.
async function saveSettingsSilently() {
  collectSettings();
  await saveAppConfig();
  await window.api.applyOverlayUi();
  await window.api.applyHotkeys();
}

async function saveSettings() {
  const cfg = AppState.config;
  const newLang = $cfg('cfg-language').value;
  const watchBefore = cfg.currentServerWatch !== false;
  const steamBefore = !!(cfg.steam && cfg.steam.enabled);

  collectSettings();

  const langChanged = newLang !== cfg.language;
  cfg.language = newLang;

  await saveAppConfig();
  if (cfg.currentServerWatch !== watchBefore) await window.api.setCurrentServerWatch(cfg.currentServerWatch);
  if (langChanged) await I18N.load(newLang);

  await window.api.applyOverlayUi();
  const hk = await window.api.applyHotkeys();

  if (typeof applyHelpVisibility === 'function') applyHelpVisibility();

  hideModal('modal-settings');
  toast(I18N.t('settings.saved'));

  if (hk && hk.failed && hk.failed.length) {
    toast(I18N.t('settings.hkFailed', { keys: hk.failed.map((f) => f.accel).join(', ') }));
  }

  // Liga/desliga o ciclo de amigos conforme a integração.
  if (cfg.steam.enabled !== steamBefore || cfg.steam.enabled) startSteamAutoRefresh();
  else { if (SteamUI.timer) clearInterval(SteamUI.timer); SteamUI.timer = null; refreshSteamFriends(); }

  renderHome();
}

// ============================================================
// Captura de atalho
//
// Traduz o evento de teclado para o formato de acelerador do
// Electron ("Ctrl+Shift+F5"). Só aceitamos combinações que fazem
// sentido como atalho GLOBAL: tecla de função sozinha, ou uma
// tecla comum com pelo menos um modificador — senão o usuário
// registraria "A" e perderia a tecla no jogo inteiro.
// ============================================================
const HotkeyCapture = { action: null, accel: null };

function eventToAccelerator(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');

  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return { accel: null, partial: parts.join('+') };

  let name = null;
  if (/^F\d{1,2}$/.test(key)) name = key;
  else if (key === ' ') name = 'Space';
  else if (key.length === 1) name = key.toUpperCase();
  else if (['Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) {
    name = key === 'Escape' ? 'Esc' : key;
  } else if (key.startsWith('Arrow')) name = key.slice(5);

  if (!name) return { accel: null, partial: parts.join('+') };

  const isFunctionKey = /^F\d{1,2}$/.test(name);
  if (!parts.length && !isFunctionKey) {
    return { accel: null, partial: name, error: 'needModifier' };
  }
  return { accel: [...parts, name].join('+') };
}

function openHotkeyCapture(action) {
  HotkeyCapture.action = action;
  HotkeyCapture.accel = null;
  const row = document.querySelector(`.hotkey-row[data-action="${action}"] .hotkey-name`);
  $cfg('hotkey-capture-for').textContent = row ? row.textContent : action;
  $cfg('hotkey-preview').textContent = '…';
  $cfg('hotkey-capture-error').classList.add('hidden');
  showModal('modal-hotkey');
}

async function confirmHotkeyCapture() {
  if (!HotkeyCapture.action || !HotkeyCapture.accel) {
    const err = $cfg('hotkey-capture-error');
    err.textContent = I18N.t('settings.hkNothing');
    err.classList.remove('hidden');
    return;
  }
  AppState.config.hotkeys[HotkeyCapture.action] = HotkeyCapture.accel;
  renderHotkeyValues(AppState.config.hotkeys);
  hideModal('modal-hotkey');
}

