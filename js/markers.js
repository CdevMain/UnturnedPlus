// ============================================================
// markers.js — Ver e editar marcadores EM MASSA
//
// O mapa é ótimo para marcar um ponto, e péssimo para conferir 60
// deles. Este modal é a visão de tabela: busca, filtro por tipo,
// seleção múltipla, e as operações que só fazem sentido em lote —
// trocar o tipo, apagar, e limpar de uma vez tudo que veio do jogo.
//
// Marcadores com `auto: true` foram extraídos do Environment/
// Nodes.dat do mapa (nomes de localização e airdrops). Eles são
// mostrados com um selo próprio para não se confundirem com o que
// você anotou à mão.
// ============================================================

const MarkerBulk = {
  selected: new Set(),
  search: '',
  typeFilter: 'all',
  sourceFilter: 'all'   // all | auto | manual
};

function markerRowsFiltered() {
  const all = (MapView.markersData && MapView.markersData.markers) || [];
  const q = MarkerBulk.search.trim().toLowerCase();
  return all
    .map((m, index) => ({ ...m, index }))
    .filter((m) => {
      if (MarkerBulk.typeFilter !== 'all' && m.type !== MarkerBulk.typeFilter) return false;
      if (MarkerBulk.sourceFilter === 'auto' && !m.auto) return false;
      if (MarkerBulk.sourceFilter === 'manual' && m.auto) return false;
      if (q && !String(m.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
}

function renderMarkerBulk() {
  const body = document.getElementById('mk-rows');
  const rows = markerRowsFiltered();
  const all = (MapView.markersData && MapView.markersData.markers) || [];

  document.getElementById('mk-count').textContent =
    I18N.t('list.results', { n: rows.length, total: all.length });
  document.getElementById('mk-selected').textContent =
    I18N.t('markers.selected', { n: MarkerBulk.selected.size });

  const acting = MarkerBulk.selected.size > 0;
  document.getElementById('mk-delete').disabled = !acting;
  document.getElementById('mk-retype').disabled = !acting;
  document.getElementById('mk-retype-to').disabled = !acting;

  if (!rows.length) {
    body.innerHTML = `<p class="muted small mk-empty">${escapeHtml(I18N.t(all.length ? 'list.noMatch' : 'markers.empty'))}</p>`;
    return;
  }

  body.innerHTML = rows.map((m) => {
    const st = MapView.style(m.type);
    return `
      <label class="mk-row${MarkerBulk.selected.has(m.index) ? ' on' : ''}">
        <input type="checkbox" data-mk="${m.index}" ${MarkerBulk.selected.has(m.index) ? 'checked' : ''}>
        <span class="mk-icon" style="--mk:${st.color}">${MapView.iconHtml(m.type, 14)}</span>
        <input class="mk-name${m.official ? ' locked' : ''}" data-mk-name="${m.index}"
               value="${escapeHtml(m.name || '')}"
               ${m.official ? `readonly title="${escapeHtml(I18N.t('markers.officialLocked'))}"` : ''}
               placeholder="${escapeHtml(I18N.t('map.markerName'))}">
        <span class="mk-type">${escapeHtml(MapView.typeLabel(m.type))}</span>
        <span class="mk-coords">${m.x}, ${m.z}</span>
        ${m.official
          ? `<span class="mk-badge official" title="${escapeHtml(I18N.t('markers.officialLocked'))}">${Icon.svg('key', 11)} ${escapeHtml(I18N.t('markers.official'))}</span>`
          : m.auto
            ? `<span class="mk-badge" title="${escapeHtml(I18N.t('markers.autoHint'))}">${escapeHtml(I18N.t('markers.auto'))}</span>`
            : '<span class="mk-badge manual"></span>'}
        <button class="mk-go" data-mk-go="${m.index}" title="${escapeHtml(I18N.t('markers.center'))}">${Icon.svg('target', 14)}</button>
        ${m.official ? '' : `<button class="mk-go" data-mk-move="${m.index}" title="${escapeHtml(I18N.t('markers.move'))}">${Icon.svg('hand', 14)}</button>`}
      </label>`;
  }).join('');

  for (const cb of body.querySelectorAll('[data-mk]')) {
    cb.addEventListener('change', () => {
      const i = Number(cb.dataset.mk);
      if (cb.checked) MarkerBulk.selected.add(i); else MarkerBulk.selected.delete(i);
      renderMarkerBulk();
    });
  }

  // Renomear direto na linha (salva ao sair do campo).
  for (const input of body.querySelectorAll('[data-mk-name]')) {
    input.addEventListener('change', async () => {
      const i = Number(input.dataset.mkName);
      const m = MapView.markersData.markers[i];
      if (!m) return;
      // Local oficial: o campo é readonly, mas a trava também vive
      // aqui, que é por onde a gravação passa de verdade.
      if (m.official) { input.value = m.name || ''; return; }
      m.name = input.value.trim() || m.name;
      // Renomear um marcador do jogo passa a valer como edição sua.
      if (m.auto) m.auto = false;
      await MapView.saveMarkers();
      MapView.draw();
      renderMarkerBulk();
    });
  }

  for (const btn of body.querySelectorAll('[data-mk-go]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      centerMapOnMarker(Number(btn.dataset.mkGo));
    });
  }

  // Mover a partir da tabela: fecha o modal e espera o clique no
  // mapa. Sem isto, mover um ponto que você achou pela busca exigia
  // fechar, procurar de novo no mapa e arrastar.
  for (const btn of body.querySelectorAll('[data-mk-move]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const i = Number(btn.dataset.mkMove);
      if (MapView.pedirNovaPosicao(i, () => renderMarkerBulk())) {
        hideModal('modal-markers');
        document.getElementById('panel-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}

// Centraliza o mapa num marcador e fecha o modal.
function centerMapOnMarker(index) {
  const m = MapView.markersData.markers[index];
  if (!m || !MapView.image) { toast(I18N.t('map.noMap')); return; }
  const { px, py } = MapView.worldToImage(m.x, m.z);
  MapView.scale = Math.max(MapView.scale, 1.4);
  MapView.offsetX = MapView.canvas.width / 2 - px * MapView.scale;
  MapView.offsetY = MapView.canvas.height / 2 - py * MapView.scale;
  MapView.draw();
  hideModal('modal-markers');
  document.getElementById('panel-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(I18N.t('markers.centered', { name: m.name }));
}

function openMarkerBulk() {
  if (!MapView.mapName) { toast(I18N.t('map.noMap')); return; }
  MarkerBulk.selected.clear();
  MarkerBulk.search = '';
  MarkerBulk.typeFilter = 'all';
  MarkerBulk.sourceFilter = 'all';
  // As categorias do usuário podem ter mudado desde a última
  // abertura: os <select> são reescritos aqui, não no boot.
  if (typeof refreshTypeSelectors === 'function') refreshTypeSelectors();
  document.getElementById('mk-search').value = '';
  document.getElementById('mk-type-filter').value = 'all';
  document.getElementById('mk-source-filter').value = 'all';
  document.getElementById('mk-map').textContent = MapView.mapName;
  renderMarkerBulk();
  showModal('modal-markers');
}

function markerBulkSelectAll(on) {
  MarkerBulk.selected.clear();
  if (on) for (const m of markerRowsFiltered()) MarkerBulk.selected.add(m.index);
  renderMarkerBulk();
}

async function markerBulkDelete() {
  const n = MarkerBulk.selected.size;
  if (!n) return;
  if (!await Ask.confirm(I18N.t('markers.confirmDelete', { n }))) return;
  // Removemos de trás para frente: apagar por índice crescente
  // desloca os seguintes e apagaria o marcador errado.
  const idx = [...MarkerBulk.selected].sort((a, b) => b - a);
  for (const i of idx) MapView.markersData.markers.splice(i, 1);
  MarkerBulk.selected.clear();
  await MapView.saveMarkers();
  MapView.draw();
  renderMarkerBulk();
  toast(I18N.t('markers.deleted', { n }));
}

async function markerBulkRetype() {
  const type = document.getElementById('mk-retype-to').value;
  const n = MarkerBulk.selected.size;
  if (!n || !type) return;
  // Local oficial fica de fora: mudar o tipo dele o tiraria do
  // índice de locais, e aí o app perderia a referência que usa para
  // dizer onde as coisas ficam.
  let trocados = 0, travados = 0;
  for (const i of MarkerBulk.selected) {
    const m = MapView.markersData.markers[i];
    if (!m) continue;
    if (m.official) { travados += 1; continue; }
    m.type = type; m.auto = false; trocados += 1;
  }
  await MapView.saveMarkers();
  MapView.draw();
  renderMarkerBulk();
  // Diz quantos ficaram de fora em vez de trocar menos do que a
  // pessoa pediu em silêncio.
  toast(travados
    ? I18N.t('markers.retypedSome', { n: trocados, k: travados })
    : I18N.t('markers.retyped', { n: trocados }));
}

async function markerBulkClearAuto() {
  const all = MapView.markersData.markers || [];
  const n = all.filter((m) => m.auto).length;
  if (!n) { toast(I18N.t('markers.noAuto')); return; }
  if (!await Ask.confirm(I18N.t('markers.confirmClearAuto', { n }))) return;
  MapView.markersData.markers = all.filter((m) => !m.auto);
  MarkerBulk.selected.clear();
  MapView.rebuildLocationIndex();   // os locais oficiais saíram junto
  await MapView.saveMarkers();
  MapView.draw();
  renderMarkerBulk();
  toast(I18N.t('markers.clearedAuto', { n }));
}

function initMarkerBulk() {
  const search = document.getElementById('mk-search');
  if (!search) return;

  search.addEventListener('input', () => { MarkerBulk.search = search.value; renderMarkerBulk(); });
  document.getElementById('mk-type-filter').addEventListener('change', (e) => {
    MarkerBulk.typeFilter = e.target.value; MarkerBulk.selected.clear(); renderMarkerBulk();
  });
  document.getElementById('mk-source-filter').addEventListener('change', (e) => {
    MarkerBulk.sourceFilter = e.target.value; MarkerBulk.selected.clear(); renderMarkerBulk();
  });
  document.getElementById('mk-all').addEventListener('change', (e) => markerBulkSelectAll(e.target.checked));
  document.getElementById('mk-delete').addEventListener('click', markerBulkDelete);
  document.getElementById('mk-retype').addEventListener('click', markerBulkRetype);
  document.getElementById('mk-clear-auto').addEventListener('click', markerBulkClearAuto);
  document.getElementById('mk-close').addEventListener('click', () => hideModal('modal-markers'));
  document.getElementById('mk-extract').addEventListener('click', async () => {
    await MapView.extractNodes();
    MarkerBulk.selected.clear();
    renderMarkerBulk();
  });
}
