// ============================================================
// teamNotes.js — a aba NOTAS do time
//
// É a lista de anotações compartilhadas, com os mesmos três tipos
// da aba do servidor (nota, ficha, plano de raid). O que muda em
// relação ao disco é o que o time acrescenta: autor, permissão para
// apagar, escopo por servidor vinculado e comentários.
//
// O cartão, o editor, as ligações e a mesa são os MESMOS do
// servidor — vêm do adaptador em dossier.js. Aqui só existe a
// lista e o que é específico do time.
//
// ------------------------------------------------------------
// POR QUE ISTO SUBSTITUIU A ABA "COMPARTILHADO"
// ------------------------------------------------------------
// A aba antiga era uma coluna com tudo misturado: marcador, nota e
// print na mesma pilha, sem tipo, sem filtro, ordenada só por data.
// A Sara pediu para desligá-la e focar em chat e notas — e o que
// ela pediu no lugar (tipos, ligações, mesa) não cabia naquela
// coluna.
//
// O que NÃO se perdeu: o mapa do time e "onde cada um está"
// continuam existindo, na aba Mapa. Eles moravam na mesma aba
// desligada, e levá-los junto teria sido apagar recurso que
// funciona por causa de um pedido que não falava deles.
// ============================================================

const TeamNotes = {
  filtro: 'all',    // all | note | ficha | raid
  busca: ''
};

function renderTeamNotes(g) {
  const box = document.getElementById('team-notes');
  if (!box) return;
  if (!g) { box.innerHTML = ''; return; }

  const ad = Dossier.time(g.id);
  const todos = (Team.items || [])
    .filter((it) => it.kind === 'note' && it.data && it.data.type !== 'news')
    .map((it) => cartaoDoItem(it));

  const q = TeamNotes.busca.trim().toLowerCase();
  const lista = todos
    .filter((c) => TeamNotes.filtro === 'all' || c.type === TeamNotes.filtro)
    .filter((c) => !q ||
      String(c.title || '').toLowerCase().includes(q) ||
      String(c.text || '').toLowerCase().includes(q) ||
      String(c.player || '').toLowerCase().includes(q))
    .sort((a, b) => b.at - a.at);

  const selo = document.getElementById('tt-badge-notes');
  if (selo) {
    selo.textContent = todos.length;
    selo.classList.toggle('hidden', !todos.length);
  }

  const podeCriar = !!Team.caps['item.create'];
  const contas = { all: todos.length };
  for (const t of ['note', 'ficha', 'raid']) contas[t] = todos.filter((c) => c.type === t).length;

  box.innerHTML = `
    <div class="tn-bar">
      <input type="text" class="list-search tn-search" value="${escapeHtml(TeamNotes.busca)}"
             placeholder="${escapeHtml(I18N.t('notes.search'))}" />
      <div class="tn-filters">
        ${['all', 'note', 'ficha', 'raid'].map((t) => `
          <button class="tn-f${TeamNotes.filtro === t ? ' active' : ''}" data-tnf="${t}">
            ${t === 'all' ? escapeHtml(I18N.t('notes.filterAll'))
                          : Icon.svg(Dossier.tipoDe(t).icone, 12) + ' ' + escapeHtml(I18N.t(Dossier.tipoDe(t).chave))}
            <span class="tn-n">${contas[t]}</span>
          </button>`).join('')}
      </div>
      <span style="flex:1"></span>
      ${podeCriar ? `<button class="btn-small primary tn-new">${Icon.svg('plus', 13)} ${
        escapeHtml(I18N.t('notes.new'))}</button>` : ''}
    </div>
    ${!podeCriar ? `<p class="muted small">${escapeHtml(I18N.t('team.notesNoPerm'))}</p>` : ''}
    <div class="tn-list">
      ${lista.length ? lista.map((c) => cartaoHtml(c, todos)).join('')
        : `<p class="muted small">${escapeHtml(I18N.t(todos.length ? 'notes.noMatch' : 'team.notesEmpty'))}</p>`}
    </div>`;

  const busca = box.querySelector('.tn-search');
  if (busca) {
    busca.addEventListener('input', () => {
      TeamNotes.busca = busca.value;
      const pos = busca.selectionStart;
      renderTeamNotes(g);
      // Redesenhar a lista recria o campo e o cursor volta para o
      // começo — digitar "base" viraria "esab". Devolver o foco e a
      // posição é o preço de redesenhar tudo a cada tecla.
      const novo = document.querySelector('#team-notes .tn-search');
      if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    });
  }

  box.onclick = async (e) => {
    const f = e.target.closest('[data-tnf]');
    if (f) { TeamNotes.filtro = f.dataset.tnf; renderTeamNotes(g); return; }

    if (e.target.closest('.tn-new')) {
      NoteEditor.open(null, null, async () => { await loadTeam(); }, { adaptador: ad });
      return;
    }

    const card = e.target.closest('[data-tnote]');
    const btn = e.target.closest('[data-act]');
    if (!card || !btn) return;
    const id = card.dataset.tnote;
    const c = todos.find((x) => x.id === id);
    if (!c) return;

    if (btn.dataset.act === 'edit') {
      NoteEditor.open(null, {
        id: c.id, type: c.type, title: c.title, text: c.text, icon: c.icon,
        photo: c.photo, color: c.color, player: c.player, raid: c.raid,
        links: c.links, shots: []
      }, async () => { await loadTeam(); }, { adaptador: ad });
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!await Ask.confirm(I18N.t('notes.confirmDelete', { title: c.title || I18N.t('notes.untitled') }))) return;
      const r = await ad.apagar(id);
      if (!r.ok) { toast(erroTime(r)); return; }
      await loadTeam();
      return;
    }
    if (btn.dataset.act === 'board') {
      switchTeamTab('board');
      return;
    }
  };
}

// Item do time -> cartão. A mesma tradução que o adaptador faz;
// aqui ela é síncrona porque `Team.items` já está na memória e a
// lista redesenha a cada tecla da busca.
function cartaoDoItem(it) {
  const d = it.data || {};
  return {
    id: it.id,
    type: d.type || 'note',
    title: d.title || d.name || '',
    text: d.text || '',
    icon: d.icon || null,
    photo: d.photo || null,
    color: d.color || null,
    player: d.player || null,
    raid: d.raid || null,
    links: d.links || [],
    shotCount: d.shotCount || 0,
    author: it.authorName || '',
    authorId: it.authorId,
    at: it.updatedAt || it.createdAt || 0
  };
}

function cartaoHtml(c, todos) {
  const meu = Team.me && c.authorId === Team.me.userId;
  const podeEditar = meu ? Team.caps['item.editOwn'] : Team.caps['item.editAny'];
  const podeApagar = meu ? Team.caps['item.deleteOwn'] : Team.caps['item.deleteAny'];
  const t = Dossier.tipoDe(c.type);
  const ico = c.type === 'ficha' ? (c.icon || 'user') : t.icone;

  return `
    <article class="tn-card t-${escapeHtml(c.type)}" data-tnote="${escapeHtml(c.id)}"
             style="--tipo:${escapeHtml(t.cor)}">
      <header class="tn-head">
        ${c.photo
          ? `<img class="tn-foto" src="${escapeHtml(c.photo)}" alt="" onerror="this.remove()" />`
          : `<span class="tn-ico">${Icon.svg(ico, 14)}</span>`}
        <strong class="tn-title">${escapeHtml(c.title || I18N.t('notes.untitled'))}</strong>
        <span class="tn-author">${escapeHtml(c.author || '')}</span>
        ${podeEditar ? `<button class="tn-act" data-act="edit"
           title="${escapeHtml(I18N.t('common.edit'))}">${Icon.svg('edit', 12)}</button>` : ''}
        ${podeApagar ? `<button class="tn-act danger" data-act="del"
           title="${escapeHtml(I18N.t('common.delete'))}">${Icon.svg('close', 12)}</button>` : ''}
      </header>
      ${c.type === 'ficha' && c.player
        ? `<p class="tn-player">${Icon.svg('user', 11)} ${escapeHtml(c.player)}</p>` : ''}
      ${c.type === 'raid' && c.raid
        ? `<p class="tn-raid">${Icon.svg('bomb', 11)} ${escapeHtml(Dossier.resumoRaid(c.raid))}</p>` : ''}
      ${c.text ? `<p class="tn-text">${escapeHtml(String(c.text).slice(0, 200))}${
        String(c.text).length > 200 ? '…' : ''}</p>` : ''}
      ${c.shotCount ? `<p class="ti-shots" title="${escapeHtml(I18N.t('team.shotsStayHint'))}">${
        Icon.svg('image', 11)} ${escapeHtml(I18N.t('team.shotsStay', { n: c.shotCount }))}</p>` : ''}
      ${(c.links || []).length ? `<div class="nl-chips inline">${
        (c.links || []).map((l) => {
          const outra = todos.find((x) => x.id === l.to);
          const rel = Dossier.relDe(l.rel);
          return `<span class="nl-chip" style="--rel:${escapeHtml(rel.cor)}">
            <span class="nl-rel">${escapeHtml(I18N.t(rel.chave))}</span>
            <span class="nl-name">${escapeHtml(outra ? (outra.title || I18N.t('notes.untitled')) : I18N.t('notes.linkGone'))}</span>
          </span>`;
        }).join('')}<button class="tn-act" data-act="board"
          title="${escapeHtml(I18N.t('board.see'))}">${Icon.svg('puzzle', 12)}</button></div>` : ''}
    </article>`;
}
