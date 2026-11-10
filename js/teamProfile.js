// ============================================================
// teamProfile.js — a identidade do time: foto, descrição, regras
// e novidades
//
// O PEDIDO
//
//   "preciso que implemente o sistema de criar time melhorado.
//    descrição, nome, foto do time (link externo).
//    aba customizadas para regras e news do time (apenas dono e
//    adm podem escrever)"
//
// ------------------------------------------------------------
// POR QUE UM FORMULÁRIO SÓ PARA CRIAR E PARA EDITAR
// ------------------------------------------------------------
// Antes, criar time era `Ask.text('Nome do grupo')` e pronto. Se a
// descrição e a foto virassem uma tela separada, acessível depois
// por um menu, o resultado previsível é time nenhum ter descrição:
// o momento em que a pessoa sabe dizer o que o time é, é o momento
// em que ela o cria.
//
// O mesmo formulário serve para editar. Uma tela a menos para
// manter, e o que se vê ao criar é exatamente o que se vê ao
// corrigir.
//
// ------------------------------------------------------------
// A FOTO É UM LINK EXTERNO, E ISSO TEM CONSEQUÊNCIA
// ------------------------------------------------------------
// O app não hospeda imagem (upload depende do servidor de mídia,
// que depende do deploy). Então a foto é um endereço, e um endereço
// escrito por OUTRA PESSOA do time acaba dentro de um `src` na
// minha tela.
//
// Duas defesas, uma em cada ponta:
//   - o store recusa qualquer coisa que não seja http(s), então
//     `javascript:` e `data:` nunca chegam a ser gravados;
//   - a tela nunca monta o `src` por concatenação de string em
//     HTML: usa `img.src = url`, com o elemento criado aqui.
//
// E se a imagem não carregar (link morto, sem internet, hotlink
// bloqueado), volta a inicial do nome. Um quadrado quebrado no
// lugar do time é pior do que a letra que sempre esteve ali.
// ============================================================

// O papel para o store quando o time é do SERVIDOR.
//
// Com conta ligada o grupo não existe em `state.groups` — ele vive
// no servidor —, mas o conteúdo continua salvo nesta máquina. Sem
// mandar o papel junto, o store responde `no_group` e a tela não
// tem como saber que o problema é esse. Ver `podeAqui` no
// teamStore.js.
function papelRemoto() {
  if (!Team.live) return null;
  const g = currentGroup();
  return (g && g.myRole) || null;
}

function opsRemotas() {
  return { papelRemoto: papelRemoto() };
}

// ------------------------------------------------------------
// Formulário
// ------------------------------------------------------------
const TeamForm = {
  modo: 'criar',   // 'criar' | 'editar'
  aoSalvar: null,

  abrir({ modo = 'criar', perfil = null, nome = '' } = {}) {
    this.modo = modo;
    document.getElementById('tedit-title').textContent =
      I18N.t(modo === 'criar' ? 'team.createTitle' : 'team.editTitle');
    document.getElementById('tedit-name').value = nome || '';
    document.getElementById('tedit-desc').value = (perfil && perfil.description) || '';
    document.getElementById('tedit-photo').value = (perfil && perfil.photo) || '';
    document.getElementById('tedit-photo-err').classList.add('hidden');
    this.previa();
    showModal('modal-team-edit');
    setTimeout(() => document.getElementById('tedit-name').focus(), 40);
  },

  // Prévia ao vivo do avatar. Existe porque link de imagem erra
  // fácil (a pessoa cola o link da PÁGINA em vez do da imagem), e
  // descobrir isso só depois de salvar é uma viagem de ida e volta
  // desnecessária.
  previa() {
    const url = document.getElementById('tedit-photo').value.trim();
    const nome = document.getElementById('tedit-name').value.trim();
    pintarAvatar(document.getElementById('tedit-preview'), url, nome);
  },

  async salvar() {
    const nome = document.getElementById('tedit-name').value.trim();
    const desc = document.getElementById('tedit-desc').value.trim();
    const foto = document.getElementById('tedit-photo').value.trim();
    const err = document.getElementById('tedit-photo-err');

    if (!nome) { document.getElementById('tedit-name').focus(); return; }
    // A checagem do link é feita aqui TAMBÉM, e não só no store,
    // porque a mensagem tem que aparecer ao lado do campo errado.
    // Um toast genérico depois de fechar o modal faria a pessoa
    // reabrir tudo para descobrir qual campo recusou.
    if (foto && !/^https?:\/\//i.test(foto)) {
      err.classList.remove('hidden');
      document.getElementById('tedit-photo').focus();
      return;
    }
    err.classList.add('hidden');
    hideModal('modal-team-edit');

    if (this.modo === 'criar') {
      await criarTimeCompleto({ nome, desc, foto });
      return;
    }
    await salvarPerfilDoTime({ nome, desc, foto });
  }
};

// ------------------------------------------------------------
// O AVATAR — e o bug que fazia a foto nunca aparecer
// ------------------------------------------------------------
// A primeira versão criava uma `<img>` nova a CADA desenho: apagava
// o que estava lá, punha a inicial, e começava a baixar de novo.
//
// Sozinho isso já é desperdício. Com conta ligada vira bug: o
// servidor empurra presença, mensagem e posição a toda hora, e cada
// empurrão redesenha o cabeçalho. Se o download demorasse mais que
// o intervalo entre dois empurrões — e uma imagem da internet
// demora —, o `load` nunca chegava a tempo: a foto era descartada
// pelo redesenho seguinte, para sempre. Ficava a letra.
//
// A correção tem duas partes:
//
//   1. Um CACHE por URL. A imagem é baixada uma vez; do segundo
//      desenho em diante ela já está pronta e entra na hora.
//   2. Não mexer no que já está certo. Se o elemento já mostra
//      ESTA url, o desenho não encosta nele.
const _avatares = new Map();   // url -> { estado, img }

function carregarAvatar(url) {
  if (_avatares.has(url)) return _avatares.get(url);
  const reg = { estado: 'carregando', img: null };
  _avatares.set(url, reg);
  const img = new Image();
  img.addEventListener('load', () => {
    reg.estado = 'ok'; reg.img = img;
    // Quem estava esperando redesenha. Sem isto a foto só apareceria
    // no PRÓXIMO desenho por outro motivo — e num time parado isso
    // pode não acontecer nunca.
    if (typeof renderTeamProfile === 'function' && TeamView.aberta) renderTeamProfile();
    document.dispatchEvent(new CustomEvent('avatar:pronto', { detail: { url } }));
  });
  img.addEventListener('error', () => { reg.estado = 'erro'; });
  img.src = url;
  return reg;
}

// Pinta um avatar num elemento: imagem se o link servir, inicial do
// nome se não servir. Uma função só porque isto aparece no
// cabeçalho do time, na prévia do formulário e no dossiê — e três
// cópias divergiriam no dia em que o fallback mudar.
function pintarAvatar(el, url, nome) {
  if (!el) return;
  const inicial = (nome || '?').trim().charAt(0).toUpperCase() || '?';
  const limpo = (url && /^https?:\/\//i.test(url)) ? url : null;

  // Já está do jeito certo: não encosta. É esta linha que impede o
  // redesenho de derrubar a foto que já estava na tela.
  if (el.dataset.foto === (limpo || '') && (limpo ? el.querySelector('img') : el.textContent === inicial)) {
    return;
  }

  if (!limpo) {
    el.dataset.foto = '';
    el.textContent = inicial;
    el.classList.remove('com-foto');
    return;
  }

  // TROCOU DE LINK: a foto velha sai AGORA.
  //
  // Sem esta parte, mudar a foto para um endereço quebrado deixava
  // a antiga na tela — o elemento já tinha uma `<img>`, o código
  // via "tem imagem" e não mexia. A pessoa trocava o link, nada
  // mudava, e não havia como saber se o novo link era ruim ou se o
  // app tinha ignorado a troca.
  const antiga = el.querySelector('img');
  if (antiga && el.dataset.foto !== limpo) {
    antiga.remove();
    el.textContent = inicial;
    el.classList.remove('com-foto');
    el.dataset.foto = '';
  }

  const reg = carregarAvatar(limpo);
  if (reg.estado !== 'ok') {
    // Enquanto baixa (ou se deu erro), fica a letra. Um quadrado
    // vazio esperando é pior do que a inicial que sempre esteve ali.
    if (!el.querySelector('img')) { el.textContent = inicial; el.classList.remove('com-foto'); }
    // `dataset.foto` só é carimbado quando a foto ENTRA. Marcando
    // agora, um erro de rede passageiro travaria a letra para
    // sempre, porque o desenho seguinte acharia que já está certo.
    return;
  }

  el.dataset.foto = limpo;
  el.textContent = '';
  const img = document.createElement('img');
  img.alt = '';
  img.src = limpo;
  el.appendChild(img);
  el.classList.add('com-foto');
}

// ------------------------------------------------------------
// Criar
// ------------------------------------------------------------
async function criarTimeCompleto({ nome, desc, foto }) {
  if (Team.live) {
    // No servidor só o NOME tem rota hoje (`liveRename`/`liveCreate`).
    // Descrição, foto e regras ficam no disco, indexadas pelo id do
    // time do servidor — é a mesma decisão do vínculo de servidor:
    // a API cuida de conta, conexão, arquivo e voz; o resto é desta
    // máquina. No dia em que a rota existir, muda só o store.
    const r = await window.api.liveCreate(nome);
    if (!r.ok) { toast(erroTime(r)); return; }
    await loadTeam();
    if (Team.currentId && (desc || foto)) {
      await window.api.teamSetProfile(Team.currentId,
        { description: desc, photo: foto || null }, opsRemotas());
      await loadTeam();
    }
    toast(I18N.t('team.createdLive', { name: nome }));
    return;
  }

  const g = await window.api.teamCreateGroup({
    name: nome, description: desc, photo: foto || null,
    serverId: AppState.trackingId || null
  });
  Team.currentId = g.id;
  await loadTeam();
  toast(I18N.t('team.created', { code: g.code }));
}

// ------------------------------------------------------------
// Editar
// ------------------------------------------------------------
async function salvarPerfilDoTime({ nome, desc, foto }) {
  const g = currentGroup();
  if (!g) return;

  // O nome vai por onde sempre foi (servidor ou store); descrição e
  // foto vão pelo perfil. Duas chamadas, porque são dois donos do
  // dado — e a ordem importa: se o rename falhar, não faz sentido
  // gravar o resto como se tivesse dado certo.
  if (nome && nome !== g.name) {
    const r = Team.live
      ? await window.api.liveRename(nome)
      : await window.api.teamUpdateGroup(g.id, { name: nome });
    if (!r || r.ok === false) { toast(erroTime(r || {})); return; }
  }

  const r2 = await window.api.teamSetProfile(g.id,
    { description: desc, photo: foto || null }, opsRemotas());
  if (!r2.ok) { toast(erroTime(r2)); return; }

  await loadTeam();
  toast(I18N.t('team.profileSaved'));
}

// ------------------------------------------------------------
// Carregar e desenhar o perfil
// ------------------------------------------------------------
async function loadTeamProfile() {
  const g = currentGroup();
  if (!g) { Team.profile = null; return; }
  try {
    Team.profile = await window.api.teamProfile(g.id);
  } catch {
    Team.profile = null;
  }
}

function renderTeamProfile() {
  const g = currentGroup();
  if (!g) return;
  const perfil = Team.profile || {};

  pintarAvatar(document.getElementById('team-photo'), perfil.photo, g.name);

  const desc = document.getElementById('team-desc');
  if (desc) {
    const txt = (perfil.description || '').trim();
    desc.textContent = txt;
    desc.classList.toggle('hidden', !txt);
  }

  const btn = document.getElementById('team-edit');
  if (btn) btn.classList.toggle('hidden', !Team.caps['profile.edit']);
}

// ------------------------------------------------------------
// REGRAS
// ------------------------------------------------------------
// Um texto só, do time inteiro, e não uma lista de itens. Regra não
// se comenta nem se ordena: ou vale, ou não vale. Uma lista traria
// junto "quem criou cada regra", "apagar a regra 3", ordenação — e
// nada disso é como um time combina regra.
const TeamRules = { editando: false };

function renderTeamRules() {
  const view = document.getElementById('rules-view');
  const campo = document.getElementById('rules-text');
  if (!view || !campo) return;

  const perfil = Team.profile || {};
  const pode = !!Team.caps['rules.write'];
  const texto = (perfil.rules || '').trim();

  document.getElementById('rules-edit').classList.toggle('hidden', !pode || TeamRules.editando);
  document.getElementById('rules-save').classList.toggle('hidden', !TeamRules.editando);
  document.getElementById('rules-cancel').classList.toggle('hidden', !TeamRules.editando);
  // O aviso de "só admin escreve" só aparece para quem NÃO pode.
  // Para quem pode, seria informar uma restrição que não existe.
  document.getElementById('rules-noperm').classList.toggle('hidden', pode);

  view.classList.toggle('hidden', TeamRules.editando);
  campo.classList.toggle('hidden', !TeamRules.editando);

  if (TeamRules.editando) {
    campo.value = perfil.rules || '';
  } else {
    view.innerHTML = texto
      ? richTextToHtml(texto)
      : `<p class="muted small">${escapeHtml(I18N.t(pode ? 'team.rulesEmpty' : 'team.rulesEmptyRead'))}</p>`;
  }

  const por = document.getElementById('rules-by');
  if (por) {
    // Quem escreveu e quando. Numa regra isso não é enfeite: é o
    // que responde "isso ainda vale?" sem precisar perguntar no
    // chat.
    por.textContent = (texto && perfil.rulesUpdatedAt)
      ? I18N.t('team.rulesBy', {
          who: perfil.rulesBy || I18N.t('team.someone'),
          when: formatNoteDate(perfil.rulesUpdatedAt)
        })
      : '';
  }
}

async function salvarRegras() {
  const g = currentGroup();
  if (!g) return;
  const txt = document.getElementById('rules-text').value;
  const r = await window.api.teamSetProfile(g.id, { rules: txt }, opsRemotas());
  if (!r.ok) { toast(erroTime(r)); return; }
  TeamRules.editando = false;
  await loadTeamProfile();
  renderTeamRules();
  toast(I18N.t('team.rulesSaved'));
}

// ------------------------------------------------------------
// NOVIDADES
// ------------------------------------------------------------
// Novidade É um item do time (`kind: 'note'`, `data.type: 'news'`),
// não um campo do grupo. A diferença com as regras é o que se faz
// com cada uma: regra é um texto que vale agora; novidade é uma
// sequência de avisos com autor e data, que se acumula.
//
// Como é item, ganha de graça o que os itens já têm: autor, data,
// escopo por servidor, sincronização e o mesmo botão de apagar.
function noticiasDoTime() {
  return (Team.items || [])
    .filter((it) => it.kind === 'note' && it.data && it.data.type === 'news')
    .sort((a, b) => b.createdAt - a.createdAt);
}

function renderTeamNews() {
  const box = document.getElementById('team-news');
  if (!box) return;
  const pode = !!Team.caps['news.write'];
  const lista = noticiasDoTime();

  document.getElementById('news-new').classList.toggle('hidden', !pode);
  document.getElementById('news-noperm').classList.toggle('hidden', pode || lista.length > 0);

  const selo = document.getElementById('tt-badge-news');
  if (selo) {
    selo.textContent = lista.length;
    selo.classList.toggle('hidden', !lista.length);
  }

  if (!lista.length) {
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('team.newsEmpty'))}</p>`;
    return;
  }

  box.innerHTML = lista.map((it) => {
    const meu = Team.me && it.authorId === Team.me.userId;
    const podeApagar = meu ? Team.caps['item.deleteOwn'] : Team.caps['item.deleteAny'];
    // Corrigir o próprio aviso é o caso comum (errou a data do wipe).
    const podeEditar = Team.caps['news.write'] &&
      (meu ? Team.caps['item.editOwn'] : Team.caps['item.editAny']);
    return `
      <article class="news-post" data-item="${escapeHtml(it.id)}">
        <header class="np-head">
          <strong class="np-title">${escapeHtml(it.data.title || I18N.t('notes.untitled'))}</strong>
          <span class="np-meta">${escapeHtml(it.authorName || '')} · ${escapeHtml(formatNoteDate(it.createdAt))}</span>
          ${podeEditar ? `<button class="np-act" data-act="edit"
             title="${escapeHtml(I18N.t('common.edit'))}">${Icon.svg('edit', 13)}</button>` : ''}
          ${podeApagar ? `<button class="np-del" data-act="del"
             title="${escapeHtml(I18N.t('common.delete'))}">${Icon.svg('close', 13)}</button>` : ''}
        </header>
        ${it.data.text ? `<div class="np-text">${richTextToHtml(it.data.text)}</div>` : ''}
      </article>`;
  }).join('');

  box.onclick = async (e) => {
    const card = e.target.closest('[data-item]');
    const btn = e.target.closest('[data-act]');
    if (!card || !btn) return;

    if (btn.dataset.act === 'edit') {
      const it = noticiasDoTime().find((x) => x.id === card.dataset.item);
      if (!it) return;
      escreverNoticia({ id: it.id, type: 'news', title: it.data.title || '',
                        text: it.data.text || '', shots: [], links: [] });
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!await Ask.confirm(I18N.t('team.confirmDeleteNews'))) return;
      const r = await window.api.teamDeleteItem(card.dataset.item, opsRemotas());
      if (!r.ok) { toast(erroTime(r)); return; }
      await loadTeam();
    }
  };
}

// Escrever novidade usa o EDITOR DE ANOTAÇÃO, com o tipo travado
// em `news`.
//
// Antes eram duas caixinhas de pergunta em sequência: título,
// confirma, texto, confirma. Isso obriga a pessoa a decidir o
// título ANTES de ter escrito o texto — que é a ordem contrária à
// que se escreve —, não deixa voltar, não aceita print colado e não
// mostra as duas coisas juntas na tela.
//
// O editor já resolve tudo isso, e é o mesmo que ela usa nas
// anotações. Uma tela a menos para manter.
function escreverNoticia(item = null) {
  const g = currentGroup();
  if (!g) return;
  NoteEditor.open(null, item, async () => {
    await loadTeam();
    toast(I18N.t('team.newsPosted'));
  }, { adaptador: Dossier.novidades(g.id) });
}

// ------------------------------------------------------------
// Ligações
// ------------------------------------------------------------
function initTeamProfile() {
  const salvar = document.getElementById('tedit-save');
  if (salvar) salvar.addEventListener('click', () => TeamForm.salvar());
  const cancelar = document.getElementById('tedit-cancel');
  if (cancelar) cancelar.addEventListener('click', () => hideModal('modal-team-edit'));

  const foto = document.getElementById('tedit-photo');
  if (foto) foto.addEventListener('input', () => TeamForm.previa());
  const nome = document.getElementById('tedit-name');
  if (nome) nome.addEventListener('input', () => TeamForm.previa());

  const editar = document.getElementById('team-edit');
  if (editar) {
    editar.addEventListener('click', () => {
      const g = currentGroup();
      if (!g) return;
      document.getElementById('team-menu').classList.add('hidden');
      TeamForm.abrir({ modo: 'editar', perfil: Team.profile, nome: g.name });
    });
  }

  const rEdit = document.getElementById('rules-edit');
  if (rEdit) rEdit.addEventListener('click', () => { TeamRules.editando = true; renderTeamRules(); });
  const rCancel = document.getElementById('rules-cancel');
  if (rCancel) rCancel.addEventListener('click', () => { TeamRules.editando = false; renderTeamRules(); });
  const rSave = document.getElementById('rules-save');
  if (rSave) rSave.addEventListener('click', salvarRegras);

  const nNew = document.getElementById('news-new');
  if (nNew) nNew.addEventListener('click', escreverNoticia);
}
