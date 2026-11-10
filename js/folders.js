// ============================================================
// folders.js — Pastas de servidores (um nível).
//
// A ideia: quem joga numa REDE tem 5, 8, 15 servidores do mesmo
// dono espalhados na home. A pasta agrupa esses servidores, tem
// cor de contorno própria e pode usar a logo da rede como ícone.
//
// Modelo de dados (fica na config, junto dos servidores, para
// exportar/importar tudo de uma vez):
//   config.folders = [{ id, name, color, icon, createdAt }]
//   config.servers[i].folderId = <id da pasta> | null
//
// O servidor guarda só o ID da pasta — mover nunca duplica dado, e
// apagar a pasta devolve os servidores para a raiz em vez de
// apagá-los junto.
// ============================================================

const FOLDER_COLORS = [
  '#e05c5c', '#e6b450', '#6ee06e', '#5cb8e0',
  '#a98bff', '#e05c9a', '#e08b5c', '#8ba394'
];

const FolderUI = {
  editingId: null,   // null = criando uma pasta nova
  draft: { name: '', color: FOLDER_COLORS[2], icon: '' }
};

// ---------------- consultas ----------------
function getFolder(id) {
  return (AppState.config.folders || []).find((f) => f.id === id) || null;
}

function serversInFolder(folderId) {
  return (AppState.config.servers || []).filter((s) => (s.folderId || null) === (folderId || null));
}

// Total de jogadores online somando os servidores da pasta — só
// conta o que já temos ao vivo; servidor offline entra como 0.
function folderStats(folderId) {
  const list = serversInFolder(folderId);
  let players = 0;
  let online = 0;
  for (const s of list) {
    const live = LiveData[s.bmId];
    if (live && live.status === 'online') {
      online += 1;
      players += live.players || 0;
    }
  }
  return { total: list.length, online, players };
}

// ---------------- linha da pasta no menu lateral ----------------
function folderRowHtml(folder) {
  const st = folderStats(folder.id);
  const icon = folder.icon
    ? `<img src="${escapeHtml(folder.icon)}" alt="" referrerpolicy="no-referrer"
         onerror="iconFallback(this,'folder')">`
    : Icon.svg('folder', 18);
  const active = AppState.currentFolderId === folder.id;

  return `
    <div class="drawer-folder${active ? ' active' : ''}" data-folder-id="${escapeHtml(folder.id)}"
         role="button" tabindex="0"
         style="--folder-color:${escapeHtml(folder.color || '#6ee06e')}">
      <span class="drawer-folder-icon">${icon}</span>
      <span class="drawer-folder-body">
        <span class="drawer-folder-name">${escapeHtml(folder.name)}</span>
        <span class="drawer-folder-meta">
          ${escapeHtml(I18N.t('folder.countServers', { n: st.total }))}${st.total
            ? ` · ${escapeHtml(I18N.t('folder.countOnline', { n: st.players }))}` : ''}
        </span>
      </span>
      <span class="drawer-folder-gear" data-folder-edit="${escapeHtml(folder.id)}"
            role="button" tabindex="0"
            title="${escapeHtml(I18N.t('folder.edit'))}">${Icon.svg('gear', 14)}</span>
    </div>`;
}

// Assinatura da lista de pastas — mesma lógica dos cards de
// servidor: sem mudança visível, sem mexer no DOM (e assim um
// clique numa pasta nunca é perdido durante o polling).
function foldersSignature(folders) {
  return folders.map((f) => {
    const st = folderStats(f.id);
    return [f.id, f.name, f.color, f.icon, st.total, st.players].join('~');
  }).join('|') + `|${AppState.currentFolderId}|${I18N.lang}`;
}

// Alvo de "soltar aqui" — vale tanto para as pastas quanto para o
// item "Todos os servidores" (que tira o servidor da pasta).
function makeDropTarget(el, folderId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-unturned-server')) return;
    e.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const bmId = e.dataTransfer.getData('text/x-unturned-server');
    if (!bmId) return;
    await moveServersToFolder([bmId], folderId);
  });
}

function renderFolders() {
  const grid = document.getElementById('grid-folders');
  const empty = document.getElementById('drawer-folders-empty');
  const folders = AppState.config.folders || [];
  const rootCount = (AppState.config.servers || []).filter((s) => !s.folderId).length;

  document.getElementById('count-folders').textContent = folders.length;
  empty.classList.toggle('hidden', folders.length > 0);

  // "Todos os servidores" — item fixo no topo da lista.
  const all = document.getElementById('drawer-all');
  all.classList.toggle('active', !AppState.currentFolderId);
  document.getElementById('drawer-all-meta').textContent =
    I18N.t('folder.countServers', { n: rootCount });
  if (!all.dataset.bound) {
    all.dataset.bound = '1';
    all.addEventListener('click', () => leaveFolder());
    makeDropTarget(all, null);
  }

  const sig = foldersSignature(folders);
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;

  grid.innerHTML = folders.map(folderRowHtml).join('');

  for (const el of grid.querySelectorAll('.drawer-folder')) {
    const id = el.dataset.folderId;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-folder-edit]')) return;
      openFolder(id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFolder(id); }
    });
    makeDropTarget(el, id);
  }

  for (const gear of grid.querySelectorAll('[data-folder-edit]')) {
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(gear.dataset.folderEdit);
    });
  }
}

// ---------------- navegação ----------------
function openFolder(id) {
  AppState.currentFolderId = id;
  AppState.selectedForDelete.clear();
  closeDrawer();
  renderHome();
  window.scrollTo(0, 0);
}

function leaveFolder() {
  AppState.currentFolderId = null;
  AppState.selectedForDelete.clear();
  closeDrawer();
  renderHome();
}

function renderFolderBar() {
  const bar = document.getElementById('folder-bar');
  const folder = getFolder(AppState.currentFolderId);
  if (!folder) { bar.classList.add('hidden'); return; }

  bar.classList.remove('hidden');
  bar.style.setProperty('--folder-color', folder.color || '#6ee06e');
  const crumb = document.getElementById('folder-crumb');
  const icon = folder.icon
    ? `<img src="${escapeHtml(folder.icon)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
    : Icon.svg('folder', 18);
  crumb.innerHTML = `${icon}<span>${escapeHtml(folder.name)}</span>`;
}

// ---------------- mover servidores ----------------
async function moveServersToFolder(bmIds, folderId) {
  await window.api.moveToFolder(bmIds, folderId);
  await reloadAppConfig();
  const folder = getFolder(folderId);
  toast(folder
    ? I18N.t('folder.moved', { n: bmIds.length, name: folder.name })
    : I18N.t('folder.movedOut', { n: bmIds.length }));
}

function openMoveModal(bmIds) {
  const ids = Array.isArray(bmIds) ? bmIds : [bmIds];
  const list = document.getElementById('move-list');
  document.getElementById('move-text').textContent = I18N.t('folder.moveText', { n: ids.length });

  const folders = AppState.config.folders || [];
  const rows = [
    `<button class="move-row" data-target="">${Icon.svg('upload', 14)} ${escapeHtml(I18N.t('folder.none'))}</button>`,
    ...folders.map((f) => `
      <button class="move-row" data-target="${escapeHtml(f.id)}"
              style="--folder-color:${escapeHtml(f.color)}">
        <span class="move-dot"></span>${escapeHtml(f.name)}
      </button>`),
    `<button class="move-row new" data-target="__new__">${Icon.svg('plus', 14)} ${escapeHtml(I18N.t('folder.new'))}</button>`
  ];
  list.innerHTML = rows.join('');

  for (const row of list.querySelectorAll('.move-row')) {
    row.addEventListener('click', async () => {
      const target = row.dataset.target;
      hideModal('modal-move');
      if (target === '__new__') {
        openFolderModal(null, { afterCreate: (folder) => moveServersToFolder(ids, folder.id) });
        return;
      }
      await moveServersToFolder(ids, target || null);
    });
  }
  showModal('modal-move');
}

// ---------------- modal de criar/editar ----------------
let folderAfterCreate = null;

function openFolderModal(id, opts = {}) {
  FolderUI.editingId = id || null;
  folderAfterCreate = opts.afterCreate || null;

  const folder = id ? getFolder(id) : null;
  FolderUI.draft = folder
    ? { name: folder.name, color: folder.color, icon: folder.icon || '' }
    : { name: '', color: FOLDER_COLORS[2], icon: '' };

  document.getElementById('folder-modal-title').textContent =
    I18N.t(folder ? 'folder.editTitle' : 'folder.new');
  document.getElementById('folder-name').value = FolderUI.draft.name;
  document.getElementById('folder-icon').value = FolderUI.draft.icon;
  document.getElementById('folder-error').classList.add('hidden');

  renderFolderColors();
  renderFolderIconPicker();
  renderFolderPreview();
  showModal('modal-folder');
  document.getElementById('folder-name').focus();
}

function renderFolderColors() {
  const box = document.getElementById('folder-colors');
  box.innerHTML = FOLDER_COLORS.map((c) => `
    <button class="color-dot${c === FolderUI.draft.color ? ' active' : ''}"
            data-color="${c}" style="--dot:${c}" aria-label="${c}"></button>`).join('');
  for (const dot of box.querySelectorAll('.color-dot')) {
    dot.addEventListener('click', () => {
      FolderUI.draft.color = dot.dataset.color;
      renderFolderColors();
      renderFolderPreview();
    });
  }
}

// Oferece os ícones dos servidores já adicionados — é o caminho
// mais rápido para usar a logo da própria rede como ícone da pasta.
function renderFolderIconPicker() {
  const box = document.getElementById('folder-icon-picker');
  const icons = [];
  const seen = new Set();
  for (const s of AppState.config.servers || []) {
    const url = LiveData[s.bmId]?.icon;
    if (url && !seen.has(url)) { seen.add(url); icons.push({ url, name: s.name || s.bmId }); }
  }
  if (!icons.length) {
    box.innerHTML = `<span class="muted small">${escapeHtml(I18N.t('folder.noIcons'))}</span>`;
    return;
  }
  box.innerHTML = icons.slice(0, 12).map((i) => `
    <button class="icon-option${i.url === FolderUI.draft.icon ? ' active' : ''}"
            data-icon="${escapeHtml(i.url)}" title="${escapeHtml(i.name)}">
      <img src="${escapeHtml(i.url)}" alt="" referrerpolicy="no-referrer" onerror="iconFallbackRemove(this)">
    </button>`).join('');
  for (const opt of box.querySelectorAll('.icon-option')) {
    opt.addEventListener('click', () => {
      FolderUI.draft.icon = opt.dataset.icon;
      document.getElementById('folder-icon').value = FolderUI.draft.icon;
      renderFolderIconPicker();
      renderFolderPreview();
    });
  }
}

function renderFolderPreview() {
  const box = document.getElementById('folder-preview');
  const name = FolderUI.draft.name || I18N.t('folder.new');
  const icon = FolderUI.draft.icon
    ? `<img src="${escapeHtml(FolderUI.draft.icon)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this,'folder')">`
    : Icon.svg('folder', 18);
  box.innerHTML = `
    <div class="folder-card preview" style="--folder-color:${escapeHtml(FolderUI.draft.color)}">
      <div class="folder-icon">${icon}</div>
      <div class="folder-body">
        <div class="folder-name">${escapeHtml(name)}</div>
        <div class="folder-meta">${escapeHtml(I18N.t('folder.previewMeta'))}</div>
      </div>
    </div>`;
}

async function confirmFolderModal() {
  const name = document.getElementById('folder-name').value.trim();
  const icon = document.getElementById('folder-icon').value.trim();
  const err = document.getElementById('folder-error');

  if (!name) {
    err.textContent = I18N.t('folder.errorName');
    err.classList.remove('hidden');
    return;
  }
  if (icon && !/^https?:\/\//i.test(icon)) {
    err.textContent = I18N.t('folder.errorIcon');
    err.classList.remove('hidden');
    return;
  }

  const payload = { name, color: FolderUI.draft.color, icon: icon || null };
  let folder;
  if (FolderUI.editingId) {
    folder = await window.api.updateFolder(FolderUI.editingId, payload);
  } else {
    folder = await window.api.createFolder(payload);
  }

  hideModal('modal-folder');
  await reloadAppConfig();
  toast(I18N.t(FolderUI.editingId ? 'folder.saved' : 'folder.created', { name }));

  if (folder && folderAfterCreate) {
    const cb = folderAfterCreate;
    folderAfterCreate = null;
    await cb(folder);
  }
}

async function deleteCurrentFolder() {
  const folder = getFolder(AppState.currentFolderId);
  if (!folder) return;
  const n = serversInFolder(folder.id).length;
  if (!await Ask.confirm(I18N.t('folder.confirmDelete', { name: folder.name, n }))) return;

  await window.api.deleteFolder(folder.id);
  AppState.currentFolderId = null;
  await reloadAppConfig();
  toast(I18N.t('folder.deleted', { name: folder.name }));
}

// Preenche o <select> de pasta do modal "adicionar servidor".
function fillFolderSelect(selectedId) {
  const sel = document.getElementById('add-folder');
  if (!sel) return;
  const folders = AppState.config.folders || [];
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('folder.none'))}</option>` +
    folders.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  sel.value = selectedId || '';
}
