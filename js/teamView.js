// ============================================================
// teamView.js — a ÁREA do time, e os servidores vinculados a ele
//
// POR QUE ISTO EXISTE
//
// O grupo era uma aba DENTRO de um servidor. Para ver o time você
// precisava abrir um servidor qualquer primeiro, e o time pairava
// sobre todos eles ao mesmo tempo: um marcador criado no servidor A
// aparecia no mapa do servidor B, onde aquela coordenada não quer
// dizer nada.
//
// A Sara pediu o contrário, e é o que faz sentido: o time é DONO dos
// servidores. "Uma aba customizada apenas pro time. Nessa aba, onde
// tem todas as informações do time, você pode vincular servidores a
// um time."
//
// AS TRÊS PEÇAS
//
// 1. `view-team` — tela própria, aberta pelo menu lateral. Não
//    depende de nenhum servidor estar aberto.
// 2. Escopo — o seletor no topo diz QUAL servidor do time você está
//    olhando. "Todos" mostra os dois ao mesmo tempo, que foi o
//    pedido literal: "pode entrar na aba de times e consultar essas
//    informações lá ao mesmo tempo".
// 3. Vínculo — com permissão. No seu time você é dona; no time de
//    outra pessoa, só com admin (ver `server.link` em teamRoles.js).
// ============================================================
const TeamView = {
  aberta: false,
  // Escopo atual: null = todos os servidores do time.
  escopo: null,
  // De onde a pessoa veio, para o botão Voltar não mentir.
  voltarPara: 'home'
};

// ------------------------------------------------------------
// Abrir e fechar
// ------------------------------------------------------------
function openTeamView({ bmId = null, voltarPara = null } = {}) {
  TeamView.aberta = true;
  // Sem dizer de onde veio, o Voltar OLHA a tela: se havia um
  // servidor aberto, é para ele que se volta. A primeira versão
  // assumia "home" sempre, e abrir o time pelo menu no meio de um
  // servidor fazia o Voltar jogar a pessoa na lista — perdendo o
  // servidor que ela estava acompanhando, sem ter pedido isso.
  TeamView.voltarPara = voltarPara
    || (document.getElementById('view-tracking').classList.contains('hidden') ? 'home' : 'tracking');
  // Abrir a partir de um servidor já entra com o escopo NELE. Quem
  // clicou em "time deste servidor" quer ver aquele servidor, não a
  // soma de todos — obrigar a escolher de novo seria pedir duas
  // vezes a mesma coisa.
  if (bmId) TeamView.escopo = String(bmId);

  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-tracking').classList.add('hidden');
  document.getElementById('view-team').classList.remove('hidden');
  if (typeof closeDrawer === 'function') closeDrawer();

  loadTeam();
}

function closeTeamView() {
  TeamView.aberta = false;
  document.getElementById('view-team').classList.add('hidden');
  if (TeamView.voltarPara === 'tracking' && AppState.trackingId) {
    document.getElementById('view-tracking').classList.remove('hidden');
  } else {
    document.getElementById('view-home').classList.remove('hidden');
  }
}

// ------------------------------------------------------------
// Escopo
// ------------------------------------------------------------
// O escopo é o que passa para o store como `serverBmId`. `null`
// (todos) vira `undefined` na consulta, porque no store `null`
// significa "só os SEM servidor" e `undefined` significa "tudo" —
// três estados diferentes de propósito, e trocar um pelo outro
// esconderia metade dos itens sem erro nenhum na tela.
function escopoDaConsulta() {
  return TeamView.escopo == null ? undefined : TeamView.escopo;
}

function renderTeamScope() {
  const sel = document.getElementById('tv-scope');
  const caixa = document.getElementById('tv-scope-box');
  if (!sel) return;
  const servidores = Team.servers || [];

  // Sem servidor vinculado o seletor não tem o que oferecer.
  if (caixa) caixa.classList.toggle('hidden', servidores.length === 0);

  // Escopo apontando para servidor que foi desvinculado volta a
  // "todos", senão a tela fica vazia sem explicar por quê.
  if (TeamView.escopo && !servidores.some((s) => s.bmId === TeamView.escopo)) {
    TeamView.escopo = null;
  }

  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('team.allServers'))}</option>` +
    servidores.map((s) =>
      `<option value="${escapeHtml(s.bmId)}"${s.bmId === TeamView.escopo ? ' selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');
}

// ------------------------------------------------------------
// Lista de servidores do time
// ------------------------------------------------------------
function renderTeamServers(g) {
  const box = document.getElementById('team-servers');
  if (!box) return;
  const servidores = Team.servers || [];
  const podeVincular = !!Team.caps['server.link'];
  const podeDesvincular = !!Team.caps['server.unlink'];

  const btn = document.getElementById('team-link-server');
  if (btn) btn.classList.toggle('hidden', !podeVincular);

  const selo = document.getElementById('tt-badge-servers');
  if (selo) {
    selo.textContent = servidores.length;
    selo.classList.toggle('hidden', !servidores.length);
  }

  if (!servidores.length) {
    // A frase muda conforme a PERMISSÃO. Dizer "clique em vincular"
    // para quem não tem o botão seria mandar a pessoa procurar algo
    // que não existe na tela dela.
    box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t(
      podeVincular ? 'team.noServers' : 'team.noServersNoPerm'))}</p>`;
    return;
  }

  box.innerHTML = servidores.map((s) => {
    const live = (typeof LiveData !== 'undefined' && LiveData[s.bmId]) || {};
    const jogadores = live.players != null
      ? `${live.players}/${live.maxPlayers == null ? '?' : live.maxPlayers}`
      : null;
    const contagem = contarDoServidor(s.bmId);
    return `
      <article class="tvs-card" data-bmid="${escapeHtml(s.bmId)}">
        <div class="tvs-main">
          <strong class="tvs-name">${escapeHtml(s.name)}</strong>
          <span class="tvs-addr">${escapeHtml(s.ip ? `${s.ip}:${s.port}` : s.bmId)}</span>
        </div>
        <div class="tvs-meta">
          ${s.map ? `<span class="tag auto">${escapeHtml(s.map)}</span>` : ''}
          ${jogadores ? `<span class="tvs-players"><span class="status-dot ${escapeHtml(live.status || 'unknown')}"></span>${escapeHtml(jogadores)}</span>` : ''}
          <span class="tvs-count" title="${escapeHtml(I18N.t('team.itemsHere'))}">
            ${Icon.svg('pin', 12)} ${contagem}
          </span>
        </div>
        <div class="tvs-acts">
          <button class="btn-small" data-act="ver">${escapeHtml(I18N.t('team.seeThisServer'))}</button>
          ${podeDesvincular
            ? `<button class="btn-small btn-ghost" data-act="unlink"
                 title="${escapeHtml(I18N.t('team.unlinkServer'))}">${Icon.svg('close', 13)}</button>`
            : ''}
        </div>
      </article>`;
  }).join('');

  box.onclick = async (e) => {
    const card = e.target.closest('[data-bmid]');
    const btn = e.target.closest('[data-act]');
    if (!card || !btn) return;
    const bmId = card.dataset.bmid;

    if (btn.dataset.act === 'ver') {
      TeamView.escopo = bmId;
      renderTeamScope();
      switchTeamTab('map');
      await loadTeam();
      return;
    }
    if (btn.dataset.act === 'unlink') {
      const nome = (Team.servers.find((s) => s.bmId === bmId) || {}).name || bmId;
      if (!await Ask.confirm(I18N.t('team.confirmUnlink', { name: nome }))) return;
      if (Team.live) {
        const rede = await window.api.liveUnlinkServer(bmId);
        if (!rede.ok && rede.error !== 'needs_deploy') { toast(erroTime(rede)); return; }
      }
      const r = await window.api.teamUnlinkServer(g.id, bmId,
        { papelRemoto: Team.live ? (g.myRole || null) : null });
      if (!r.ok) { toast(erroTime(r)); return; }
      if (TeamView.escopo === bmId) TeamView.escopo = null;
      await loadTeam();
    }
  };
}

// Quantos itens do time pertencem a este servidor. É o número que
// responde "tem alguma coisa aqui?" sem precisar abrir.
function contarDoServidor(bmId) {
  return (Team.items || []).filter((it) =>
    it.kind !== 'comment' && (it.serverBmId || null) === bmId).length;
}

// ------------------------------------------------------------
// Vincular
// ------------------------------------------------------------
async function abrirVincularServidor() {
  const g = currentGroup();
  if (!g) return;
  if (!Team.caps['server.link']) { toast(I18N.t('team.err_forbidden')); return; }

  const jaTem = new Set((Team.servers || []).map((s) => s.bmId));
  const candidatos = (AppState.config.servers || []).filter((s) => !jaTem.has(s.bmId));
  if (!candidatos.length) {
    toast(I18N.t(jaTem.size ? 'team.allAlreadyLinked' : 'team.noServersToLink'));
    return;
  }

  const escolhido = await Ask.pick(I18N.t('team.pickServer'),
    candidatos.map((s) => ({ valor: s.bmId, texto: displayName(s), sub: `${s.ip}:${s.port}` })));
  if (!escolhido) return;

  const s = candidatos.find((x) => x.bmId === escolhido);

  // AO VIVO, o vínculo vai primeiro para a API: ele precisa valer
  // para o time inteiro. Se a rota ainda não existe, segue para o
  // disco — o app funciona hoje e sincroniza quando o deploy subir.
  if (Team.live) {
    const rede = await window.api.liveLinkServer({
      bmId: s.bmId, name: displayName(s), ip: s.ip, port: s.port,
      map: (LiveData[s.bmId] || {}).map || s.lastMap || null
    });
    if (!rede.ok && rede.error !== 'needs_deploy') { toast(erroTime(rede)); return; }
    if (!rede.ok) toast(I18N.t('team.linkLocalOnly'));
  }
  // `papelRemoto` só vale quando o time vive no servidor: aí ele
  // não está no store local e a checagem de papel precisa vir daqui.
  // No modo local o store usa a hierarquia dele e ignora isto.
  const r = await window.api.teamLinkServer(g.id, {
    bmId: s.bmId, name: displayName(s), ip: s.ip, port: s.port,
    map: (LiveData[s.bmId] || {}).map || s.lastMap || null
  }, { papelRemoto: Team.live ? (g.myRole || null) : null });
  if (!r.ok) { toast(erroTime(r)); return; }
  await loadTeam();
  toast(I18N.t('team.linked', { name: displayName(s) }));
}

// ------------------------------------------------------------
// O bloco "time deste servidor", dentro da tela do servidor
// ------------------------------------------------------------
async function renderServerTeams(bmId) {
  const box = document.getElementById('tk-team');
  const lista = document.getElementById('tk-team-list');
  if (!box || !lista) return;

  let grupos = [];
  try { grupos = (await window.api.teamGroupsForServer(bmId)) || []; } catch { grupos = []; }

  // Sem time, o bloco some inteiro. Um quadro dizendo "nenhum time"
  // em toda tela de servidor seria ruído permanente para quem não
  // usa time nenhum.
  box.classList.toggle('hidden', grupos.length === 0);
  if (!grupos.length) return;

  lista.innerHTML = grupos.map((g) => `
    <button class="tkt-row" data-gid="${escapeHtml(g.id)}">
      <span class="tkt-name">${escapeHtml(g.name)}</span>
      <span class="role-chip ${escapeHtml(g.myRole || 'guest')}">${escapeHtml(I18N.t('team.role_' + (g.myRole || 'guest')))}</span>
      <span class="tkt-members">${escapeHtml(I18N.t('team.memberCount', { n: g.members }))}</span>
      <span class="tkt-go">${Icon.svg('arrowRight', 13)}</span>
    </button>`).join('');

  lista.onclick = (e) => {
    const row = e.target.closest('[data-gid]');
    if (!row) return;
    // Abre a área do time JÁ no escopo deste servidor, e o Voltar
    // devolve para o servidor de onde a pessoa saiu.
    Team.currentId = row.dataset.gid;
    openTeamView({ bmId, voltarPara: 'tracking' });
  };
}

// ------------------------------------------------------------
// OS SERVIDORES DOS SEUS TIMES, NO MENU LATERAL
// ------------------------------------------------------------
// "Em vez de aparecer o histórico de servidores, já aparecer os
// servidores vinculados a times."
//
// A troca faz sentido: "onde o meu time joga" é pergunta de toda
// abertura do app; "quais servidores eu abri semana passada", quase
// nunca. E aqui a lista é de TODOS os seus times somados — no menu
// não existe um time "atual", então filtrar por um deles esconderia
// metade sem explicar.
//
// A seção some inteira quando não há vínculo: para quem não usa
// time, o menu continua exatamente como era.
async function renderDrawerTeamServers() {
  const sec = document.getElementById('drawer-teamservers-sec');
  const box = document.getElementById('drawer-teamservers');
  if (!sec || !box) return;

  // Junta os servidores de todos os times, sem repetir. O mesmo
  // servidor em dois times aparece UMA vez, com os dois nomes — a
  // lista é de servidores, não de vínculos.
  const porServidor = new Map();
  for (const g of (Team.groups || [])) {
    let lista = [];
    try { lista = (await window.api.teamServers(g.id)) || []; } catch { lista = []; }
    for (const s of lista) {
      if (!porServidor.has(s.bmId)) porServidor.set(s.bmId, { ...s, times: [] });
      porServidor.get(s.bmId).times.push(g.name);
    }
  }

  const itens = [...porServidor.values()];
  sec.classList.toggle('hidden', itens.length === 0);
  const cont = document.getElementById('count-teamservers');
  if (cont) cont.textContent = itens.length;
  if (!itens.length) { box.innerHTML = ''; return; }

  // Favorito em cima, como no resto do app.
  const cfgDe = (bmId) => (AppState.config.servers || []).find((x) => x.bmId === bmId) || null;
  itens.sort((a, b) => {
    const fa = !!(cfgDe(a.bmId) || {}).favorite, fb = !!(cfgDe(b.bmId) || {}).favorite;
    if (fa !== fb) return fa ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  box.innerHTML = itens.map((s) => {
    const cfg = cfgDe(s.bmId);
    const live = (typeof LiveData !== 'undefined' && LiveData[s.bmId]) || {};
    const fav = !!(cfg && cfg.favorite);
    // Servidor vinculado que você NÃO tem no app (alguém do time
    // vinculou). Aparece, mas sem abrir: clicar levaria a uma tela
    // sem dado nenhum.
    const tenho = !!cfg;
    return `
      <div class="dts-row${fav ? ' fav' : ''}${tenho ? '' : ' ausente'}" data-bmid="${escapeHtml(s.bmId)}">
        <button class="dts-main" data-act="abrir" ${tenho ? '' : 'disabled'}
                title="${escapeHtml(tenho ? s.name : I18N.t('nav.teamServerMissing'))}">
          <span class="dts-dot status-dot ${escapeHtml(live.status || 'unknown')}"></span>
          <span class="dts-body">
            <span class="dts-name">${escapeHtml(s.name)}</span>
            <span class="dts-meta">${escapeHtml(s.times.join(' · '))}${
              live.players != null ? ` · ${live.players}/${live.maxPlayers == null ? '?' : live.maxPlayers}` : ''}</span>
          </span>
        </button>
        ${tenho ? `<button class="dts-fav${fav ? ' on' : ''}" data-act="fav"
           title="${escapeHtml(I18N.t(fav ? 'card.unfavorite' : 'card.favorite'))}">${Icon.svg('star', 13)}</button>` : ''}
      </div>`;
  }).join('');

  box.onclick = async (e) => {
    const linha = e.target.closest('[data-bmid]');
    const btn = e.target.closest('[data-act]');
    if (!linha || !btn) return;
    const bmId = linha.dataset.bmid;
    if (btn.dataset.act === 'fav') {
      await toggleFavorite(bmId);
      await renderDrawerTeamServers();
      return;
    }
    if (typeof closeDrawer === 'function') closeDrawer();
    if (TeamView.aberta) closeTeamView();
    openTracking(bmId);
  };
}

// ------------------------------------------------------------
// Ligações
// ------------------------------------------------------------
function initTeamView() {
  const back = document.getElementById('team-back');
  if (back) back.addEventListener('click', closeTeamView);

  const tile = document.getElementById('drawer-teams');
  if (tile) tile.addEventListener('click', () => openTeamView({}));

  const sel = document.getElementById('tv-scope');
  if (sel) {
    sel.addEventListener('change', async () => {
      TeamView.escopo = sel.value || null;
      await loadTeam();
    });
  }

  const btn = document.getElementById('team-link-server');
  if (btn) btn.addEventListener('click', abrirVincularServidor);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && TeamView.aberta && !document.querySelector('.modal-backdrop:not(.hidden)')) {
      closeTeamView();
    }
  });
}
