// ============================================================
// notes.js — Anotações e prints (renderer)
//
// Um componente só, usado em dois lugares diferentes:
//   - na aba "Notas" do servidor  -> escopo "server:<bmId>"
//   - no card de um marcador      -> escopo "marker:<Mapa>:<id>"
//
// É de propósito que seja o mesmo: as duas telas querem a mesma
// coisa (escrever um texto, grudar prints, achar depois), e manter
// duas versões disso significaria consertar todo bug duas vezes.
//
// Como se usa:
//   NotesPanel.mount(document.getElementById('x'), 'server:123');
//   NotesPanel.unmount(el);   // ao trocar de servidor
// ============================================================

const NotesPanel = {
  // el -> { scope, notes, filter, expanded:Set }
  mounted: new Map(),

  async mount(el, scope, opts = {}) {
    if (!el) return;
    this.mounted.set(el, {
      scope,
      notes: [],
      filter: '',
      expanded: new Set(),
      compact: !!opts.compact,
      // Filtro por TIPO. Fica no painel (e não numa variável global)
      // porque o mesmo componente é montado em dois lugares ao mesmo
      // tempo — a aba do servidor e o card de um marcador —, e um
      // filtro compartilhado faria mexer num mudar o outro.
      tipo: 'all',
      // Só a aba do SERVIDOR agrega as notas dos marcadores. No card
      // de um marcador isso seria circular (ele mostraria as suas
      // próprias notas duas vezes).
      podeAgregar: !opts.compact && String(scope).startsWith('server:'),
      incluirMarcadores: false,
      notasDeMarcador: [],
      // Quem montou o painel costuma ter um contador para atualizar
      // (o selo da aba, o "?" do card). Sem este gancho, o número
      // só corrigia na próxima troca de aba.
      onChange: opts.onChange || null
    });
    el.classList.add('notes-panel');
    if (opts.compact) el.classList.add('compact');
    this.renderShell(el);
    await this.reload(el);
  },

  unmount(el) {
    if (!el) return;
    this.mounted.delete(el);
    el.innerHTML = '';
  },

  state(el) { return this.mounted.get(el); },

  // Recarrega do disco. Chamado depois de qualquer gravação —
  // é barato (o índice é pequeno) e evita o estado da tela
  // divergir do arquivo, que é o bug clássico desse tipo de painel.
  async reload(el) {
    const st = this.state(el);
    if (!st) return;
    st.notes = (await window.api.notesList(st.scope)) || [];
    // As notas dos pontos do mapa vêm de outra consulta: cada uma
    // tem escopo próprio (marker:<Mapa>:<id>), então não há como
    // pegá-las na mesma chamada.
    st.notasDeMarcador = [];
    if (st.incluirMarcadores && typeof MapView !== 'undefined' && MapView.mapName) {
      const cru = (await window.api.notesListMarkers(MapView.mapName)) || [];
      st.notasDeMarcador = cru.map((n) => ({ ...n, deMarcador: idDoEscopo(n.scope) }));
    }
    this.renderList(el);
    if (st.onChange) st.onChange(st.notes);
  },

  renderShell(el) {
    const st = this.state(el);
    el.innerHTML = `
      <div class="notes-bar">
        <input type="text" class="notes-search list-search"
               placeholder="${escapeHtml(I18N.t('notes.search'))}" />
        <button class="btn-small primary notes-new">${Icon.svg('plus', 13)} <span>${escapeHtml(I18N.t('notes.new'))}</span></button>
      </div>
      <p class="muted small notes-hint">${escapeHtml(I18N.t('notes.hint'))}</p>
      <div class="tn-filters notes-filters"></div>
      ${st.podeAgregar ? `
        <label class="check notes-agg">
          <input type="checkbox" class="notes-include-marks" />
          <span>${escapeHtml(I18N.t('notes.includeMarkers'))}</span>
        </label>` : ''}
      <div class="notes-list"></div>`;

    const search = el.querySelector('.notes-search');
    search.addEventListener('input', () => { st.filter = search.value; this.renderList(el); });

    const filtros = el.querySelector('.notes-filters');
    if (filtros) {
      filtros.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tnf]');
        if (!b) return;
        st.tipo = b.dataset.tnf;
        this.renderList(el);
      });
    }
    el.querySelector('.notes-new').addEventListener('click', () => this.openEditor(el, null));

    const agg = el.querySelector('.notes-include-marks');
    if (agg) {
      agg.addEventListener('change', async () => {
        st.incluirMarcadores = agg.checked;
        await this.reload(el);
      });
    }
  },

  // Todas as notas que este painel mostra: as do escopo + (se
  // ligado) as dos marcadores do mapa atual, na mesma ordenação.
  todas(el) {
    const st = this.state(el);
    if (!st.incluirMarcadores || !st.notasDeMarcador.length) return st.notes;
    return [...st.notes, ...st.notasDeMarcador].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  },

  // A barra de tipos. Só aparece quando há mais de um tipo na
  // lista: num servidor onde a pessoa só escreve notas soltas, três
  // botões filtrando nada seriam enfeite ocupando espaço.
  renderFiltros(el) {
    const st = this.state(el);
    const box = el.querySelector('.notes-filters');
    if (!box) return;
    const todas = this.todas(el);
    const contas = { all: todas.length };
    for (const t of ['note', 'ficha', 'raid']) contas[t] = todas.filter((n) => (n.type || 'note') === t).length;

    const variedade = ['note', 'ficha', 'raid'].filter((t) => contas[t] > 0).length;
    box.classList.toggle('hidden', variedade < 2);
    if (variedade < 2) { st.tipo = 'all'; box.innerHTML = ''; return; }

    box.innerHTML = ['all', 'note', 'ficha', 'raid'].map((t) => `
      <button class="tn-f${st.tipo === t ? ' active' : ''}" data-tnf="${t}">
        ${t === 'all' ? escapeHtml(I18N.t('notes.filterAll'))
                      : Icon.svg(Dossier.tipoDe(t).icone, 12) + ' ' + escapeHtml(I18N.t(Dossier.tipoDe(t).chave))}
        <span class="tn-n">${contas[t]}</span>
      </button>`).join('');
  },

  filtered(el) {
    const st = this.state(el);
    const q = st.filter.trim().toLowerCase();
    let base = this.todas(el);
    if (st.tipo && st.tipo !== 'all') base = base.filter((n) => (n.type || 'note') === st.tipo);
    if (!q) return base;
    // Busca no texto SEM os tokens de menção: procurar pelo nome do
    // marcador tem que achar a anotação que o cita.
    return base.filter((n) =>
      String(n.title || '').toLowerCase().includes(q) ||
      textoLimpo(n.text).toLowerCase().includes(q) ||
      (n.markers || []).some((id) => {
        const m = acharMarcadorPorId(id);
        return m && String(m.name || '').toLowerCase().includes(q);
      }));
  },

  renderList(el) {
    const st = this.state(el);
    const box = el.querySelector('.notes-list');
    if (!box) return;
    this.renderFiltros(el);
    const rows = this.filtered(el);

    if (!rows.length) {
      box.innerHTML = `<p class="muted small notes-empty">${
        escapeHtml(I18N.t(this.todas(el).length ? 'notes.noMatch' : 'notes.empty'))}</p>`;
      return;
    }

    box.innerHTML = rows.map((n) => {
      const open = st.expanded.has(n.id);
      const shots = (n.shots || []).filter((s) => !s.missing);
      // Print que sumiu do disco (backup restaurado sem as imagens,
      // pasta mexida à mão). Some da grade, mas o aviso fica: um
      // print desaparecendo em silêncio é pior do que a falha.
      const lost = (n.shots || []).length - shots.length;
      const preview = textoLimpo(n.text).trim();
      // Nota que veio de um PONTO do mapa (agregada). O selo diz de
      // qual — sem ele a lista misturaria coisas sem explicar de
      // onde cada uma saiu.
      const dono = n.deMarcador ? acharMarcadorPorId(n.deMarcador) : null;
      const stDono = dono ? MapView.style(dono.type) : null;
      return `
        <article class="note-card${open ? ' open' : ''}${n.pinned ? ' pinned' : ''}${n.deMarcador ? ' from-marker' : ''}"
                 data-note="${escapeHtml(n.id)}"
                 style="${n.color ? `--note-accent:${escapeHtml(n.color)}` : ''}">
          <header class="note-head">
            <button class="note-pin" data-act="pin" title="${escapeHtml(I18N.t('notes.pin'))}">${Icon.svg(n.pinned ? 'pin' : 'dot', 14)}</button>
            ${(n.type && n.type !== 'note') ? `<span class="note-type t-${escapeHtml(n.type)}"
               title="${escapeHtml(I18N.t(Dossier.tipoDe(n.type).chave))}">${
               Icon.svg(n.type === 'ficha' ? (n.icon || 'user') : Dossier.tipoDe(n.type).icone, 13)}</span>` : ''}
            <h4 class="note-title">${escapeHtml(n.title || I18N.t('notes.untitled'))}</h4>
            ${n.deMarcador ? `<button class="note-origin" data-act="goto-owner"
                 style="--cat:${escapeHtml(stDono ? stDono.color : '#7a8b80')}"
                 title="${escapeHtml(I18N.t('notes.fromMarkerGo'))}">${
                   (dono ? MapView.iconHtml(dono.type, 12) : Icon.svg('question', 12)) + ' ' +
                   escapeHtml(dono ? (dono.name || I18N.t('map.markerDefault')) : I18N.t('notes.markGone'))
                 }</button>` : ''}
            ${shots.length ? `<span class="note-chip" title="${escapeHtml(I18N.t('notes.shotsCount', { n: shots.length }))}">${Icon.svg('image', 12)} ${shots.length}</span>` : ''}
            <time class="note-date">${formatNoteDate(n.updatedAt)}</time>
            <button class="note-toggle" data-act="toggle">${Icon.svg(open ? 'caretDown' : 'caretRight', 14)}</button>
          </header>
          ${open ? `
            <div class="note-body">
              ${n.type === 'ficha' && n.player ? `<p class="note-player">
                ${n.photo ? `<img class="np-foto" src="${escapeHtml(n.photo)}" alt=""
                     onerror="this.remove()" />` : Icon.svg('user', 12)}
                ${escapeHtml(n.player)}</p>` : ''}
              ${n.type === 'raid' && n.raid ? `<p class="note-raidline">${
                Icon.svg('bomb', 12)} ${escapeHtml(Dossier.resumoRaid(n.raid))}</p>` : ''}
              ${(n.links || []).length ? `<div class="nl-chips inline">${
                (n.links || []).map((l) => {
                  const outra = this.todas(el).find((x) => x.id === l.to);
                  const rel = Dossier.relDe(l.rel);
                  return `<span class="nl-chip" style="--rel:${escapeHtml(rel.cor)}">
                    <span class="nl-rel">${escapeHtml(I18N.t(rel.chave))}</span>
                    <span class="nl-name">${escapeHtml(outra ? (outra.title || I18N.t('notes.untitled')) : I18N.t('notes.linkGone'))}</span>
                  </span>`;
                }).join('')}</div>` : ''}
              ${String(n.text || '').trim()
                ? `<div class="note-text">${richTextToHtml(n.text)}</div>`
                : `<p class="muted small">${escapeHtml(I18N.t('notes.noText'))}</p>`}
              ${(n.markers || []).length ? `<div class="nm-chips inline">${
                (n.markers || []).map((id) => {
                  const m = acharMarcadorPorId(id);
                  const st2 = m ? MapView.style(m.type) : { color: '#7a8b80' };
                  const nome = m ? (m.name || I18N.t('map.markerDefault')) : I18N.t('notes.markGone');
                  return `<button type="button" class="nm-chip${m ? '' : ' gone'}"
                            style="--cat:${escapeHtml(st2.color)}" data-goto-mark="${escapeHtml(id)}"
                            ${m ? '' : 'disabled'}>
                            <span class="nm-ico">${m ? MapView.iconHtml(m.type, 12) : Icon.svg('question', 12)}</span>
                            <span class="nm-name">${escapeHtml(nome)}</span>
                          </button>`;
                }).join('')}</div>` : ''}
              ${shots.length ? `<div class="note-shots">${shots.map((s, i) => `
                <button class="note-shot" data-act="zoom" data-shot="${i}">
                  <img src="${escapeHtml(s.url)}" alt="" loading="lazy"
                       onerror="this.closest('.note-shot').classList.add('broken')" />
                </button>`).join('')}</div>` : ''}
              ${lost > 0 ? `<p class="note-lost small">${Icon.svg('warning', 12)} ${escapeHtml(I18N.t('notes.lostShots', { n: lost }))}</p>` : ''}
              <div class="note-actions">
                <button class="btn-small" data-act="edit">${escapeHtml(I18N.t('common.edit'))}</button>
                <!-- Compartilhar só aparece com grupo: um botão que
                     sempre responde "você não tem grupo" é um botão
                     que não devia estar ali. -->
                ${(typeof currentGroup === 'function' && currentGroup())
                  ? `<button class="btn-small" data-act="share">${
                      Icon.svg('users', 12)} ${escapeHtml(I18N.t('team.shareNote'))}</button>` : ''}
                <button class="btn-small danger" data-act="delete">${escapeHtml(I18N.t('common.delete'))}</button>
              </div>
            </div>`
          : (preview ? `<p class="note-preview">${escapeHtml(preview.slice(0, 160))}${preview.length > 160 ? '…' : ''}</p>` : '')}
        </article>`;
    }).join('');

    // Um handler só, delegado. Cada card é reconstruído a cada
    // render; pendurar listener em cada botão vazaria memória.
    box.onclick = async (e) => {
      // Chip/menção: pula para o ponto no mapa. Vem antes do resto
      // porque o chip vive DENTRO do card e o closest pegaria os dois.
      const salto = e.target.closest('[data-goto-mark]');
      if (salto) { irParaMarcadorPorId(salto.dataset.gotoMark); return; }

      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('[data-note]');
      if (!btn || !card) return;
      const id = card.dataset.note;
      const note = this.todas(el).find((n) => n.id === id);
      if (!note) return;

      switch (btn.dataset.act) {
        case 'goto-owner':
          irParaMarcadorPorId(note.deMarcador);
          break;
        case 'toggle':
          if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id);
          this.renderList(el);
          break;
        case 'pin':
          await window.api.noteSave({ ...note, shots: note.shots.map((s) => s.id), pinned: !note.pinned });
          await this.reload(el);
          break;
        case 'share':
          if (typeof shareNoteWithTeam === 'function') await shareNoteWithTeam(note);
          break;
        case 'edit':
          // Uma nota agregada pertence ao marcador, não ao servidor:
          // salvar com o escopo do painel a arrancaria do ponto.
          this.openEditor(el, note, note.scope);
          break;
        case 'delete':
          if (!await Ask.confirm(I18N.t('notes.confirmDelete', { title: note.title || I18N.t('notes.untitled') }))) return;
          await window.api.noteDelete(id);
          st.expanded.delete(id);
          await this.reload(el);
          toast(I18N.t('notes.deleted'));
          break;
        case 'zoom':
          openShotLightbox(note.shots.filter((s) => !s.missing), Number(btn.dataset.shot));
          break;
      }
    };
  },

  // ---------- Editor ----------
  // Um modal só para o app inteiro; o painel que abriu fica
  // guardado em NoteEditor.owner para saber quem recarregar.
  openEditor(el, note, escopo) {
    NoteEditor.open(escopo || this.state(el).scope, note, () => this.reload(el));
  }
};

// ============================================================
// Editor de anotação (modal único, compartilhado)
// ============================================================
const NoteEditor = {
  scope: null,
  note: null,
  shots: [],
  markers: [],      // ids de marcador citados por esta anotação
  onSaved: null,

  // ---- tipos ----
  // O editor é o mesmo para os três tipos, e isso é a decisão
  // inteira: título, texto e prints valem para nota, ficha e plano
  // de raid igualmente. O tipo só ACRESCENTA campos.
  //
  // Escrever três editores separados teria dado três lugares para
  // consertar o mesmo bug de print colado, e três caminhos por
  // onde o texto pode se perder.
  tipo: 'note',
  player: '',
  icone: null,
  foto: '',
  raid: null,
  links: [],
  // O adaptador (ver dossier.js). `null` = anotação do disco, que é
  // o caso de sempre; o time passa o dele.
  adaptador: null,

  open(scope, note, onSaved, opts = {}) {
    this.scope = scope;
    this.note = note;
    this.onSaved = onSaved;
    this.adaptador = opts.adaptador || null;
    this.shots = note ? (note.shots || []).filter((s) => !s.missing).map((s) => ({ ...s })) : [];
    this.markers = note ? [...(note.markers || [])] : [];
    // Tipo TRAVADO: alguns lugares só escrevem um tipo (a aba de
    // Novidades do time, por exemplo). Nesses, o seletor some — três
    // botões que não fazem nada seria pior do que não ter seletor.
    this.tipoFixo = opts.tipoFixo || (opts.adaptador && opts.adaptador.tipoFixo) || null;
    this.tipo = this.tipoFixo || (note && note.type) || opts.tipo || 'note';
    this.player = (note && note.player) || opts.player || '';
    this.icone = (note && note.icon) || null;
    this.foto = (note && note.photo) || '';
    this.raid = (note && note.raid) || null;
    this.links = note ? [...(note.links || [])] : [];

    document.getElementById('note-title').value = note ? (note.title || '') : '';
    document.getElementById('note-text').value = note ? (note.text || '') : '';
    document.getElementById('note-pinned').checked = note ? !!note.pinned : false;
    document.getElementById('note-color').value = (note && note.color) || '#6ee06e';
    document.getElementById('note-color-on').checked = !!(note && note.color);
    document.getElementById('note-modal-title').textContent =
      I18N.t(note ? 'notes.editTitle' : 'notes.newTitle');

    this.renderShots();
    this.renderMarks();
    this.renderTipo();
    this.renderRaid();
    this.renderLinks();
    document.getElementById('note-mark-picker').classList.add('hidden');
    showModal('modal-note');
    setTimeout(() => document.getElementById('note-title').focus(), 30);
  },

  // ---------- Tipo ----------
  renderTipo() {
    const barra = document.getElementById('note-types');
    if (barra) barra.classList.toggle('hidden', !!this.tipoFixo);
    // Ligações e marcadores citados também não fazem sentido numa
    // novidade: ela é um aviso datado, não um nó de investigação.
    const soTexto = this.tipoFixo === 'news';
    const cxLinks = document.getElementById('note-links-box');
    if (cxLinks) cxLinks.classList.toggle('hidden', soTexto);
    const cxMarks = document.getElementById('note-marks');
    if (cxMarks && soTexto) cxMarks.classList.add('hidden');

    for (const b of document.querySelectorAll('#note-types .ntype')) {
      b.classList.toggle('active', b.dataset.ntype === this.tipo);
    }
    const ficha = this.tipo === 'ficha';
    document.getElementById('note-ficha-box').classList.toggle('hidden', !ficha);
    document.getElementById('note-raid-box').classList.toggle('hidden', this.tipo !== 'raid');

    if (ficha) {
      document.getElementById('note-player').value = this.player || '';
      const campoFoto = document.getElementById('note-photo');
      if (campoFoto) campoFoto.value = this.foto || '';
      this.renderFoto();
      this.renderNomesDaLista();
      this.renderIcones();
    }
  },

  // A prévia da foto do dossiê. Mesma função de avatar do time —
  // e é de propósito: link morto cai de volta no ícone escolhido,
  // em vez de deixar um quadrado vazio.
  renderFoto() {
    const alvo = document.getElementById('note-photo-preview');
    if (!alvo || typeof pintarAvatar !== 'function') return;
    const url = (document.getElementById('note-photo') || {}).value || this.foto || '';
    pintarAvatar(alvo, url.trim(), this.player || '?');
    // Sem foto, o que aparece é o ÍCONE escolhido, não a inicial:
    // o ícone é a identidade visual da ficha na mesa e na lista.
    if (!alvo.querySelector('img')) {
      alvo.innerHTML = Icon.svg(this.icone || 'user', 20);
    }
  },

  // A lista de quem está online agora vira sugestão do campo. É o
  // atalho que faz a ficha valer a pena no meio de uma partida:
  // você vê o nome na lista, abre a ficha e ele já está ali para
  // escolher — sem digitar um nome com acento e caractere estranho
  // que, digitado errado, cria uma ficha que nunca casa com
  // ninguém.
  renderNomesDaLista() {
    const dl = document.getElementById('note-player-list');
    if (!dl) return;
    const nomes = (typeof AppState !== 'undefined' && AppState.players)
      ? AppState.players.map((p) => p.name).filter(Boolean) : [];
    dl.innerHTML = [...new Set(nomes)].slice(0, 100)
      .map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  },

  renderIcones() {
    const row = document.getElementById('note-icon-row');
    if (!row) return;
    row.innerHTML = Dossier.ICONES_FICHA.map((ic) => `
      <button type="button" class="nf-ico${ic === (this.icone || 'user') ? ' active' : ''}"
              data-ico="${escapeHtml(ic)}" title="${escapeHtml(ic)}">${Icon.svg(ic, 16)}</button>`).join('');
    row.onclick = (e) => {
      const b = e.target.closest('[data-ico]');
      if (!b) return;
      this.icone = b.dataset.ico;
      this.renderIcones();
      this.renderFoto();
    };
  },

  // ---------- Plano de raid ----------
  //
  // Pega o plano que está montado na aba Raid e guarda o
  // RESULTADO. Não recalcula ao abrir: o plano é uma decisão
  // tomada num momento, e recalcular faria o time combinar uma
  // coisa e ler outra quando o catálogo do jogo mudasse.
  renderRaid() {
    const corpo = document.getElementById('note-raid-body');
    const vazio = document.getElementById('note-raid-empty');
    const limpar = document.getElementById('note-raid-clear');
    if (!corpo) return;

    const tem = !!(this.raid && (this.raid.lines || []).length);
    vazio.classList.toggle('hidden', tem);
    limpar.classList.toggle('hidden', !tem);
    if (!tem) { corpo.innerHTML = ''; return; }

    corpo.innerHTML = `
      <ul class="nr-lines">
        ${this.raid.lines.map((l) => `<li>${escapeHtml(l.name)} <b>×${Number(l.qty) || 1}</b></li>`).join('')}
      </ul>
      <ul class="nr-buys">
        ${(this.raid.buys || []).map((c) => `
          <li><span class="nr-tool">${escapeHtml(c.name)}</span>
              <span class="nr-qty">×${Number(c.units) || 0}</span></li>`).join('')}
      </ul>
      ${this.raid.note ? `<p class="muted small">${escapeHtml(this.raid.note)}</p>` : ''}`;
  },

  // Lê o plano da aba Raid. Se não houver plano montado, DIZ isso —
  // um botão que não faz nada é indistinguível de um botão
  // quebrado.
  pegarDaCalculadora() {
    if (typeof Raid === 'undefined' || !Raid.plano) {
      toast(I18N.t('notes.raidNoPlan'));
      return;
    }
    const p = Raid.plano;
    this.raid = {
      lines: (p.linhas || []).map((l) => ({
        name: (l.alvo && l.alvo.name) || '?', qty: l.qtd || 1
      })),
      buys: (p.compras || []).map((c) => ({
        name: (c.ferramenta && c.ferramenta.name) || '?', units: c.unidades || 0
      })),
      total: p.total != null ? p.total : null,
      note: p.aviso || null
    };
    // Título vazio ganha um resumo do plano: uma nota de raid sem
    // título vira "Sem título" na lista, que não ajuda ninguém a
    // achar o plano da porta de metal duas semanas depois.
    const campo = document.getElementById('note-title');
    if (!campo.value.trim() && this.raid.lines.length) {
      campo.value = this.raid.lines.map((l) => `${l.name} ×${l.qty}`).join(', ').slice(0, 110);
    }
    this.renderRaid();
  },

  // ---------- Ligações ----------
  renderLinks() {
    const chips = document.getElementById('note-link-chips');
    const vazio = document.getElementById('note-link-empty');
    const semSalvar = document.getElementById('note-link-nosave');
    const add = document.getElementById('note-link-add');
    if (!chips) return;

    // Ligar exige os DOIS lados existindo — a ligação é simétrica e
    // gravada nos dois. Numa anotação que ainda não foi salva não
    // existe id para o outro lado apontar.
    const salva = !!(this.note && this.note.id);
    semSalvar.classList.toggle('hidden', salva);
    add.classList.toggle('hidden', !salva);

    vazio.classList.toggle('hidden', !salva || this.links.length > 0);

    chips.innerHTML = this.links.map((l) => {
      const outra = (NoteEditor.vizinhas || []).find((n) => n.id === l.to);
      const rel = Dossier.relDe(l.rel);
      return `
        <span class="nl-chip" style="--rel:${escapeHtml(rel.cor)}" data-to="${escapeHtml(l.to)}">
          <span class="nl-rel">${escapeHtml(I18N.t(rel.chave))}</span>
          <span class="nl-name">${escapeHtml(outra ? (outra.title || I18N.t('notes.untitled')) : I18N.t('notes.linkGone'))}</span>
          <button type="button" class="nl-x" data-unlink="${escapeHtml(l.to)}"
                  title="${escapeHtml(I18N.t('notes.linkRemove'))}">${Icon.svg('close', 11)}</button>
        </span>`;
    }).join('');

    chips.onclick = async (e) => {
      const x = e.target.closest('[data-unlink]');
      if (!x) return;
      await this.desligar(x.dataset.unlink);
    };
  },

  adaptadorAtual() {
    return this.adaptador || Dossier.local(this.scope);
  },

  async carregarVizinhas() {
    const ad = this.adaptadorAtual();
    NoteEditor.vizinhas = (await ad.listar()).filter((n) => !this.note || n.id !== this.note.id);
    return NoteEditor.vizinhas;
  },

  async abrirLigar() {
    if (!this.note || !this.note.id) return;
    const vizinhas = await this.carregarVizinhas();
    if (!vizinhas.length) { toast(I18N.t('notes.linkNoOthers')); return; }

    const jaLigadas = new Set(this.links.map((l) => l.to));
    const alvo = await Ask.pick(I18N.t('notes.linkPick'),
      vizinhas.map((n) => ({
        valor: n.id,
        texto: (n.title || I18N.t('notes.untitled')) + (jaLigadas.has(n.id) ? ' ✓' : ''),
        sub: I18N.t(Dossier.tipoDe(n.type).chave) + (n.player ? ' · ' + n.player : '')
      })));
    if (!alvo) return;

    const rel = await Ask.pick(I18N.t('notes.linkRel'),
      Object.keys(Dossier.RELS).map((k) => ({
        valor: k, texto: I18N.t(Dossier.RELS[k].chave), sub: I18N.t('notes.rel_' + k + '_sub')
      })));
    if (!rel) return;

    const r = await this.adaptadorAtual().ligar(this.note.id, alvo, rel);
    if (!r || r.ok === false) { toast(I18N.t('notes.linkFailed')); return; }
    this.links = this.links.filter((l) => l.to !== alvo);
    this.links.push({ to: alvo, rel });
    this.renderLinks();
    if (this.onSaved) await this.onSaved();
  },

  async desligar(id) {
    if (!this.note || !this.note.id) return;
    await this.adaptadorAtual().desligar(this.note.id, id);
    this.links = this.links.filter((l) => l.to !== id);
    this.renderLinks();
    if (this.onSaved) await this.onSaved();
  },

  // ---------- Marcadores citados ----------
  //
  // O bloco fica escondido quando não há mapa carregado: citar um
  // ponto de um mapa que o app não abriu não significa nada, e um
  // botão que só dá erro é pior do que botão nenhum.
  //
  // Citar faz DUAS coisas de propósito: guarda o id na anotação
  // (para o chip, o filtro e o pulo para o mapa) e escreve um
  // "@Nome" no texto onde o cursor está. Só a lista faria o texto
  // ficar mudo ("a base" — qual base?); só o texto faria a citação
  // ser impossível de achar depois.
  renderMarks() {
    const box = document.getElementById('note-marks');
    if (!box) return;
    const temMapa = !!(typeof MapView !== 'undefined' && MapView.mapName);
    box.classList.toggle('hidden', !temMapa);
    if (!temMapa) return;

    const chips = document.getElementById('note-mark-chips');
    const vazio = document.getElementById('note-mark-empty');
    const lista = this.markers.map((id) => ({ id, m: acharMarcadorPorId(id) }));

    vazio.classList.toggle('hidden', lista.length > 0);
    chips.innerHTML = lista.map(({ id, m }) => {
      const st = m ? MapView.style(m.type) : { color: '#7a8b80' };
      // Marcador apagado: interrogação, porque a nota continua
      // apontando para alguma coisa que não existe mais e sumir
      // com o chip esconderia o problema.
      const ico = m ? MapView.iconHtml(m.type, 13) : Icon.svg('question', 13);
      const nome = m ? (m.name || I18N.t('map.markerDefault')) : I18N.t('notes.markGone');
      return `<span class="nm-chip${m ? '' : ' gone'}" style="--cat:${escapeHtml(st.color)}">
        <span class="nm-ico">${ico}</span>
        <span class="nm-name">${escapeHtml(nome)}</span>
        <button type="button" class="nm-x" data-mark-del="${escapeHtml(id)}"
                title="${escapeHtml(I18N.t('notes.markRemove'))}">${Icon.svg('close', 11)}</button>
      </span>`;
    }).join('');

    chips.onclick = (e) => {
      const del = e.target.closest('[data-mark-del]');
      if (!del) return;
      this.markers = this.markers.filter((id) => id !== del.dataset.markDel);
      this.renderMarks();
    };
  },

  abrirSeletor() {
    const box = document.getElementById('note-mark-picker');
    const busca = document.getElementById('note-mark-search');
    box.classList.toggle('hidden');
    if (box.classList.contains('hidden')) return;
    busca.value = '';
    this.renderResultados('');
    setTimeout(() => busca.focus(), 30);
  },

  renderResultados(q) {
    const cx = document.getElementById('note-mark-results');
    const termo = String(q || '').trim().toLowerCase();
    const todos = (MapView.markersData && MapView.markersData.markers) || [];
    const achados = todos
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.id && !this.markers.includes(m.id))
      .filter(({ m }) => !termo || String(m.name || '').toLowerCase().includes(termo))
      .slice(0, 40);

    if (!achados.length) {
      cx.innerHTML = `<p class="muted small">${escapeHtml(I18N.t(todos.length ? 'list.noMatch' : 'markers.empty'))}</p>`;
      return;
    }
    cx.innerHTML = achados.map(({ m }) => {
      const st = MapView.style(m.type);
      return `<button type="button" class="nm-result" data-mark-add="${escapeHtml(m.id)}">
        <span class="nm-ico" style="color:${escapeHtml(st.color)}">${MapView.iconHtml(m.type, 13)}</span>
        <span class="nm-name">${escapeHtml(m.name || I18N.t('map.markerDefault'))}</span>
        <span class="nm-type muted small">${escapeHtml(MapView.typeLabel(m.type))}</span>
        <span class="nm-xy muted small">${m.x}, ${m.z}</span>
      </button>`;
    }).join('');
    cx.onclick = (e) => {
      const b = e.target.closest('[data-mark-add]');
      if (!b) return;
      this.citar(b.dataset.markAdd);
    };
  },

  citar(id) {
    const m = acharMarcadorPorId(id);
    if (!m) return;
    if (!this.markers.includes(id)) this.markers.push(id);
    inserirMencaoNoTexto(m);
    this.renderMarks();
    this.renderResultados(document.getElementById('note-mark-search').value);
  },

  renderShots() {
    const box = document.getElementById('note-shots');
    const empty = document.getElementById('note-shots-empty');
    empty.classList.toggle('hidden', this.shots.length > 0);
    box.innerHTML = this.shots.map((s, i) => `
      <div class="shot-thumb">
        <img src="${escapeHtml(s.url)}" alt="" onerror="this.parentElement.classList.add('broken')" />
        <button class="shot-del" data-shot-del="${i}" title="${escapeHtml(I18N.t('notes.removeShot'))}">${Icon.svg('close', 12)}</button>
        <button class="shot-zoom" data-shot-zoom="${i}" title="${escapeHtml(I18N.t('notes.viewShot'))}">${Icon.svg('search', 12)}</button>
      </div>`).join('');

    box.onclick = (e) => {
      const del = e.target.closest('[data-shot-del]');
      const zoom = e.target.closest('[data-shot-zoom]');
      if (del) {
        // Só desliga da anotação. O arquivo em disco só some quando
        // você salva — assim dá para desistir fechando o modal.
        this.shots.splice(Number(del.dataset.shotDel), 1);
        this.renderShots();
      } else if (zoom) {
        openShotLightbox(this.shots, Number(zoom.dataset.shotZoom));
      }
    };
  },

  async addFromFiles() {
    const added = (await window.api.shotsPick()) || [];
    if (!added.length) return;
    this.shots.push(...added);
    this.renderShots();
    toast(I18N.t('notes.shotsAdded', { n: added.length }));
  },

  async addFromClipboard() {
    const s = await window.api.shotFromClipboard();
    if (!s) { toast(I18N.t('notes.clipboardEmpty')); return; }
    this.shots.push(s);
    this.renderShots();
    toast(I18N.t('notes.shotsAdded', { n: 1 }));
  },

  async save() {
    const title = document.getElementById('note-title').value.trim();
    const text = document.getElementById('note-text').value;
    const player = this.tipo === 'ficha'
      ? document.getElementById('note-player').value.trim() : '';

    // Uma ficha SEM jogador não é uma ficha: é uma nota com um
    // ícone. E ela nunca casaria com nome nenhum na lista, então
    // ficaria invisível justamente onde deveria aparecer.
    if (this.tipoFixo === 'news' && !title) {
      toast(I18N.t('team.newsNeedTitle'));
      document.getElementById('note-title').focus();
      return;
    }
    const fotoDigitada = ((document.getElementById('note-photo') || {}).value || '').trim();
    if (this.tipo === 'ficha' && fotoDigitada && !/^https?:\/\//i.test(fotoDigitada)) {
      toast(I18N.t('team.badPhoto'));
      document.getElementById('note-photo').focus();
      return;
    }
    if (this.tipo === 'ficha' && !player) {
      toast(I18N.t('notes.fichaNeedPlayer'));
      document.getElementById('note-player').focus();
      return;
    }
    if (!title && !text.trim() && !this.shots.length && !this.markers.length
        && !player && !this.raid) {
      toast(I18N.t('notes.needSomething'));
      return;
    }
    const useColor = document.getElementById('note-color-on').checked;
    const comum = {
      id: this.note ? this.note.id : null,
      type: this.tipo,
      title: title || player,
      text,
      icon: this.tipo === 'ficha' ? (this.icone || 'user') : null,
      photo: this.tipo === 'ficha'
        ? ((document.getElementById('note-photo') || {}).value || '').trim() || null
        : null,
      player: player || null,
      raid: this.tipo === 'raid' ? this.raid : null,
      pinned: document.getElementById('note-pinned').checked,
      color: useColor ? document.getElementById('note-color').value : null,
      shots: this.shots.map((s) => s.id),
      shotCount: this.shots.length
    };

    // Com adaptador, quem grava é ele (é assim que a mesma tela
    // escreve no disco e no time). Sem adaptador, o caminho de
    // sempre — inclusive os marcadores citados, que só existem em
    // anotação de servidor.
    if (this.adaptador) {
      const r = await this.adaptador.salvar({ ...comum, bruto: this.note });
      if (r && r.ok === false) {
        toast(typeof erroTime === 'function' ? erroTime(r) : I18N.t('notes.saveFailed'));
        return;
      }
    } else {
      await window.api.noteSave({
        ...comum,
        scope: this.scope,
        markers: this.markers,
        markerMap: (typeof MapView !== 'undefined' && MapView.mapName) || null
      });
    }
    hideModal('modal-note');
    toast(I18N.t('notes.saved'));
    if (this.onSaved) await this.onSaved();
  }
};

// ============================================================
// Lightbox — ver o print grande
// ============================================================
const ShotLightbox = { shots: [], index: 0 };

function openShotLightbox(shots, index = 0) {
  if (!shots || !shots.length) return;
  ShotLightbox.shots = shots;
  ShotLightbox.index = Math.max(0, Math.min(index, shots.length - 1));
  renderShotLightbox();
  showModal('modal-shot');
}

function renderShotLightbox() {
  const s = ShotLightbox.shots[ShotLightbox.index];
  if (!s) return;
  const img = document.getElementById('shot-img');
  img.src = s.url;
  document.getElementById('shot-count').textContent =
    `${ShotLightbox.index + 1} / ${ShotLightbox.shots.length}`;
  document.getElementById('shot-size').textContent =
    s.bytes ? formatBytes(s.bytes) : '';
  const multi = ShotLightbox.shots.length > 1;
  document.getElementById('shot-prev').classList.toggle('hidden', !multi);
  document.getElementById('shot-next').classList.toggle('hidden', !multi);
}

function shotStep(d) {
  const n = ShotLightbox.shots.length;
  if (!n) return;
  ShotLightbox.index = (ShotLightbox.index + d + n) % n;
  renderShotLightbox();
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function formatNoteDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(I18N.lang, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ============================================================
// Menções a marcador dentro do texto
//
// Formato guardado no texto: @[Nome](mk:mk_ab12cd)
//
// O NOME fica no token só como plano B. Quem manda é o id: assim,
// renomear o marcador atualiza a menção sozinha, em vez de deixar
// o texto falando de um nome que não existe mais. Se o marcador
// tiver sido apagado, aí sim cai no nome congelado do token — é
// melhor ler "Base do Zé (apagado)" do que um id cru.
// ============================================================
const MENCAO_RE = /@\[([^\]]*)\]\(mk:(mk_[a-z0-9_]+)\)/gi;

// "marker:Russia:mk_ab12" -> "mk_ab12". O nome do mapa pode conter
// ':' (mapa de Workshop com nome esquisito), então pegamos o ÚLTIMO
// segmento em vez de dividir e confiar no índice 2.
function idDoEscopo(scope) {
  const partes = String(scope || '').split(':');
  return partes.length > 2 ? partes[partes.length - 1] : null;
}

// Fecha o que estiver na frente, centraliza o mapa no ponto e abre
// o card dele. É o mesmo caminho do 🎯 da tabela de marcadores.
function irParaMarcadorPorId(id) {
  if (!id) return;
  const todos = (MapView.markersData && MapView.markersData.markers) || [];
  const index = todos.findIndex((m) => m.id === id);
  if (index < 0) { toast(I18N.t('notes.markGone')); return; }
  for (const m of ['modal-note', 'modal-marker', 'modal-markers']) {
    const el = document.getElementById(m);
    if (el && !el.classList.contains('hidden')) hideModal(m);
  }
  if (typeof centerMapOnMarker === 'function') centerMapOnMarker(index);
  if (typeof openMarkerCard === 'function') openMarkerCard(index);
}

function acharMarcadorPorId(id) {
  if (typeof MapView === 'undefined') return null;
  return ((MapView.markersData && MapView.markersData.markers) || []).find((m) => m.id === id) || null;
}

// Escreve "@Nome" na posição do cursor do textarea. Fora do
// textarea (foco em outro campo) vai para o fim do texto.
function inserirMencaoNoTexto(m) {
  const ta = document.getElementById('note-text');
  if (!ta) return;
  const token = `@[${String(m.name || '').replace(/[\[\]()]/g, '')}](mk:${m.id})`;
  const ini = ta.selectionStart, fim = ta.selectionEnd;
  const usarCursor = document.activeElement === ta && ini != null;
  const antes = usarCursor ? ta.value.slice(0, ini) : ta.value;
  const depois = usarCursor ? ta.value.slice(fim) : '';
  // Um espaço antes só quando não há: colar "@X" grudado na
  // palavra anterior produz "posto@X", que não se lê.
  const cola = antes && !/\s$/.test(antes) ? ' ' : '';
  ta.value = antes + cola + token + (depois && !/^\s/.test(depois) ? ' ' : '') + depois;
  const pos = (antes + cola + token).length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

// Troca os tokens por chips clicáveis DEPOIS do rich text. O
// RichText escapa < e &, mas não mexe em colchetes nem parênteses,
// então o token chega aqui intacto.
function mencoesParaChips(html) {
  return String(html).replace(MENCAO_RE, (_todo, nomeCru, id) => {
    const m = acharMarcadorPorId(id);
    const st = m && typeof MapView !== 'undefined' ? MapView.style(m.type) : { color: '#7a8b80' };
    const ico = (m && typeof MapView !== 'undefined')
      ? MapView.iconHtml(m.type, 12) : Icon.svg('question', 12);
    // `nomeCru` já passou pelo escape do RichText; o nome vivo, não.
    const nome = m ? escapeHtml(m.name || I18N.t('map.markerDefault')) : nomeCru;
    const cls = m ? 'nm-inline' : 'nm-inline gone';
    const titulo = m ? I18N.t('notes.markGo', { x: m.x, z: m.z }) : I18N.t('notes.markGone');
    return `<button type="button" class="${cls}" data-goto-mark="${escapeHtml(id)}"
              style="--cat:${escapeHtml(st.color)}" title="${escapeHtml(titulo)}"
              ${m ? '' : 'disabled'}>${ico} ${nome}</button>`;
  });
}

// O texto da anotação aceita o mesmo rich text do jogo (<color>,
// <b>, <size>) — quem anota preço de loja cola direto do servidor.
function richTextToHtml(text) {
  const base = (typeof RichText !== 'undefined' && RichText.toHtml)
    ? RichText.toHtml(text)
    : escapeHtml(text).replace(/\n/g, '<br>');
  return mencoesParaChips(base);
}

// Texto sem os tokens, para prévia e busca. Sem isto, procurar
// "base" acharia a anotação, mas a prévia mostraria "@[Base](mk:
// mk_9f...)" — ilegível.
function textoLimpo(text) {
  return String(text || '').replace(MENCAO_RE, (_t, nome, id) => {
    const m = acharMarcadorPorId(id);
    return '@' + ((m && m.name) || nome || '');
  });
}

function initNotes() {
  const modal = document.getElementById('modal-note');
  if (!modal) return;

  document.getElementById('note-save').addEventListener('click', () => NoteEditor.save());
  document.getElementById('note-cancel').addEventListener('click', () => hideModal('modal-note'));
  document.getElementById('note-add-file').addEventListener('click', () => NoteEditor.addFromFiles());
  document.getElementById('note-add-clip').addEventListener('click', () => NoteEditor.addFromClipboard());
  document.getElementById('note-mark-add').addEventListener('click', () => NoteEditor.abrirSeletor());

  // ---- tipo, plano de raid e ligações ----
  const tipos = document.getElementById('note-types');
  if (tipos) {
    tipos.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ntype]');
      if (!b) return;
      NoteEditor.tipo = b.dataset.ntype;
      NoteEditor.renderTipo();
    });
  }
  const campoFoto = document.getElementById('note-photo');
  if (campoFoto) campoFoto.addEventListener('input', () => NoteEditor.renderFoto());
  const campoJogador = document.getElementById('note-player');
  if (campoJogador) campoJogador.addEventListener('input', () => NoteEditor.renderFoto());

  const pull = document.getElementById('note-raid-pull');
  if (pull) pull.addEventListener('click', () => NoteEditor.pegarDaCalculadora());
  const limpar = document.getElementById('note-raid-clear');
  if (limpar) limpar.addEventListener('click', () => { NoteEditor.raid = null; NoteEditor.renderRaid(); });
  const ligar = document.getElementById('note-link-add');
  if (ligar) ligar.addEventListener('click', () => NoteEditor.abrirLigar());
  document.getElementById('note-mark-search').addEventListener('input', (e) => {
    NoteEditor.renderResultados(e.target.value);
  });
  document.getElementById('note-open-game').addEventListener('click', async () => {
    const ok = await window.api.openGameScreenshots();
    if (!ok) toast(I18N.t('notes.gameFolderMissing'));
  });

  // Ctrl+V com o editor aberto cola o print direto. É o caminho
  // mais curto entre "apertei PrintScreen" e "está salvo".
  modal.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    const reader = new FileReader();
    reader.onload = async () => {
      const s = await window.api.shotFromDataUrl(reader.result);
      if (s) { NoteEditor.shots.push(s); NoteEditor.renderShots(); toast(I18N.t('notes.shotsAdded', { n: 1 })); }
    };
    reader.readAsDataURL(file);
  });

  // Arrastar uma imagem de qualquer lugar para dentro do editor.
  const drop = document.getElementById('note-drop');
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      for (const file of [...(e.dataTransfer?.files || [])]) {
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await new Promise((res) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file);
        });
        const s = await window.api.shotFromDataUrl(dataUrl);
        if (s) NoteEditor.shots.push(s);
      }
      NoteEditor.renderShots();
    });
  }

  document.getElementById('shot-prev').addEventListener('click', () => shotStep(-1));
  document.getElementById('shot-next').addEventListener('click', () => shotStep(1));
  document.getElementById('shot-close').addEventListener('click', () => hideModal('modal-shot'));

  // Setas navegam entre os prints quando o lightbox está aberto.
  document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('modal-shot');
    if (!lb || lb.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') shotStep(-1);
    if (e.key === 'ArrowRight') shotStep(1);
  });
}
