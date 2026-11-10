// ============================================================
// fichas.js — a ficha de cada jogador, na tela
//
// O pedido: "sistema de fichas, para poder vincular jogadores a
// outros como time e como aliados. Isso deve ser claro na listagem."
//
// DUAS COISAS DIFERENTES, e a tela precisa mostrar as duas:
//
//   VÍNCULO  aliado / inimigo / neutro — a relação com VOCÊ
//   GRUPO    com quem essa pessoa anda — a relação dela com OUTROS
//
// Um grupo rival pode ter dentro dele alguém que você considera
// conhecido; um aliado pode não andar com ninguém. Por isso são dois
// campos e dois lugares na tela.
//
// POR QUE EXISTE UM CACHE AQUI
//
// A lista de jogadores é redesenhada a cada atualização do polling —
// alguns segundos. `renderPlayers` é síncrona (monta uma string de
// HTML), então ela NÃO pode esperar uma ida ao processo principal
// por jogador. O cache resolve isso: o disco é lido de vez em
// quando, em bloco, e o desenho só consulta memória.
// ============================================================
const FichasUI = {
  // chave normalizada -> ficha
  cache: new Map(),
  grupos: [],
  // Nome do jogador com a ficha aberta agora.
  abertaDe: null,
  // Seleção múltipla, para agrupar vários de uma vez.
  selecao: new Set(),

  // Mesma normalização do fichasStore. Precisa ser a MESMA, senão o
  // cache erra o alvo por causa de um espaço — e o sintoma seria uma
  // ficha que "some" ao redesenhar.
  chave(nome) {
    return String(nome || '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  },

  de(nome) {
    return this.cache.get(this.chave(nome)) || null;
  },

  async recarregar(nomes = []) {
    try {
      const m = await window.api.fichasList(nomes);
      this.cache = new Map(Object.entries(m || {}));
    } catch { /* sem fichas ainda */ }
  },

  async recarregarGrupos() {
    try { this.grupos = (await window.api.fichaGroups()) || []; } catch { this.grupos = []; }
  }
};

// ------------------------------------------------------------
// A PONTE ENTRE A FICHA E O DOSSIÊ
// ------------------------------------------------------------
// A ficha é a resposta rápida; o dossiê é a investigação. Sem esta
// linha na tela, quem usa a ficha nunca descobre que o dossiê
// existe — e quem monta o dossiê não entende por que a ficha não
// mostra as fotos.
//
// O botão muda de verbo conforme o caso: ABRIR quando já existe,
// CRIAR quando não existe. "Dossiê" sozinho, sempre igual, faria a
// pessoa clicar para descobrir qual dos dois é.
function desenharPonteDoDossie(nome) {
  const caixa = document.getElementById('ficha-dossie');
  const txt = document.getElementById('ficha-dossie-txt');
  const btn = document.getElementById('ficha-dossie-btn');
  if (!caixa || !btn) return;

  // Fora de um servidor não há escopo onde guardar o dossiê. Some
  // inteiro em vez de oferecer um botão que não teria onde gravar.
  if (!AppState.trackingId || typeof PlayerLinks === 'undefined') {
    caixa.classList.add('hidden');
    return;
  }
  caixa.classList.remove('hidden');

  const dossies = PlayerLinks.todosDe(nome);
  const meu = dossies.find((d) => d.origem === 'local') || null;
  const doTime = dossies.filter((d) => d.origem === 'time');
  const ligacoes = dossies.reduce((n, d) => n + (d.links || []).length, 0);

  txt.innerHTML = meu
    ? `${Icon.svg('note', 12)} ${escapeHtml(I18N.t('fichas.hasDossier', { n: ligacoes }))}`
    : (doTime.length
        ? `${Icon.svg('users', 12)} ${escapeHtml(I18N.t('fichas.teamDossier', { team: doTime[0].time || '' }))}`
        : `<span class="muted">${escapeHtml(I18N.t('fichas.noDossier'))}</span>`);

  btn.textContent = I18N.t(meu ? 'fichas.openDossier' : 'fichas.newDossier');
  btn.onclick = () => abrirDossieDe(nome, meu);
}

function abrirDossieDe(nome, meu) {
  hideModal('modal-ficha');
  const escopo = 'server:' + AppState.trackingId;
  const nota = meu ? { ...meu.bruto } : null;
  NoteEditor.open(escopo, nota, async () => {
    // O dossiê mexe no que a lista desenha (linha e selo), então a
    // lista precisa saber. Sem isto, a ligação recém-criada só
    // apareceria na próxima volta do polling.
    await PlayerLinks.sincronizar(escopo, AppState.trackingId);
    if (typeof renderPlayersList === 'function') renderPlayersList();
    if (typeof refreshTrackingNotes === 'function') await refreshTrackingNotes();
  }, { tipo: 'ficha', player: nome });
}

// ------------------------------------------------------------
// Manter o cache em dia
// ------------------------------------------------------------
// Chamado pelo tracking a cada leitura de jogadores. Uma ida ao
// disco por atualização, não uma por jogador.
async function sincronizarFichas(nomes) {
  await FichasUI.recarregar(nomes);
}

// ------------------------------------------------------------
// A ficha
// ------------------------------------------------------------
async function abrirFicha(nome) {
  FichasUI.abertaDe = nome;
  await FichasUI.recarregarGrupos();
  let f = null;
  try { f = await window.api.fichaGet(nome); } catch { /* nada ainda */ }
  desenharFicha(nome, f);
  showModal('modal-ficha');
}

function desenharFicha(nome, f) {
  const vinculo = f ? f.link : 'neutral';
  document.getElementById('ficha-nome').textContent = nome;
  desenharPonteDoDossie(nome);

  // Nome pelo qual a ficha está guardada, quando é diferente do que
  // apareceu na lista. Sem isto, abrir a ficha de "Gunner2" e ver as
  // anotações de "Gunner" pareceria bug.
  const outro = document.getElementById('ficha-alias-aviso');
  const mesmoNome = !f || FichasUI.chave(f.name) === FichasUI.chave(nome);
  outro.classList.toggle('hidden', mesmoNome);
  if (!mesmoNome) outro.textContent = I18N.t('fichas.sameAs', { name: f.name });

  for (const b of document.querySelectorAll('#ficha-links .fk-op')) {
    b.classList.toggle('on', b.dataset.link === vinculo);
  }

  const sel = document.getElementById('ficha-grupo');
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('fichas.noGroup'))}</option>` +
    FichasUI.grupos.map((g) =>
      `<option value="${escapeHtml(g.id)}"${f && f.groupId === g.id ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');

  document.getElementById('ficha-nota').value = (f && f.note) || '';

  // Quem mais está no mesmo grupo. É o que responde "com quem essa
  // pessoa anda" sem obrigar a abrir ficha por ficha.
  const juntos = document.getElementById('ficha-juntos');
  const g = f && f.group ? FichasUI.grupos.find((x) => x.id === f.group.id) : null;
  const outros = g ? (g.members || []).filter((n) => FichasUI.chave(n) !== FichasUI.chave(f.name)) : [];
  juntos.classList.toggle('hidden', !outros.length);
  if (outros.length) {
    juntos.innerHTML = `<span class="muted small">${escapeHtml(I18N.t('fichas.alsoInGroup'))}</span> ` +
      outros.map((n) => `<button class="fk-chip" data-abrir="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('');
  }

  document.getElementById('ficha-apagar').classList.toggle('hidden', !f);
}

async function salvarFicha() {
  const nome = FichasUI.abertaDe;
  if (!nome) return;
  const nota = document.getElementById('ficha-nota').value;
  const gid = document.getElementById('ficha-grupo').value || null;
  await window.api.fichaNote(nome, nota);
  await window.api.fichaSetGroup(nome, gid);
  await depoisDeMexer();
  hideModal('modal-ficha');
  toast(I18N.t('fichas.saved', { name: nome }));
}

// Redesenha tudo que mostra ficha. Uma função só, chamada de todo
// lugar que altera: assim não existe tela que fica para trás.
async function depoisDeMexer() {
  const nomes = (typeof trackingPlayers !== 'undefined' ? trackingPlayers : []).map((p) => p.name);
  await FichasUI.recarregar(nomes);
  await FichasUI.recarregarGrupos();
  if (typeof renderPlayers === 'function' && typeof trackingPlayers !== 'undefined') {
    renderPlayers(trackingPlayers);
  }
}

// ------------------------------------------------------------
// Agrupar vários de uma vez
// ------------------------------------------------------------
// O caminho real: você vê três nomes juntos no servidor e quer
// marcar os três como um bando. Um por um seria seis cliques e a
// chance de errar o nome.
async function agruparSelecionados() {
  const nomes = [...FichasUI.selecao];
  if (!nomes.length) return;

  await FichasUI.recarregarGrupos();
  const opcoes = FichasUI.grupos.map((g) => ({
    valor: g.id, texto: g.name,
    sub: I18N.t('fichas.groupMembers', { n: (g.members || []).length })
  }));
  opcoes.push({ valor: '__novo', texto: I18N.t('fichas.newGroup'), sub: '' });

  const escolha = await Ask.pick(I18N.t('fichas.groupWhich', { n: nomes.length }), opcoes);
  if (!escolha) return;

  let r;
  if (escolha === '__novo') {
    const nome = await Ask.text(I18N.t('fichas.newGroupName'));
    if (!nome) return;
    r = await window.api.fichaGroup(nomes, { name: nome });
  } else {
    r = await window.api.fichaGroup(nomes, { groupId: escolha });
  }
  if (!r || !r.ok) { toast(I18N.t('fichas.groupFailed')); return; }

  FichasUI.selecao.clear();
  await depoisDeMexer();
  toast(I18N.t('fichas.grouped', { n: r.membros.length, name: r.grupo.name }));
}

function alternarSelecao(nome) {
  const k = FichasUI.chave(nome);
  if (FichasUI.selecao.has(nome)) FichasUI.selecao.delete(nome);
  else FichasUI.selecao.add(nome);
  atualizarBarraSelecao();
  for (const li of document.querySelectorAll('#players-list [data-player]')) {
    li.classList.toggle('selecionado', FichasUI.selecao.has(li.dataset.player));
  }
}

function atualizarBarraSelecao() {
  const barra = document.getElementById('ficha-bar');
  if (!barra) return;
  const n = FichasUI.selecao.size;
  barra.classList.toggle('hidden', n === 0);
  const txt = document.getElementById('ficha-bar-txt');
  if (txt) txt.textContent = I18N.t('fichas.selected', { n });
}

// ------------------------------------------------------------
// Ligações
// ------------------------------------------------------------
function initFichas() {
  const lista = document.getElementById('players-list');
  if (lista) {
    lista.addEventListener('click', (e) => {
      const li = e.target.closest('[data-player]');
      if (!li) return;
      // Ctrl/Shift junta à seleção; clique simples abre a ficha. É a
      // convenção de qualquer lista de arquivos, e não precisa de
      // um "modo selecionar" separado.
      if (e.ctrlKey || e.metaKey || e.shiftKey) { alternarSelecao(li.dataset.player); return; }
      abrirFicha(li.dataset.player);
    });
  }

  const caixa = document.getElementById('modal-ficha');
  if (caixa) {
    caixa.addEventListener('click', async (e) => {
      if (e.target === caixa) { hideModal('modal-ficha'); return; }

      const op = e.target.closest('.fk-op');
      if (op) {
        // O vínculo salva NA HORA, sem esperar o "Salvar": é um
        // clique só e o efeito aparece na lista atrás do modal.
        await window.api.fichaLink(FichasUI.abertaDe, op.dataset.link);
        const f = await window.api.fichaGet(FichasUI.abertaDe);
        desenharFicha(FichasUI.abertaDe, f);
        await depoisDeMexer();
        return;
      }
      const chip = e.target.closest('[data-abrir]');
      if (chip) { abrirFicha(chip.dataset.abrir); return; }
    });
  }

  const salvar = document.getElementById('ficha-salvar');
  if (salvar) salvar.addEventListener('click', salvarFicha);

  const fechar = document.getElementById('ficha-fechar');
  if (fechar) fechar.addEventListener('click', () => hideModal('modal-ficha'));

  const apagar = document.getElementById('ficha-apagar');
  if (apagar) {
    apagar.addEventListener('click', async () => {
      if (!await Ask.confirm(I18N.t('fichas.confirmDelete', { name: FichasUI.abertaDe }))) return;
      await window.api.fichaDelete(FichasUI.abertaDe);
      await depoisDeMexer();
      hideModal('modal-ficha');
    });
  }

  const agrupar = document.getElementById('ficha-bar-group');
  if (agrupar) agrupar.addEventListener('click', agruparSelecionados);
  const limpar = document.getElementById('ficha-bar-clear');
  if (limpar) {
    limpar.addEventListener('click', () => {
      FichasUI.selecao.clear();
      atualizarBarraSelecao();
      for (const li of document.querySelectorAll('#players-list [data-player]')) {
        li.classList.remove('selecionado');
      }
    });
  }
}
