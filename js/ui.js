// ============================================================
// ui.js — inicialização geral, modais, toast e eventos
// ============================================================

// ---------------- Modais ----------------
//
// O z-index vem da ORDEM DE ABERTURA, não da ordem no HTML.
//
// Isso era um bug de verdade: abrir "nova nota" de dentro do card
// de um marcador deixava a nota ATRÁS, porque o card do marcador
// aparece depois no HTML e o CSS empilha por ordem do documento.
// Dava para ver o formulário mas não escrever nele.
let modalZ = 200;
const modalStack = [];

// Todo modal ganha um ✕ no canto, gerado aqui em vez de escrito à
// mão 18 vezes no HTML.
//
// Por que importa: 17 dos 18 modais só tinham saída no RODAPÉ
// ("Cancelar", ao lado de "Salvar"). Duas consequências ruins:
// numa tela menor o rodapé fica abaixo da dobra e some, e quem só
// quer FECHAR hesita em clicar num botão que promete descartar. O ✕
// no topo é a saída que todo mundo já procura, sempre visível,
// sempre no mesmo lugar.
//
// Fora da lista: os modais que existem para fazer uma pergunta de
// verdade. Neles um ✕ seria só um segundo "cancelar" — e no caso do
// primeiro uso, sair pelo canto deixaria a pessoa numa tela vazia
// sem entender o que aconteceu.
const SEM_X = new Set(['modal-welcome']);

function ensureModalClose(el) {
  if (!el || SEM_X.has(el.id) || el.dataset.xReady) return;
  const caixa = el.querySelector('.modal');
  if (!caixa) return;
  el.dataset.xReady = '1';
  if (caixa.querySelector('.modal-x')) return;

  const b = document.createElement('button');
  b.className = 'modal-x';
  b.type = 'button';
  b.setAttribute('aria-label', I18N.t('common.close'));
  b.title = I18N.t('common.close');
  b.innerHTML = Icon.svg('close', 14);
  b.addEventListener('click', () => {
    // Passa pelo botão de cancelar do próprio modal quando existe:
    // ele costuma limpar estado (modo de escolha no mapa, captura
    // de atalho, seleção múltipla). Fechar por fora deixaria isso
    // ligado sem nada na tela para desligar.
    const cancelar = caixa.querySelector('[data-x-alias]')
      || caixa.querySelector('.modal-actions .btn:not(.primary):not(.danger)');
    if (cancelar && cancelar.offsetParent !== null) { cancelar.click(); return; }
    hideModal(el.id);
  });
  caixa.insertBefore(b, caixa.firstChild);
}

function initModalCloses() {
  for (const el of document.querySelectorAll('.modal-backdrop')) ensureModalClose(el);
}

function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  ensureModalClose(el);   // vale também para modal criado depois da carga
  // Campos de senha que só existem dentro deste modal ganham o
  // olho agora — no boot eles ainda podiam nem estar no DOM.
  if (typeof initPasswordReveal === 'function') initPasswordReveal(el);
  if (typeof Icon !== 'undefined') Icon.paint(el);
  modalZ += 1;
  el.style.zIndex = modalZ;
  el.classList.remove('hidden');
  const i = modalStack.indexOf(id);
  if (i >= 0) modalStack.splice(i, 1);
  modalStack.push(id);
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.style.zIndex = '';
  const i = modalStack.indexOf(id);
  if (i >= 0) modalStack.splice(i, 1);
  // Zera o contador quando a pilha esvazia, para não crescer sem
  // limite numa sessão longa.
  if (!modalStack.length) modalZ = 200;
}

// Qual modal está por cima agora (usado pelo Esc).
function topModal() {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const el = document.getElementById(modalStack[i]);
    if (el && !el.classList.contains('hidden')) return el;
  }
  return document.querySelector('.modal-backdrop:not(.hidden)');
}

// Clicar FORA não fecha mais o modal.
//
// Fechava antes, e atrapalhava: um clique errado no meio de um
// formulário (adicionar servidor, configurações, editar pasta)
// jogava fora tudo que tinha sido digitado. Agora só fecham pelos
// botões de Cancelar/✕ ou pelo Esc — que são ações deliberadas.

// ---------------- Menu lateral ----------------
// Fechado por padrão. Guarda as pastas e as ações principais, que
// antes viviam em botões flutuantes sobre os cards.
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer').setAttribute('aria-hidden', 'false');
  document.getElementById('drawer-scrim').classList.remove('hidden');
  // Pergunta o estado ao abrir em vez de guardar: o overlay também
  // liga e desliga pelo F8, longe daqui, e um estado guardado aqui
  // ficaria mentindo até alguém clicar de novo.
  if (window.api.isOverlayOpen) window.api.isOverlayOpen().then(paintOverlayState).catch(() => {});
  if (typeof renderAgendaBadge === 'function') renderAgendaBadge();
}

function paintOverlayState(ligado) {
  const el = document.getElementById('drawer-overlay-state');
  if (!el) return;
  el.classList.toggle('on', !!ligado);
  el.textContent = I18N.t(ligado ? 'nav.stateOn' : 'nav.stateOff');
  el.setAttribute('data-i18n', ligado ? 'nav.stateOn' : 'nav.stateOff');
}

function closeDrawer() {
  const el = document.getElementById('drawer');
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  document.getElementById('drawer-scrim').classList.add('hidden');
}

function toggleDrawer() {
  const el = document.getElementById('drawer');
  if (el.classList.contains('open')) closeDrawer(); else openDrawer();
}

// ---------------- Toast ----------------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ---------------- Inicialização ----------------
window.addEventListener('DOMContentLoaded', async () => {
  await loadAppConfig();
  await I18N.load(AppState.config.language);

  Icon.paint();
  initPasswordReveal();
  MapView.init();
  initLogView();
  initMarkerBulk();
  initNotes();
  initMarkerCard();
  initMarkerCats();
  initRaid();
  if (typeof initInventory === 'function') initInventory();
  initNotifCenter();
  initPastaDoJogo();
  initBackup();
  initHelp();
  initUserMenu();
  initTrackingTabs();
  initNews();
  // initConta ANTES de initTeam, e não depois.
  //
  // Este era o bug do "SYNCING infinito e o Create não faz nada":
  // `loadTeam()` decide entre time LOCAL e time DO SERVIDOR lendo
  // `Conta.info.signedIn` — que só é preenchido por `carregarConta()`,
  // lá dentro de `initConta`. Rodando depois, o painel do time
  // sempre nascia no modo local, mostrava o aviso antigo de "ainda
  // não está no ar" e o botão criava um grupo no disco em vez de no
  // servidor. A ordem aqui é a correção.
  initConta();
  initTeam();
  if (typeof initFichas === "function") initFichas();
  initAgenda();
  initModalCloses();   // antes do welcome: ele já abre um modal
  initWelcome();   // por último: pode abrir a introdução na primeira vez
  renderHome();
  refreshAllCards();
  initCurrentServer();

  // Identidade da Steam no boot, SEM depender das configurações
  // estarem abertas. Era esse o motivo de a foto e o nome só
  // aparecerem depois de clicar em "Conectar Steam" duas vezes: o
  // perfil era buscado por uma função que desistia quando o modal
  // estava fechado (ver carregarIdentidadeSteam em js/steam.js).
  //
  // Roda sem `await`: é uma ida à rede e não pode segurar o resto
  // da abertura. O chip do canto se pinta sozinho quando responde.
  carregarIdentidadeSteam();

  startSteamAutoRefresh();   // a lista de AMIGOS, essa sim, só se estiver ligada

  // O HUD pode ter sido redimensionado com o mouse: mantemos a
  // config em sincronia para o campo de tamanho não mentir.
  window.api.onOverlayResized(({ width, height }) => {
    if (!AppState.config.overlayUi) return;
    AppState.config.overlayUi.width = width;
    AppState.config.overlayUi.height = height;
    const w = document.getElementById('cfg-ov-width');
    const h = document.getElementById('cfg-ov-height');
    if (w && h && !document.getElementById('modal-settings').classList.contains('hidden')) {
      w.value = width; h.value = height;
    }
  });

  // Atualização periódica da home
  setInterval(() => {
    if (!AppState.trackingId) refreshAllCards();
  }, (AppState.config.refreshInterval || 30) * 1000);

  // ---------- Topbar ----------
  document.getElementById('brand-home').addEventListener('click', () => {
    closeDrawer();
    if (AppState.trackingId) closeTracking();
    else leaveFolder();
  });
  // Notícias: o botão zera o selo assim que é aberto.
  document.getElementById('btn-news').addEventListener('click', () => {
    openNews();
  });
  document.getElementById('news-close').addEventListener('click', () => hideModal('modal-news'));

  document.getElementById('search-input').addEventListener('input', () => {
    if (!AppState.trackingId) renderHome();
  });

  // ---------- Menu lateral ----------
  document.getElementById('btn-menu').addEventListener('click', toggleDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);

  document.getElementById('drawer-add').addEventListener('click', () => {
    closeDrawer();
    openAddModal();
  });
  document.getElementById('drawer-new-folder').addEventListener('click', () => {
    closeDrawer();
    openFolderModal(null);
  });
  // Overlay, agenda e configurações agora vivem no menu.
  document.getElementById('drawer-overlay').addEventListener('click', async () => {
    // NÃO fecho o menu: o botão mostra o estado, e fechar na hora
    // esconderia justamente a resposta ("ligou ou não?").
    const ligado = await window.api.toggleOverlay();
    paintOverlayState(ligado);
  });
  document.getElementById('drawer-events').addEventListener('click', () => { closeDrawer(); openAgenda(); });
  document.getElementById('drawer-settings').addEventListener('click', () => { closeDrawer(); openSettings(); });

  document.getElementById('drawer-delete').addEventListener('click', () => {
    closeDrawer();
    if (!AppState.deleteMode) {
      setDeleteMode(true);
      toast(I18N.t('home.deleteHint'));
    } else {
      setDeleteMode(false);
    }
  });

  // ---------- Barra do modo de exclusão ----------
  document.getElementById('delete-bar-cancel').addEventListener('click', () => setDeleteMode(false));
  document.getElementById('delete-bar-confirm').addEventListener('click', askDeleteSelected);

  // ---------- Modal adicionar ----------
  document.getElementById('add-confirm').addEventListener('click', addServer);
  document.getElementById('add-cancel').addEventListener('click', () => hideModal('modal-add'));
  document.getElementById('add-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addServer();
  });
  document.getElementById('add-suggest-refresh').addEventListener('click', async () => {
    await window.api.reloadLog();
    await loadAddSuggestions();
    toast(I18N.t('log.reloaded'));
  });

  // ---------- Modal excluir ----------
  document.getElementById('delete-confirm').addEventListener('click', confirmDelete);
  document.getElementById('delete-cancel').addEventListener('click', () => hideModal('modal-delete'));

  // ---------- Pastas ----------
  document.getElementById('folder-back').addEventListener('click', leaveFolder);
  document.getElementById('folder-edit').addEventListener('click', () => openFolderModal(AppState.currentFolderId));
  document.getElementById('folder-delete').addEventListener('click', deleteCurrentFolder);
  document.getElementById('folder-confirm').addEventListener('click', confirmFolderModal);
  document.getElementById('folder-cancel').addEventListener('click', () => hideModal('modal-folder'));
  document.getElementById('move-cancel').addEventListener('click', () => hideModal('modal-move'));

  document.getElementById('folder-name').addEventListener('input', e => {
    FolderUI.draft.name = e.target.value;
    renderFolderPreview();
  });
  document.getElementById('folder-icon').addEventListener('input', e => {
    FolderUI.draft.icon = e.target.value.trim();
    renderFolderPreview();
  });
  document.getElementById('folder-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmFolderModal();
  });

  // ---------- Quick View ----------
  document.getElementById('qv-close').addEventListener('click', closeQuickView);
  document.getElementById('qv-join').addEventListener('click', quickViewJoin);
  document.getElementById('qv-fav').addEventListener('click', quickViewToggleFavorite);
  document.getElementById('qv-track').addEventListener('click', quickViewTrack);
  document.getElementById('qv-ip').addEventListener('click', e => {
    const cs = QuickView.data;
    if (cs && cs.ip) copyIp(`${cs.ip}:${cs.port}`, e.currentTarget);
  });

  // ---------- Configurações ----------
  document.getElementById('cfg-save').addEventListener('click', saveSettings);
  document.getElementById('cfg-cancel').addEventListener('click', () => hideModal('modal-settings'));
  document.getElementById('cfg-welcome').addEventListener('click', () => {
    hideModal('modal-settings');
    openWelcome(true);
  });
  document.getElementById('cfg-help').addEventListener('change', (e) => {
    // Efeito imediato, antes mesmo de salvar: o usuário está
    // justamente tentando ver se prefere com ou sem.
    AppState.config.helpDots = e.target.checked;
    applyHelpVisibility();
  });

  for (const tab of document.querySelectorAll('.settings-tab')) {
    tab.addEventListener('click', () => setSettingsTab(tab.dataset.tab));
  }

  // Sliders com valor ao lado
  const bindRange = (id, valueId, suffix = '%') => {
    const input = document.getElementById(id);
    input.addEventListener('input', () => {
      document.getElementById(valueId).textContent = input.value + suffix;
    });
  };
  bindRange('cfg-ov-opacity', 'cfg-ov-opacity-value');
  bindRange('cfg-ov-scale', 'cfg-ov-scale-value');
  bindRange('cfg-nt-volume', 'cfg-nt-volume-value');

  document.getElementById('cfg-ov-accent').addEventListener('input', (e) => renderAccentRow(e.target.value.trim()));

  // ---------- Steam ----------
  document.getElementById('cfg-steam-test').addEventListener('click', testSteamConnection);
  document.getElementById('cfg-steam-key-link').addEventListener('click',
    () => window.api.openExternal('https://steamcommunity.com/dev/apikey'));
  document.getElementById('friends-refresh').addEventListener('click',
    () => refreshSteamFriends({ silent: false }));

  // ---------- Testes de overlay/notificação ----------
  document.getElementById('cfg-ov-preview').addEventListener('click', async () => {
    await saveSettingsSilently();
    await window.api.toggleOverlay();
  });
  document.getElementById('cfg-nt-test').addEventListener('click', async () => {
    await saveSettingsSilently();
    await window.api.testNotification();
  });

  // ---------- Atalhos ----------
  for (const row of document.querySelectorAll('.hotkey-row')) {
    const action = row.dataset.action;
    row.querySelector('.hotkey-set').addEventListener('click', () => openHotkeyCapture(action));
    row.querySelector('.hotkey-clear').addEventListener('click', () => {
      AppState.config.hotkeys[action] = '';
      renderHotkeyValues(AppState.config.hotkeys);
    });
  }
  document.getElementById('hotkey-capture-cancel').addEventListener('click', () => hideModal('modal-hotkey'));
  document.getElementById('hotkey-capture-ok').addEventListener('click', confirmHotkeyCapture);

  document.getElementById('cfg-hk-apply').addEventListener('click', async () => {
    await saveSettingsSilently();
    const r = await window.api.applyHotkeys();
    const box = document.getElementById('hotkey-result');
    box.classList.remove('hidden');
    const ok = Object.entries(r.registered || {})
      .map(([a, k]) => `<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(k)}</span>`);
    const bad = (r.failed || [])
      .map((f) => `<span class="test-bad">${Icon.svg('close', 13)} ${escapeHtml(f.accel)} — ${escapeHtml(I18N.t(f.reason === 'taken' ? 'settings.hkTaken' : 'settings.hkInvalid'))}</span>`);
    box.innerHTML = [...ok, ...bad].join('<br>') || `<span class="muted">${escapeHtml(I18N.t('settings.hkNone'))}</span>`;
  });

  // Captura da combinação enquanto o modal está aberto.
  window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-hotkey');
    if (modal.classList.contains('hidden')) return;

    // Esc aqui cancela SÓ a captura. Sem o stopPropagation, o Esc
    // global fecharia as configurações inteiras junto e o usuário
    // perderia tudo o que ainda não tinha salvado.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideModal('modal-hotkey');
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const r = eventToAccelerator(e);
    const preview = document.getElementById('hotkey-preview');
    const err = document.getElementById('hotkey-capture-error');

    if (r.accel) {
      HotkeyCapture.accel = r.accel;
      preview.textContent = r.accel;
      err.classList.add('hidden');
      // Pergunta ao processo principal se a tecla está livre.
      window.api.checkHotkey(r.accel).then((c) => {
        if (c && c.ok && c.free === false && !c.mine) {
          err.textContent = I18N.t('settings.hkTaken');
          err.classList.remove('hidden');
        }
      });
    } else {
      preview.textContent = r.partial || '…';
      if (r.error === 'needModifier') {
        err.textContent = I18N.t('settings.hkNeedModifier');
        err.classList.remove('hidden');
      }
    }
  }, true);

  // ---------- Tracking ----------
  document.getElementById('btn-back').addEventListener('click', closeTracking);
  document.getElementById('btn-join').addEventListener('click', joinServer);
  document.getElementById('btn-bm').addEventListener('click', openBattleMetrics);
  document.getElementById('btn-clear-logs').addEventListener('click', clearLogs);
  document.getElementById('tk-fav').addEventListener('click', toggleTrackingFavorite);
  document.getElementById('btn-refresh-mods').addEventListener('click', refreshWorkshopDetails);

  // Busca dentro das listas longas (jogadores e mods)
  document.getElementById('players-search').addEventListener('input', renderPlayersList);
  document.getElementById('mods-search').addEventListener('input', renderModsList);
  document.getElementById('btn-pin-overlay').addEventListener('click', pinToOverlay);

  // IP da tela de tracking também copia ao clicar.
  document.getElementById('tk-address').addEventListener('click', e => {
    const v = e.currentTarget.dataset.copy;
    if (v && v !== '') copyIp(v, e.currentTarget);
  });

  // Detalhes & Mods: mostrar/ocultar tabela de rules cruas
  document.getElementById('btn-toggle-rules').addEventListener('click', () => {
    const box = document.getElementById('tk-raw-rules');
    const hidden = box.classList.toggle('hidden');
    document.getElementById('btn-toggle-rules').textContent =
      I18N.t(hidden ? 'details.showRaw' : 'details.hideRaw');
  });

  // Airdrop
  document.getElementById('btn-airdrop-fell').addEventListener('click', markAirdropFell);
  document.getElementById('btn-airdrop-reset').addEventListener('click', resetAirdrop);
  document.getElementById('tk-airdrop-interval').addEventListener('change', saveAirdropInterval);

  // ---------- Servidor atual ("jogando agora") ----------
  document.getElementById('cs-add').addEventListener('click', addCurrentServer);
  document.getElementById('cs-quick').addEventListener('click', openQuickViewCurrent);
  document.getElementById('cs-open').addEventListener('click', async () => {
    const cs = AppState.currentServer;
    if (!cs || !cs.ip) return;
    if (!cs.savedBmId) await addCurrentServer(); // adiciona para poder rastrear
    if (cs.savedBmId) openTracking(cs.savedBmId);
  });
  document.getElementById('cs-manual').addEventListener('click', async () => {
    document.getElementById('cur-ip').value = '';
    try {
      const st = await window.api.getCurrentServer();
      document.getElementById('cur-logpath').textContent = st.logPath
        ? I18N.t('current.logPath', { path: st.logPath })
        : I18N.t('current.logMissing');
    } catch {
      document.getElementById('cur-logpath').textContent = I18N.t('current.logMissing');
    }
    showModal('modal-current');
  });
  document.getElementById('cur-cancel').addEventListener('click', () => hideModal('modal-current'));
  document.getElementById('cur-pick-log').addEventListener('click', async () => {
    const p = await window.api.pickUnturnedLog();
    if (p) {
      toast(I18N.t('current.logSet'));
      hideModal('modal-current');
      LogView.loaded = false;
      if (LogView.tab === 'live') loadLogEvents();
    }
  });
  document.getElementById('cur-confirm').addEventListener('click', async () => {
    const val = document.getElementById('cur-ip').value.trim();
    const m = val.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (!m) { toast(I18N.t('current.badAddress')); return; }
    await window.api.setManualCurrentServer(m[1], parseInt(m[2], 10));
    hideModal('modal-current');
  });

  // ---------- Mapa v2 ----------
  document.getElementById('btn-import-maps').addEventListener('click', async () => {
    document.getElementById('map-menu').classList.add('hidden');
    const located = await window.api.locateUnturned();
    if (!located) { toast(I18N.t('map.installNotFound')); return; }
    try {
      const sync = located.sync || await window.api.syncMaps();
      if (sync && sync.error) { toast(I18N.t('map.importError')); return; }
      const novos = ((sync && sync.added && sync.added.length) || 0) + ((sync && sync.updated && sync.updated.length) || 0);
      toast(novos > 0
        ? I18N.t('map.synced', { n: novos, total: sync.total })
        : I18N.t('map.syncedNone', { total: (sync && sync.total) || 0 }));
      if (MapView.mapName) MapView.loadForMap(MapView.mapName);
      renderHome(); // atualiza os fundos dos cards
    } catch (e) {
      toast(I18N.t('map.importError'));
    }
  });

  document.getElementById('map-view-select').addEventListener('change', e => {
    MapView.setView(e.target.value);
  });

  // ---------- Barra do mapa ----------
  document.getElementById('btn-marker-mode').addEventListener('click',
    () => MapView.setAddMode(!MapView.addMode));
  document.getElementById('btn-marker-cancel').addEventListener('click',
    () => MapView.setAddMode(false));

  document.getElementById('btn-map-full').addEventListener('click', () => MapView.toggleFullscreen());
  document.getElementById('btn-map-zoom-in').addEventListener('click', () => MapView.zoomBy(1.35));
  document.getElementById('btn-map-zoom-out').addEventListener('click', () => MapView.zoomBy(1 / 1.35));
  document.getElementById('btn-map-zoom-reset').addEventListener('click', () => MapView.resetView());

  // Menu "…" com o que é raro (importar mapas / JSON).
  const mapMenu = document.getElementById('map-menu');
  document.getElementById('btn-map-more').addEventListener('click', (e) => {
    e.stopPropagation();
    mapMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!mapMenu.contains(e.target) && e.target.id !== 'btn-map-more') mapMenu.classList.add('hidden');
  });

  document.getElementById('btn-extract-nodes').addEventListener('click', () => MapView.extractNodes());
  document.getElementById('btn-markers-bulk').addEventListener('click', openMarkerBulk);

  document.getElementById('btn-import-markers').addEventListener('click', async () => {
    document.getElementById('map-menu').classList.add('hidden');
    if (!MapView.mapName) { toast(I18N.t('map.noMap')); return; }
    const result = await window.api.importMarkersJson(MapView.mapName);
    if (result) {
      MapView.markersData = result;
      MapView.draw();
      toast(I18N.t('map.jsonImported', { n: result.markers.length }));
    }
  });

  document.querySelectorAll('.layer-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      MapView.layers[cb.dataset.layer] = cb.checked;
      MapView.draw();
    });
  });

  // ---------- Mover marcadores ----------
  const btnMover = document.getElementById('btn-marker-move');
  if (btnMover) {
    btnMover.addEventListener('click', () => {
      if (!MapView.image) { toast(I18N.t('map.noMap')); return; }
      MapView.setMoveMode(!MapView.moveMode);
    });
    document.getElementById('btn-marker-move-off')
      .addEventListener('click', () => MapView.setMoveMode(false));
  }

  // ---------- Atalhos ----------
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;

    // Fecha UM modal por vez, sempre o que está por cima. Como a
    // pilha é por ordem de abertura, isso funciona mesmo com
    // modais abrindo modais.
    const openModal = topModal();
    if (openModal) {
      hideModal(openModal.id);
      if (openModal.id === 'modal-quickview') QuickView.bmId = null;
      return;
    }
    if (document.getElementById('drawer').classList.contains('open')) { closeDrawer(); return; }
    if (AppState.deleteMode) { setDeleteMode(false); return; }
    // Último degrau: sair do servidor e voltar para a lista. Sem
    // isso, dentro do tracking o Esc não fazia nada e a única saída
    // era o "← Voltar" — que é pequeno e fica longe do olhar.
    if (AppState.trackingId) closeTracking();
  });
});
