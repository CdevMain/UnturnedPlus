// ============================================================
// list.js — página inicial: cards, seções, busca, pastas
//
// Estrutura da home (nesta ordem):
//   1. Card ESPECIAL do servidor em que o jogador está agora
//   2. Favoritos (seção própria, sempre no topo)
//   3. Pastas
//   4. Demais servidores
//
// Dentro de uma pasta a home vira a "home da pasta": só os
// servidores dela, com uma barra de volta.
// ============================================================

// Cache de dados vivos por servidor.
// bmId -> { name, players, maxPlayers, status, map, icon, description, mods }
const LiveData = {};

// Converte um caminho absoluto de arquivo em URL file://.
function toFileUrl(p) { return 'file:///' + String(p).replace(/\\/g, '/'); }

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str == null ? '' : str);
  return d.innerHTML;
}

// ------------------------------------------------------------
// Fundo do card
//
// Preferência: a imagem do MAPA importada da instalação local.
// Se o mapa não foi encontrado (mapa de Workshop que o usuário não
// tem, ou mapas ainda não sincronizados), usamos o ÍCONE do
// servidor DESSATURADO — assim o card nunca fica "pelado", e dá
// para perceber visualmente que aquele fundo é um fallback.
// ------------------------------------------------------------
async function applyCardBackground(cardEl, live) {
  // Idempotente: se o mapa e o ícone não mudaram, não mexemos no
  // DOM (evita piscar o fundo a cada ciclo de polling).
  const key = `${(live && live.map) || ''}|${(live && live.icon) || ''}`;
  if (cardEl.dataset.bgKey === key) return;
  cardEl.dataset.bgKey = key;

  cardEl.classList.remove('has-bg', 'bg-fallback');
  cardEl.style.removeProperty('--card-bg');

  if (live && live.map) {
    try {
      const filePath = await window.api.mapImagePath(live.map, 'map');
      if (filePath) {
        cardEl.style.setProperty('--card-bg', `url("${toFileUrl(filePath)}")`);
        cardEl.classList.add('has-bg');
        return;
      }
    } catch { /* segue para o fallback */ }
  }

  if (live && live.icon) {
    cardEl.style.setProperty('--card-bg', `url("${live.icon}")`);
    cardEl.classList.add('has-bg', 'bg-fallback');
  }
}

function iconHtml(live, cls = 'card-icon') {
  if (live && live.icon) {
    return `<div class="${cls}"><img src="${escapeHtml(live.icon)}" alt="" referrerpolicy="no-referrer"
      onerror="iconFallback(this,'gamepad')"></div>`;
  }
  return `<div class="${cls}">${Icon.svg('gamepad', 20)}</div>`;
}

// Um servidor salvo "casa" com o servidor atual? (IP + porta de jogo)
function matchesCurrent(s) {
  const cs = AppState.currentServer;
  return !!(cs && cs.live && cs.ip && s.ip === cs.ip && Number(s.port) === Number(cs.port));
}

// Nome exibido: o vivo (do A2S) tem prioridade sobre o salvo.
function displayName(s) {
  const live = LiveData[s.bmId] || {};
  return live.name || s.name || s.bmId;
}

function serverDescription(s) {
  const live = LiveData[s.bmId] || {};
  if (live.description) return live.description;
  // O log do jogo tem a descrição do servidor em que estamos agora,
  // mesmo quando o A2S não publica as rules.
  if (matchesCurrent(s) && AppState.currentServer && AppState.currentServer.description) {
    return AppState.currentServer.description;
  }
  return null;
}

// ------------------------------------------------------------
// Card de servidor
// ------------------------------------------------------------
// Amigos da Steam que estão neste servidor agora (vazio quando a
// integração está desligada — o padrão).
function cardFriends(s) {
  const cfg = AppState.config;
  if (!cfg.steam || !cfg.steam.enabled || cfg.steam.showFriendsOnCards === false) return [];
  return friendsOnServer(s.ip, s.port);
}

// Conteúdo INTERNO do card (sem o elemento raiz — ver fillGrid).
function serverCardInnerHtml(s) {
  const live = LiveData[s.bmId] || {};
  const isCurrent = matchesCurrent(s);
  const selected = AppState.selectedForDelete.has(s.bmId);
  const address = `${s.ip}:${s.port}`;

  // Tags automáticas derivadas do que sabemos ao vivo.
  const autoTags = [];
  if (live.map) autoTags.push(live.map);
  if (live.modCount) autoTags.push(I18N.t('card.modsTag', { n: live.modCount }));
  if (live.status === 'offline') autoTags.push(I18N.t('status.offline'));

  const desc = serverDescription(s);
  const descHtml = desc
    ? RichText.toHtml(desc, { singleLine: true, maxScale: 1.25, baseSize: 14 })
    : '';

  // CARREGANDO é diferente de VAZIO.
  //
  // `LiveData[bmId]` só existe depois da primeira resposta. Antes
  // disso o card mostrava o lugar do número em branco e a bolinha
  // cinza — e isso lê como "servidor sem ninguém", não como "ainda
  // estou perguntando". Ao abrir o app, com todos os cards assim,
  // parecia que o app tinha carregado errado.
  //
  // A distinção é justamente a AUSÊNCIA da entrada: quem já
  // respondeu tem entrada, mesmo que offline (aí o vazio é verdade
  // e deve aparecer como vazio).
  const carregando = !LiveData[s.bmId];

  const players = live.players != null
    ? `${live.players}/${live.maxPlayers == null ? '?' : live.maxPlayers}`
    : '';

  return `
      ${AppState.deleteMode ? `<input type="checkbox" class="card-check" ${selected ? 'checked' : ''}>` : ''}

      <div class="card-head">
        ${iconHtml(live)}
        <div class="card-headtext">
          <div class="card-title">
            ${isCurrent ? `<span class="live-chip"><span class="live-dot"></span>${escapeHtml(I18N.t('current.playingNow'))}</span>` : ''}
            <span class="card-name">${escapeHtml(displayName(s))}</span>
          </div>
          <div class="card-address">
            ${AppState.config.showFlags !== false ? GeoFlag.html(GeoFlag.peek(s.ip)) : ''}
            <span class="copy-ip" data-copy="${escapeHtml(address)}"
                  title="${escapeHtml(I18N.t('card.copyIp'))}">${escapeHtml(address)}</span>
          </div>
        </div>
      </div>

      ${descHtml ? `<div class="card-desc urt-line">${descHtml}</div>` : ''}

      <div class="card-foot">
        <div class="card-players ${carregando ? '' : (live.players ? '' : 'zero')}">
          <span class="status-dot ${carregando ? 'carregando' : escapeHtml(live.status || 'unknown')}"></span>
          ${carregando
            ? `<span class="sk sk-lg w-sm" aria-hidden="true"></span>
               <span class="muted">${escapeHtml(I18N.t('common.loading'))}</span>`
            : `<strong>${escapeHtml(players)}</strong>
               <span class="muted">${escapeHtml(I18N.t('home.playersOnline'))}</span>
               ${friendAvatarsHtml(cardFriends(s))}`}
        </div>
        <div class="card-tags">
          ${typeof wipeChipHtml === 'function' ? wipeChipHtml(s.bmId) : ''}
          ${(s.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          ${carregando
            ? '<span class="sk w-md" aria-hidden="true"></span>'
            : autoTags.map((t) => `<span class="tag auto">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>

      <!-- AS AÇÕES FORAM PARA UM MENU.
           Quatro botões redondos por card, num grid com dezenas de
           cards, viravam uma parede de bolinhas: a informação do
           card (nome, jogadores, tags) competia com controles que
           quase nunca são usados.

           O que NÃO some junto é o ESTADO. Favorito e rastreado são
           informação — quem passa o olho na lista precisa ver quais
           são quais sem abrir menu nenhum. Por isso os dois viram
           SELOS ao lado do botão de menu; e o card inteiro continua
           com a borda dourada/vermelha.

           E agora eles também DESLIGAM. A Sara pediu: "quero parar
           de fazer tracking e parar de ser favorito clicando em cima
           do ícone que fica mostrando quando já tem". Faz sentido: o
           selo é onde o olho já está na hora de decidir desligar, e
           abrir o menu para isso é um passo a mais sem motivo.

           LIGAR continua só no menu, de propósito. O selo só existe
           quando o estado está ligado, então clicar nele só pode
           querer dizer uma coisa — não é um interruptor ambíguo. -->
      <div class="card-actions">
        ${s.favorite ? `<button class="card-flag fav" data-off="fav" title="${
          escapeHtml(I18N.t('card.clickToUnfav'))}">${Icon.svg('star', 14)}</button>` : ''}
        ${s.tracked ? `<button class="card-flag track" data-off="track" title="${
          escapeHtml(I18N.t('card.clickToUntrack'))}">${Icon.svg('radar', 14)}</button>` : ''}
        <button class="card-menu-btn" data-cardmenu
                title="${escapeHtml(I18N.t('card.actions'))}"
                aria-haspopup="true">${Icon.svg('dots', 16)}</button>
      </div>

      <div class="card-menu hidden" data-menu>
        <button class="cmn-item${s.favorite ? ' on fav' : ''}" data-fav>
          <span class="cmn-ico">${Icon.svg('star', 15)}</span>
          <span>${escapeHtml(I18N.t(s.favorite ? 'card.unfavShort' : 'card.favShort'))}</span>
        </button>
        <button class="cmn-item${s.tracked ? ' on track' : ''}" data-track
                title="${escapeHtml(I18N.t(s.tracked ? 'card.untrack' : 'card.track'))}">
          <span class="cmn-ico">${Icon.svg('radar', 15)}</span>
          <!-- Rótulo CURTO. O texto longo ("avisa quando alguém entra
               ou sai") é ótimo como dica e péssimo como item de
               menu: fazia o menu ficar do tamanho do card. Ele
               continua na dica do item. -->
          <span>${escapeHtml(I18N.t(s.tracked ? 'card.untrackShort' : 'card.trackShort'))}</span>
        </button>
        <div class="cmn-sep"></div>
        <button class="cmn-item" data-act="quick">
          <span class="cmn-ico">${Icon.svg('eye', 15)}</span>
          <span>${escapeHtml(I18N.t('card.quickView'))}</span>
        </button>
        <button class="cmn-item" data-act="move">
          <span class="cmn-ico">${Icon.svg('folder', 15)}</span>
          <span>${escapeHtml(I18N.t('folder.moveTitle'))}</span>
        </button>
      </div>`;
}

// ------------------------------------------------------------
// Menu de ações do card
//
// Um de cada vez: abrir o segundo fecha o primeiro. Dois menus
// abertos ao mesmo tempo num grid de cards é bagunça, e ainda deixa
// o usuário sem saber qual clique vale.
//
// O fechamento por clique fora é registrado UMA vez, no documento,
// não um por card. Com trinta servidores na tela, trinta ouvintes
// de clique global seria desperdício — e cada redesenho do card
// (que acontece a cada ciclo de polling) criaria mais um.
// ------------------------------------------------------------
// O menu SAI do card para abrir.
//
// O card tem `overflow: hidden` (é o que mantém a imagem e as tags
// dentro da borda arredondada), então um menu filho dele nasce
// cortado. E mesmo sem o overflow, o card seguinte na grade
// passaria por cima.
//
// Então, ao abrir, o menu é movido para o `body` e posicionado em
// coordenadas de tela a partir do botão. Ao fechar, volta para o
// card — que é quem o redesenha a cada ciclo de polling.
let menuAbertoAgora = null;   // { menu, card, btn }

function fecharMenusDeCard() {
  if (!menuAbertoAgora) return;
  const { menu, card, btn } = menuAbertoAgora;
  menu.classList.add('hidden');
  menu.classList.remove('flutuante');
  menu.style.left = menu.style.top = '';
  // Devolve ao card. Se o card já foi redesenhado e sumiu do
  // documento, o menu vai junto para o lixo — por isso o teste
  // `isConnected`.
  if (card && card.isConnected) card.appendChild(menu);
  else menu.remove();
  if (btn) btn.classList.remove('on');
  menuAbertoAgora = null;
}

function abrirMenuDoCard(card) {
  // ATENÇÃO: com o menu aberto ele NÃO está mais dentro do card
  // (foi para o body), então `card.querySelector` devolve null.
  // Perguntar ao estado é o único jeito de saber se este card é o
  // que está aberto.
  const eraEste = menuAbertoAgora && menuAbertoAgora.card === card;
  fecharMenusDeCard();
  if (eraEste) return;              // clicar de novo fecha

  const menu = card.querySelector('[data-menu]');
  const btn = card.querySelector('[data-cardmenu]');
  if (!menu) return;

  // O menu sai do card e passa a viver solto: por isso ele precisa
  // carregar consigo A QUAL SERVIDOR pertence. Sem isto o clique
  // num item não teria como saber em que card mexer — foi
  // exatamente o que quebrou quando movi o nó para o body e a
  // delegação do card deixou de alcançá-lo.
  menu.dataset.bmid = card.dataset.bmid;

  document.body.appendChild(menu);
  menu.classList.remove('hidden');
  menu.classList.add('flutuante');
  if (btn) btn.classList.add('on');
  menuAbertoAgora = { menu, card, btn };

  // Posiciona depois de estar visível: um elemento escondido mede 0.
  const r = btn.getBoundingClientRect();
  const cx = menu.offsetWidth, cy = menu.offsetHeight;
  const margem = 8;
  // Alinhado à direita do botão, abrindo para cima. Se não couber
  // para cima, abre para baixo; se não couber à esquerda, encosta
  // na margem. É o mínimo para o menu nunca sair da tela.
  let left = r.right - cx;
  let top = r.top - cy - 6;
  if (top < margem) top = r.bottom + 6;
  if (left < margem) left = margem;
  if (left + cx > window.innerWidth - margem) left = window.innerWidth - cx - margem;
  if (top + cy > window.innerHeight - margem) top = Math.max(margem, window.innerHeight - cy - margem);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// Rolar ou redimensionar com o menu aberto deixaria ele parado no
// ar, longe do card. Fecha.
window.addEventListener('scroll', () => fecharMenusDeCard(), true);
window.addEventListener('resize', () => fecharMenusDeCard());

// Cliques DENTRO do menu aberto.
//
// Enquanto o menu estava dentro do card, a delegação do card dava
// conta. Solto no body, ele não é mais descendente de card nenhum,
// e aquele `card.addEventListener('click')` nunca era chamado: o
// menu abria e os itens não faziam nada.
//
// Este ouvinte é único, no documento, e resolve o servidor pelo
// `data-bmid` que o menu carrega.
document.addEventListener('click', (e) => {
  const menu = e.target.closest('.card-menu.flutuante');
  if (!menu) return;
  const bmId = menu.dataset.bmid;
  if (!bmId) return;

  const fav = e.target.closest('[data-fav]');
  const track = e.target.closest('[data-track]');
  const act = e.target.closest('[data-act]');
  if (!fav && !track && !act) return;

  e.stopPropagation();
  fecharMenusDeCard();              // escolher fecha, sempre

  if (fav) toggleFavorite(bmId);
  else if (track) toggleTracked(bmId);
  else if (act.dataset.act === 'quick') openQuickView(bmId);
  else if (act.dataset.act === 'move') openMoveModal([bmId]);
}, true);

document.addEventListener('click', (e) => {
  if (e.target.closest('.card-menu') || e.target.closest('[data-cardmenu]')) return;
  fecharMenusDeCard();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenusDeCard(); });

// Handlers do card. Ficam no ELEMENTO RAIZ e usam delegação, então
// sobrevivem a qualquer atualização do conteúdo interno. Isso é o
// que garante que um clique nunca se perca por causa do polling.
function attachCardShell(card) {
  card.addEventListener('click', (e) => {
    const bmId = card.dataset.bmid;

    // Shift tem prioridade sobre tudo: quem segura Shift quer o
    // Quick View, mesmo que o clique caia em cima do IP.
    if (e.shiftKey && !AppState.deleteMode) { openQuickView(bmId); return; }

    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) { e.stopPropagation(); copyIp(copyEl.dataset.copy, copyEl); return; }

    // ---- menu de três pontos ----
    if (e.target.closest('[data-cardmenu]')) {
      e.stopPropagation();
      abrirMenuDoCard(card);
      return;
    }

    // Cada item do menu fecha ao ser escolhido: o menu aberto por
    // cima de um card que acabou de mudar é confusão garantida.
    const dentroDoMenu = !!e.target.closest('[data-menu]');

    // Clique no SELO desliga aquele estado. Vem antes do `data-fav`
    // do menu porque é outro elemento e outro significado: o item
    // do menu ALTERNA, o selo só DESLIGA. Como o selo só existe
    // ligado, o efeito é o mesmo — mas escrever a intenção separada
    // evita que alguém depois "simplifique" os dois no mesmo lugar e
    // faça o selo ligar de volta o que acabou de desligar.
    const selo = e.target.closest('[data-off]');
    if (selo) {
      e.stopPropagation();
      if (selo.dataset.off === 'fav') toggleFavorite(bmId);
      else toggleTracked(bmId);
      return;
    }

    if (e.target.closest('[data-fav]')) {
      e.stopPropagation();
      if (dentroDoMenu) fecharMenusDeCard();
      toggleFavorite(bmId);
      return;
    }
    if (e.target.closest('[data-track]')) {
      e.stopPropagation();
      if (dentroDoMenu) fecharMenusDeCard();
      toggleTracked(bmId);
      return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      if (dentroDoMenu) fecharMenusDeCard();
      if (act.dataset.act === 'quick') openQuickView(bmId);
      else if (act.dataset.act === 'move') openMoveModal([bmId]);
      return;
    }

    if (AppState.deleteMode) { toggleDeleteSelection(bmId); return; }
    openTracking(bmId);
  });

  // Arrastar para dentro de uma pasta.
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/x-unturned-server', card.dataset.bmid);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
}

// Assinatura do estado visível do card. Só redesenhamos o conteúdo
// quando ela muda — um ciclo de polling que não mudou nada não
// mexe no DOM.
function cardSignature(s) {
  const live = LiveData[s.bmId] || {};
  const geo = GeoFlag.peek(s.ip);
  return [
    displayName(s), live.players, live.maxPlayers, live.status, live.map,
    live.icon, live.modCount, serverDescription(s),
    geo && geo.countryCode, s.favorite, s.tracked, (s.tags || []).join(','),
    matchesCurrent(s), AppState.deleteMode, AppState.selectedForDelete.has(s.bmId),
    AppState.config.showFlags !== false, I18N.lang,
    cardFriends(s).map((f) => f.steamId).join(','),
    // O selo de wipe faz parte do card, então TEM que entrar aqui.
    // A assinatura é o que decide se o HTML é remontado; sem esta
    // linha, cadastrar um wipe não aparecia no card até algo
    // ALHEIO mudar (um jogador entrar, o servidor cair).
    // Entra o texto do selo, não a data: assim ele também se
    // atualiza sozinho quando a contagem vira de "3d" para "2d".
    wipeSignature(s.bmId)
  ].join('|');
}

// Só o que muda o que se VÊ. A data exata mudaria a assinatura a
// cada segundo e o card seria remontado sem parar.
function wipeSignature(bmId) {
  if (typeof Agenda === 'undefined') return '';
  const w = (Agenda.cache[String(bmId)] || {}).wipe;
  if (!w) return '';
  // O selo muda de "vai acontecer" para "acabou de acontecer": a
  // assinatura tem que enxergar isso, senão o card só atualizaria
  // quando a contagem virasse de hora.
  if (w.justHappened && !w.happening) return 'was:' + Math.floor((w.sinceMs || 0) / 60000);
  return countdownText(w.nextAt - Date.now());
}

// ------------------------------------------------------------
// Copiar IP / favoritar
// ------------------------------------------------------------
async function copyIp(text, el) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Fallback pelo processo principal (algumas builds do Electron
    // bloqueiam a Clipboard API sem permissão explícita).
    try { ok = await window.api.copyText(text); } catch { ok = false; }
  }
  if (el) {
    el.classList.add(ok ? 'copied' : 'copy-failed');
    setTimeout(() => el.classList.remove('copied', 'copy-failed'), 1200);
  }
  toast(I18N.t(ok ? 'card.copied' : 'card.copyFailed', { ip: text }));
}

async function toggleFavorite(bmId) {
  const s = AppState.config.servers.find((x) => x.bmId === bmId);
  if (!s) return;
  s.favorite = !s.favorite;
  await saveAppConfig();
  renderHome();
  toast(I18N.t(s.favorite ? 'card.favorited' : 'card.unfavorited', { name: displayName(s) }));
}

// Marcar um servidor como RASTREADO é dizer "me avise sobre este".
// É o que liga as notificações de entrada e saída de jogador para
// ele — antes só o servidor do overlay (ou aquele em que você
// estava jogando) notificava, o que deixava de fora justamente o
// caso de acompanhar o servidor do time enquanto joga em outro.
async function toggleTracked(bmId) {
  const s = AppState.config.servers.find((x) => x.bmId === bmId);
  if (!s) return;
  s.tracked = !s.tracked;
  await saveAppConfig();
  renderHome();
  toast(I18N.t(s.tracked ? 'card.tracked' : 'card.untracked', { name: displayName(s) }));
}

// ------------------------------------------------------------
// Renderização da home
// ------------------------------------------------------------
function currentFilter() {
  const el = document.getElementById('search-input');
  return (el ? el.value : '').trim().toLowerCase();
}

function serverMatchesFilter(s, q) {
  if (!q) return true;
  const live = LiveData[s.bmId] || {};
  const folder = getFolder(s.folderId);
  const haystack = [
    live.name, s.name, s.bmId, `${s.ip}:${s.port}`, live.map,
    folder && folder.name,
    RichText.toPlain(serverDescription(s) || ''),
    ...(s.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

function sortServers(list) {
  return list.slice().sort((a, b) => {
    const cur = (matchesCurrent(b) ? 1 : 0) - (matchesCurrent(a) ? 1 : 0);
    if (cur) return cur;
    const la = LiveData[a.bmId] || {}, lb = LiveData[b.bmId] || {};
    const on = ((lb.status === 'online') ? 1 : 0) - ((la.status === 'online') ? 1 : 0);
    if (on) return on;
    const pl = (lb.players || 0) - (la.players || 0);
    if (pl) return pl;
    return displayName(a).localeCompare(displayName(b));
  });
}

// ------------------------------------------------------------
// fillGrid — reconciliação, NÃO "innerHTML = tudo de novo".
//
// A home se redesenha a cada ciclo de polling. Se cada redesenho
// recriasse os cards, um clique que caísse exatamente nesse
// instante seria perdido (o nó clicado deixa de existir antes do
// evento ser despachado) — e hover, foco e a rolagem piscariam.
//
// Então mantemos o MESMO elemento por servidor: ele é criado uma
// vez, ganha os handlers uma vez, e só o conteúdo interno é
// reescrito — e ainda assim apenas quando a assinatura muda.
// ------------------------------------------------------------
function fillGrid(grid, servers) {
  if (!grid.__cards) grid.__cards = new Map();
  const cards = grid.__cards;
  const seen = new Set();

  servers.forEach((s, index) => {
    seen.add(s.bmId);
    let card = cards.get(s.bmId);

    if (!card) {
      card = document.createElement('div');
      card.dataset.bmid = s.bmId;
      card.draggable = true;
      attachCardShell(card);
      cards.set(s.bmId, card);
    }

    const sig = cardSignature(s);
    if (card.dataset.sig !== sig) {
      card.dataset.sig = sig;
      card.innerHTML = serverCardInnerHtml(s);

      const live = LiveData[s.bmId] || {};
      // As classes de fundo são preservadas: quem manda nelas é a
      // applyCardBackground, e recalculá-las aqui faria o fundo
      // piscar a cada atualização.
      const bgClasses = ['has-bg', 'bg-fallback'].filter((c) => card.classList.contains(c));
      card.className = [
        'server-card',
        s.favorite ? 'favorite' : '',
        s.tracked ? 'tracked' : '',
        live.status === 'offline' ? 'offline' : '',
        AppState.selectedForDelete.has(s.bmId) ? 'selected' : '',
        matchesCurrent(s) ? 'playing' : '',
        ...bgClasses
      ].filter(Boolean).join(' ');

      applyCardBackground(card, live); // assíncrono; só age se o fundo mudou
    }

    // Reordena sem recriar (appendChild/insertBefore MOVEM o nó).
    if (grid.children[index] !== card) {
      grid.insertBefore(card, grid.children[index] || null);
    }
  });

  // Remove os que saíram da lista/filtro.
  for (const [bmId, el] of cards) {
    if (!seen.has(bmId)) { el.remove(); cards.delete(bmId); }
  }
}

function renderHome() {
  const all = AppState.config.servers || [];
  const q = currentFilter();
  const inFolder = AppState.currentFolderId;

  renderFolderBar();
  renderFolders();
  renderCurrentServer();
  renderDeleteBar();
  renderFriendsSection();

  // Dentro de uma pasta, o escopo é só ela. Na raiz, pegamos os
  // servidores SEM pasta (os de dentro aparecem ao abrir a pasta).
  // A busca é a exceção: ao pesquisar, varremos tudo — é o que a
  // pessoa espera de uma busca.
  let scope;
  if (inFolder) scope = serversInFolder(inFolder);
  else if (q) scope = all;
  else scope = all.filter((s) => !s.folderId);

  const visible = scope.filter((s) => serverMatchesFilter(s, q));

  // Favoritos ficam numa seção separada, sempre no topo.
  const favorites = sortServers(visible.filter((s) => s.favorite));
  const rest = sortServers(visible.filter((s) => !s.favorite));

  const favSection = document.getElementById('section-favorites');
  favSection.classList.toggle('hidden', favorites.length === 0);
  document.getElementById('count-favorites').textContent = favorites.length;
  fillGrid(document.getElementById('grid-favorites'), favorites);

  const serversSection = document.getElementById('section-servers');
  serversSection.classList.toggle('hidden', rest.length === 0);
  document.getElementById('count-servers').textContent = rest.length;
  fillGrid(document.getElementById('cards-grid'), rest);

  // Estado vazio: só quando REALMENTE não há nada para mostrar
  // (não queremos "nenhum servidor" com 3 pastas cheias na tela).
  const noFolders = (AppState.config.folders || []).length === 0;
  const nothing = favorites.length === 0 && rest.length === 0 && (!!inFolder || !!q || noFolders);
  document.getElementById('empty-state').classList.toggle('hidden', !nothing);

  document.getElementById('home-count').textContent =
    I18N.t('home.count', { n: all.length });

  // Busca os países que ainda não conhecemos e redesenha uma vez só.
  if (AppState.config.showFlags !== false) {
    GeoFlag.warm(visible.map((s) => s.ip)).then((changed) => {
      if (changed && !AppState.trackingId) renderHome();
    });
  }
}

// Mantido por compatibilidade com o restante do app.
function renderCards() { renderHome(); }

// ---------------- Atualizar dados dos cards (Query Port local) ----------------
window.api.onQueryUpdate((payload) => {
  const { bmId, info, unturned, error } = payload;
  const prev = LiveData[bmId] || {};
  if (error) {
    LiveData[bmId] = { ...prev, status: 'offline' };
  } else {
    LiveData[bmId] = {
      ...prev,
      name: info.name,
      players: info.players,
      maxPlayers: info.maxPlayers,
      status: 'online',
      map: info.map,
      description: (unturned && unturned.fields && unturned.fields.description) || prev.description || null,
      mods: (unturned && unturned.mods) || prev.mods || [],
      modCount: (unturned && unturned.modCount) || prev.modCount || 0,
      icon: (unturned && unturned.iconUrl) || prev.icon || null
    };
  }
  if (!AppState.trackingId) renderHome();
});

// Disparo inicial (um tiro só) pra não esperar o primeiro ciclo do timer.
async function refreshAllCards() {
  await Promise.all((AppState.config.servers || []).map(async (s) => {
    const prev = LiveData[s.bmId] || {};
    try {
      const { info, unturned } = await window.api.queryServerByBmId(s.bmId);
      LiveData[s.bmId] = {
        ...prev,
        name: info.name, players: info.players, maxPlayers: info.maxPlayers,
        status: 'online', map: info.map,
        description: (unturned && unturned.fields && unturned.fields.description) || prev.description || null,
        mods: (unturned && unturned.mods) || [],
        modCount: (unturned && unturned.modCount) || 0,
        icon: (unturned && unturned.iconUrl) || prev.icon || null
      };
    } catch (e) {
      LiveData[s.bmId] = { ...prev, status: 'offline' };
    }
  }));
  renderHome();
}

// Sonda um IP:porta de forma TOLERANTE (nunca lança).
async function tryProbe(ip, gamePort, queryPortOverride) {
  try {
    const probe = await window.api.probeServer(ip, gamePort, queryPortOverride);
    const u = probe.unturned || {};
    return {
      name: (probe.info && probe.info.name) || null,
      map: (probe.info && probe.info.map) || (u.fields && u.fields.map) || null,
      icon: u.iconUrl || null,
      description: (u.fields && u.fields.description) || null,
      players: probe.info ? probe.info.players : null,
      maxPlayers: probe.info ? probe.info.maxPlayers : null,
      mods: u.mods || [],
      modCount: u.modCount || 0,
      queryPort: probe.resolvedQueryPort || null
    };
  } catch (e) {
    toast(I18N.t('add.probeFailed'));
    return { name: null, map: null, icon: null, description: null, players: null, maxPlayers: null, mods: [], modCount: 0, queryPort: null };
  }
}

// ============================================================
// Adicionar servidor — agora com SUGESTÕES vindas do log do jogo
// ============================================================
async function openAddModal() {
  document.getElementById('add-input').value = '';
  document.getElementById('add-tags').value = '';
  document.getElementById('add-queryport').value = '';
  document.getElementById('add-favorite').checked = false;
  document.getElementById('add-error').classList.add('hidden');
  fillFolderSelect(AppState.currentFolderId);
  showModal('modal-add');
  await loadAddSuggestions();
}

// Lê o log do Unturned e oferece os servidores em que o jogador
// entrou recentemente. É o caminho que substitui o "adicionar por
// ID do BattleMetrics", que parou de funcionar sem token.
async function loadAddSuggestions() {
  const box = document.getElementById('add-suggestions');
  const list = document.getElementById('add-suggest-list');
  let suggestions = [];
  try { suggestions = await window.api.getLogSuggestions(); } catch { suggestions = []; }

  if (!suggestions.length) {
    box.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  const existing = new Set((AppState.config.servers || []).map((s) => `${s.ip}:${s.port}`));
  box.classList.remove('hidden');

  list.innerHTML = suggestions.map((sug, i) => {
    const addr = sug.addressable ? `${sug.ip}:${sug.port}` : null;
    const already = !!(addr && existing.has(addr));
    const icon = sug.thumbnail
      ? `<img src="${escapeHtml(sug.thumbnail)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this,'gamepad')">`
      : Icon.svg('gamepad', 18);
    const meta = [
      sug.map, addr,
      sug.mods && sug.mods.length ? I18N.t('add.sugMods', { n: sug.mods.length }) : null
    ].filter(Boolean).join(' · ');

    return `
      <button class="suggest-item${sug.addressable ? '' : ' disabled'}${already ? ' already' : ''}"
              data-index="${i}" ${sug.addressable && !already ? '' : 'disabled'}>
        <span class="suggest-icon">${icon}</span>
        <span class="suggest-body">
          <span class="suggest-name">
            ${sug.open ? `<span class="live-chip small"><span class="live-dot"></span>${escapeHtml(I18N.t('current.playingNow'))}</span>` : ''}
            ${escapeHtml(sug.name)}
          </span>
          <span class="suggest-meta">${escapeHtml(meta)}</span>
          ${!sug.addressable ? `<span class="suggest-warn">${escapeHtml(I18N.t('add.sugP2P'))}</span>` : ''}
          ${already ? `<span class="suggest-warn">${escapeHtml(I18N.t('add.sugAlready'))}</span>` : ''}
        </span>
      </button>`;
  }).join('');

  for (const btn of list.querySelectorAll('.suggest-item')) {
    btn.addEventListener('click', () => {
      const sug = suggestions[Number(btn.dataset.index)];
      if (!sug || !sug.addressable) return;
      document.getElementById('add-input').value = `${sug.ip}:${sug.port}`;
      // Pré-carrega o que o log já sabe, para o card nascer completo
      // mesmo se o servidor estiver offline na hora de adicionar.
      const bmId = `local_${sug.ip}_${sug.port}`;
      LiveData[bmId] = {
        ...(LiveData[bmId] || {}),
        name: sug.name, map: sug.map || null,
        icon: sug.thumbnail || null, description: sug.description || null,
        maxPlayers: sug.maxPlayers || null,
        mods: sug.mods || [], modCount: (sug.mods || []).length
      };
      for (const other of list.querySelectorAll('.suggest-item')) other.classList.remove('picked');
      btn.classList.add('picked');
    });
  }
}

async function addServer() {
  const input = document.getElementById('add-input').value.trim();
  const tags = document.getElementById('add-tags').value
    .split(',').map((t) => t.trim()).filter(Boolean);
  const favorite = document.getElementById('add-favorite').checked;
  const folderId = document.getElementById('add-folder').value || null;
  const errorEl = document.getElementById('add-error');
  errorEl.classList.add('hidden');

  if (!input) {
    errorEl.textContent = I18N.t('add.errorEmpty');
    errorEl.classList.remove('hidden');
    return;
  }

  const qpEl = document.getElementById('add-queryport');
  const queryPortInput = qpEl ? qpEl.value.trim() : '';
  const queryPort = queryPortInput ? parseInt(queryPortInput, 10) : null;

  try {
    let bmId, name, ip, port, map = null, icon = null, description = null;
    let resolvedQueryPort = queryPort;
    let mods = [];

    const ipPortMatch = input.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);

    if (ipPortMatch) {
      // ---- Caminho principal: IP:porta -> consulta DIRETA ao servidor ----
      ip = ipPortMatch[1];
      port = parseInt(ipPortMatch[2], 10);
      bmId = `local_${ip}_${port}`;
      const pre = LiveData[bmId] || {};
      const probe = await tryProbe(ip, port, queryPort);
      name = probe.name || pre.name || `${ip}:${port}`;
      map = probe.map || pre.map || null;
      icon = probe.icon || pre.icon || null;
      description = probe.description || pre.description || null;
      mods = (probe.mods && probe.mods.length) ? probe.mods : (pre.mods || []);
      resolvedQueryPort = probe.queryPort || queryPort;
    } else if (/^\d+$/.test(input)) {
      // ---- ID do BattleMetrics -> resolve só o ENDEREÇO ----
      const resolved = await window.api.resolveBmId(input);
      bmId = String(resolved.id);
      ip = resolved.ip; port = resolved.port; name = resolved.name; map = resolved.map;
      const probe = await tryProbe(ip, port, queryPort);
      if (probe.name) name = probe.name;
      if (probe.map) map = probe.map;
      icon = probe.icon; description = probe.description; mods = probe.mods || [];
      resolvedQueryPort = probe.queryPort || queryPort;
    } else {
      // ---- Nome: busca na listagem pública do BattleMetrics ----
      const results = await window.api.bmScrapeSearch(input);
      const match = results.find((r) => input === `${r.ip}:${r.port}` || input === r.ip) || results[0];
      if (!match) throw new Error(I18N.t('add.errorNotFound'));
      bmId = String(match.id);
      name = match.name; ip = match.ip; port = match.port;
      const probe = await tryProbe(ip, port, queryPort);
      if (probe.name) name = probe.name;
      map = probe.map || map; icon = probe.icon;
      description = probe.description; mods = probe.mods || [];
      resolvedQueryPort = probe.queryPort || queryPort;
    }

    if (AppState.config.servers.some((s) => s.bmId === bmId)) {
      throw new Error(I18N.t('add.errorDuplicate'));
    }

    LiveData[bmId] = {
      ...(LiveData[bmId] || {}),
      name, map: map || null, icon: icon || null,
      description: description || null, mods, modCount: mods.length
    };

    AppState.config.servers.push({
      bmId, name, ip, port,
      queryPort: resolvedQueryPort || null,
      tags, favorite, folderId
    });
    await saveAppConfig();
    await window.api.restartPolling();
    hideModal('modal-add');
    toast(I18N.t('add.success', { name }));
    if (AppState.config.showFlags !== false) GeoFlag.resolve(ip);
    refreshAllCards();
  } catch (e) {
    errorEl.textContent = e.message || I18N.t('add.errorGeneric');
    errorEl.classList.remove('hidden');
  }
}

// ---------------- Exclusão múltipla ----------------
// Com o menu lateral, o modo de exclusão ganhou uma barra própria
// no rodapé da home: fica claro que o modo está ligado, quantos
// estão selecionados, e como sair dele.
function renderDeleteBar() {
  const bar = document.getElementById('delete-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !AppState.deleteMode);
  if (!AppState.deleteMode) return;
  const n = AppState.selectedForDelete.size;
  document.getElementById('delete-bar-text').textContent =
    n ? I18N.t('delete.selected', { n }) : I18N.t('home.deleteHint');
  document.getElementById('delete-bar-confirm').disabled = n === 0;
}

function setDeleteMode(on) {
  AppState.deleteMode = !!on;
  if (!AppState.deleteMode) AppState.selectedForDelete.clear();
  const label = document.getElementById('drawer-delete-label');
  if (label) label.textContent = I18N.t(AppState.deleteMode ? 'home.deleteExit' : 'home.deleteMode');
  renderHome();
}

function toggleDeleteMode() { setDeleteMode(!AppState.deleteMode); }

function toggleDeleteSelection(bmId) {
  if (AppState.selectedForDelete.has(bmId)) AppState.selectedForDelete.delete(bmId);
  else AppState.selectedForDelete.add(bmId);
  renderHome();
}

async function askDeleteSelected() {
  if (AppState.selectedForDelete.size === 0) {
    toggleDeleteMode();
    return;
  }
  document.getElementById('delete-text').textContent =
    I18N.t('delete.confirm', { n: AppState.selectedForDelete.size });

  // Se esses servidores tiverem anotações, perguntamos o que fazer
  // com elas em vez de decidir sozinhos.
  const scopes = [...AppState.selectedForDelete].map((id) => 'server:' + id);
  const counts = await window.api.notesCounts(scopes);
  let notes = 0, shots = 0;
  for (const s of scopes) { notes += (counts[s] || {}).notes || 0; shots += (counts[s] || {}).shots || 0; }

  const row = document.getElementById('delete-notes-row');
  row.classList.toggle('hidden', notes === 0);
  document.getElementById('delete-notes').checked = false;
  if (notes) {
    document.getElementById('delete-notes-label').textContent =
      I18N.t('delete.alsoNotes', { n: notes, s: shots });
  }

  showModal('modal-delete');
}

async function confirmDelete() {
  const gone = AppState.config.servers.filter((s) => AppState.selectedForDelete.has(s.bmId));
  AppState.config.servers = AppState.config.servers
    .filter((s) => !AppState.selectedForDelete.has(s.bmId));
  // Os cards apagados também saem do cache de reconciliação.
  for (const s of gone) delete LiveData[s.bmId];

  if (document.getElementById('delete-notes').checked) {
    for (const s of gone) await window.api.notesDeleteScope('server:' + s.bmId);
  }
  // A agenda vai junto SEMPRE, independente da caixa das anotações:
  // um wipe agendado para um servidor que saiu da lista só serviria
  // para avisar sobre algo que a pessoa não acompanha mais.
  for (const s of gone) await window.api.schedDeleteByServer(String(s.bmId));

  AppState.selectedForDelete.clear();
  await saveAppConfig();
  hideModal('modal-delete');
  toast(I18N.t('delete.done'));
  setDeleteMode(false);
}

// ============================================================
// SERVIDOR ATUAL — card especial de "jogando agora"
//
// O processo principal lê o log do Unturned e nos manda o BLOCO
// inteiro do servidor (nome, mapa, descrição, thumbnail, mods).
// Então:
//   • se o servidor já está salvo -> o card dele ganha o chip
//     "jogando agora" na frente do nome e o destaque âmbar;
//   • se não está -> aparece o card especial no topo, com Quick
//     View e "adicionar aos meus servidores".
//
// `live` separa "estou jogando AGORA" de "foi o último que joguei":
// só o primeiro acende o chip e o destaque.
// ============================================================
async function setCurrentServer(payload) {
  const saved = payload.ip
    ? AppState.config.servers.find((s) => s.ip === payload.ip && Number(s.port) === Number(payload.port))
    : null;

  AppState.currentServer = {
    ...payload,
    live: payload.source !== 'lastPlayed',
    name: payload.name || (saved ? saved.name : (payload.ip ? `${payload.ip}:${payload.port}` : '')),
    savedBmId: saved ? saved.bmId : null
  };
  renderHome();

  // Complementa com dados AO VIVO do A2S (jogadores online, ícone).
  if (payload.ip && payload.port) {
    const probe = await tryProbe(payload.ip, payload.port, null);
    const cs = AppState.currentServer;
    if (cs && cs.ip === payload.ip) {
      cs.players = probe.players;
      cs.maxPlayers = probe.maxPlayers != null ? probe.maxPlayers : payload.maxPlayers;
      cs.icon = probe.icon || payload.thumbnail || null;
      cs.map = probe.map || payload.map;
      renderHome();
    }
    if (AppState.config.showFlags !== false) GeoFlag.resolve(payload.ip);
  }
}

function clearCurrentServer() {
  AppState.currentServer = null;
  renderHome();
}

function csChip(label, value) {
  if (value == null || value === '') return '';
  return `<span class="cs-chip"><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`;
}

function renderCurrentServer() {
  const box = document.getElementById('current-server');
  const cs = AppState.currentServer;
  if (!box) return;

  // Jogando num servidor JÁ salvo: o card dele já mostra o chip
  // "jogando agora", então não duplicamos a informação aqui.
  if (!cs || (cs.savedBmId && cs.live)) { box.classList.add('hidden'); return; }

  box.classList.remove('hidden');
  box.classList.toggle('is-last-played', !cs.live);
  const badgeLabel = box.querySelector('#cs-badge span:last-child');
  if (badgeLabel) badgeLabel.textContent = I18N.t(cs.live ? 'current.playingNow' : 'current.lastPlayed');

  document.getElementById('cs-name').textContent = cs.name;
  RichText.render(document.getElementById('cs-desc'), cs.description || '', { maxScale: 1.4 });

  const players = cs.players != null ? `${cs.players}/${cs.maxPlayers == null ? '?' : cs.maxPlayers}` : null;
  const flag = cs.ip && AppState.config.showFlags !== false ? GeoFlag.html(GeoFlag.peek(cs.ip)) : '';
  const addr = cs.ip ? `${cs.ip}:${cs.port}` : I18N.t('current.noAddress');
  const metaEl = document.getElementById('cs-meta');
  metaEl.innerHTML =
    `${flag}<span class="copy-ip" data-copy="${escapeHtml(addr)}">${escapeHtml(addr)}</span>` +
    (cs.map ? ` · ${escapeHtml(cs.map)}` : '') +
    (players ? ` · ${escapeHtml(players)} ${escapeHtml(I18N.t('home.playersOnline'))}` : '');

  const copyEl = metaEl.querySelector('[data-copy]');
  if (copyEl && cs.ip) copyEl.addEventListener('click', () => copyIp(copyEl.dataset.copy, copyEl));

  document.getElementById('cs-chips').innerHTML = [
    csChip(`${I18N.t('details.pvp')}: `, cs.pvp === true ? 'PvP' : cs.pvp === false ? 'PvE' : null),
    csChip(`${I18N.t('quick.difficulty')}: `, cs.difficulty),
    csChip('BattlEye: ', cs.battlEye === true ? 'ON' : cs.battlEye === false ? 'OFF' : null),
    csChip(`${I18N.t('details.mods')}: `, cs.mods && cs.mods.length ? String(cs.mods.length) : null)
  ].join('');

  const iconEl = document.getElementById('cs-icon');
  const iconUrl = cs.icon || cs.thumbnail;
  if (iconUrl) {
    iconEl.innerHTML = `<img src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this,'gamepad')">`;
  } else {
    iconEl.innerHTML = Icon.svg('gamepad', 22);
  }

  // Servidor via relay da Steam: não temos endereço para adicionar.
  const addBtn = document.getElementById('cs-add');
  const openBtn = document.getElementById('cs-open');
  const noAddress = !cs.ip;
  addBtn.disabled = noAddress;
  openBtn.disabled = noAddress;
  addBtn.title = noAddress ? I18N.t('add.sugP2P') : '';
}

// Adiciona o servidor atual (do card especial) à lista salva.
async function addCurrentServer() {
  const cs = AppState.currentServer;
  if (!cs || !cs.ip) return;
  const bmId = `local_${cs.ip}_${cs.port}`;
  if (AppState.config.servers.some((s) => s.bmId === bmId)) { cs.savedBmId = bmId; renderHome(); return; }

  const probe = await tryProbe(cs.ip, cs.port, null);
  LiveData[bmId] = {
    name: cs.name, map: cs.map || null,
    icon: cs.icon || cs.thumbnail || null,
    description: cs.description || null,
    mods: cs.mods || [], modCount: (cs.mods || []).length
  };
  AppState.config.servers.push({
    bmId, name: cs.name, ip: cs.ip, port: cs.port,
    queryPort: probe.queryPort || null, tags: [], favorite: false,
    folderId: AppState.currentFolderId || null
  });
  await saveAppConfig();
  await window.api.restartPolling();
  cs.savedBmId = bmId;
  toast(I18N.t('add.success', { name: cs.name }));
  refreshAllCards();
}

// Recebe eventos de detecção do processo principal.
window.api.onCurrentServer((payload) => {
  if (!payload || payload.disconnected) { clearCurrentServer(); return; }
  setCurrentServer(payload);
});

// Ao abrir o app, recupera o estado atual/último jogado.
async function initCurrentServer() {
  try {
    const st = await window.api.getCurrentServer();
    if (st.detected) { await setCurrentServer(st.detected); return; }
    if (st.lastPlayed && st.lastPlayed.ip) {
      await setCurrentServer({ ...st.lastPlayed, source: 'lastPlayed', addressable: true });
    }
  } catch { /* sem estado ainda */ }
}
