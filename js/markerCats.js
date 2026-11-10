// ============================================================
// markerCats.js — Categorias de marcador criadas pelo usuário
//
// O app traz quatro tipos: Local, Airdrop, Item e Custom. "Custom"
// resolve o caso de UMA coisa extra; a partir da segunda ("base do
// time", "loot bom", "inimigo") tudo vira o mesmo ponto rosa e o
// mapa deixa de responder perguntas.
//
// Aqui a pessoa cria até TRÊS categorias suas, cada uma com nome,
// emoji e cor. Elas entram na mesma fila das de fábrica: chip no
// card do marcador, opção no filtro, camada ligável, e cor própria
// no desenho.
//
// Onde ficam: na config (`markerCats`), não no arquivo de
// marcadores do mapa. Uma categoria "Time" que só existisse no
// Russia teria que ser recriada a cada mapa novo — e os marcadores
// que fossem exportados para outro mapa perderiam o tipo.
//
// O limite de 3 é de TELA, não técnico: a barra de camadas tem
// largura finita e sete chips já é o teto do que dá para ler numa
// olhada. Quando chega no limite o formulário some e o motivo
// aparece escrito — em vez de o botão silenciosamente não fazer
// nada.
// ============================================================

const MarkerCats = {
  // Paleta de emojis: os que fazem sentido num mapa de Unturned.
  // É um atalho, não uma prisão — o campo aceita colar qualquer um.
  EMOJIS: ['⭐', '🛡️', '💀', '🏠', '🔫', '⛽', '🔧', '💊', '🚗', '🚁',
           '⚠️', '🎯', '🔒', '💰', '🧟', '🌲', '⚓', '🏭', '📡', '🔥'],

  novoId() {
    return 'cat_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  },

  lista() {
    return (AppState.config && AppState.config.markerCats) || [];
  },

  cheio() { return this.lista().length >= MapView.MAX_CATS; },

  // Grava na config e reaplica em TUDO que desenha tipo. Um caminho
  // só: se cada tela recarregasse por conta própria, a categoria
  // apareceria no card e não na camada (ou vice-versa).
  async persistir(cats) {
    AppState.config.markerCats = cats;
    await saveAppConfig();
    MapView.setCats(cats);
    const recuperados = MapView.reclaimOrphanTypes();
    if (recuperados) await MapView.saveMarkers();
    renderLayerChips();
    refreshTypeSelectors();
    MapView.draw();
    this.render();
    if (typeof renderMarkerBulk === 'function' &&
        !document.getElementById('modal-markers').classList.contains('hidden')) {
      renderMarkerBulk();
    }
    return recuperados;
  },

  async criar(nome, emoji, cor) {
    if (this.cheio()) { toast(I18N.t('markers.catFull', { n: MapView.MAX_CATS })); return null; }
    const limpo = String(nome || '').trim().slice(0, 20);
    if (!limpo) { toast(I18N.t('markers.catNeedName')); return null; }
    // Nome repetido não quebra nada (o id é único), mas duas
    // camadas "Time" na barra é indistinguível na prática.
    if (this.lista().some((c) => c.name.toLowerCase() === limpo.toLowerCase())) {
      toast(I18N.t('markers.catDup', { name: limpo }));
      return null;
    }
    const cat = { id: this.novoId(), name: limpo, emoji: emoji || '⭐', color: cor || '#b48ee6' };
    await this.persistir([...this.lista(), cat]);
    toast(I18N.t('markers.catCreated', { name: cat.name }));
    return cat;
  },

  async editar(id, campos) {
    const cats = this.lista().map((c) => (c.id === id ? { ...c, ...campos } : c));
    await this.persistir(cats);
  },

  // Apagar uma categoria NÃO apaga os marcadores dela: eles voltam
  // para "Custom". Sumir com os pontos de alguém porque a etiqueta
  // saiu seria a pior troca possível.
  async excluir(id) {
    const cat = this.lista().find((c) => c.id === id);
    if (!cat) return;
    const usados = (MapView.markersData.markers || []).filter((m) => m.type === id).length;
    const pergunta = usados
      ? I18N.t('markers.catDeleteUsed', { name: cat.name, n: usados })
      : I18N.t('markers.catDelete', { name: cat.name });
    if (!await Ask.confirm(pergunta)) return;
    await this.persistir(this.lista().filter((c) => c.id !== id));
    toast(usados
      ? I18N.t('markers.catRemovedUsed', { name: cat.name, n: usados })
      : I18N.t('markers.catRemoved', { name: cat.name }));
  },

  // ---------- Interface ----------
  render() {
    const box = document.getElementById('cats-list');
    if (!box) return;
    const cats = this.lista();

    box.innerHTML = cats.length
      ? cats.map((c) => {
          const usados = (MapView.markersData.markers || []).filter((m) => m.type === c.id).length;
          return `
            <div class="cat-row" data-cat="${escapeHtml(c.id)}" style="--cat:${escapeHtml(c.color)}">
              <button class="cat-emoji-btn" data-cat-emoji="${escapeHtml(c.id)}"
                      title="${escapeHtml(I18N.t('markers.catEmoji'))}">${escapeHtml(c.emoji)}</button>
              <input class="cat-name-input" data-cat-name="${escapeHtml(c.id)}" maxlength="20"
                     value="${escapeHtml(c.name)}" />
              <input type="color" data-cat-color="${escapeHtml(c.id)}" value="${escapeHtml(c.color)}" />
              <span class="cat-used muted small">${escapeHtml(I18N.t('markers.catUsed', { n: usados }))}</span>
              <button class="btn-small danger" data-cat-del="${escapeHtml(c.id)}"
                      data-i18n="common.delete">${escapeHtml(I18N.t('common.delete'))}</button>
            </div>`;
        }).join('')
      : `<p class="muted small">${escapeHtml(I18N.t('markers.catsEmpty'))}</p>`;

    const form = document.getElementById('cats-new');
    const limite = document.getElementById('cats-limit');
    const cheio = this.cheio();
    if (form) form.classList.toggle('hidden', cheio);
    if (limite) {
      limite.textContent = cheio
        ? I18N.t('markers.catFull', { n: MapView.MAX_CATS })
        : I18N.t('markers.catLeft', { n: MapView.MAX_CATS - cats.length });
    }

    box.onclick = async (e) => {
      const del = e.target.closest('[data-cat-del]');
      const emo = e.target.closest('[data-cat-emoji]');
      if (del) { await this.excluir(del.dataset.catDel); return; }
      if (emo) { this.abrirEmojis((valor) => this.editar(emo.dataset.catEmoji, { emoji: valor })); }
    };
    box.onchange = async (e) => {
      const nome = e.target.closest('[data-cat-name]');
      const cor = e.target.closest('[data-cat-color]');
      if (nome) await this.editar(nome.dataset.catName, { name: nome.value.trim().slice(0, 20) || '' });
      if (cor) await this.editar(cor.dataset.catColor, { color: cor.value });
    };
  },

  // Grade de emojis. Um <input> de emoji puro não funciona: em
  // Windows o teclado de emoji é Win+. e muita gente não conhece.
  abrirEmojis(aoEscolher) {
    const grid = document.getElementById('cat-emoji-grid');
    if (!grid) return;
    grid.innerHTML = this.EMOJIS.map((e) =>
      `<button type="button" class="cat-emoji-opt" data-emo="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('');
    grid.classList.remove('hidden');
    grid.onclick = (ev) => {
      const b = ev.target.closest('[data-emo]');
      if (!b) return;
      grid.classList.add('hidden');
      aoEscolher(b.dataset.emo);
    };
  },

  abrir() {
    MapView.setCats(this.lista());
    this.render();
    document.getElementById('cat-emoji-grid').classList.add('hidden');
    showModal('modal-marker-cats');
  }
};

// ------------------------------------------------------------
// As camadas do mapa: as quatro fixas vivem no HTML, as suas são
// desenhadas aqui do lado. Mesmo visual, mesma barra.
// ------------------------------------------------------------
function renderLayerChips() {
  const box = document.getElementById('map-layers-cats');
  if (!box) return;
  box.innerHTML = MapView.customCats.map((c) => `
    <label class="layer-chip cat" style="--cat:${escapeHtml(c.color)}">
      <input type="checkbox" class="layer-toggle" data-layer="${escapeHtml(c.id)}"
             ${MapView.layers[c.id] === false ? '' : 'checked'} />
      <span class="lc-ico">${escapeHtml(c.emoji)}</span><span>${escapeHtml(c.name)}</span>
    </label>`).join('');
  // Os chips são recriados a cada mudança: o listener tem que ser
  // religado, e delegar no contêiner evita acumular handlers.
  box.onchange = (e) => {
    const cb = e.target.closest('.layer-toggle');
    if (!cb) return;
    MapView.layers[cb.dataset.layer] = cb.checked;
    MapView.draw();
  };
}

// Os <select> e as fileiras de chips que listam TIPO precisam
// ganhar as categorias novas. Um lugar só que os reescreve — antes
// bastava esquecer um para a categoria existir só pela metade.
function refreshTypeSelectors() {
  const tipos = MapView.allTypes();

  for (const sel of document.querySelectorAll('#mk-type-filter, #mk-retype-to')) {
    const anterior = sel.value;
    const todos = sel.id === 'mk-type-filter';
    sel.innerHTML =
      (todos ? `<option value="all">${escapeHtml(I18N.t('markers.allTypes'))}</option>` : '') +
      // `<option>` não aceita SVG dentro — o navegador desenha o
      // texto e nada mais. Então aqui vai só o emoji das categorias
      // suas (que É texto) e o rótulo; os tipos do app ficam com o
      // nome, que já diz tudo.
      tipos.map((t) => `<option value="${escapeHtml(t.value)}">${
        t.emoji ? escapeHtml(t.emoji) + ' ' : ''}${escapeHtml(t.label)}</option>`).join('');
    // Se o tipo selecionado sumiu (categoria apagada), volta ao topo
    // em vez de ficar com um value fantasma que não filtra nada.
    sel.value = [...sel.options].some((o) => o.value === anterior) ? anterior : sel.options[0].value;
  }

  const chips = document.getElementById('mkc-types');
  if (chips) {
    chips.innerHTML = tipos.map((t) => `
      <button class="type-chip" data-type="${escapeHtml(t.value)}" style="--cat:${escapeHtml(t.color)}">
        <span>${t.iconHtml}</span><span>${escapeHtml(t.label)}</span>
      </button>`).join('');
    // O listener de #mkc-types é delegado NO CONTÊINER (help.js), que
    // sobrevive a este innerHTML — por isso não religamos nada aqui.
  }
}

function initMarkerCats() {
  const modal = document.getElementById('modal-marker-cats');
  if (!modal) return;

  MapView.setCats(MarkerCats.lista());
  renderLayerChips();
  refreshTypeSelectors();

  document.getElementById('btn-marker-cats').addEventListener('click', () => {
    document.getElementById('map-menu').classList.add('hidden');
    MarkerCats.abrir();
  });
  document.getElementById('cats-close').addEventListener('click', () => hideModal('modal-marker-cats'));

  const emojiBtn = document.getElementById('cat-emoji');
  emojiBtn.addEventListener('click', () => {
    MarkerCats.abrirEmojis((v) => { emojiBtn.textContent = v; });
  });

  document.getElementById('cats-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('cat-name');
    const cor = document.getElementById('cat-color');
    const criada = await MarkerCats.criar(nome.value, emojiBtn.textContent.trim(), cor.value);
    if (criada) { nome.value = ''; emojiBtn.textContent = '⭐'; }
  });
}
