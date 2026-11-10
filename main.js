// ============================================================
// Unturned+ — Processo principal (Electron)
// v1.2 — importador de mapas + sistema de marcadores
// ============================================================
const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, dialog, clipboard,
        Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const queryPort = require('./queryPort');
const unturnedRules = require('./unturnedRules');
const queryEngine = require('./queryEngine');
const mapSync = require('./mapSync');
const bmScrape = require('./bmScrape');
const fichasStore = require('./fichasStore');
const unturnedLog = require('./unturnedLog');
const { GeoIp } = require('./geoip');
const { SteamWorkshop } = require('./steamWorkshop');
const { SteamAccount } = require('./steamAccount');
const unturnedNodes = require('./unturnedNodes');
const notesStore = require('./notesStore');
const backupStore = require('./backupStore');
const teamStore = require('./teamStore');
const mediaStore = require('./mediaStore');
const scheduleStore = require('./scheduleStore');
const raidStore = require('./raidStore');
const inventoryStore = require('./inventoryStore');
const notifStore = require('./notifStore');
const accountStore = require('./accountStore');
const netClient = require('./netClient');
const { SyncClient } = require('./syncClient');
const { TeamLive } = require('./teamLive');

// ------------------------------------------------------------
// Nome do app — fixado de propósito.
//
// O Electron decide a pasta de dados (%APPDATA%\<nome>) a partir do
// package.json, e o nome que ele acha em DESENVOLVIMENTO ("npm
// start") pode não ser o mesmo do app EMPACOTADO, porque o
// electron-builder tem o seu próprio `productName`. Quando os dois
// divergem, o instalador abre com a lista de servidores vazia e
// parece que o build perdeu tudo — quando na verdade está lendo
// outra pasta.
//
// Fixando aqui, dev e build usam sempre a mesma pasta, e quem já
// tem dados continua com eles depois de instalar.
// ------------------------------------------------------------
app.setName('unturned-plus');

// Cache leve das rules interpretadas por servidor (rules mudam pouco;
// evita refazer a consulta multi-pacote a cada tick de polling).
const rulesCache = {}; // id -> { at, data }

const BM_API = 'https://api.battlemetrics.com';

let mainWindow = null;
let overlayWindow = null;
let overlayClickThrough = false;
let localPollTimer = null;
let servidorEmFoco = null; // bmId da página de tracking aberta (prioridade no polling)

// Último resultado de cada servidor, só para o texto da bandeja.
// O renderer tem o seu próprio `LiveData`, mas ele vive na JANELA —
// e a bandeja precisa justamente do caso em que a janela está
// fechada.
const ultimoEstado = {};   // bmId -> { players, maxPlayers, at }
const lastPlayersByServer = {}; // bmId -> Set<string> (pra detectar join/leave localmente, via query port)

// ------------------------------------------------------------
// Configuração persistente
// ------------------------------------------------------------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const mapsDir = () => path.join(app.getPath('userData'), 'maps');
const historyDir = () => path.join(app.getPath('userData'), 'history');
// Sanitiza o ID para uso como nome de arquivo (IDs sintéticos de
// servidores adicionados por IP podem conter ":" e ".", inválidos no Windows).
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
const localHistoryFile = (bmId) => path.join(historyDir(), `${safeId(bmId)}.json`);

const geoCacheFile = () => path.join(app.getPath('userData'), 'geo.json');
const workshopCacheFile = () => path.join(app.getPath('userData'), 'workshop.json');
const steamCacheFile = () => path.join(app.getPath('userData'), 'steam.json');

// ------------------------------------------------------------
// Padrões da Parte 2: conta Steam, aparência do overlay, atalhos
// globais e notificações de entrada/saída de jogador.
//
// Tudo nasce DESLIGADO ou no comportamento antigo: quem atualiza o
// app não é surpreendido por janela nova piscando na tela.
// ------------------------------------------------------------
const DEFAULT_STEAM = {
  enabled: false,
  autoDetect: true,
  steamId: '',
  apiKey: '',
  showFriendsOnCards: true,
  showFriendServers: true,
  refreshSec: 120
};

const DEFAULT_OVERLAY_UI = {
  width: 360,
  height: 560,
  opacity: 84,     // % do fundo do HUD (o texto continua opaco)
  scale: 100,      // % do tamanho da fonte
  accent: '#6ee06e',
  alwaysOnTop: true,
  sections: { description: true, stats: true, airdrop: true, events: true, online: true }
};

const DEFAULT_HOTKEYS = {
  toggleOverlay: 'F8',
  ghostMode: 'F9',
  markAirdrop: 'F10'
};

const DEFAULT_NOTIFY = {
  enabled: false,
  onJoin: true,
  onLeave: false,
  onlyFriends: false,
  mode: 'both',            // 'both' | 'visual' | 'sound'
  sound: 'blip',           // 'blip' | 'soft' | 'alert'
  volume: 60,
  position: 'top-right',   // top-left | top-right | bottom-left | bottom-right | top-center
  durationSec: 4
};

// ------------------------------------------------------------
// Idioma inicial: o do computador
// ------------------------------------------------------------
// `null` significa "ainda não escolhido". Só na primeira abertura o
// app olha o Windows e decide. Depois que a pessoa salvar um idioma
// nas configurações, o valor fica gravado e o sistema não manda
// mais — trocar o Windows para inglês não pode desfazer a escolha
// dela.
//
// `app.getLocale()` devolve coisas como 'pt-BR', 'pt', 'en-US',
// 'en-GB'. Comparar a string inteira erraria em 'pt-PT' e em 'pt';
// por isso a comparação é pela PARTE DO IDIOMA, e a região só serve
// para desempate quando existe mais de uma variante.
const IDIOMAS = ['pt-BR', 'en-US'];

function detectSystemLanguage() {
  // Três fontes, nesta ordem:
  //  1. getSystemLocale() — o idioma do Windows, e vale ANTES do
  //     evento 'ready' (getLocale sozinho pode vir vazio ali).
  //  2. getLocale() — o que o Chromium resolveu.
  //  3. as variáveis de ambiente, que é o que sobra fora do Electron
  //     (os testes rodam assim).
  let bruto = '';
  for (const fonte of [
    () => app.getSystemLocale && app.getSystemLocale(),
    () => app.getLocale && app.getLocale(),
    () => process.env.LC_ALL || process.env.LANG
  ]) {
    try { bruto = String(fonte() || '').trim(); } catch { bruto = ''; }
    if (bruto) break;
  }
  // 'pt_BR.UTF-8' -> 'pt_BR'
  bruto = bruto.split('.')[0];
  if (!bruto) return 'en-US';

  const exato = IDIOMAS.find((l) => l.toLowerCase() === bruto.toLowerCase());
  if (exato) return exato;

  const idioma = bruto.split(/[-_]/)[0].toLowerCase();
  const porIdioma = IDIOMAS.find((l) => l.split('-')[0].toLowerCase() === idioma);
  if (porIdioma) return porIdioma;

  // Idioma que o app não fala (espanhol, russo, alemão...). Inglês
  // é a escolha menos ruim: cair no português deixaria a maior
  // parte do mundo numa língua que ela provavelmente não lê.
  return 'en-US';
}

const DEFAULT_CONFIG = {
  language: null,
  apiToken: '',
  refreshInterval: 30,
  servers: [],
  // Pastas de organização (um nível). Cada servidor guarda folderId.
  // { id, name, color, icon, createdAt }
  folders: [],
  // Categorias de marcador criadas pelo usuário (máx. 3).
  // { id: 'cat_xxx', name, emoji, color }
  markerCats: [],
  logs: {},
  overlayServerId: null,
  overlayEnabled: true,
  unturnedPath: '',
  // Detecção do servidor em que o jogador está (via log do Unturned).
  unturnedLogPath: '',        // caminho do Client.log (auto-detectado se vazio)
  currentServerWatch: true,   // liga/desliga a vigilância do log
  lastPlayedServer: null,     // { ip, port, name, map, at } — persistido p/ mostrar "último jogado"
  showFlags: true,            // bandeirinha de país no card

  // O X fecha o app de verdade, ou só esconde a janela e deixa o
  // tracking rodando na bandeja?
  //
  // PADRÃO DESLIGADO, de propósito. Um programa que não fecha
  // quando você manda fechar é a coisa mais irritante que um app de
  // desktop pode fazer, e ninguém procura essa configuração antes
  // de ser surpreendido por ela. Quem quer, liga — e a partir daí
  // sabe o que esperar.
  closeToTray: false,

  steam: { ...DEFAULT_STEAM },
  overlayUi: { ...DEFAULT_OVERLAY_UI },
  hotkeys: { ...DEFAULT_HOTKEYS },
  notify: { ...DEFAULT_NOTIFY }
};

// Migração tolerante: configs antigas não têm `folders` nem
// `folderId` nos servidores. Normalizamos na LEITURA, para o resto
// do app nunca precisar checar "esse campo existe?".
function normalizeConfig(cfg) {
  // Primeira abertura (ou config de uma versão que ainda não tinha
  // este campo): herda o idioma do computador. Gravado aqui mesmo,
  // então isto roda UMA vez na vida da instalação.
  if (!cfg.language || !IDIOMAS.includes(cfg.language)) {
    cfg.language = detectSystemLanguage();
  }
  if (!Array.isArray(cfg.folders)) cfg.folders = [];
  if (!Array.isArray(cfg.servers)) cfg.servers = [];

  // Categorias de marcador: saneadas na LEITURA. O renderer só vê
  // dados válidos, e um arquivo mexido à mão não vira id malformado
  // dentro de `layers` nem cor injetada em style="".
  if (!Array.isArray(cfg.markerCats)) cfg.markerCats = [];
  const vistos = new Set();
  cfg.markerCats = cfg.markerCats
    .filter((c) => c && /^cat_[a-z0-9]{4,20}$/i.test(String(c.id || '')) && !vistos.has(c.id) && vistos.add(c.id))
    .slice(0, 3)
    .map((c) => ({
      id: String(c.id),
      name: String(c.name || '').slice(0, 20) || String(c.id),
      emoji: String(c.emoji || '⭐').slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(String(c.color || '')) ? String(c.color) : '#b48ee6'
    }));
  const folderIds = new Set(cfg.folders.map((f) => f.id));
  for (const s of cfg.servers) {
    if (!('folderId' in s)) s.folderId = null;
    // Servidor "rastreado": recebe notificação de entrada/saída.
    if (!('tracked' in s)) s.tracked = false;
    // Pasta apagada: o servidor volta para a raiz em vez de sumir.
    if (s.folderId && !folderIds.has(s.folderId)) s.folderId = null;
    if (!Array.isArray(s.tags)) s.tags = [];
  }
  for (const f of cfg.folders) {
    if (!f.color) f.color = '#6ee06e';
    if (!('icon' in f)) f.icon = null;
  }

  // Blocos novos: mesclamos com os padrões para que uma config
  // antiga (ou parcial) nunca chegue no resto do app com buracos.
  cfg.steam = { ...DEFAULT_STEAM, ...(cfg.steam || {}) };
  cfg.hotkeys = { ...DEFAULT_HOTKEYS, ...(cfg.hotkeys || {}) };
  cfg.notify = { ...DEFAULT_NOTIFY, ...(cfg.notify || {}) };
  cfg.overlayUi = {
    ...DEFAULT_OVERLAY_UI,
    ...(cfg.overlayUi || {}),
    sections: { ...DEFAULT_OVERLAY_UI.sections, ...((cfg.overlayUi || {}).sections || {}) }
  };

  // Limites de sanidade — um valor absurdo salvo à mão não pode
  // deixar o overlay do tamanho de um pixel.
  const clamp = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  cfg.overlayUi.width = clamp(cfg.overlayUi.width, 260, 900, 360);
  cfg.overlayUi.height = clamp(cfg.overlayUi.height, 260, 1400, 560);
  cfg.overlayUi.opacity = clamp(cfg.overlayUi.opacity, 20, 100, 84);
  cfg.overlayUi.scale = clamp(cfg.overlayUi.scale, 70, 160, 100);
  cfg.notify.volume = clamp(cfg.notify.volume, 0, 100, 60);
  cfg.notify.durationSec = clamp(cfg.notify.durationSec, 1, 20, 4);
  if (!/^#[0-9a-fA-F]{6}$/.test(cfg.overlayUi.accent || '')) cfg.overlayUi.accent = '#6ee06e';

  return cfg;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return normalizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
  } catch {
    return normalizeConfig({ ...DEFAULT_CONFIG });
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

// ------------------------------------------------------------
// Janelas
// ------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640,
    backgroundColor: '#101613', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');

  // ----------------------------------------------------------
  // O BOTÃO X
  //
  // Com `closeToTray` ligado, o X ESCONDE a janela em vez de
  // encerrar: o tracking do servidor continua rodando e o app fica
  // na bandeja, do lado do relógio.
  //
  // Vem DESLIGADO de fábrica, e isso é decisão, não descuido: um
  // programa que não fecha quando você manda fechar é a coisa mais
  // irritante que um app de desktop pode fazer. Quem quiser o
  // comportamento liga nas configurações e a partir daí sabe o que
  // esperar.
  //
  // `sairDeVerdade` distingue "o usuário clicou no X" de "o app
  // está encerrando" (menu da bandeja, Alt+F4 no encerrar, update).
  // Sem essa marca, o app nunca conseguiria fechar.
  // ----------------------------------------------------------
  mainWindow.on('close', (e) => {
    const cfg = loadConfig();
    if (sairDeVerdade || !cfg.closeToTray) return;   // fecha normalmente
    e.preventDefault();
    mainWindow.hide();
    garantirBandeja();
    atualizarBandeja();
    // Avisa UMA vez. Uma janela que some sem explicação parece
    // travamento; na segunda vez a pessoa já sabe e o aviso vira
    // barulho.
    if (!avisouBandeja) {
      avisouBandeja = true;
      notificarBandeja();
    }
  });
}

// ------------------------------------------------------------
// BANDEJA DO SISTEMA
//
// O ícone ao lado do relógio (nos "ícones ocultos" do Windows,
// igual ao da Steam). Serve para duas coisas: dizer que o app
// continua vivo, e dizer QUAL SERVIDOR está sendo acompanhado —
// que é a pergunta que se faz ao olhar para lá.
// ------------------------------------------------------------
let tray = null;
let sairDeVerdade = false;
let avisouBandeja = false;

function garantirBandeja() {
  if (tray) return tray;
  const ico = path.join(__dirname, 'assets', 'icon.ico');
  let img;
  try {
    img = nativeImage.createFromPath(ico);
    // No Windows o ícone da bandeja é 16px. Sem redimensionar, um
    // .ico grande sai borrado ou cortado.
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  } catch { img = null; }

  try {
    tray = new Tray(img && !img.isEmpty() ? img : nativeImage.createEmpty());
  } catch (e) {
    console.error('[bandeja] não foi possível criar:', e && e.message);
    return null;
  }

  tray.on('click', () => mostrarJanela());
  tray.on('double-click', () => mostrarJanela());
  atualizarBandeja();
  return tray;
}

function mostrarJanela() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// O texto que aparece ao passar o mouse, e o menu do botão direito.
// Os dois dizem a mesma coisa: o que o app está fazendo agora.
function atualizarBandeja() {
  if (!tray) return;
  const cfg = loadConfig();
  const s = (cfg.servers || []).find((x) => x.bmId === servidorEmFoco)
         || (cfg.servers || []).find((x) => x.bmId === cfg.overlayServerId);

  const nome = s ? (s.name || `${s.ip}:${s.port}`) : null;
  const vivo = s ? ultimoEstado[s.bmId] : null;
  const jogadores = vivo ? `  ${vivo.players}/${vivo.maxPlayers}` : '';

  // O tooltip do Windows corta em 127 caracteres; nome de servidor
  // de Unturned passa disso com folga.
  const linha = nome
    ? `Unturned+  ·  ${nome}${jogadores}`
    : 'Unturned+  ·  sem servidor no tracking';
  tray.setToolTip(linha.slice(0, 120));

  const menu = Menu.buildFromTemplate([
    { label: nome ? `Acompanhando: ${nome}` : 'Nenhum servidor no tracking', enabled: false },
    { type: 'separator' },
    { label: 'Abrir o Unturned+', click: () => mostrarJanela() },
    { label: isOverlayOpen() ? 'Esconder o overlay' : 'Mostrar o overlay',
      click: () => { toggleOverlay(); atualizarBandeja(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { sairDeVerdade = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function notificarBandeja() {
  try {
    if (tray && tray.displayBalloon) {
      tray.displayBalloon({
        title: 'Unturned+ continua rodando',
        content: 'O tracking do servidor segue ativo. Clique no ícone para abrir de novo, ou use Sair para encerrar.'
      });
    }
  } catch { /* balão é enfeite: falhar aqui não pode atrapalhar nada */ }
}

function createOverlay() {
  if (overlayWindow) { overlayWindow.show(); return; }
  const cfg = loadConfig();
  const ui = cfg.overlayUi;
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: ui.width, height: ui.height, minWidth: 260, minHeight: 260,
    x: Math.max(0, width - ui.width - 20), y: 20,
    transparent: true, frame: false, resizable: true,
    skipTaskbar: true, alwaysOnTop: ui.alwaysOnTop !== false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  if (ui.alwaysOnTop !== false) overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile('overlay.html');

  // Quem redimensiona o HUD com o mouse manda no tamanho salvo —
  // senão a config voltaria a esticar a janela no próximo F8.
  overlayWindow.on('resized', () => {
    if (!overlayWindow) return;
    const [w, h] = overlayWindow.getSize();
    const c = loadConfig();
    c.overlayUi.width = w;
    c.overlayUi.height = h;
    saveConfig(c);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay:resized', { width: w, height: h });
    }
  });

  overlayWindow.on('closed', () => { overlayWindow = null; });

  // O HUD não consulta o servidor por conta própria — ele desenha o
  // que o processo principal transmite. Se o próximo ciclo só sai
  // daqui a 25s, o HUD abriria vazio; então forçamos uma leitura
  // assim que a janela termina de carregar.
  overlayWindow.webContents.once('did-finish-load', () => {
    const c = loadConfig();
    if (c.overlayServerId) pollarAgora(c.overlayServerId).catch(() => {});
  });
}

// Devolve se ficou LIGADO. O menu mostra esse estado, e sem o
// retorno ele teria que adivinhar invertendo o que mostrava antes —
// que erra assim que o F8 é usado por fora do menu.
function toggleOverlay() {
  if (overlayWindow && overlayWindow.isVisible()) { overlayWindow.hide(); return false; }
  createOverlay();
  return true;
}

function isOverlayOpen() {
  return !!(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
}

// Aplica a aparência salva na janela já aberta (sem reiniciar).
function applyOverlayUi() {
  const cfg = loadConfig();
  const ui = cfg.overlayUi;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const [w, h] = overlayWindow.getSize();
    if (w !== ui.width || h !== ui.height) overlayWindow.setSize(ui.width, ui.height);
    overlayWindow.setAlwaysOnTop(ui.alwaysOnTop !== false, 'screen-saver');
    overlayWindow.webContents.send('overlay:ui', ui);
  }
  return ui;
}

// ------------------------------------------------------------
// JANELA DE NOTIFICAÇÃO
//
// Separada do overlay de propósito: o aviso de "fulano entrou"
// precisa aparecer mesmo com o HUD escondido (F8), e no canto que
// o usuário escolheu — que não é necessariamente onde o HUD está.
// É clique-atravessa e sem foco, para nunca roubar o jogo.
// ------------------------------------------------------------
let notifyWindow = null;
const NOTIFY_W = 340;
const NOTIFY_H = 96;

function notifyBounds(position) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const m = 20;
  switch (position) {
    case 'top-left':      return { x: m, y: m };
    case 'top-center':    return { x: Math.round((width - NOTIFY_W) / 2), y: m };
    case 'bottom-left':   return { x: m, y: height - NOTIFY_H - m };
    case 'bottom-right':  return { x: width - NOTIFY_W - m, y: height - NOTIFY_H - m };
    case 'top-right':
    default:              return { x: width - NOTIFY_W - m, y: m };
  }
}

function ensureNotifyWindow() {
  if (notifyWindow && !notifyWindow.isDestroyed()) return notifyWindow;
  const cfg = loadConfig();
  const pos = notifyBounds(cfg.notify.position);

  notifyWindow = new BrowserWindow({
    width: NOTIFY_W, height: NOTIFY_H, x: pos.x, y: pos.y,
    transparent: true, frame: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    focusable: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  notifyWindow.setAlwaysOnTop(true, 'screen-saver');
  notifyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notifyWindow.setIgnoreMouseEvents(true);   // nunca intercepta cliques do jogo
  notifyWindow.loadFile('notify.html');
  notifyWindow.on('closed', () => { notifyWindow = null; });
  return notifyWindow;
}

// `payload`: { type: 'join'|'leave'|'test', name, server }
function showNotification(payload) {
  const cfg = loadConfig();
  const n = cfg.notify;
  if (!n.enabled && payload.type !== 'test') return false;

  const win = ensureNotifyWindow();
  const pos = notifyBounds(n.position);
  win.setBounds({ x: pos.x, y: pos.y, width: NOTIFY_W, height: NOTIFY_H });

  const send = () => {
    if (!notifyWindow || notifyWindow.isDestroyed()) return;
    notifyWindow.showInactive();       // aparece sem roubar o foco do jogo
    notifyWindow.webContents.send('notify:show', {
      ...payload,
      mode: n.mode,
      sound: n.sound,
      volume: n.volume / 100,
      durationSec: n.durationSec,
      position: n.position
    });
  };

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
  return true;
}

// ------------------------------------------------------------
// ATALHOS GLOBAIS
//
// Registrados a partir da config. Um acelerador inválido ou já
// tomado por outro programa faz o register falhar — devolvemos a
// lista de falhas para a interface avisar em vez de o atalho
// simplesmente "não funcionar" sem explicação.
// ------------------------------------------------------------
const HOTKEY_ACTIONS = {
  toggleOverlay: () => toggleOverlay(),
  ghostMode: () => {
    if (!overlayWindow) return;
    overlayClickThrough = !overlayClickThrough;
    overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
    overlayWindow.webContents.send('overlay:clickthrough', overlayClickThrough);
  },
  markAirdrop: () => {
    const cfg = loadConfig();
    const id = cfg.overlayServerId;
    if (!id) return;
    const s = cfg.servers.find((x) => x.bmId === id);
    if (!s) return;
    s.lastAirdropAt = new Date().toISOString();
    saveConfig(cfg);
    sendToWindows('overlay:configChanged');
    showNotification({ type: 'airdrop', name: s.name || id });
  }
};

function applyHotkeys() {
  globalShortcut.unregisterAll();
  const cfg = loadConfig();
  const failed = [];
  const registered = {};

  for (const [action, accel] of Object.entries(cfg.hotkeys || {})) {
    if (!accel || !HOTKEY_ACTIONS[action]) continue;
    try {
      const ok = globalShortcut.register(accel, HOTKEY_ACTIONS[action]);
      if (ok) registered[action] = accel;
      else failed.push({ action, accel, reason: 'taken' });
    } catch (e) {
      failed.push({ action, accel, reason: 'invalid' });
    }
  }
  return { registered, failed };
}

app.whenReady().then(() => {
  notesStore.init(app.getPath('userData'));
  teamStore.init(app.getPath('userData'));
  fichasStore.init(app.getPath('userData'));
  mediaStore.init(app.getPath('userData'));
  scheduleStore.init(app.getPath('userData'));
  raidStore.init(app.getPath('userData'));
  inventoryStore.init(app.getPath('userData'));
  notifStore.init(app.getPath('userData'));
  initConta();
  initSync();
  createWindow();
  startLocalPolling();
  startCurrentServerWatch();
  startScheduleWatch();
  applyHotkeys();   // F8/F9/F10 por padrão, mas configuráveis

  // A bandeja nasce junto com o app quando a opção está ligada.
  // Criar só na hora de fechar funcionaria, mas aí o ícone
  // apareceria do nada no meio do uso — e o ponto dele é justamente
  // dizer, o tempo todo, que o app está ali.
  if (loadConfig().closeToTray) garantirBandeja();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopLocalPolling();
  stopCurrentServerWatch();
  if (geo) { try { geo.flush(); } catch {} }             // cache de país pendente
  if (workshop) { try { workshop.flush(); } catch {} }   // cache do workshop pendente
  if (steamAcc) { try { steamAcc.flush(); } catch {} }   // cache de perfis da Steam
  // A central grava em lote; a rajada pendente não pode se perder
  // justamente no fechamento.
  try { notifStore.flush(); } catch {}
});
app.on('before-quit', () => { sairDeVerdade = true; });

app.on('window-all-closed', () => {
  // Com a bandeja ligada, "não sobrou janela" NÃO significa "pode
  // encerrar": a janela principal está escondida de propósito e o
  // tracking continua. Sem esta guarda o app morreria no X mesmo
  // com a opção ativada, e o ícone da bandeja sumiria junto.
  if (tray && loadConfig().closeToTray && !sairDeVerdade) return;
  if (process.platform !== 'darwin') app.quit();
});

// ------------------------------------------------------------
// IPC: configuração
// ------------------------------------------------------------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, cfg) => {
  saveConfig(cfg);
  if (overlayWindow) overlayWindow.webContents.send('overlay:configChanged');
  startLocalPolling(); // reaplica intervalo/lista de servidores atualizados
  applyOverlayUi();    // aparência do HUD ao vivo
  return true;
});

// ------------------------------------------------------------
// IPC: idiomas
//
// O renderer carregava os .json com fetch('languages/pt-BR.json').
// Numa página file:// o Chromium bloqueia esse fetch por CORS, e o
// I18N caía no catch silencioso: TODA string traduzida virava a
// própria chave ("card.copied" em vez de "IP copiado"). Só não era
// óbvio porque o HTML tem o texto em português escrito à mão.
// Ler do disco pelo processo principal resolve de vez.
// ------------------------------------------------------------
ipcMain.handle('i18n:load', (_e, lang) => {
  const safe = /^[a-zA-Z]{2}-[a-zA-Z]{2}$/.test(String(lang || '')) ? lang : 'pt-BR';
  const file = path.join(__dirname, 'languages', `${safe}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    if (safe !== 'pt-BR') {
      try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', 'pt-BR.json'), 'utf-8')); } catch {}
    }
    return {};
  }
});

// ------------------------------------------------------------
// IPC: overlay
// ------------------------------------------------------------
ipcMain.handle('overlay:toggle', () => toggleOverlay());
ipcMain.handle('overlay:isOpen', () => isOverlayOpen());
ipcMain.handle('overlay:hide', () => { if (overlayWindow) overlayWindow.hide(); return true; });

// ------------------------------------------------------------
// IPC: BattleMetrics
// ------------------------------------------------------------
async function bmRequest(endpoint, params = {}) {
  const cfg = loadConfig();
  const url = new URL(BM_API + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = { 'Accept': 'application/json' };
  if (cfg.apiToken) headers['Authorization'] = `Bearer ${cfg.apiToken}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BattleMetrics ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

ipcMain.handle('bm:server', async (_e, bmId) =>
  bmRequest(`/servers/${bmId}`, { include: 'player' }));
ipcMain.handle('bm:searchByIp', async (_e, ipPort) =>
  bmRequest('/servers', { 'filter[game]': 'unturned', 'filter[search]': ipPort, 'page[size]': '10' }));
ipcMain.handle('bm:searchByName', async (_e, name) =>
  bmRequest('/servers', { 'filter[game]': 'unturned', 'filter[search]': name, 'page[size]': '20' }));

// ------------------------------------------------------------
// IPC: Query Port local (A2S / Source Query, direto no servidor)
// ------------------------------------------------------------
ipcMain.handle('query:info', async (_e, ip, port) => queryPort.queryInfo(ip, port));
ipcMain.handle('query:players', async (_e, ip, port) => queryPort.queryPlayers(ip, port));
ipcMain.handle('query:server', async (_e, ip, port) => queryPort.queryServer(ip, port));
ipcMain.handle('query:rules', async (_e, ip, port) => queryPort.queryRules(ip, port));

// Consulta COMPLETA por IP/porta direto (info + players + rules já
// interpretadas: mapa, mods do Workshop, descrição, config...).
// É o que a tela de tracking e o "adicionar por IP" usam para trazer
// tudo do servidor sem depender de nenhum serviço externo.
async function queryFull(ip, queryPortNum, opts = {}) {
  // Porta já conhecida (ex.: overlay/renderer) -> candidatos = [essa porta].
  return queryEngine.queryResolved(ip, null, queryPortNum, opts);
}

ipcMain.handle('query:full', async (_e, ip, port) => queryFull(ip, port, { timeoutMs: 3500 }));

// Cache em memória da porta de query que REALMENTE respondeu por servidor.
// Evita ficar redescobrindo a porta a cada ciclo de polling.
const workingPortCache = {}; // bmId -> porta que respondeu

// Descobre a porta de query correta e traz os dados completos, usando o
// motor de consulta (gamedig quando disponível; A2S próprio como fallback).
// Testa várias portas candidatas — é isso que conserta o "sempre offline".
async function resolveAndQuery(ip, gamePort, queryPortOverride, opts = {}) {
  return queryEngine.queryResolved(ip, gamePort, queryPortOverride, {
    timeoutMs: opts.timeoutMs || 3000
  });
}

// Sonda um endereço "cru" (usado ao adicionar por IP:porta e ao detectar
// o servidor em que o jogador está). Aceita a porta de JOGO e/ou uma
// porta de query explícita; descobre sozinho qual porta responde.
ipcMain.handle('server:probe', async (_e, ip, gamePort, queryPortOverride) => {
  return resolveAndQuery(ip, gamePort, queryPortOverride, { timeoutMs: 3000 });
});

// Consulta pontual usando o servidor salvo (resolve IP/queryPort automaticamente)
ipcMain.handle('query:serverByBmId', async (_e, bmId) => {
  const cfg = loadConfig();
  const s = cfg.servers.find((x) => x.bmId === bmId);
  if (!s) throw new Error('Servidor não encontrado na lista salva.');

  // Usa a porta que já funcionou como dica; senão parte do jogo/override.
  const hint = workingPortCache[bmId] || s.queryPort;
  const { info, players, unturned, resolvedQueryPort } =
    await resolveAndQuery(s.ip, s.port, hint, { timeoutMs: 3500 });
  if (resolvedQueryPort) workingPortCache[bmId] = resolvedQueryPort;
  rulesCache[bmId] = { at: Date.now(), data: unturned };
  await appendSnapshotAndEvents(bmId, info, players);
  return { info, players, unturned };
});

// ------------------------------------------------------------
// IPC: Airdrop — intervalo por servidor + marcação do último drop.
// O intervalo vem, por ordem de prioridade:
//   1) config manual do usuário (airdropIntervalSec no servidor);
//   2) a rule de airdrop publicada pelo servidor (se houver);
//   3) padrão de 1800s (30 min), só como chute inicial editável.
// ------------------------------------------------------------
ipcMain.handle('airdrop:get', (_e, bmId) => {
  const cfg = loadConfig();
  const s = cfg.servers.find((x) => x.bmId === bmId);
  if (!s) return null;
  const fromRules = rulesCache[bmId]?.data?.airdropSeconds || null;
  return {
    intervalSec: s.airdropIntervalSec || fromRules || 1800,
    intervalFromServer: fromRules,
    lastAirdropAt: s.lastAirdropAt || null
  };
});

ipcMain.handle('airdrop:setInterval', (_e, bmId, seconds) => {
  const cfg = loadConfig();
  const s = cfg.servers.find((x) => x.bmId === bmId);
  if (!s) return false;
  s.airdropIntervalSec = Math.max(30, parseInt(seconds, 10) || 0) || null;
  saveConfig(cfg);
  return true;
});

// Marca "caiu um airdrop agora" (ou limpa, se timestamp = null)
ipcMain.handle('airdrop:mark', (_e, bmId, timestamp) => {
  const cfg = loadConfig();
  const s = cfg.servers.find((x) => x.bmId === bmId);
  if (!s) return false;
  s.lastAirdropAt = timestamp === null ? null : (timestamp || new Date().toISOString());
  saveConfig(cfg);
  if (overlayWindow) overlayWindow.webContents.send('overlay:configChanged');
  return true;
});

// Histórico LOCAL (construído por este app, a partir do polling do query port —
// não depende do BattleMetrics de forma alguma).
ipcMain.handle('query:clearLocalHistory', (_e, bmId) => {
  writeLocalHistory(bmId, { snapshots: [], events: [] });
  delete lastPlayersByServer[bmId];
  return true;
});

ipcMain.handle('query:localHistory', (_e, bmId, limit = 500) => {
  const data = readLocalHistory(bmId);
  return {
    snapshots: data.snapshots.slice(-limit),
    events: data.events.slice(0, limit)
  };
});

// ------------------------------------------------------------
// Uptime: há quanto tempo ESTE servidor está de pé
//
// Não vem do BattleMetrics. O campo "Uptime" de lá é uma
// PORCENTAGEM de um período ("99%"), não "está no ar há tanto
// tempo" — pendurar um no outro daria um número certo com o
// rótulo errado.
//
// A conta é feita em cima do que o app viu com os próprios olhos:
// cada poll bem-sucedido grava um snapshot. Uma sequência de
// snapshots sem buraco é um período no ar; o buraco é queda. Vale
// entre reinícios do app, porque o histórico está no disco.
//
// O que isto NÃO consegue dizer: se o servidor caiu enquanto o app
// estava fechado. Aí o buraco no histórico é do app, não do
// servidor, e a conta trata os dois igual — de propósito, porque
// do lado de fora não há como distinguir. Por isso a resposta traz
// `confiavel: false` quando o intervalo observado é maior que o
// esperado, e a tela avisa em vez de afirmar.
// ------------------------------------------------------------
function calcularUptime(bmId, intervaloMs) {
  const hist = readLocalHistory(bmId);
  const snaps = hist.snapshots || [];
  if (!snaps.length) return { desde: null, ms: 0, confiavel: false, amostras: 0 };

  // Folga de 3x o intervalo: um poll que demorou, um timeout
  // isolado ou uma máquina que dormiu por 20 segundos não são
  // queda de servidor.
  const FOLGA = Math.max(3 * (intervaloMs || 30000), 90000);

  let inicio = new Date(snaps[snaps.length - 1].t).getTime();
  let amostras = 1;
  let maiorBuraco = 0;
  for (let i = snaps.length - 1; i > 0; i--) {
    const atual = new Date(snaps[i].t).getTime();
    const antes = new Date(snaps[i - 1].t).getTime();
    const buraco = atual - antes;
    if (!Number.isFinite(buraco) || buraco > FOLGA) break;
    if (buraco > maiorBuraco) maiorBuraco = buraco;
    inicio = antes;
    amostras++;
  }

  const fim = new Date(snaps[snaps.length - 1].t).getTime();
  const agora = Date.now();
  // O último snapshot é velho? Então não estamos "no ar há X": o
  // app parou de olhar. Devolve o que sabe, marcado como não
  // confiável, em vez de contar tempo que ninguém observou.
  const frescor = agora - fim;
  return {
    desde: new Date(inicio).toISOString(),
    ms: Math.max(0, fim - inicio),
    amostras,
    confiavel: amostras >= 3 && frescor <= FOLGA,
    frescorMs: frescor
  };
}

ipcMain.handle('query:uptime', (_e, bmId) => {
  const cfg = loadConfig();
  // Mesma chave que o gerenciador de polling usa lá embaixo:
  // duas leituras diferentes do intervalo dariam duas folgas
  // diferentes para a mesma queda.
  return calcularUptime(bmId, Math.max(15, cfg.refreshInterval || 30) * 1000);
});

// ------------------------------------------------------------
// IPC: BattleMetrics via SCRAPING da página pública (sem API/token)
// ------------------------------------------------------------
// A raspagem do BattleMetrics ficou reduzida a UM uso: descobrir
// IP e porta quando você adiciona um servidor pelo ID do BM (ver
// `resolverServidorPorBmId` mais abaixo). O rank saiu da tela, e
// com ele o cache e a consulta a cada abertura — era um Chromium
// invisível carregando uma página inteira para preencher um campo.
ipcMain.handle('bmscrape:search', async (_e, query) => bmScrape.scrapeSearch(query));

// GET simples de JSON usando a stack de rede do próprio Electron
// (respeita proxy/DNS do sistema). Usado só para resolver ID -> IP:porta.
function httpGetJson(url, { timeoutMs = 8000 } = {}) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let body = '';
    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('Timeout na requisição.')); }, timeoutMs);
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Resposta não é JSON válido.')); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// Resolve um ID numérico do BattleMetrics para { id, name, ip, port, map }.
// O endereço é só o ponto de partida — quem traz os dados VIVOS depois é
// a consulta A2S direta. Tenta primeiro o endpoint JSON público (sem
// token, mais estável) e, se falhar, cai para a leitura da página HTML.
async function resolveBmServer(bmId) {
  // 1) endpoint público de leitura (não requer token)
  try {
    const json = await httpGetJson(`${BM_API}/servers/${encodeURIComponent(bmId)}`);
    const a = json?.data?.attributes;
    if (a && a.ip && a.port) {
      return {
        id: String(bmId),
        name: a.name || `#${bmId}`,
        ip: a.ip,
        port: Number(a.port),
        map: a.details?.map || null
      };
    }
  } catch { /* segue para o fallback */ }

  // 2) fallback: leitura da página pública (sujeito a Cloudflare/mudança de layout)
  let scraped = null;
  try {
    scraped = (await bmScrape.scrapeServer(bmId)).server;
  } catch { /* página bloqueada/offline */ }

  if (scraped && scraped.ip && scraped.port) {
    return {
      id: String(scraped.id || bmId), name: scraped.name || `#${bmId}`,
      ip: scraped.ip, port: scraped.port, map: scraped.map || null
    };
  }

  // 3) último recurso: o LOG DO JOGO. Se o usuário já entrou nesse
  //    servidor, o nome que o BattleMetrics devolveu (mesmo sem IP)
  //    costuma bater com o que o Unturned registrou — e aí temos o
  //    endereço de graça, sem depender do BattleMetrics.
  const wantedName = (scraped && scraped.name) || null;
  if (wantedName && logSession) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const hit = logSession.getState().suggestions
      .find((s) => s.addressable && norm(s.name) === norm(wantedName));
    if (hit) {
      return { id: String(bmId), name: hit.name, ip: hit.ip, port: hit.port, map: hit.map || null };
    }
  }

  // Erro EXPLICATIVO. O BattleMetrics passou a exigir autenticação
  // no endpoint público e bloqueia scraping por Cloudflare, então
  // "não funciona" é o comportamento esperado sem token — e o
  // caminho recomendado (log do jogo / IP direto) precisa aparecer
  // para o usuário, não só no console.
  throw new Error(
    'O BattleMetrics não devolveu o IP/porta deste servidor. ' +
    'Isso costuma acontecer porque a API pública passou a exigir token. ' +
    'Cole um token em Configurações, ou adicione o servidor por IP:porta — ' +
    'se você já entrou nele pelo jogo, ele aparece nas sugestões do botão "+".'
  );
}

ipcMain.handle('bm:resolve', async (_e, bmId) => resolveBmServer(bmId));

// ------------------------------------------------------------
// Histórico local: leitura/gravação em disco
// ------------------------------------------------------------
function readLocalHistory(bmId) {
  try {
    return JSON.parse(fs.readFileSync(localHistoryFile(bmId), 'utf-8'));
  } catch {
    return { snapshots: [], events: [] };
  }
}

function writeLocalHistory(bmId, data) {
  fs.mkdirSync(historyDir(), { recursive: true });
  fs.writeFileSync(localHistoryFile(bmId), JSON.stringify(data, null, 2), 'utf-8');
}

// Nomes dos amigos vistos na última consulta à Steam — usados pelo
// filtro "só avisar quando for amigo". Nome de jogador no Unturned
// é o persona da Steam, então casar por nome funciona na prática
// (não é infalível: dois amigos podem trocar de nome, e um
// desconhecido pode usar o mesmo nome de um amigo).
let friendNames = new Set();

// Decide se um join/leave vira notificação na tela.
//
// Só notificamos o servidor que interessa: o fixado no overlay e,
// se não houver nenhum, aquele em que o jogador está agora. Sem
// isso, quem acompanha 10 servidores tomaria uma enxurrada de
// avisos de gente que não conhece.
// Rede de segurança: o MESMO aviso (servidor + tipo + pessoa) não
// sai duas vezes dentro de uma janela curta.
//
// Isto NÃO é a correção do bug — nenhum caso do vf/avisos.js
// precisa dela para passar, e eu conferi desligando. É proteção
// para o que eu não consigo reproduzir aqui: `lastPlayersByServer`
// zerado por reinício do app, porta de query que muda no meio,
// servidor que responde de um jeito num ciclo e de outro no
// seguinte. Em todos esses o app "redescobre" a mesma entrada, e
// quem está do outro lado só quer ser avisado uma vez.
//
// 90s: mais que o intervalo de polling (30s) com folga para três
// ciclos, e menos que qualquer ida e volta real de alguém que saiu
// e voltou de propósito.
const JANELA_AVISO_MS = 90 * 1000;
const avisosRecentes = new Map();   // "bmId|tipo|nome" -> quando

function avisoRepetido(bmId, type, name) {
  const chave = `${bmId}|${type}|${name}`;
  const agora = Date.now();
  const antes = avisosRecentes.get(chave);
  if (antes && agora - antes < JANELA_AVISO_MS) return true;
  avisosRecentes.set(chave, agora);
  // Limpeza preguiçosa: sem isto o mapa cresce para sempre num
  // servidor movimentado.
  if (avisosRecentes.size > 500) {
    for (const [k, t] of avisosRecentes) {
      if (agora - t > JANELA_AVISO_MS) avisosRecentes.delete(k);
    }
  }
  return false;
}

function maybeNotifyPlayer(bmId, type, name) {
  const cfg = loadConfig();
  const n = cfg.notify;
  if (!n.enabled) return;
  if (type === 'join' && !n.onJoin) return;
  if (type === 'leave' && !n.onLeave) return;

  const server = cfg.servers.find((s) => s.bmId === bmId);

  // Quais servidores avisam:
  //   1. os marcados como RASTREADOS (o ✚ vermelho no card);
  //   2. o fixado no overlay;
  //   3. aquele em que você está jogando agora.
  //
  // O item 1 é o que faltava: antes só valia o overlay ou o servidor
  // atual, então acompanhar o servidor do time ENQUANTO joga em
  // outro era impossível — e é exatamente o caso comum.
  let interessa = !!(server && server.tracked);

  if (!interessa && cfg.overlayServerId === bmId) interessa = true;
  if (!interessa && logSession && logSession.current && logSession.current.ip) {
    const cur = logSession.current;
    const match = cfg.servers.find((s) => s.ip === cur.ip && Number(s.port) === Number(cur.port));
    if (match && match.bmId === bmId) interessa = true;
  }
  if (!interessa) return;

  if (n.onlyFriends && !friendNames.has(name)) return;

  // A checagem fica DEPOIS dos filtros: um aviso que não ia sair de
  // qualquer forma não pode consumir a janela e mascarar o próximo
  // que sairia.
  if (avisoRepetido(bmId, type, name)) return;

  showNotification({ type, name, server: server ? server.name : null });
  // Toda notificação entra na central, mesmo quando o balão passa
  // despercebido. Aviso que some em 4 segundos e não deixa rastro é
  // aviso perdido.
  registrarNotificacao({ kind: type, title: name, body: server ? server.name : '', bmId });
}

// ------------------------------------------------------------
// UMA DETECÇÃO DE EVENTO POR VEZ, POR SERVIDOR
//
// Dois caminhos consultam o mesmo servidor e cada um chama esta
// função com o resultado da SUA consulta: o laço de polling (a cada
// 30s) e `query:serverByBmId`, que a página de tracking dispara.
//
// A fila garante que a sequência ler -> comparar -> gravar de um
// não se misture com a do outro. O trecho de comparação é síncrono
// e, sozinho, já não se intercalaria; o que a fila protege de
// verdade é o ARQUIVO de histórico, cuja leitura e gravação ficam
// dos dois lados de um `await` no chamador — sem ela, dois ciclos
// próximos podiam perder eventos por sobrescrita.
//
// NOTA HONESTA SOBRE O DIAGNÓSTICO: minha primeira explicação para
// a "notificação repetida 2, 3, 4 vezes" foi uma corrida entre
// esses dois caminhos. Escrevi o teste (vf/avisos.js), desliguei a
// fila, e ele continuou passando — ou seja, a corrida não era a
// causa. Quem causa é a leitura ruim da lista de jogadores, tratada
// mais abaixo. A fila fica porque protege o arquivo, não porque
// resolveu o sintoma.
// ------------------------------------------------------------
const filaPorServidor = new Map();   // bmId -> Promise

function emFila(bmId, tarefa) {
  const anterior = filaPorServidor.get(bmId) || Promise.resolve();
  // `.catch` para que um erro numa chamada não trave a fila para
  // sempre — a próxima precisa rodar de qualquer jeito.
  const proxima = anterior.then(tarefa, tarefa);
  filaPorServidor.set(bmId, proxima.catch(() => {}));
  return proxima;
}

function appendSnapshotAndEvents(bmId, info, players) {
  return emFila(bmId, () => appendSnapshotAndEventsInterno(bmId, info, players));
}

function appendSnapshotAndEventsInterno(bmId, info, players) {
  const hist = readLocalHistory(bmId);

  hist.snapshots.push({
    t: new Date().toISOString(),
    players: info.players,
    maxPlayers: info.maxPlayers,
    map: info.map
  });
  // Mantém no máximo ~30 dias em resolução de polling padrão (ajustável).
  if (hist.snapshots.length > 20000) hist.snapshots = hist.snapshots.slice(-20000);

  // ESTA É A CORREÇÃO DA NOTIFICAÇÃO REPETIDA.
  //
  // LISTA VAZIA COM O SERVIDOR CHEIO É LEITURA RUIM, NÃO ESVAZIAMENTO.
  //
  // O A2S responde em duas partes: INFO (nome, contagem, mapa) e
  // PLAYER (a lista). A segunda é bem mais frágil — é maior, vem em
  // vários pacotes UDP e alguns servidores simplesmente param de
  // responder a ela sob carga. Quando isso acontece a contagem diz
  // "12 jogadores" e a lista vem vazia.
  //
  // Tratar isso como esvaziamento gerava uma saída para CADA pessoa
  // e, no ciclo seguinte, uma entrada para cada uma de volta. Um
  // servidor cheio com uma leitura ruim virava dezenas de avisos.
  //
  // Aqui a leitura é descartada para efeito de EVENTOS. O snapshot
  // acima continua gravado (a contagem veio do INFO e é confiável);
  // o que não acontece é a comparação.
  const leituraSuspeita = players && players.length === 0 && info && info.players > 0;
  if (leituraSuspeita) {
    writeLocalHistory(bmId, hist);
    return hist;
  }

  if (players) {
    const prev = lastPlayersByServer[bmId];
    const now = new Set(players.map((p) => p.name));
    if (prev) {
      for (const name of now) {
        if (!prev.has(name)) {
          hist.events.unshift({ t: new Date().toISOString(), type: 'join', name });
          maybeNotifyPlayer(bmId, 'join', name);
        }
      }
      for (const name of prev) {
        if (!now.has(name)) {
          hist.events.unshift({ t: new Date().toISOString(), type: 'leave', name });
          maybeNotifyPlayer(bmId, 'leave', name);
        }
      }
    }
    lastPlayersByServer[bmId] = now;
    hist.events = hist.events.slice(0, 2000);
  }

  writeLocalHistory(bmId, hist);
  return hist;
}

// ------------------------------------------------------------
// Gerenciador de polling local — roda no processo principal,
// consulta o Query Port de cada servidor salvo periodicamente,
// e alimenta o histórico local + avisa a janela em tempo real.
// ------------------------------------------------------------
function effectiveQueryPort(server) {
  // Se o usuário não informou uma porta de query específica,
  // usa a convenção mais comum do Unturned (Query Port = Porta + 1).
  return server.queryPort || (server.port ? server.port + 1 : null);
}

// Um ciclo de polling. O resultado é transmitido para TODAS as
// janelas (principal e overlay) no MESMO instante — o overlay não
// tem relógio próprio, ele desenha o que chega daqui. Antes cada
// janela consultava o servidor no seu próprio setInterval: dobrava
// o tráfego contra o servidor de jogo e produzia uma defasagem de
// até um ciclo inteiro entre o app e o HUD.
async function pollarServidor(s) {
  // Candidatas: a porta que já funcionou antes primeiro, depois a
  // porta salva/derivada e as vizinhas. Assim um card "offline" por
  // porta errada se recupera sozinho assim que uma responde.
  const hint = workingPortCache[s.bmId] || s.queryPort;
  try {
    const { info, players, unturned, resolvedQueryPort } =
      await resolveAndQuery(s.ip, s.port, hint, { timeoutMs: 2500 });
    if (resolvedQueryPort) workingPortCache[s.bmId] = resolvedQueryPort;
    if (unturned) rulesCache[s.bmId] = { at: Date.now(), data: unturned };
    const hist = await appendSnapshotAndEvents(s.bmId, info, players);
    ultimoEstado[s.bmId] = {
      players: info.players, maxPlayers: info.maxPlayers, at: Date.now() };
    // Só o servidor que a bandeja mostra justifica redesenhar o
    // menu: fazer isso para os 20 da lista, a cada ciclo, seria
    // trabalho para ninguém ver.
    if (tray && (s.bmId === servidorEmFoco || s.bmId === loadConfig().overlayServerId)) {
      atualizarBandeja();
    }
    sendToWindows('query:update', {
      bmId: s.bmId, info, players,
      // Versão ENXUTA das rules: o card precisa de descrição,
      // ícone e contagem de mods, mas mandar `raw` (centenas de
      // chaves) a cada ciclo de polling é desperdício puro.
      unturned: unturned ? {
        fields: unturned.fields,
        mods: unturned.mods,
        modCount: unturned.modCount,
        iconUrl: unturned.iconUrl
      } : null,
      latestEvents: hist.events.slice(0, 20)
    });
  } catch (err) {
    delete ultimoEstado[s.bmId];
    sendToWindows('query:update', { bmId: s.bmId, error: err.message });
  }
}

// Servidores que alguém está OLHANDO agora (HUD fixado, card aberto)
// vão na frente da fila. Com 20 servidores na lista e 2,5s de
// timeout cada, o que importa não pode esperar o resto.
function ordenarPorPrioridade(servers, cfg) {
  const prio = new Set([cfg.overlayServerId, servidorEmFoco].filter(Boolean));
  return [...servers].sort((a, b) => (prio.has(b.bmId) ? 1 : 0) - (prio.has(a.bmId) ? 1 : 0));
}

async function pollAllServersOnce() {
  const cfg = loadConfig();
  const fila = ordenarPorPrioridade((cfg.servers || []).filter((s) => s.ip), cfg);

  // Concorrência limitada: 4 em paralelo. Sequencial, um ciclo com
  // 20 servidores levava até 50s — mais que o próprio intervalo.
  const LIMITE = 4;
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(LIMITE, fila.length) }, async () => {
    while (i < fila.length) {
      const s = fila[i++];
      await pollarServidor(s);
    }
  });
  await Promise.all(trabalhadores);
}

function startLocalPolling() {
  stopLocalPolling();
  const cfg = loadConfig();
  const intervalMs = Math.max(15, cfg.refreshInterval || 30) * 1000;
  localPollTimer = setInterval(pollAllServersOnce, intervalMs);
  pollAllServersOnce(); // primeira leitura imediata
}

function stopLocalPolling() {
  if (localPollTimer) clearInterval(localPollTimer);
  localPollTimer = null;
}

// Atualiza AGORA um servidor só e transmite para as duas janelas.
// Usado pelo botão de refresh manual e quando o overlay é aberto:
// o HUD não precisa esperar o próximo ciclo para ter dados.
async function pollarAgora(bmId) {
  const cfg = loadConfig();
  const s = (cfg.servers || []).find((x) => x.bmId === bmId);
  if (!s || !s.ip) return false;
  await pollarServidor(s);
  return true;
}

ipcMain.handle('query:restartPolling', () => { startLocalPolling(); return true; });
ipcMain.handle('query:focus', (_e, bmId) => {
  servidorEmFoco = bmId || null;
  atualizarBandeja();   // o tooltip diz QUAL servidor está sendo acompanhado
  return true;
});
ipcMain.handle('query:pollNow', async (_e, bmId) => {
  if (bmId) return pollarAgora(bmId);
  await pollAllServersOnce();
  return true;
});

// ============================================================
// LOG DO UNTURNED — detecção do servidor atual, sugestões e o
// visualizador de log ao vivo.
//
// Tudo aqui é alimentado por unturnedLog.js, que lê o Client.log
// do jogo. Ao contrário da versão anterior (que só caçava um
// "IP:porta" solto em qualquer linha), agora reconstruímos o
// BLOCO INTEIRO que o jogo publica ao conectar: nome, mapa,
// descrição, thumbnail, max players, dificuldade, PvP, BattlEye e
// a lista completa de mods do Workshop com nome — não só o ID.
//
// É por isso que o botão "+" consegue sugerir o servidor em que o
// jogador acabou de entrar sem depender do BattleMetrics.
//
// LIMITE HONESTO: servidores que usam o relay da Steam (P2P/SDR)
// aparecem no log como `steamid:...`, sem IP. Nesses casos ainda
// mostramos nome/mapa/mods, mas marcamos `addressable: false` — o
// app avisa em vez de fingir que sabe o endereço.
// ============================================================
let logSession = null;
let manualCurrent = null;   // servidor definido à mão pelo usuário

function localLowUnturned() {
  const home = process.env.USERPROFILE || app.getPath('home');
  return unturnedLog.defaultLogDir(home);
}

function findUnturnedLog() {
  const cfg = loadConfig();
  const home = process.env.USERPROFILE || app.getPath('home');
  return unturnedLog.findLogFile(home, cfg.unturnedLogPath);
}

function sendToWindows(channel, payload) {
  for (const w of [mainWindow, overlayWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// Converte uma sessão do log no formato que a interface consome.
function sessionToCurrent(s, source = 'log') {
  if (!s) return { disconnected: true, source };
  return {
    source,
    addressable: !!(s.ip && s.port),
    transport: s.transport || null,
    ip: s.ip || null,
    port: s.port != null ? s.port : null,
    steamId: s.steamId || null,
    name: s.name || null,
    map: s.levelName || null,
    description: s.description || null,
    thumbnail: s.thumbnail || null,
    maxPlayers: s.maxPlayers || null,
    difficulty: s.difficulty || null,
    cameraMode: s.cameraMode || null,
    pvp: s.pvp, vac: s.vac, battlEye: s.battlEye,
    requiresGold: s.requiresGold, adminCheats: s.adminCheats,
    bookmarkHost: s.bookmarkHost || null,
    mods: s.mods || [],
    since: s.startedAt || null
  };
}

function onLogCurrentChange(session) {
  const payload = sessionToCurrent(session);

  // "Último jogado" só faz sentido guardar quando temos endereço.
  if (session && session.ip && session.port) {
    const cfg = loadConfig();
    cfg.lastPlayedServer = {
      ip: session.ip, port: session.port,
      name: session.name || null, map: session.levelName || null,
      description: session.description || null,
      thumbnail: session.thumbnail || null,
      at: session.startedAt || new Date().toISOString()
    };
    saveConfig(cfg);
  }
  sendToWindows('current-server', payload);
}

function startCurrentServerWatch() {
  stopCurrentServerWatch();
  const cfg = loadConfig();
  if (cfg.currentServerWatch === false) return;
  const file = findUnturnedLog();
  if (!file) return; // sem log conhecido; o usuário pode apontar manualmente

  logSession = new unturnedLog.LogSession({
    onCurrentChange: (session) => onLogCurrentChange(session),
    // Empurra as linhas novas para o visualizador de log ao vivo.
    onEvents: (events) => {
      const useful = events.filter((e) => !e.noise);
      if (useful.length) sendToWindows('log:events', useful);
    }
  });
  logSession.open(file);

  // Estado inicial (o app pode ter aberto com o jogo já conectado).
  if (logSession.current) onLogCurrentChange(logSession.current);
}

function stopCurrentServerWatch() {
  if (logSession) { try { logSession.close(); } catch {} }
  logSession = null;
}

// Estado atual (para a interface montar o card ao abrir).
ipcMain.handle('currentServer:get', () => {
  const cfg = loadConfig();
  const detected = manualCurrent
    || (logSession && logSession.current ? sessionToCurrent(logSession.current) : null);
  return {
    detected,
    lastPlayed: cfg.lastPlayedServer || null,
    logPath: logSession ? logSession.file : null,
    watchEnabled: cfg.currentServerWatch !== false,
    suggestions: logSession ? logSession.getState().suggestions : []
  };
});

// Modo manual — 100% confiável: o usuário informa onde está jogando.
ipcMain.handle('currentServer:setManual', (_e, ip, port, name, map) => {
  manualCurrent = {
    source: 'manual', addressable: true,
    ip, port: Number(port), name: name || null, map: map || null,
    description: null, thumbnail: null, mods: [], since: new Date().toISOString()
  };
  const cfg = loadConfig();
  cfg.lastPlayedServer = { ip, port: Number(port), name: name || null, map: map || null, at: manualCurrent.since };
  saveConfig(cfg);
  sendToWindows('current-server', manualCurrent);
  return cfg.lastPlayedServer;
});

ipcMain.handle('currentServer:clear', () => {
  manualCurrent = null;
  sendToWindows('current-server', { disconnected: true, source: 'manual' });
  return true;
});

// Deixa o usuário apontar manualmente o arquivo de log do Unturned.
ipcMain.handle('currentServer:pickLog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o Client.log do Unturned (pasta Logs)',
    defaultPath: path.join(localLowUnturned(), 'Logs'),
    filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const cfg = loadConfig();
  cfg.unturnedLogPath = result.filePaths[0];
  saveConfig(cfg);
  startCurrentServerWatch();
  return result.filePaths[0];
});

ipcMain.handle('currentServer:setWatch', (_e, enabled) => {
  const cfg = loadConfig();
  cfg.currentServerWatch = !!enabled;
  saveConfig(cfg);
  if (enabled) startCurrentServerWatch(); else stopCurrentServerWatch();
  return cfg.currentServerWatch;
});

// ------------------------------------------------------------
// IPC: VISUALIZADOR DE LOG (ao vivo)
// ------------------------------------------------------------
ipcMain.handle('log:state', () => {
  if (!logSession) {
    return { file: null, current: null, sessions: [], suggestions: [], eventCount: 0, available: false };
  }
  return { ...logSession.getState(), available: true };
});

ipcMain.handle('log:events', (_e, limit = 600, includeNoise = false) => {
  if (!logSession) return [];
  return logSession.getEvents(Math.min(4000, Math.max(1, limit)), { includeNoise: !!includeNoise });
});

// Sugestões para o botão "+": servidores em que o jogador entrou
// recentemente, lidos do log do jogo.
ipcMain.handle('log:suggestions', () => (logSession ? logSession.getState().suggestions : []));

// Releitura forçada (o usuário clicou em "atualizar" no visualizador).
ipcMain.handle('log:reload', () => {
  startCurrentServerWatch();
  return logSession ? { ...logSession.getState(), available: true } : { available: false };
});

// Abre a PASTA do log no explorador — atalho útil para suporte.
ipcMain.handle('log:reveal', () => {
  const file = logSession ? logSession.file : findUnturnedLog();
  if (!file) return false;
  shell.showItemInFolder(file);
  return true;
});

// ------------------------------------------------------------
// POST form-urlencoded usando a stack de rede do Electron.
// A API do Workshop da Steam só aceita POST neste endpoint.
// ------------------------------------------------------------
function httpPostForm(url, fields, { timeoutMs = 12000 } = {}) {
  const { net } = require('electron');
  const body = Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
    let out = '';
    const timer = setTimeout(() => {
      try { req.abort(); } catch {}
      reject(new Error('Timeout na requisição.'));
    }, timeoutMs);

    req.on('response', (res) => {
      res.on('data', (c) => { out += c.toString('utf-8'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(out)); } catch { reject(new Error('Resposta não é JSON válido.')); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// GET de texto puro (usado no XML público do perfil da Steam).
function httpGetText(url, { timeoutMs = 8000 } = {}) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let body = '';
    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('Timeout na requisição.')); }, timeoutMs);
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf-8'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// ------------------------------------------------------------
// IPC: CONTA STEAM E AMIGOS
// ------------------------------------------------------------
let steamAcc = null;
function getSteam() {
  if (!steamAcc) {
    steamAcc = new SteamAccount({
      cacheFile: steamCacheFile(),
      httpGetText,
      httpGetJson,
      execSync: require('child_process').execSync
    });
  }
  return steamAcc;
}

// Descobre o SteamID lendo o loginusers.vdf da instalação local.
ipcMain.handle('steam:detect', () => {
  try {
    const cfg = loadConfig();
    return getSteam().detect({
      unturnedPath: cfg.unturnedPath,
      home: process.env.USERPROFILE || app.getPath('home')
    });
  } catch (e) {
    return { steamPath: null, users: [], steamId: null, error: e.message };
  }
});

// Qual SteamID usar: o manual tem prioridade; senão o detectado.
function resolveSteamId(cfg) {
  if (cfg.steam.steamId && /^\d{17}$/.test(cfg.steam.steamId)) return cfg.steam.steamId;
  if (!cfg.steam.autoDetect) return null;
  try {
    const d = getSteam().detect({
      unturnedPath: cfg.unturnedPath,
      home: process.env.USERPROFILE || app.getPath('home')
    });
    return d.steamId;
  } catch { return null; }
}

ipcMain.handle('steam:profile', async (_e, steamId) => {
  const cfg = loadConfig();
  const id = steamId || resolveSteamId(cfg);
  if (!id) return null;
  try { return await getSteam().profile(id); } catch { return null; }
});

ipcMain.handle('steam:friends', async () => {
  const cfg = loadConfig();
  if (!cfg.steam.enabled) return { status: 'disabled', friends: [], playing: [], servers: [] };
  const id = resolveSteamId(cfg);
  try {
    const r = await getSteam().friendsPlaying(id, cfg.steam.apiKey);
    // Alimenta o filtro "só notificar amigos".
    friendNames = new Set((r.friends || []).map((f) => f.personaName).filter(Boolean));
    return r;
  } catch (e) {
    return { status: 'error', message: e.message, friends: [], playing: [], servers: [] };
  }
});

// Botão "testar" das configurações: diz exatamente o que funcionou.
ipcMain.handle('steam:test', async () => {
  const cfg = loadConfig();
  const out = { steamPath: null, steamId: null, profile: null, friends: null, errors: [] };
  try {
    const d = getSteam().detect({
      unturnedPath: cfg.unturnedPath,
      home: process.env.USERPROFILE || app.getPath('home')
    });
    out.steamPath = d.steamPath;
    out.users = d.users;
  } catch (e) { out.errors.push('detect: ' + e.message); }

  out.steamId = resolveSteamId(cfg);
  if (!out.steamId) { out.errors.push('no_steamid'); return out; }

  try { out.profile = await getSteam().profile(out.steamId, { force: true }); }
  catch (e) { out.errors.push('profile: ' + e.message); }

  if (!cfg.steam.apiKey) { out.friends = { status: 'no_key' }; return out; }
  try { out.friends = await getSteam().friendsPlaying(out.steamId, cfg.steam.apiKey); }
  catch (e) { out.errors.push('friends: ' + e.message); }
  return out;
});

// ------------------------------------------------------------
// IPC: ATALHOS GLOBAIS
// ------------------------------------------------------------
ipcMain.handle('hotkeys:apply', () => applyHotkeys());

// Verifica se um acelerador é registrável ANTES de salvar — assim a
// interface avisa "essa tecla já está em uso" na hora da captura.
ipcMain.handle('hotkeys:check', (_e, accel) => {
  if (!accel) return { ok: true, free: true };
  if (globalShortcut.isRegistered(accel)) return { ok: true, free: false, mine: true };
  let ok = false;
  try { ok = globalShortcut.register(accel, () => {}); } catch { ok = false; }
  if (ok) globalShortcut.unregister(accel);
  // Reaplica: o teste acima pode ter derrubado um atalho nosso.
  applyHotkeys();
  return { ok: true, free: ok };
});

// ------------------------------------------------------------
// IPC: APARÊNCIA DO OVERLAY E NOTIFICAÇÕES
// ------------------------------------------------------------
ipcMain.handle('overlay:applyUi', () => applyOverlayUi());
ipcMain.handle('overlay:getUi', () => loadConfig().overlayUi);

// ------------------------------------------------------------
// Central de notificações
//
// Um caminho só para registrar: `registrarNotificacao`. Quem avisa
// (join/leave, wipe, evento, airdrop) chama isto e a janela é
// avisada para atualizar o selo — sem ficar perguntando.
// ------------------------------------------------------------
function registrarNotificacao(dados) {
  const item = notifStore.add(dados || {});
  if (item && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notif:new', { item, unread: notifStore.unread() });
  }
  return item;
}

ipcMain.handle('notif:list', (_e, opts) => ({
  items: notifStore.list(opts || {}), unread: notifStore.unread()
}));
ipcMain.handle('notif:markRead', (_e, ids) => {
  const n = notifStore.markRead(ids);
  return { changed: n, unread: notifStore.unread() };
});
ipcMain.handle('notif:remove', (_e, id) => ({ ok: notifStore.remove(id), unread: notifStore.unread() }));
ipcMain.handle('notif:clear', () => ({ cleared: notifStore.clear(), unread: 0 }));

ipcMain.handle('notify:show', (_e, payload) => showNotification(payload || {}));
ipcMain.handle('notify:test', (_e, payload) => showNotification({
  type: 'test', name: 'Jogador de Teste', server: 'Unturned+', ...(payload || {})
}));
ipcMain.handle('notify:hide', () => {
  if (notifyWindow && !notifyWindow.isDestroyed()) notifyWindow.hide();
  return true;
});

// ------------------------------------------------------------
// IPC: WORKSHOP (detalhes dos mods direto da Steam)
// ------------------------------------------------------------
let workshop = null;
function getWorkshop() {
  if (!workshop) workshop = new SteamWorkshop({ cacheFile: workshopCacheFile(), httpPostForm });
  return workshop;
}

ipcMain.handle('workshop:details', async (_e, ids) => {
  try { return await getWorkshop().details(ids); } catch { return {}; }
});
ipcMain.handle('workshop:peek', (_e, ids) => {
  try { return getWorkshop().peek(ids); } catch { return {}; }
});
ipcMain.handle('workshop:clearCache', () => {
  try { return getWorkshop().clearCache(); } catch { return false; }
});

// ------------------------------------------------------------
// IPC: GEOLOCALIZAÇÃO (bandeirinha do card)
// ------------------------------------------------------------
let geo = null;
function getGeo() {
  if (!geo) geo = new GeoIp({ cacheFile: geoCacheFile(), httpGetJson });
  return geo;
}

ipcMain.handle('geo:lookup', async (_e, ip) => {
  try { return await getGeo().lookup(ip); } catch { return null; }
});
ipcMain.handle('geo:peek', (_e, ip) => {
  try { return getGeo().peek(ip); } catch { return null; }
});
ipcMain.handle('geo:setManual', (_e, ip, code, name) => {
  try { return getGeo().setManual(ip, code, name); } catch { return null; }
});

// ------------------------------------------------------------
// IPC: PASTAS de servidores
//
// Ficam na config (junto dos servidores) para exportar/importar
// tudo de uma vez. Cada servidor guarda apenas `folderId`, então
// mover um servidor nunca duplica dado.
// ------------------------------------------------------------
function newFolderId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

ipcMain.handle('folders:create', (_e, { name, color, icon } = {}) => {
  const cfg = loadConfig();
  const folder = {
    id: newFolderId(),
    name: String(name || 'Nova pasta').slice(0, 40),
    color: color || '#6ee06e',
    icon: icon || null,
    createdAt: new Date().toISOString()
  };
  cfg.folders.push(folder);
  saveConfig(cfg);
  return folder;
});

ipcMain.handle('folders:update', (_e, id, patch = {}) => {
  const cfg = loadConfig();
  const f = cfg.folders.find((x) => x.id === id);
  if (!f) return null;
  if (patch.name != null) f.name = String(patch.name).slice(0, 40);
  if (patch.color != null) f.color = patch.color;
  if ('icon' in patch) f.icon = patch.icon || null;
  saveConfig(cfg);
  return f;
});

// Apagar a pasta NÃO apaga os servidores — eles voltam para a raiz.
ipcMain.handle('folders:delete', (_e, id) => {
  const cfg = loadConfig();
  cfg.folders = cfg.folders.filter((f) => f.id !== id);
  for (const s of cfg.servers) if (s.folderId === id) s.folderId = null;
  saveConfig(cfg);
  return true;
});

ipcMain.handle('folders:move', (_e, bmIds, folderId) => {
  const cfg = loadConfig();
  const ids = new Set(Array.isArray(bmIds) ? bmIds : [bmIds]);
  const valid = folderId && cfg.folders.some((f) => f.id === folderId) ? folderId : null;
  for (const s of cfg.servers) if (ids.has(s.bmId)) s.folderId = valid;
  saveConfig(cfg);
  return true;
});

// ------------------------------------------------------------
// IPC: MAPAS — importação da instalação local do Unturned
// ------------------------------------------------------------
const STEAM_CANDIDATES = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Unturned',
  'C:\\Program Files\\Steam\\steamapps\\common\\Unturned',
  'D:\\Steam\\steamapps\\common\\Unturned',
  'D:\\SteamLibrary\\steamapps\\common\\Unturned',
  'E:\\SteamLibrary\\steamapps\\common\\Unturned'
];

function findUnturnedInstall() {
  const cfg = loadConfig();
  if (cfg.unturnedPath && fs.existsSync(path.join(cfg.unturnedPath, 'Maps'))) {
    return cfg.unturnedPath;
  }
  for (const p of STEAM_CANDIDATES) {
    if (fs.existsSync(path.join(p, 'Maps'))) return p;
  }
  return null;
}

// Detecta automaticamente ou pede a pasta ao usuário. Ao definir a pasta,
// JÁ sincroniza os mapas (o usuário não precisa clicar em nada depois).
// Estado da pasta do jogo, para a tela poder dizer o que está e o
// que não está disponível — em vez de a pessoa descobrir pelo
// sintoma três telas adiante.
ipcMain.handle('game:pathInfo', () => {
  const cfg = loadConfig();
  const p = cfg.unturnedPath || '';
  const existe = !!p && fs.existsSync(p);
  return {
    path: p,
    exists: existe,
    hasMaps: existe && fs.existsSync(path.join(p, 'Maps')),
    hasItems: existe && fs.existsSync(path.join(p, 'Bundles', 'Items')),
    detected: !cfg.unturnedPath ? (findUnturnedInstall() || null) : null
  };
});

// Escolher à mão. Aceita tanto a pasta do jogo quanto uma subpasta
// dela (é fácil parar em Maps/ no seletor) e sobe até achar a raiz.
ipcMain.handle('game:pickPath', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione a pasta do Unturned',
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };

  let escolhida = r.filePaths[0];
  const ehRaiz = (d) => fs.existsSync(path.join(d, 'Maps')) || fs.existsSync(path.join(d, 'Bundles'));
  for (let i = 0; i < 3 && !ehRaiz(escolhida); i++) {
    const acima = path.dirname(escolhida);
    if (acima === escolhida) break;
    escolhida = acima;
  }
  if (!ehRaiz(escolhida)) return { ok: false, error: 'not_unturned' };

  const cfg = loadConfig();
  cfg.unturnedPath = escolhida;
  saveConfig(cfg);
  // A pasta mudou: o catálogo de raid em cache é de outra
  // instalação e não vale mais.
  try { raidStore.catalogo(escolhida, { forcar: true }); } catch { /* segue */ }
  return { ok: true, path: escolhida };
});

ipcMain.handle('maps:locate', async () => {
  let installPath = findUnturnedInstall();
  if (!installPath) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a pasta do Unturned (a que contém a pasta Maps)',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    installPath = result.filePaths[0];
    if (!fs.existsSync(path.join(installPath, 'Maps'))) return null;
  }
  const cfg = loadConfig();
  cfg.unturnedPath = installPath;
  saveConfig(cfg);
  // Sincroniza automaticamente logo após pegar o local.
  let sync = null;
  try { sync = syncMaps(); } catch (e) { sync = { error: e.message }; }
  return { path: installPath, sync };
});

// Raízes e coleta de mapas ficam no módulo testável mapSync.js.

// Sincroniza (copia) Map.png/Chart.png de todos os mapas encontrados
// (oficiais + Workshop). Recopia quando detecta mapa novo ou imagem alterada.
function syncMaps() {
  const installPath = findUnturnedInstall();
  if (!installPath) throw new Error('Instalação do Unturned não encontrada.');
  return mapSync.sync(installPath, mapsDir());
}

// Sincroniza sob demanda (botão). Mantém o canal antigo 'maps:import' por
// compatibilidade, mas agora ele faz a sincronização completa.
ipcMain.handle('maps:sync', async () => syncMaps());
ipcMain.handle('maps:import', async () => {
  const r = syncMaps();
  // formato antigo esperado por telas legadas: lista de nomes tocados
  return [...r.added, ...r.updated];
});

// Lista mapas importados e quais imagens cada um tem
ipcMain.handle('maps:list', () => {
  const dir = mapsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      hasMap: fs.existsSync(path.join(dir, e.name, 'Map.png')),
      hasChart: fs.existsSync(path.join(dir, e.name, 'Chart.png'))
    }));
});

// Caminho absoluto da imagem (renderer carrega via file://)
ipcMain.handle('maps:imagePath', (_e, mapName, view) => {
  const file = path.join(mapsDir(), mapName, view === 'chart' ? 'Chart.png' : 'Map.png');
  return fs.existsSync(file) ? file : null;
});

// ------------------------------------------------------------
// IPC: NÓS DO MAPA (nomes das localizações + airdrops)
//
// Lê o Environment/Nodes.dat da instalação do Unturned e devolve
// marcadores prontos. Ver unturnedNodes.js para como o formato
// binário foi decifrado e por que a leitura pode ser parcial.
// ------------------------------------------------------------
function findMapDir(mapName) {
  const installPath = findUnturnedInstall();
  if (!installPath) return null;
  for (const root of mapSync.mapSourceRoots(installPath)) {
    for (const { name, dir } of mapSync.collectMapDirs(root)) {
      if (name.toLowerCase() === String(mapName).toLowerCase()) return dir;
    }
  }
  return null;
}

// Lê a largura de um PNG direto do cabeçalho IHDR (bytes 16..19).
// Carregar a imagem inteira só para saber a largura seria jogar
// fora 26 MB de leitura por mapa.
function pngWidth(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    if (head.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
    return head.readUInt32BE(16);
  } catch {
    return null;
  }
}

ipcMain.handle('nodes:extract', (_e, mapName) => {
  const dir = findMapDir(mapName);
  if (!dir) return { ok: false, reason: 'map_not_found', markers: [] };

  const r = unturnedNodes.readMapNodes(dir);
  if (!r.ok) return { ...r, mapDir: dir, markers: [] };

  // A escala depende da imagem que o app realmente vai desenhar,
  // que é a já importada em userData — não a da instalação.
  const importada = path.join(mapsDir(), mapName, 'Map.png');
  const largura = pngWidth(importada) || pngWidth(path.join(dir, 'Map.png'));
  const mpp = unturnedNodes.metersPerPixel(r.worldSize, largura);

  return {
    ...r,
    mapDir: dir,
    imageWidth: largura,
    metersPerPixel: mpp,
    markers: unturnedNodes.nodesToMarkers(r.nodes)
  };
});

// Tamanho do mundo e escala sem extrair nada — usado ao abrir o
// mapa, para os marcadores que o usuário já tinha ficarem no lugar
// certo mesmo sem rodar a extração de novo.
ipcMain.handle('nodes:scale', (_e, mapName) => {
  const dir = findMapDir(mapName);
  const importada = path.join(mapsDir(), mapName, 'Map.png');
  const largura = pngWidth(importada) || (dir ? pngWidth(path.join(dir, 'Map.png')) : null);
  const world = dir ? unturnedNodes.readWorldSize(dir) : { meters: null, source: 'no_install' };
  return {
    worldSize: world.meters,
    worldSizeSource: world.source,
    imageWidth: largura,
    metersPerPixel: unturnedNodes.metersPerPixel(world.meters, largura)
  };
});

// ------------------------------------------------------------
// IPC: MARCADORES (por mapa, em userData/maps/<Mapa>/markers.json)
// ------------------------------------------------------------
function markersFile(mapName) {
  return path.join(mapsDir(), mapName, 'markers.json');
}

ipcMain.handle('markers:load', (_e, mapName) => {
  try {
    return JSON.parse(fs.readFileSync(markersFile(mapName), 'utf-8'));
  } catch {
    return { worldSize: null, markers: [] };
  }
});

ipcMain.handle('markers:save', (_e, mapName, data) => {
  fs.mkdirSync(path.dirname(markersFile(mapName)), { recursive: true });
  fs.writeFileSync(markersFile(mapName), JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

// Importa JSON exportado pelo script do U3-SDK (ou compartilhado)
ipcMain.handle('markers:importJson', async (_e, mapName) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar marcadores (JSON)',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const incoming = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
  let current;
  try {
    current = JSON.parse(fs.readFileSync(markersFile(mapName), 'utf-8'));
  } catch {
    current = { worldSize: null, markers: [] };
  }

  if (incoming.worldSize) current.worldSize = incoming.worldSize;
  const list = Array.isArray(incoming) ? incoming : (incoming.markers || []);
  for (const m of list) {
    if (typeof m.x === 'number' && typeof m.z === 'number') {
      current.markers.push({
        name: String(m.name || 'Marcador'),
        type: ['location', 'airdrop', 'item', 'custom'].includes(m.type) ? m.type : 'custom',
        x: m.x, z: m.z
      });
    }
  }
  fs.mkdirSync(path.dirname(markersFile(mapName)), { recursive: true });
  fs.writeFileSync(markersFile(mapName), JSON.stringify(current, null, 2), 'utf-8');
  return current;
});

// ------------------------------------------------------------
// IPC: ações externas
// ------------------------------------------------------------
// Lista branca de destinos. `steamcommunity.com` estava faltando —
// era por isso que o botão "Abrir no Workshop" não fazia nada.
const EXTERNAL_ALLOWED = [
  'steam://',
  'https://www.battlemetrics.com/',
  'https://battlemetrics.com/',
  'https://steamcommunity.com/',
  'https://www.cdev.com.br',
  'https://cdev.com.br'
];

ipcMain.handle('external:open', (_e, url) => {
  const u = String(url || '');
  if (EXTERNAL_ALLOWED.some((p) => u.startsWith(p))) {
    shell.openExternal(u);
    return true;
  }
  return false;
});

// Copiar para a área de transferência (IP do card, JSON das tools).
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return true;
});

// ------------------------------------------------------------
// IPC: ANOTAÇÕES E PRINTS
//
// O renderer nunca toca em caminho de arquivo. Ele manda o escopo
// ("server:31635372") e recebe objetos prontos; os prints voltam
// com um `url` file:// que a <img> consegue carregar direto — mais
// leve que trafegar base64 a cada abertura de painel.
// ------------------------------------------------------------
function shotUrl(p) { return p ? 'file:///' + String(p).replace(/\\/g, '/') : null; }

function decorateNote(n) {
  if (!n) return n;
  return {
    ...n,
    shots: (n.shots || []).map((id) => {
      const meta = notesStore.shotMeta(id);
      return meta ? { ...meta, url: shotUrl(meta.path) } : { id, missing: true };
    })
  };
}

// ------------------------------------------------------------
// CONTA E REDE (api.cdev.com.br)
// ------------------------------------------------------------
// Toda a rede mora AQUI, no processo principal. O renderer nunca
// vê token: pede "faça isso" e recebe o resultado. Ver o comentário
// no topo de accountStore.js.
const API_PADRAO = 'https://api.cdev.com.br';

function initConta() {
  accountStore.init(app.getPath('userData'), API_PADRAO);

  netClient.configurar({
    conta: accountStore,
    // Evento vindo do servidor (mensagem, presença, convite...):
    // repassa para a janela, que decide o que redesenhar.
    onEvent: (obj) => {
      // O time ao vivo vê PRIMEIRO: ele mantém a lista de mensagens
      // e a presença. Só depois a janela recebe o evento cru, para
      // quem quiser reagir a algo que o TeamLive não trata.
      encaminharParaLive(obj);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('net:event', obj);
    },
    onEstado: (st) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('net:state', st);
      // Voltou a conexão: recarrega o time. Ficar com a lista de
      // antes do corte é o jeito mais fácil de a tela mentir sobre
      // quem está online.
      if (st && st.estado === 'online' && live && live.ligado) {
        live.carregarTimes().catch(() => {});
      }
    }
  });

  initTeamLive();

  // Já logada de outra sessão: conecta sozinha. Sem isto a pessoa
  // teria que clicar em algo para o chat voltar a funcionar toda
  // vez que abrisse o app.
  if (accountStore.publico().signedIn) {
    setTimeout(() => netClient.conectar().catch(() => {}), 1500);
    live.carregarTimes().catch(() => {});
  }
}

ipcMain.handle('conta:info', () => accountStore.publico());
ipcMain.handle('conta:setBaseUrl', (_e, url) => accountStore.setBaseUrl(url));
ipcMain.handle('conta:health', () => accountStore.health());

ipcMain.handle('conta:register', async (_e, d) => {
  const r = await accountStore.register(d || {});
  if (r.ok) netClient.conectar().catch(() => {});
  return r;
});
ipcMain.handle('conta:login', async (_e, d) => {
  const r = await accountStore.login(d || {});
  if (r.ok) netClient.conectar().catch(() => {});
  return r;
});
// Recuperação de senha. O código de 9 dígitos só trafega nestes
// três caminhos e nunca é gravado no disco do app.
ipcMain.handle('conta:recuperar', async (_e, d) => accountStore.recuperar(d || {}));
ipcMain.handle('conta:recuperacaoEstado', async () => accountStore.recuperacaoEstado());
ipcMain.handle('conta:recuperacaoRenovar', async (_e, senha) => accountStore.recuperacaoRenovar(senha));

ipcMain.handle('conta:logout', async (_e, todos) => {
  netClient.desconectar();
  return accountStore.logout(!!todos);
});

// Porta única para a API REST. O renderer manda método e caminho;
// o token entra aqui. Uma porta só significa um lugar só para
// tratar 401, renovação e erro de rede.
ipcMain.handle('api:call', async (_e, metodo, caminho, body) => {
  const m = String(metodo || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(m)) return { ok: false, error: 'bad_method' };
  // O caminho vem do renderer: só aceitamos o que começa com /api/.
  // Sem isto, um caminho montado com dado de servidor poderia
  // apontar para outro host inteiro.
  if (typeof caminho !== 'string' || !caminho.startsWith('/api/')) {
    return { ok: false, error: 'bad_path' };
  }
  return accountStore.auth(m, caminho, body);
});

ipcMain.handle('net:state', () => netClient.estado());
ipcMain.handle('net:connect', () => netClient.conectar().then(() => netClient.estado()));
ipcMain.handle('net:disconnect', () => { netClient.desconectar(); return netClient.estado(); });
ipcMain.handle('net:send', (_e, msg) => netClient.enviar(msg));
ipcMain.handle('net:request', (_e, msg) => netClient.pedir(msg));

// ------------------------------------------------------------
// IPC: agenda (wipes e eventos)
// ------------------------------------------------------------
ipcMain.handle('sched:list', (_e, serverId) => scheduleStore.listEvents(serverId));
ipcMain.handle('sched:agenda', (_e, opts) => scheduleStore.agenda(opts || {}));
ipcMain.handle('sched:nextWipe', (_e, serverId) => scheduleStore.nextWipe(serverId));
ipcMain.handle('sched:create', (_e, d) => scheduleStore.createEvent(d));
ipcMain.handle('sched:update', (_e, id, d) => scheduleStore.updateEvent(id, d));
ipcMain.handle('sched:delete', (_e, id) => scheduleStore.deleteEvent(id));
ipcMain.handle('sched:deleteByServer', (_e, serverId) => scheduleStore.deleteByServer(serverId));
// Prévia SEM salvar: valida e calcula as próximas datas do que está
// no formulário. É o que deixa a pessoa conferir a regra antes de
// confiar nela.
ipcMain.handle('sched:preview', (_e, d) => {
  const v = scheduleStore.validate(d || {});
  if (!v.ok) return { ok: false, reason: v.reason, dates: [] };
  return { ok: true, dates: scheduleStore.upcomingOccurrences({ id: 'preview', ...v.value }, 3) };
});
ipcMain.handle('sched:upcoming', (_e, id, n) => {
  const ev = scheduleStore.listEvents().find((e) => e.id === id);
  return ev ? scheduleStore.upcomingOccurrences(ev, n || 3) : [];
});
// Um resumo por servidor de uma vez só. A home tem N cards e cada
// um quer o próximo wipe; N chamadas de IPC para montar uma tela é
// desperdício que aparece como travadinha ao abrir o app.
ipcMain.handle('sched:summary', () => {
  const agora = Date.now();
  const out = {};
  for (const ev of scheduleStore.listEvents()) {
    const d = scheduleStore.decorate(ev, agora);
    if (d.past) continue;
    const s = (out[ev.serverId] = out[ev.serverId] || { wipe: null, next: null, count: 0 });
    s.count += 1;
    if (ev.kind === 'wipe' && (!s.wipe || d.nextAt < s.wipe.nextAt)) s.wipe = d;
    if (!s.next || d.nextAt < s.next.nextAt) s.next = d;
  }
  return out;
});

// ------------------------------------------------------------
// Vigia da agenda
// ------------------------------------------------------------
// Um minuto é a granularidade certa: os avisos são em minutos, e
// verificar de segundo em segundo só gastaria CPU num app que fica
// aberto o dia inteiro.
let schedTimer = null;

function startScheduleWatch() {
  if (schedTimer) clearInterval(schedTimer);
  schedTimer = setInterval(checkSchedule, 60 * 1000);
  // Uma passada logo ao abrir: se o app estava fechado na hora do
  // wipe, a pessoa merece saber ao abrir em vez de nunca.
  setTimeout(checkSchedule, 4000);
}

function checkSchedule() {
  let pendentes;
  try { pendentes = scheduleStore.due(Date.now(), 5 * 60 * 1000); } catch { return; }
  if (!pendentes.length) return;

  const cfg = loadConfig();
  const servidores = new Map((cfg.servers || []).map((s) => [String(s.id), s]));
  const entregues = [];

  for (const p of pendentes) {
    const srv = servidores.get(String(p.event.serverId));
    // Servidor removido: o evento não deveria existir mais. Marca
    // como avisado para não ficar tentando toda hora.
    if (!srv) { entregues.push(p.key); continue; }

    // Mando os NÚMEROS, não a frase. Quem traduz é a janela de
    // notificação, que tem o I18N carregado no idioma escolhido —
    // montar a frase aqui deixaria o aviso sempre em português.
    const ok = showNotification({
      type: p.event.kind === 'wipe' ? 'wipe' : 'event',
      name: p.event.title,
      beforeMin: p.beforeMin,
      server: srv.name || ''
    });
    // Só marca como avisado se realmente saiu. Notificação desligada
    // nas configurações não pode "queimar" o aviso.
    if (ok) entregues.push(p.key);
  }
  if (entregues.length) scheduleStore.markNotified(entregues);

  // A janela principal atualiza os selos sem esperar o próximo ciclo.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sched:changed');
}

ipcMain.handle('notes:list', (_e, scope) => notesStore.list(scope).map(decorateNote));
ipcMain.handle('notes:get', (_e, id) => decorateNote(notesStore.get(id)));

ipcMain.handle('notes:save', (_e, note) => {
  // Os prints chegam como objetos decorados; guardamos só o id.
  const shots = (note.shots || []).map((s) => (typeof s === 'string' ? s : s.id)).filter(Boolean);
  return decorateNote(notesStore.save({ ...note, shots }));
});

ipcMain.handle('notes:delete', (_e, id) => notesStore.remove(id));
// Todas as anotações de marcador de um mapa, de uma vez. A aba de
// notas do servidor usa isto para mostrar junto o que está
// espalhado pelos pontos do mapa.
ipcMain.handle('notes:listMarkers', (_e, mapName) =>
  notesStore.listByPrefix(`marker:${mapName}:`).map(decorateNote));
ipcMain.handle('notes:forgetMarker', (_e, markerId) => notesStore.forgetMarker(markerId));
ipcMain.handle('notes:deleteScope', (_e, scope) => notesStore.removeScope(scope));
ipcMain.handle('notes:counts', (_e, scopes) => notesStore.counts(scopes));

// ---- Notas tipadas, ligações e mesa de investigação ----
ipcMain.handle('notes:link', (_e, a, b, rel) => notesStore.linkNotes(a, b, rel));
ipcMain.handle('notes:unlink', (_e, a, b) => notesStore.unlinkNotes(a, b));
ipcMain.handle('notes:boardPos', (_e, id, x, y) => notesStore.setBoardPos(id, x, y));
ipcMain.handle('notes:board', (_e, scope) => {
  const b = notesStore.board(scope);
  return { notes: b.notes.map(decorateNote), links: b.links };
});
// As fichas de um escopo, prontas para a lista de jogadores casar
// nome por nome. Vai decorada porque a ficha mostra o print do
// jogador no cartão, e o caminho do arquivo só o principal conhece.
ipcMain.handle('notes:fichas', (_e, scope) => {
  const bruto = notesStore.fichasDoEscopo(scope);
  const out = {};
  for (const [k, n] of Object.entries(bruto)) out[k] = decorateNote(n);
  return out;
});

// Adiciona print a partir de arquivo(s) escolhido(s) no explorador.
ipcMain.handle('shots:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolher print',
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled || !r.filePaths.length) return [];
  const out = [];
  for (const f of r.filePaths) {
    const meta = notesStore.addShotFromFile(f);
    if (meta) out.push({ ...meta, url: shotUrl(meta.path) });
  }
  return out;
});

// Ctrl+V: pega a imagem da área de transferência.
ipcMain.handle('shots:fromClipboard', () => {
  const img = clipboard.readImage();
  if (!img || img.isEmpty()) return null;
  const meta = notesStore.addShotFromBuffer(img.toPNG(), '.png');
  return meta ? { ...meta, url: shotUrl(meta.path) } : null;
});

// Print vindo do renderer como data URL (colagem por drag&drop).
ipcMain.handle('shots:fromDataUrl', (_e, dataUrl) => {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? '.jpg' : '.' + m[1].toLowerCase();
  const meta = notesStore.addShotFromBuffer(Buffer.from(m[2], 'base64'), ext);
  return meta ? { ...meta, url: shotUrl(meta.path) } : null;
});

ipcMain.handle('shots:meta', (_e, id) => {
  const meta = notesStore.shotMeta(id);
  return meta ? { ...meta, url: shotUrl(meta.path) } : null;
});

ipcMain.handle('shots:delete', (_e, id) => notesStore.removeShot(id));
ipcMain.handle('shots:reveal', (_e, id) => {
  const p = notesStore.shotPath(id);
  if (p && fs.existsSync(p)) { shell.showItemInFolder(p); return true; }
  return false;
});
ipcMain.handle('shots:prune', () => notesStore.pruneOrphans());

// A pasta do Unturned guarda os prints do F12 da Steam? Não — a
// Steam guarda em userdata/<id>/760/. O Unturned salva os do seu
// próprio botão de screenshot em Unturned/Screenshots. É essa que
// abrimos, porque é a que o jogador reconhece.
ipcMain.handle('shots:openGameFolder', () => {
  const install = findUnturnedInstall();
  if (!install) return false;
  const dir = path.join(install, 'Screenshots');
  if (!fs.existsSync(dir)) return false;
  shell.openPath(dir);
  return true;
});

// ------------------------------------------------------------
// IPC: CALCULADORA DE RAID
//
// Os números saem dos assets da instalação do Unturned. Ler .dat
// numa pasta com milhares de arquivos leva alguns segundos, então
// a varredura é feita no processo principal (nunca no renderer) e
// o resultado fica em cache até a pessoa pedir para reler.
// ------------------------------------------------------------
ipcMain.handle('raid:catalog', (_e, opts) => {
  const cfg = loadConfig();
  const install = cfg.unturnedPath || findUnturnedInstall() || '';
  const cat = raidStore.catalogo(install, { forcar: !!(opts && opts.forcar) });
  // O renderer não precisa (nem deve) saber caminhos de disco.
  return {
    source: cat.source,
    scannedAt: cat.scannedAt || 0,
    hasGame: cat.source === 'game',
    triedPath: !!cat.triedPath,
    alvos: (cat.alvos || []).filter((a) => ehConstrucao(a)),
    // Só o que RAIDA. O resto (marreta, machado, bala comum) tem
    // dano a barricada no arquivo do jogo e não serve para raid —
    // listar tudo transformava a tela numa lista de itens.
    ferramentas: (cat.ferramentas || []).filter((f) => f.raidTool !== false && (f.raidTool || f.explosive))
  };
});

// O que se RAIDA é construção: porta, parede, portão, escotilha,
// garagem, pilar, rampa, e os containers que a pessoa arromba.
// Armadilha, gerador, cama e placa têm vida e não são alvo de raid.
const BUILDS_RAID = /door|gate|hatch|wall|garage|pillar|ramp|roof|floor|post|window|storage|locker|crate|safe|vault/i;
function ehConstrucao(a) {
  if (!a) return false;
  if (a.kind === 'structure') return true;
  return BUILDS_RAID.test(String(a.build || '')) || BUILDS_RAID.test(String(a.name || ''));
}

// Ícone de um item. Devolve uma URL utilizável direto no <img>:
// arquivo local quando já está em cache, senão baixa uma vez.
//
// A chave preferida é o GUID (que veio do .dat do jogo); o ID
// numérico é o plano B. O renderer manda os dois e não precisa
// saber de qual CDN veio.
ipcMain.handle('raid:icon', async (_e, ref) => {
  const alvo = (ref && typeof ref === 'object') ? { guid: ref.guid, id: ref.id } : { id: ref };
  const local = raidStore.iconeLocal(alvo);
  if (local) return shotUrl(local);
  const baixado = await raidStore.baixarIcone(alvo);
  return baixado ? shotUrl(baixado) : null;
});

// ------------------------------------------------------------
// IPC: INVENTÁRIO E BASES
//
// O catálogo sai dos arquivos do jogo instalado e dos mods (mesma
// pasta que a calculadora de raid usa). Os dados ficam por
// servidor em userData/inventory/servers/<id>.json.
// ------------------------------------------------------------
function inventoryPaths() {
  const cfg = loadConfig();
  const gamePath = cfg.unturnedPath || findUnturnedInstall() || '';
  const s = inventoryStore.settings();
  const auto = inventoryStore.workshopFor(gamePath);
  return {
    gamePath,
    workshopPath: s.workshopPath || auto,
    workshopAuto: !s.workshopPath,
    extraFolders: s.extraFolders || []
  };
}

ipcMain.handle('inv:paths', () => inventoryPaths());

ipcMain.handle('inv:setPaths', (_e, patch) => {
  const p = patch || {};
  const clean = {};
  if (typeof p.workshopPath === 'string') clean.workshopPath = p.workshopPath;
  if (Array.isArray(p.extraFolders)) clean.extraFolders = p.extraFolders.filter((x) => typeof x === 'string');
  inventoryStore.saveSettings(clean);
  return inventoryPaths();
});

ipcMain.handle('inv:pickFolder', async (_e, title) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: String(title || 'Pasta'), properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// O renderer recebe o ícone já como URL file:///.
function catalogForRenderer(cat) {
  if (!cat) return null;
  return {
    ...cat,
    items: cat.items.map((it) => (it.icon ? { ...it, icon: shotUrl(it.icon) } : it))
  };
}

ipcMain.handle('inv:catalog', () => catalogForRenderer(inventoryStore.loadCatalog()));

let invScanning = null;
ipcMain.handle('inv:scan', async (e) => {
  if (invScanning) return invScanning;
  const p = inventoryPaths();
  if (!p.gamePath) return { ok: false, error: 'no_game' };
  const send = (msg) => { try { e.sender.send('inv:progress', msg); } catch { /* janela fechou */ } };
  invScanning = (async () => {
    try {
      const cat = await inventoryStore.scanCatalog(p, send);
      return { ok: true, catalog: catalogForRenderer(cat) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    } finally {
      invScanning = null;
    }
  })();
  return invScanning;
});

ipcMain.handle('inv:load', (_e, serverId) => inventoryStore.loadData(serverId));
ipcMain.handle('inv:save', (_e, serverId, data) => {
  try { return inventoryStore.saveData(serverId, data); } catch { return false; }
});

// PDF: uma janela invisível carrega o HTML do relatório e o
// Chromium imprime. Os ícones são file:/// — por isso o HTML vai
// para um arquivo temporário em vez de data: URL (data: não pode
// carregar arquivo local).
ipcMain.handle('inv:exportPdf', async (_e, html, defaultName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PDF',
    defaultPath: path.join(app.getPath('documents'), String(defaultName || 'inventory.pdf').replace(/[\\/:*?"<>|]+/g, '_')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const tmp = path.join(app.getPath('temp'), `uplus-inventory-${Date.now()}.html`);
  let win = null;
  try {
    fs.writeFileSync(tmp, String(html), 'utf-8');
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    await win.loadFile(tmp);
    // Dá um instante para os ícones decodificarem.
    await new Promise((res) => setTimeout(res, 300));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
    fs.writeFileSync(r.filePath, pdf);
    shell.openPath(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (win) win.destroy();
    try { fs.unlinkSync(tmp); } catch { /* segue */ }
  }
});

// ------------------------------------------------------------
// IPC: BACKUP E RESET
// ------------------------------------------------------------
const backupDeps = {
  configPath, mapsDir, historyDir,
  notes: notesStore,
  userDataPath: () => app.getPath('userData'),
  appVersion: app.getVersion()
};

// Monta o backup só para a tela mostrar o tamanho, sem salvar.
ipcMain.handle('backup:preview', (_e, opts) => {
  const b = backupStore.buildBackup(backupDeps, opts || {});
  return { ...backupStore.inspect(b), bytes: backupStore.estimateSize(b) };
});

ipcMain.handle('backup:export', async (_e, opts) => {
  const b = backupStore.buildBackup(backupDeps, opts || {});
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar backup',
    defaultPath: `unturned-plus-${stamp}.json`,
    filters: [{ name: 'Backup Unturned+', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, JSON.stringify(b, null, 2), 'utf-8');
  return { ok: true, path: r.filePath, bytes: backupStore.estimateSize(b) };
});

// Duas etapas de propósito: primeiro o usuário VÊ o que tem no
// arquivo, depois decide. `backup:inspect` guarda o arquivo lido
// em memória para o `backup:apply` não reler do disco (o usuário
// pode ter movido o arquivo entre um clique e outro).
let pendingBackup = null;

ipcMain.handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Carregar backup',
    filters: [{ name: 'Backup Unturned+', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf-8'));
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const info = backupStore.inspect(parsed);
  if (!info.ok) return info;
  pendingBackup = parsed;
  return { ...info, path: r.filePaths[0] };
});

ipcMain.handle('backup:apply', (_e, opts) => {
  if (!pendingBackup) return { ok: false, reason: 'nothing_loaded' };
  const res = backupStore.applyBackup(backupDeps, pendingBackup, opts || {});
  pendingBackup = null;
  if (res.ok) {
    // A configuração mudou por baixo: reaplica o que depende dela.
    try { applyHotkeys(); } catch { /* ignora */ }
    try { applyOverlayUi(); } catch { /* ignora */ }
    try { startLocalPolling(); } catch { /* ignora */ }
  }
  return res;
});

ipcMain.handle('backup:cancel', () => { pendingBackup = null; return true; });

// Reset total. O renderer já confirmou (duas vezes, digitando).
ipcMain.handle('app:reset', (_e, opts) => {
  const res = backupStore.resetAll(backupDeps, opts || {});
  try { globalShortcut.unregisterAll(); } catch { /* ignora */ }
  return res;
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.exit(0);
  return true;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  userData: app.getPath('userData'),
  platform: process.platform
}));

ipcMain.handle('app:openUserData', () => { shell.openPath(app.getPath('userData')); return true; });

// ------------------------------------------------------------
// IPC: GRUPOS (time) E SINCRONIZAÇÃO
//
// A rede nasce DESLIGADA: não existe servidor ainda. Todo o
// sistema funciona local, e a fila de operações vai acumulando
// para o dia da hospedagem. O transporte "loopback" permite
// demonstrar e testar o ciclo completo sem servidor nenhum.
// ------------------------------------------------------------
let sync = null;

function initSync() {
  const cfg = loadConfig();
  sync = new SyncClient(teamStore, {
    ...(cfg.team && cfg.team.sync ? cfg.team.sync : {}),
    enabled: !!(cfg.team && cfg.team.sync && cfg.team.sync.enabled)
  });
  sync.on('changed', (info) => {
    // A tela precisa saber que chegou coisa nova sem ficar
    // perguntando de segundo em segundo.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('team:changed', info);
  });
  sync.on('status', (st) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('team:status', st);
  });
  if (sync.opts.enabled) sync.start();
}

// ------------------------------------------------------------
// TIME AO VIVO (api.cdev.com.br)
//
// Convive com o time LOCAL em vez de substituí-lo: quem não tem
// conta continua com o grupo no disco, e quem tem ganha a versão
// que sincroniza entre máquinas. A tela pergunta "estou ligada?" e
// desenha um ou outro.
// ------------------------------------------------------------
let live = null;

function initTeamLive() {
  live = new TeamLive({ conta: accountStore, net: netClient, store: teamStore });

  const avisar = (canal, dados) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(canal, dados);
  };
  live.on('mudou', (st) => avisar('live:state', st));
  live.on('mensagens', (m) => avisar('live:messages', m));
  live.on('presenca', (p) => avisar('live:presence', p));
  live.on('digitando', (d) => avisar('live:typing', d));
  live.on('nova-mensagem', (m) => avisar('live:message', m));
  live.on('posicoes', (p) => avisar('live:positions', p));
}

// Tudo que chega do socket passa por aqui antes de ir para a tela.
function encaminharParaLive(msg) {
  if (live) live.aoReceber(msg);
}

// Todo verbo do time ao vivo passa por aqui.
//
// O PORQUÊ: um `ipcMain.handle` que ESTOURA faz o `invoke` do outro
// lado rejeitar. E a tela escreve
//
//     const r = await window.api.liveCreate(nome);
//     if (!r.ok) { toast(...); return; }
//
// — se o `await` rejeita, a linha do toast nem é alcançada. O
// resultado é um botão que não faz nada e não explica nada, que foi
// exatamente o sintoma relatado. Um DNS que falhou, um timeout, um
// certificado vencido: tudo virava silêncio.
//
// Agora nada sobe daqui. Erro vira `{ ok:false, error }`, que a
// tela sabe mostrar, e fica registrado no log do processo principal
// com o nome do verbo.
function verboLive(nome, fn) {
  ipcMain.handle(nome, async (...args) => {
    if (!live) return { ok: false, error: 'off' };
    try {
      const r = await fn(...args);
      return r === undefined ? { ok: true } : r;
    } catch (e) {
      console.error(`[live] ${nome} falhou:`, e && e.message);
      // 'offline' e 'timeout' vêm do accountStore e têm tradução
      // própria na tela; o resto cai no genérico.
      const m = String((e && e.message) || 'generic');
      const conhecido = ['offline', 'timeout', 'not_signed_in', 'base_url_invalida'];
      return { ok: false, error: conhecido.includes(m) ? m : 'network', detalhe: m };
    }
  });
}

ipcMain.handle('live:state', () => (live ? live.publico() : { signedIn: false, teams: [], team: null, members: [], messages: [], positions: [] }));
verboLive('live:load', () => live.carregarTimes());
verboLive('live:open', (_e, id) => live.abrir(id));
verboLive('live:create', (_e, name) => live.criar(name));
verboLive('live:invite', (_e, opts) => live.convidar(opts || {}));
verboLive('live:redeem', (_e, code, senha) => live.entrarPorCodigo(code, senha));
verboLive('live:leave', () => live.sair());
verboLive('live:role', (_e, userId, role) => live.trocarPapel(userId, role));
verboLive('live:kick', (_e, userId) => live.remover(userId));
verboLive('live:send', (_e, texto) => live.enviar(texto));
verboLive('live:history', (_e, before) => live.carregarHistorico(before));
verboLive('live:invites', () => live.convites());
verboLive('live:revoke', (_e, id) => live.revogarConvite(id));
verboLive('live:rename', (_e, name) => live.renomear(name));
verboLive('live:dissolve', () => live.dissolver());
verboLive('live:transfer', (_e, userId) => live.transferir(userId));
verboLive('live:ban', (_e, userId, motivo) => live.banir(userId, motivo));
verboLive('live:position', (_e, pos) => live.marcarPosicao(pos || {}));
verboLive('live:positionClear', () => live.limparPosicao());
verboLive('live:deleteMessage', (_e, id) => live.apagarMensagem(id));
verboLive('live:restore', (_e, teamId) => live.desfazerExclusao(teamId));
// Servidores e canais do time, na API (migração 003). O renderer
// tenta a rede primeiro e cai no disco quando o servidor ainda não
// tem a rota — ver `rotaFaltando` em teamLive.js.
verboLive('live:servers', () => live.servidores());
verboLive('live:linkServer', (_e, s) => live.vincularServidor(s || {}));
verboLive('live:unlinkServer', (_e, bmId) => live.desvincularServidor(bmId));
verboLive('live:channels', () => live.canais());
verboLive('live:createChannel', (_e, d) => live.criarCanal(d || {}));
verboLive('live:deleteChannel', (_e, id) => live.apagarCanal(id));

// Estes dois não devolvem resultado útil e não podem derrubar nada:
// "digitando" e "marcar lido" falhando são invisíveis por natureza.
ipcMain.handle('live:typing', () => { try { if (live) live.digitando(); } catch { /* ruído */ } return true; });
ipcMain.handle('live:read', async () => { try { if (live) await live.marcarLido(); } catch { /* ruído */ } return true; });

// ---------- identidade ----------
ipcMain.handle('team:me', (_e, patch) => teamStore.ensureIdentity(patch || {}));

// ---------- grupos ----------
ipcMain.handle('team:groups', () => teamStore.listGroups().map((g) => ({
  ...g,
  myRole: teamStore.myRole(g.id),
  isOwner: teamStore.me() ? g.ownerId === teamStore.me().userId : false
})));
ipcMain.handle('team:createGroup', (_e, data) => teamStore.createGroup(data || {}));
ipcMain.handle('team:updateGroup', (_e, id, patch) => teamStore.updateGroup(id, patch || {}));
ipcMain.handle('team:deleteGroup', (_e, id) => teamStore.deleteGroup(id));
ipcMain.handle('team:leaveGroup', (_e, id) => teamStore.leaveGroup(id));

// Entrar por código só funciona com servidor: é ele que sabe qual
// grupo tem aquele código. Dizemos isso em vez de fingir.
ipcMain.handle('team:joinByCode', async (_e, code) => {
  const cfg = loadConfig();
  const on = !!(cfg.team && cfg.team.sync && cfg.team.sync.enabled && cfg.team.sync.baseUrl);
  if (!on) return { ok: false, reason: 'offline_no_server', code };
  try {
    const r = await fetch(cfg.team.sync.baseUrl.replace(/\/$/, '') + '/v1/groups/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.team.sync.token },
      body: JSON.stringify({ code })
    });
    if (!r.ok) return { ok: false, reason: 'http_' + r.status };
    const data = await r.json();
    teamStore.applyRemote([{ type: 'group.create', payload: data.group, at: Date.now() }]);
    return { ok: true, group: data.group };
  } catch (e) {
    return { ok: false, reason: 'network', error: e.message };
  }
});

// ---------- membros ----------
ipcMain.handle('team:addMember', (_e, gid, m) => teamStore.addMember(gid, m || {}));
ipcMain.handle('team:setRole', (_e, gid, uid, role) => teamStore.setRole(gid, uid, role));
ipcMain.handle('team:removeMember', (_e, gid, uid) => teamStore.removeMember(gid, uid));
ipcMain.handle('team:can', (_e, gid, action, item) => teamStore.can(gid, action, item || null));

// ---------- conteúdo ----------
ipcMain.handle('team:items', (_e, gid, opts) => {
  const rows = teamStore.listItems(gid, opts || {});
  return rows.map((it) => ({ ...it, comments: teamStore.countComments(it.id) }));
});
// `opts.papelRemoto` é como o time AO VIVO se identifica: o grupo
// vive no servidor e não está no store daqui, mas o conteúdo é
// gravado nesta máquina. Sem isso, criar nota em time com conta
// ligada respondia `no_group` e nada acontecia na tela.
ipcMain.handle('team:createItem', (_e, gid, data) => teamStore.createItem(gid, data || {}));
ipcMain.handle('team:updateItem', (_e, id, patch, opts) => teamStore.updateItem(id, patch || {}, opts || {}));
ipcMain.handle('team:deleteItem', (_e, id, opts) => teamStore.deleteItem(id, opts || {}));
ipcMain.handle('team:linkItems', (_e, a, b, rel, opts) => teamStore.linkItems(a, b, rel, opts || {}));
ipcMain.handle('team:unlinkItems', (_e, a, b, opts) => teamStore.unlinkItems(a, b, opts || {}));
ipcMain.handle('team:itemLinks', (_e, gid) => teamStore.itemLinks(gid));
ipcMain.handle('team:profile', (_e, gid) => teamStore.getProfile(gid));
ipcMain.handle('team:setProfile', (_e, gid, patch, opts) => teamStore.setProfile(gid, patch || {}, opts || {}));

// ---------- posição ----------
ipcMain.handle('team:setPosition', (_e, gid, pos) => teamStore.setPosition(gid, pos || {}));
ipcMain.handle('team:clearPosition', (_e, gid) => teamStore.clearPosition(gid));
ipcMain.handle('team:positions', (_e, gid, opts) => teamStore.listPositions(gid, opts || {}));

// ---------- FICHAS DE JOGADORES ----------
//
// "Quem é essa gente para mim?" — a pergunta que a lista de
// jogadores online não sabia responder. Tudo local: é anotação sua
// sobre quem você encontrou no jogo, e não tem por que sair daqui.
ipcMain.handle('fichas:list', (_e, nomes) => fichasStore.paraLista(nomes || []));
ipcMain.handle('fichas:all', () => fichasStore.todas());
ipcMain.handle('fichas:get', (_e, nome) => fichasStore.resolver(nome));
ipcMain.handle('fichas:link', (_e, nome, link) => fichasStore.definirVinculo(nome, link));
ipcMain.handle('fichas:note', (_e, nome, nota) => fichasStore.anotar(nome, nota));
ipcMain.handle('fichas:alias', (_e, principal, outro) => fichasStore.apelidar(principal, outro));
ipcMain.handle('fichas:delete', (_e, nome) => fichasStore.apagar(nome));
ipcMain.handle('fichas:groups', () => fichasStore.grupos());
ipcMain.handle('fichas:groupCreate', (_e, d) => fichasStore.criarGrupo(d || {}));
ipcMain.handle('fichas:groupRename', (_e, id, nome) => fichasStore.renomearGrupo(id, nome));
ipcMain.handle('fichas:groupDelete', (_e, id) => fichasStore.apagarGrupo(id));
ipcMain.handle('fichas:setGroup', (_e, nome, gid) => fichasStore.porGrupo(nome, gid));
ipcMain.handle('fichas:group', (_e, nomes, opts) => fichasStore.agrupar(nomes || [], opts || {}));
ipcMain.handle('fichas:stats', () => fichasStore.stats());

// ---------- servidores vinculados ----------
//
// `linkServer` recebe o servidor INTEIRO, não só o id: o vínculo
// guarda nome, IP e mapa para a área do time conseguir listar até um
// servidor que você tenha removido do app depois. Guardando só o id,
// a lista do time mostraria um número cru — e ninguém reconhece um
// servidor por id do BattleMetrics.
ipcMain.handle('team:linkServer', (_e, gid, servidor, opts) =>
  teamStore.linkServer(gid, servidor || {}, opts || {}));
ipcMain.handle('team:unlinkServer', (_e, gid, bmId, opts) =>
  teamStore.unlinkServer(gid, bmId, opts || {}));
ipcMain.handle('team:servers', (_e, gid) => teamStore.listServers(gid));
ipcMain.handle('team:groupsForServer', (_e, bmId) => teamStore.groupsForServer(bmId));

// ---------- sincronização ----------
ipcMain.handle('team:syncStatus', () => (sync ? sync.status() : { enabled: false }));
ipcMain.handle('team:syncNow', async () => (sync ? sync.syncNow() : { skipped: true }));
ipcMain.handle('team:syncConfigure', (_e, patch) => {
  const cfg = loadConfig();
  cfg.team = cfg.team || {};
  cfg.team.sync = { ...(cfg.team.sync || {}), ...(patch || {}) };
  saveConfig(cfg);
  return sync ? sync.configure(cfg.team.sync) : { enabled: false };
});
ipcMain.handle('team:stats', () => teamStore.stats());

// Modo demonstração: injeta um "outro jogador" pelo loopback, para
// dar para ver o grupo funcionando antes de existir servidor.
ipcMain.handle('team:demo', (_e, gid) => {
  if (!sync) return { ok: false };
  sync.configure({ enabled: true, transport: 'loopback' });
  const agora = Date.now();
  sync.injectRemote(gid, [
    { opId: 'demo_m', type: 'member.add', authorId: 'u_demo', at: agora,
      payload: { groupId: gid, member: { userId: 'u_demo', name: 'Pedro (demo)', role: 'member', joinedAt: agora } } },
    { opId: 'demo_i', type: 'item.create', authorId: 'u_demo', at: agora,
      payload: { id: 'it_demo', groupId: gid, kind: 'marker', parentId: null, authorId: 'u_demo',
                 authorName: 'Pedro (demo)', createdAt: agora, updatedAt: agora, deleted: false,
                 data: { name: 'Estoque escondido', x: 320, z: -140, type: 'item' } } },
    { opId: 'demo_p', type: 'position.set', authorId: 'u_demo', at: agora,
      payload: { groupId: gid, userId: 'u_demo', name: 'Pedro (demo)', x: -200, z: 400, source: 'manual', at: agora } }
  ]);
  return sync.syncNow();
});

// ------------------------------------------------------------
// IPC: HIERARQUIA, CONVITES COM SENHA, CHAT E MÍDIA
// ------------------------------------------------------------
function mediaUrl(p) { return p ? 'file:///' + String(p).replace(/\\/g, '/') : null; }

function decorateMedia(m) {
  if (!m) return null;
  return { ...m, url: mediaUrl(m.path), thumbUrl: mediaUrl(m.thumbPath) };
}

// ---------- papéis ----------
ipcMain.handle('team:roles', (_e, gid) => ({
  myRole: teamStore.myRole(gid),
  assignable: teamStore.assignableRoles(gid),
  capabilities: teamStore.capabilities(gid)
}));
ipcMain.handle('team:transfer', (_e, gid, uid) => teamStore.transferOwnership(gid, uid));
ipcMain.handle('team:ban', (_e, gid, uid, reason) => teamStore.banMember(gid, uid, reason));
ipcMain.handle('team:bans', (_e, gid) => teamStore.listBans(gid));

// ---------- convites ----------
// A senha volta UMA vez, para a tela mostrar. Depois disso ela não
// existe mais em lugar nenhum — nem aqui, nem no arquivo.
ipcMain.handle('team:createInvite', (_e, gid, opts) => teamStore.createInvite(gid, opts || {}));
ipcMain.handle('team:invites', (_e, gid) => teamStore.listInvites(gid));
ipcMain.handle('team:revokeInvite', (_e, id) => teamStore.revokeInvite(id));
ipcMain.handle('team:joinWithInvite', (_e, data) => teamStore.joinWithInvite(data || {}));

// ---------- canais e chat ----------
ipcMain.handle('team:channels', (_e, gid) => teamStore.listChannels(gid));
ipcMain.handle('team:createChannel', (_e, gid, d) => teamStore.createChannel(gid, d || {}));
ipcMain.handle('team:deleteChannel', (_e, id) => teamStore.deleteChannel(id));
ipcMain.handle('team:messages', (_e, chId, opts) => {
  const rows = teamStore.listMessages(chId, opts || {});
  // A mídia vai decorada com a URL: a tela não deve montar caminho.
  return rows.map((m) => ({ ...m, mediaFull: (m.media || []).map((id) => decorateMedia(mediaStore.get(id))) }));
});
ipcMain.handle('team:send', (_e, chId, d) => teamStore.sendMessage(chId, d || {}));
ipcMain.handle('team:editMessage', (_e, id, text) => teamStore.editMessage(id, text));
ipcMain.handle('team:deleteMessage', (_e, id) => teamStore.deleteMessage(id));
ipcMain.handle('team:markRead', (_e, gid, chId) => teamStore.markRead(gid, chId));
ipcMain.handle('team:unread', (_e, gid) => teamStore.unreadByChannel(gid));

// ---------- mídia ----------
ipcMain.handle('media:pick', async (_e, scope) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolher fotos ou vídeos',
    filters: [
      { name: 'Fotos e vídeos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mkv'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true, media: [] };

  const eu = teamStore.me();
  const media = [], recusados = [];
  for (const f of r.filePaths) {
    const add = mediaStore.addFromFile(f, { scope, authorId: eu ? eu.userId : null });
    if (add.ok) media.push(decorateMedia(mediaStore.get(add.media.id)));
    // Recusa PRECISA voltar para a tela: um arquivo que some em
    // silêncio faz a pessoa achar que anexou.
    else recusados.push({ file: path.basename(f), ...add });
  }
  return { ok: true, media, rejected: recusados };
});

ipcMain.handle('media:fromDataUrl', (_e, dataUrl, scope) => {
  const m = /^data:(image|video)\/([a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return { ok: false, reason: 'bad_data_url' };
  const ext = m[2].toLowerCase() === 'jpeg' ? '.jpg' : '.' + m[2].toLowerCase();
  const eu = teamStore.me();
  const add = mediaStore.addFromBuffer(Buffer.from(m[3], 'base64'), ext, {
    scope, authorId: eu ? eu.userId : null
  });
  return add.ok ? { ok: true, media: decorateMedia(mediaStore.get(add.media.id)) } : add;
});

ipcMain.handle('media:thumb', (_e, id, dataUrl) => {
  const m = /^data:image\/[a-z]+;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return false;
  return mediaStore.saveThumb(id, Buffer.from(m[1], 'base64'));
});
ipcMain.handle('media:get', (_e, id) => decorateMedia(mediaStore.get(id)));
ipcMain.handle('media:delete', (_e, id) => mediaStore.remove(id));
ipcMain.handle('media:stats', () => mediaStore.stats());
ipcMain.handle('media:pruneOld', (_e, days) => mediaStore.pruneOlderThan(days || 30));
ipcMain.handle('media:limits', () => mediaStore.LIMITS);
