// ============================================================
// quickview.js — Quick View (Shift + clique num card)
//
// A ideia é responder "vale a pena entrar nesse servidor agora?"
// sem sair da home: ícone, nome completo (que no card pode estar
// cortado), jogadores online, descrição renderizada como no jogo,
// e um botão de JOIN direto.
//
// Funciona tanto para um servidor salvo quanto para o card
// especial de "jogando agora" (que ainda não está na lista).
// ============================================================

const QuickView = {
  bmId: null,      // servidor salvo em exibição
  data: null,      // snapshot exibido
  refreshing: false
};

function qvChip(label, value, cls = '') {
  if (value == null || value === '') return '';
  return `<span class="qv-chip ${cls}"><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`;
}

// Monta o snapshot a partir do que já sabemos (não bloqueia a
// abertura do modal). Os dados ao vivo chegam logo depois.
function quickViewSnapshotFromServer(s) {
  const live = LiveData[s.bmId] || {};
  const folder = getFolder(s.folderId);
  return {
    bmId: s.bmId,
    name: live.name || s.name || s.bmId,
    ip: s.ip, port: s.port,
    icon: live.icon || null,
    map: live.map || null,
    status: live.status || 'unknown',
    players: live.players, maxPlayers: live.maxPlayers,
    description: serverDescription(s),
    mods: live.mods || [],
    modCount: live.modCount || (live.mods || []).length,
    tags: s.tags || [],
    favorite: !!s.favorite,
    folderName: folder ? folder.name : null,
    folderColor: folder ? folder.color : null,
    playing: matchesCurrent(s),
    canJoin: true
  };
}

function quickViewSnapshotFromCurrent() {
  const cs = AppState.currentServer;
  if (!cs) return null;
  return {
    bmId: cs.savedBmId || null,
    name: cs.name,
    ip: cs.ip, port: cs.port,
    icon: cs.icon || cs.thumbnail || null,
    map: cs.map || null,
    status: cs.ip ? 'online' : 'unknown',
    players: cs.players, maxPlayers: cs.maxPlayers,
    description: cs.description || null,
    mods: cs.mods || [],
    modCount: (cs.mods || []).length,
    tags: [],
    favorite: false,
    folderName: null, folderColor: null,
    playing: !!cs.live,
    pvp: cs.pvp, difficulty: cs.difficulty, battlEye: cs.battlEye,
    canJoin: !!cs.ip
  };
}

function renderQuickView(d) {
  QuickView.data = d;

  document.getElementById('qv-name').textContent = d.name;

  const iconEl = document.getElementById('qv-icon');
  if (d.icon) {
    iconEl.innerHTML = `<img src="${escapeHtml(d.icon)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this,'gamepad')">`;
  } else {
    iconEl.innerHTML = Icon.svg('gamepad', 22);
  }

  // Endereço + bandeira (o IP continua copiável aqui).
  const ipEl = document.getElementById('qv-ip');
  const addr = d.ip ? `${d.ip}:${d.port}` : I18N.t('current.noAddress');
  ipEl.textContent = addr;
  ipEl.classList.toggle('disabled', !d.ip);
  document.getElementById('qv-flag').innerHTML =
    d.ip && AppState.config.showFlags !== false ? GeoFlag.html(GeoFlag.peek(d.ip), { size: 'md' }) : '';

  // Status
  const statusEl = document.getElementById('qv-status');
  if (d.playing) {
    statusEl.textContent = I18N.t('current.playingNow');
    statusEl.className = 'status-pill qv-status playing';
  } else {
    const key = d.status === 'online' ? 'status.online' : d.status === 'offline' ? 'status.offline' : 'status.unknown';
    statusEl.textContent = I18N.t(key);
    statusEl.className = `status-pill qv-status ${d.status === 'online' ? 'online' : d.status === 'offline' ? 'offline' : ''}`;
  }

  document.getElementById('qv-players').textContent =
    d.players != null ? `${d.players}/${d.maxPlayers == null ? '?' : d.maxPlayers}` : '';
  document.getElementById('qv-map').textContent = d.map || '';
  document.getElementById('qv-mods').textContent = d.modCount ? String(d.modCount) : '';

  // Descrição com o rich text do jogo (cores, tamanhos, negrito).
  const descEl = document.getElementById('qv-desc');
  if (d.description) {
    RichText.render(descEl, d.description, { maxScale: 1.7, baseSize: 14 });
    descEl.classList.remove('empty');
  } else {
    descEl.textContent = I18N.t('quick.noDescription');
    descEl.classList.add('empty');
    descEl.removeAttribute('title');
  }

  document.getElementById('qv-chips').innerHTML = [
    d.folderName ? `<span class="qv-chip folder" style="--folder-color:${escapeHtml(d.folderColor || '#6ee06e')}"><b>${Icon.svg('folder', 12)}</b> ${escapeHtml(d.folderName)}</span>` : '',
    qvChip(`${I18N.t('details.pvp')}: `, d.pvp === true ? 'PvP' : d.pvp === false ? 'PvE' : null),
    qvChip(`${I18N.t('quick.difficulty')}: `, d.difficulty),
    qvChip('BattlEye: ', d.battlEye === true ? 'ON' : d.battlEye === false ? 'OFF' : null),
    ...(d.tags || []).map((t) => `<span class="qv-chip tag">${escapeHtml(t)}</span>`)
  ].join('');

  // Botões que só fazem sentido para servidores salvos.
  const favBtn = document.getElementById('qv-fav');
  const trackBtn = document.getElementById('qv-track');
  favBtn.classList.toggle('hidden', !d.bmId);
  trackBtn.classList.toggle('hidden', !d.bmId);
  favBtn.textContent = I18N.t(d.favorite ? 'quick.unfavorite' : 'quick.favorite');
  favBtn.classList.toggle('on', !!d.favorite);
  document.getElementById('qv-join').disabled = !d.canJoin;
}

async function openQuickView(bmId) {
  const s = AppState.config.servers.find((x) => x.bmId === bmId);
  if (!s) return;
  QuickView.bmId = bmId;
  renderQuickView(quickViewSnapshotFromServer(s));
  showModal('modal-quickview');

  // Bandeira e dados ao vivo chegam depois, sem travar a abertura.
  if (s.ip && AppState.config.showFlags !== false) {
    GeoFlag.resolve(s.ip).then(() => {
      if (QuickView.bmId === bmId) renderQuickView(quickViewSnapshotFromServer(s));
    });
  }
  refreshQuickView();
}

function openQuickViewCurrent() {
  const d = quickViewSnapshotFromCurrent();
  if (!d) return;
  QuickView.bmId = null;
  renderQuickView(d);
  showModal('modal-quickview');
  if (d.ip && AppState.config.showFlags !== false) {
    GeoFlag.resolve(d.ip).then(() => {
      const fresh = quickViewSnapshotFromCurrent();
      if (fresh && !QuickView.bmId) renderQuickView(fresh);
    });
  }
}

// Consulta o servidor de novo enquanto o modal está aberto, para o
// número de jogadores não ficar "velho" na tela.
async function refreshQuickView() {
  const bmId = QuickView.bmId;
  if (!bmId || QuickView.refreshing) return;
  QuickView.refreshing = true;
  try {
    const { info, unturned } = await window.api.queryServerByBmId(bmId);
    const prev = LiveData[bmId] || {};
    LiveData[bmId] = {
      ...prev,
      name: info.name, players: info.players, maxPlayers: info.maxPlayers,
      status: 'online', map: info.map,
      description: (unturned && unturned.fields && unturned.fields.description) || prev.description || null,
      mods: (unturned && unturned.mods) || prev.mods || [],
      modCount: (unturned && unturned.modCount) || prev.modCount || 0,
      icon: (unturned && unturned.iconUrl) || prev.icon || null
    };
  } catch {
    LiveData[bmId] = { ...(LiveData[bmId] || {}), status: 'offline' };
  } finally {
    QuickView.refreshing = false;
  }

  // Só redesenha se o modal ainda estiver no mesmo servidor.
  if (QuickView.bmId === bmId && !document.getElementById('modal-quickview').classList.contains('hidden')) {
    const s = AppState.config.servers.find((x) => x.bmId === bmId);
    if (s) renderQuickView(quickViewSnapshotFromServer(s));
    if (!AppState.trackingId) renderHome();
  }
}

function closeQuickView() {
  QuickView.bmId = null;
  QuickView.data = null;
  hideModal('modal-quickview');
}

function quickViewJoin() {
  const d = QuickView.data;
  if (!d || !d.ip) return;
  window.api.openExternal(`steam://connect/${d.ip}:${d.port}`);
  toast(I18N.t('quick.joining', { name: d.name }));
}

async function quickViewToggleFavorite() {
  const d = QuickView.data;
  if (!d || !d.bmId) return;
  await toggleFavorite(d.bmId);
  const s = AppState.config.servers.find((x) => x.bmId === d.bmId);
  if (s) renderQuickView(quickViewSnapshotFromServer(s));
}

function quickViewTrack() {
  const d = QuickView.data;
  if (!d || !d.bmId) return;
  closeQuickView();
  openTracking(d.bmId);
}
