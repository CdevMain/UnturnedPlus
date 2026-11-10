// ============================================================
// backup.js — exportar, carregar e resetar (renderer)
//
// O mesmo modal serve para exportar e para importar, porque as
// duas telas fazem a MESMA pergunta: "quais partes?". A diferença
// é o que aparece embaixo (seleção de servidores na exportação,
// escolha de conflito na importação) e o que o botão faz.
//
// Nada é escrito sem o usuário ver antes o que vai acontecer:
// exportar mostra o tamanho, importar mostra o que tem no arquivo.
// ============================================================

const Backup = {
  mode: 'export',      // 'export' | 'import'
  info: null,          // resumo do arquivo carregado (só no import)
  serverIds: null,     // null = todos
  previewTimer: null
};

const BACKUP_PARTS = ['servers', 'folders', 'settings', 'markers', 'notes', 'history'];

function initBackup() {
  if (!document.getElementById('modal-backup')) return;

  document.getElementById('backup-cancel').addEventListener('click', () => {
    if (Backup.mode === 'import') window.api.backupCancel();
    hideModal('modal-backup');
  });
  document.getElementById('backup-go').addEventListener('click', runBackup);

  for (const cb of document.querySelectorAll('#backup-parts input[type=checkbox]')) {
    cb.addEventListener('change', () => {
      // A seleção fina de servidores só faz sentido se "servidores"
      // estiver marcado; escondê-la evita a pergunta sem resposta.
      syncBackupUi();
      schedulePreview();
    });
  }
  document.getElementById('backup-shots').addEventListener('change', schedulePreview);

  document.getElementById('bk-srv-all').addEventListener('change', (e) => {
    Backup.serverIds = e.target.checked ? null : [];
    renderBackupServers();
    schedulePreview();
  });

  // ---- Configurações ----
  document.getElementById('cfg-backup-export').addEventListener('click', () => openBackup('export'));
  document.getElementById('cfg-backup-import').addEventListener('click', openBackupImport);
  document.getElementById('cfg-open-userdata').addEventListener('click', () => window.api.openUserData());
  document.getElementById('cfg-prune-shots').addEventListener('click', async () => {
    const n = await window.api.shotsPrune();
    toast(I18N.t(n ? 'data.pruned' : 'data.nothingToPrune', { n }));
    renderDataStats();
  });
  document.getElementById('cfg-reset').addEventListener('click', openReset);

  // ---- Reset ----
  const confirmInput = document.getElementById('reset-confirm');
  confirmInput.addEventListener('input', () => {
    // A palavra é traduzida: quem usa o app em inglês digita RESET.
    const want = I18N.t('reset.word').trim().toUpperCase();
    document.getElementById('reset-go').disabled =
      confirmInput.value.trim().toUpperCase() !== want;
  });
  document.getElementById('reset-cancel').addEventListener('click', () => hideModal('modal-reset'));
  document.getElementById('reset-backup-first').addEventListener('click', () => {
    hideModal('modal-reset');
    openBackup('export');
  });
  document.getElementById('reset-go').addEventListener('click', runReset);
}

// ------------------------------------------------------------
// Abrir
// ------------------------------------------------------------
function openBackup(mode) {
  Backup.mode = mode;
  Backup.info = null;
  Backup.serverIds = null;

  document.getElementById('backup-title').textContent = I18N.t('backup.exportTitle');
  document.getElementById('backup-sub').textContent = I18N.t('backup.exportSub');
  document.getElementById('backup-go').textContent = I18N.t('backup.export');
  document.getElementById('backup-import').classList.add('hidden');
  document.getElementById('backup-servers').classList.remove('hidden');
  document.getElementById('backup-shots-row').classList.remove('hidden');

  for (const cb of document.querySelectorAll('#backup-parts input[type=checkbox]')) {
    cb.disabled = false;
    cb.checked = cb.dataset.part !== 'history';   // histórico é grande e raramente útil fora daqui
  }
  document.getElementById('bk-srv-all').checked = true;
  renderBackupServers();
  syncBackupUi();
  showModal('modal-backup');
  schedulePreview();
}

async function openBackupImport() {
  const r = await window.api.backupPick();
  if (!r || r.canceled) return;
  if (!r.ok) {
    toast(I18N.t(r.reason === 'newer_version' ? 'backup.tooNew'
      : r.reason === 'not_a_backup' ? 'backup.notBackup' : 'backup.unreadable'));
    return;
  }

  Backup.mode = 'import';
  Backup.info = r;

  document.getElementById('backup-title').textContent = I18N.t('backup.importTitle');
  document.getElementById('backup-sub').textContent = I18N.t('backup.importSub', {
    date: (r.createdAt || '').slice(0, 10), app: r.app || '?'
  });
  document.getElementById('backup-go').textContent = I18N.t('backup.import');
  document.getElementById('backup-import').classList.remove('hidden');
  document.getElementById('backup-servers').classList.add('hidden');
  document.getElementById('backup-shots-row').classList.add('hidden');

  // Só dá para importar o que o arquivo REALMENTE tem. Marcar uma
  // caixa vazia daria a impressão de que algo foi restaurado.
  for (const cb of document.querySelectorAll('#backup-parts input[type=checkbox]')) {
    const n = r.counts[cb.dataset.part] || 0;
    cb.disabled = !n;
    cb.checked = !!n;
    const em = document.getElementById('bk-n-' + cb.dataset.part);
    if (em) em.textContent = n ? `(${n})` : `— ${I18N.t('backup.absent')}`;
  }
  const shots = r.counts.shots || 0;
  document.getElementById('backup-size').textContent = shots
    ? I18N.t('backup.importShots', { n: shots })
    : '';

  showModal('modal-backup');
}

function syncBackupUi() {
  const servers = document.querySelector('#backup-parts input[data-part=servers]');
  const notes = document.querySelector('#backup-parts input[data-part=notes]');
  if (Backup.mode === 'export') {
    document.getElementById('backup-servers').classList.toggle('hidden', !servers.checked);
    document.getElementById('backup-shots-row').classList.toggle('hidden', !notes.checked);
  }
}

function selectedParts() {
  return [...document.querySelectorAll('#backup-parts input[type=checkbox]')]
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => cb.dataset.part)
    .filter((p) => BACKUP_PARTS.includes(p));
}

// ------------------------------------------------------------
// Escolha de servidores (só na exportação)
// ------------------------------------------------------------
function renderBackupServers() {
  const box = document.getElementById('bk-srv-list');
  const all = AppState.config.servers || [];
  const every = Backup.serverIds === null;

  document.getElementById('bk-srv-count').textContent =
    I18N.t('backup.nServers', { n: every ? all.length : Backup.serverIds.length, total: all.length });

  box.classList.toggle('hidden', every);
  if (every) { box.innerHTML = ''; return; }

  box.innerHTML = all.map((s) => {
    const id = String(s.bmId);
    return `<label class="check bk-srv">
      <input type="checkbox" data-bk-srv="${escapeHtml(id)}" ${Backup.serverIds.includes(id) ? 'checked' : ''} />
      <span>${escapeHtml(s.name || id)}</span>
      <em class="muted small">${escapeHtml(s.ip ? s.ip + ':' + s.port : id)}</em>
    </label>`;
  }).join('');

  box.onchange = (e) => {
    const cb = e.target.closest('[data-bk-srv]');
    if (!cb) return;
    const id = cb.dataset.bkSrv;
    if (cb.checked) Backup.serverIds.push(id);
    else Backup.serverIds = Backup.serverIds.filter((x) => x !== id);
    document.getElementById('bk-srv-count').textContent =
      I18N.t('backup.nServers', { n: Backup.serverIds.length, total: all.length });
    schedulePreview();
  };
}

// ------------------------------------------------------------
// Prévia do tamanho
// ------------------------------------------------------------
// Debounce: cada prévia LÊ os prints do disco para somar bytes.
// Marcar seis caixas em sequência não deve virar seis leituras.
function schedulePreview() {
  if (Backup.mode !== 'export') return;
  clearTimeout(Backup.previewTimer);
  document.getElementById('backup-size').textContent = I18N.t('backup.calculating');
  Backup.previewTimer = setTimeout(renderBackupPreview, 250);
}

async function renderBackupPreview() {
  const opts = {
    parts: selectedParts(),
    includeShots: document.getElementById('backup-shots').checked,
    serverIds: Backup.serverIds || []
  };
  if (!opts.parts.length) {
    document.getElementById('backup-size').textContent = I18N.t('backup.nothingSelected');
    document.getElementById('backup-go').disabled = true;
    return;
  }
  document.getElementById('backup-go').disabled = false;

  const r = await window.api.backupPreview(opts);
  if (!r || !r.ok) { document.getElementById('backup-size').textContent = ''; return; }

  for (const [k, n] of Object.entries(r.counts || {})) {
    const em = document.getElementById('bk-n-' + k);
    if (em) em.textContent = n ? `(${n})` : '';
  }
  document.getElementById('backup-size').textContent =
    I18N.t('backup.willBe', { size: formatBytes(r.bytes || 0) });
}

// ------------------------------------------------------------
// Executar
// ------------------------------------------------------------
async function runBackup() {
  const parts = selectedParts();
  if (!parts.length) { toast(I18N.t('backup.nothingSelected')); return; }

  if (Backup.mode === 'export') {
    const r = await window.api.backupExport({
      parts,
      includeShots: document.getElementById('backup-shots').checked,
      serverIds: Backup.serverIds || []
    });
    if (r && r.canceled) return;
    hideModal('modal-backup');
    if (r && r.ok) {
      toast(I18N.t('backup.exported', { size: formatBytes(r.bytes || 0) }));
      showBackupResult(`<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('backup.exportedTo', { path: r.path }))}</span>`);
    } else {
      toast(I18N.t('backup.exportFail'));
    }
    return;
  }

  // --- Importar ---
  const mode = document.querySelector('input[name=bkmode]:checked').value;
  const r = await window.api.backupApply({ parts, mode });
  hideModal('modal-backup');
  if (!r || !r.ok) { toast(I18N.t('backup.importFail')); return; }

  const lines = Object.entries(r.added || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="test-ok">${Icon.svg('check', 13)} ${escapeHtml(I18N.t('backup.p' + k.charAt(0).toUpperCase() + k.slice(1)))}: ${n}</span>`);
  const skipped = Object.entries(r.skipped || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="muted">− ${escapeHtml(I18N.t('backup.kept', { what: I18N.t('backup.p' + k.charAt(0).toUpperCase() + k.slice(1)), n }))}</span>`);
  if ((r.warnings || []).includes('settings_secrets_excluded')) {
    skipped.push(`<span class="muted">− ${escapeHtml(I18N.t('backup.secretsNote'))}</span>`);
  }
  showBackupResult([...lines, ...skipped].join('<br>') || `<span class="muted">${escapeHtml(I18N.t('backup.nothingImported'))}</span>`);

  // A config no disco mudou: recarrega tudo em vez de tentar
  // adivinhar o que mexeu.
  await loadAppConfig();
  await I18N.load(AppState.config.language);
  applyHelpVisibility();
  renderHome();
  refreshAllCards();
  toast(I18N.t('backup.imported'));
}

function showBackupResult(html) {
  const box = document.getElementById('backup-result');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = html;
}

// ------------------------------------------------------------
// Reset total
// ------------------------------------------------------------
function openReset() {
  document.getElementById('reset-confirm').value = '';
  document.getElementById('reset-go').disabled = true;
  document.getElementById('reset-type-label').textContent =
    I18N.t('reset.typeToConfirm', { word: I18N.t('reset.word') });
  showModal('modal-reset');
}

async function runReset() {
  const keep = document.getElementById('reset-keep-maps').checked ? ['maps'] : [];
  const r = await window.api.appReset({ keep });
  if (!r || !r.ok) { toast(I18N.t('reset.failed')); return; }
  hideModal('modal-reset');
  // Reiniciar é honesto: metade do estado do app já está em memória
  // e continuaria escrevendo por cima do que acabamos de apagar.
  toast(I18N.t('reset.done'));
  setTimeout(() => window.api.appRelaunch(), 900);
}

// ------------------------------------------------------------
// Estatísticas da aba Dados
// ------------------------------------------------------------
async function renderDataStats() {
  const box = document.getElementById('data-stats');
  if (!box) return;
  const counts = await window.api.notesCounts([]);
  let notes = 0, shots = 0;
  for (const v of Object.values(counts || {})) { notes += v.notes; shots += v.shots; }

  box.innerHTML = `
    <div class="ds-row"><span>${escapeHtml(I18N.t('backup.pServers'))}</span><strong>${(AppState.config.servers || []).length}</strong></div>
    <div class="ds-row"><span>${escapeHtml(I18N.t('backup.pFolders'))}</span><strong>${(AppState.config.folders || []).length}</strong></div>
    <div class="ds-row"><span>${escapeHtml(I18N.t('notes.title'))}</span><strong>${notes}</strong></div>
    <div class="ds-row"><span>${escapeHtml(I18N.t('data.shots'))}</span><strong>${shots}</strong></div>`;

  const about = document.getElementById('app-about');
  if (about) {
    const info = await window.api.appInfo();
    about.textContent = `Unturned+ v${info.version} · Electron ${info.electron} · ${info.platform}`;
  }
}
