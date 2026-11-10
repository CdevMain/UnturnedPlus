// ============================================================
// tracking.js — página de tracking do servidor selecionado
//
// Fonte dos dados ao vivo: Query Port LOCAL (A2S), consultado
// continuamente pelo processo principal (main.js) e empurrado
// aqui via window.api.onQueryUpdate — não depende do BattleMetrics.
//
// A BattleMetrics só é usada (via scraping da página pública,
// sem API/token) para complementar com Rank e histórico dela,
// de forma pontual e não-bloqueante ao abrir a tela.
// ============================================================

let trackingServerCfg = null; // entrada salva em AppState.config.servers (ip/port/queryPort)
let trackingLogs = [];        // eventos locais (join/leave) já carregados
let trackingSnapshots = [];   // snapshots locais de player count (pra sparkline)
let airdropTimer = null;      // setInterval do contador regressivo de airdrop
let airdropState = null;      // { intervalSec, lastAirdropAt, intervalFromServer }

// Um ID é do BattleMetrics só quando é puramente numérico. Servidores
// adicionados por IP têm ID sintético "local:ip:porta" e ignoram tudo do BM.
function isBmId(id) { return /^\d+$/.test(String(id || '')); }

// ---------------- Abrir/fechar tracking ----------------
async function openTracking(bmId) {
  AppState.trackingId = bmId;
  trackingServerCfg = AppState.config.servers.find(s => s.bmId === bmId) || null;

  // O servidor que está na tela passa a ter prioridade na fila de
  // polling e recebe uma leitura imediata — abrir o tracking não
  // deve significar esperar o próximo ciclo para ver algo.
  try { window.api.focusServer(bmId); window.api.pollNow(bmId); } catch { /* versão antiga do preload */ }

  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-tracking').classList.remove('hidden');
  document.getElementById('tk-name').textContent =
    (trackingServerCfg && trackingServerCfg.name) || bmId;

  // Endereço clicável (copia) + localização física via geoip.
  const addrEl = document.getElementById('tk-address');
  const address = trackingServerCfg ? `${trackingServerCfg.ip}:${trackingServerCfg.port}` : '';
  addrEl.textContent = address;
  addrEl.dataset.copy = address;
  document.getElementById('tk-location').textContent = '';
  if (trackingServerCfg && trackingServerCfg.ip) loadTrackingLocation(trackingServerCfg.ip);

  marcarCarregandoInfo(bmId);

  renderTrackingFavorite();
  // De qual time é este servidor. Fica junto do resto da informação
  // do servidor — "de que time é isto aqui?" é da mesma família de
  // "quantos jogadores tem?".
  if (typeof renderServerTeams === 'function') renderServerTeams(bmId);
  if (typeof renderServerSchedule === 'function') renderServerSchedule(bmId);

  // O mapa do servidor ANTERIOR sai da tela agora, não quando (ou
  // se) este servidor responder. Servidor offline nunca responde, e
  // era aí que o mapa errado ficava.
  if (typeof MapView !== 'undefined') {
    MapView.reset();
    // `lastMap` é o mapa que este servidor tinha da última vez que
    // respondeu. Sem ele, um servidor offline não mostraria mapa
    // nenhum — e o mapa de um servidor praticamente não muda.
    const conhecido = (LiveData[bmId] || {}).map
      || (trackingServerCfg && trackingServerCfg.lastMap) || null;
    if (conhecido) MapView.loadForMap(conhecido);
  }

  // Sempre volta na primeira aba: abrir um servidor novo na aba de
  // log do anterior é desorientador.
  if (typeof switchTrackingTab === 'function') switchTrackingTab('overview');
  if (typeof updateNotesBadge === 'function') updateNotesBadge();

  // Reseta os painéis de detalhes/airdrop enquanto a 1ª consulta chega
  resetDetailsView();

  await loadLocalHistoryIntoView();
  await refreshFromLocalQuery();     // dado ao vivo imediato (info + players + mods/config)
  await initAirdrop(bmId);           // contador de airdrop conforme config do servidor
  await renderUptime(bmId);          // "no ar há X", medido pelo próprio app

  // O botão "Abrir no BattleMetrics" só faz sentido para servidor
  // com ID do BM. É a única coisa que sobrou dessa integração na
  // tela: um link. O rank saiu (ver a nota mais abaixo).
  const bmBtn = document.getElementById('btn-bm');
  if (bmBtn) bmBtn.style.display = isBmId(bmId) ? '' : 'none';
  const histEl = document.getElementById('tk-bm-history-note');
  if (histEl) histEl.textContent = '';
}

// Mostra bandeira + cidade/país e, numa segunda linha discreta, o
// provedor. Separar as duas coisas é proposital: nomes de datacenter
// são absurdamente longos ("Aleksandr Shmalko trading as PR Obrada
// Podataka Castles Novi Sad") e, na mesma linha do país, quebravam
// o alinhamento da lista inteira. Aqui o provedor fica truncado numa
// linha só, com o texto completo no tooltip.
async function loadTrackingLocation(ip) {
  const el = document.getElementById('tk-location');
  if (!el) return;
  const geo = await GeoFlag.resolve(ip);
  if (!AppState.trackingId) return;

  if (!geo) {
    el.textContent = I18N.t('tracking.locationUnknown');
    el.removeAttribute('title');
    return;
  }

  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || geo.countryCode;
  el.innerHTML =
    `<span class="loc-place">${GeoFlag.html(geo)}<span>${escapeHtml(place)}</span></span>` +
    (geo.isp ? `<span class="loc-isp" title="${escapeHtml(geo.isp)}">${escapeHtml(geo.isp)}</span>` : '');
  el.title = GeoFlag.describe(geo) || place;
}

// ---------------- Favorito (sincronizado com card e quick view) ----------------
function renderTrackingFavorite() {
  const btn = document.getElementById('tk-fav');
  if (!btn) return;
  const on = !!(trackingServerCfg && trackingServerCfg.favorite);
  btn.classList.toggle('on', on);
  btn.title = I18N.t(on ? 'card.unfavorite' : 'card.favorite');
}

async function toggleTrackingFavorite() {
  if (!trackingServerCfg) return;
  await toggleFavorite(trackingServerCfg.bmId);
  // toggleFavorite mexe no objeto salvo; relemos para o botão refletir.
  trackingServerCfg = AppState.config.servers.find((s) => s.bmId === AppState.trackingId) || null;
  renderTrackingFavorite();
}

function closeTracking() {
  try { window.api.focusServer(null); } catch { /* ignora */ }
  AppState.trackingId = null;
  trackingServerCfg = null;
  stopAirdropTimer();
  // Sair do servidor também limpa o mapa: voltar para a home e
  // entrar noutro servidor não pode reaproveitar nada do anterior.
  if (typeof MapView !== 'undefined') MapView.reset();
  document.getElementById('view-tracking').classList.add('hidden');
  document.getElementById('view-home').classList.remove('hidden');
  refreshAllCards();
}

// ---------------- Recebe atualizações ao vivo (push do processo principal) ----------------
window.api.onQueryUpdate((payload) => {
  if (payload.bmId !== AppState.trackingId) return;

  if (payload.error) {
    setStatusPill('error');
    return;
  }
  applyInfoToView(payload.info);
  if (payload.players) renderPlayers(payload.players);
  if (payload.latestEvents?.length) {
    trackingLogs = mergeNewEvents(trackingLogs, payload.latestEvents);
    renderLogs();
  }
  trackingSnapshots.push({ t: new Date().toISOString(), players: payload.info.players });
  trackingSnapshots = trackingSnapshots.slice(-200);
  renderSparkline();
});

// ---------------- Consulta local pontual (ao abrir a tela) ----------------
async function refreshFromLocalQuery() {
  const bmId = AppState.trackingId;
  if (!bmId) return;
  try {
    const r = (await window.api.queryServerByBmId(bmId)) || {};
    // Servidor fora do ar (ou sem porta de query aberta) responde
    // sem `info`. Isso é um resultado normal, não uma exceção: cair
    // no catch aqui escondia o motivo e ainda logava erro no console.
    if (!r.info) {
      // "Não respondeu" É uma resposta. O esqueleto tem que sair
      // aqui também, senão o servidor offline — que por definição
      // nunca responde — fica pulsando "carregando" para sempre.
      limparEsqueletos();
      setStatusPill('offline');
      renderPlayers([]);
      document.getElementById('tk-updated').textContent = new Date().toLocaleTimeString();
      return;
    }
    applyInfoToView(r.info);
    if (r.players) renderPlayers(r.players);
    if (r.unturned) renderDetails(r.unturned);
  } catch (e) {
    console.error('Erro ao consultar Query Port local:', e);
    limparEsqueletos();
    setStatusPill('offline');
    renderPlayers([]);
  }
}

// ------------------------------------------------------------
// ESQUELETO da tela de informações
//
// A tela do servidor abria com Jogadores, Mapa, Uptime e Última
// atualização todos em BRANCO, e ficava assim até a primeira
// resposta chegar — que num servidor lento (ou offline, que nunca
// responde) é muito tempo olhando para o nada. Campo vazio é
// indistinguível de "não tem esse dado".
//
// A barra cinza ocupa o mesmo espaço que o texto vai ocupar, então
// nada pula de lugar quando o valor chega.
//
// Quando já existe leitura deste servidor — você veio da lista, onde
// ele já respondeu — o valor conhecido é pintado na hora e nenhum
// esqueleto aparece: piscar um "carregando" por cima de dado que já
// se tem é pior do que não ter esqueleto nenhum.
// ------------------------------------------------------------
const CAMPOS_INFO = ['tk-players', 'tk-map', 'tk-uptime', 'tk-updated'];

function marcarCarregandoInfo(bmId) {
  const live = (typeof LiveData !== 'undefined' && LiveData[bmId]) || null;
  if (live && live.players != null) {
    // Já temos o que mostrar: pinta e sai.
    const el = document.getElementById('tk-players');
    if (el) el.textContent = `${live.players}/${live.maxPlayers == null ? '?' : live.maxPlayers}`;
    const mp = document.getElementById('tk-map');
    if (mp && live.map) mp.textContent = live.map;
    return;
  }
  for (const id of CAMPOS_INFO) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="sk w-md" aria-hidden="true"></span>';
  }
  const pill = document.getElementById('tk-status');
  if (pill) pill.classList.add('carregando');
}

// Tira o esqueleto de quem não foi preenchido pela resposta. Sem
// isto, um campo que a resposta não traz (uptime de servidor que
// acabou de ser adicionado) ficaria pulsando para sempre — um
// "carregando" eterno mente tanto quanto um campo vazio.
function limparEsqueletos() {
  for (const id of CAMPOS_INFO) {
    const el = document.getElementById(id);
    if (el && el.querySelector('.sk')) el.textContent = '';
  }
  const pill = document.getElementById('tk-status');
  if (pill) pill.classList.remove('carregando');
}

function applyInfoToView(info) {
  limparEsqueletos();
  document.getElementById('tk-name').textContent = info.name || trackingServerCfg?.name || '';
  document.getElementById('tk-players').textContent = `${info.players}/${info.maxPlayers}`;
  document.getElementById('tk-map').textContent = info.map || '';
  document.getElementById('tk-updated').textContent = new Date().toLocaleTimeString();
  setStatusPill('online');

  if (typeof MapView !== 'undefined' && MapView.mapName !== (info.map || null)) {
    MapView.loadForMap(info.map || null);
  }

  // Guarda o mapa deste servidor para a próxima vez que ele estiver
  // offline. Só grava quando MUDA, senão seria uma escrita em disco
  // a cada atualização.
  if (info.map && trackingServerCfg && trackingServerCfg.lastMap !== info.map) {
    trackingServerCfg.lastMap = info.map;
    saveAppConfig();
  }
}

function setStatusPill(state) {
  const pill = document.getElementById('tk-status');
  const map = { online: ['status.online', 'online'], offline: ['status.offline', 'offline'], error: ['status.error', 'offline'] };
  const [key, cls] = map[state] || map.offline;
  pill.textContent = I18N.t(key);
  pill.className = 'status-pill ' + cls;
}

// ---------------- Uptime ----------------
// O campo ficou VAZIO desde sempre: o <dd id="tk-uptime"> existia no
// HTML e nenhuma linha de código escrevia nele. Não era um dado que
// vinha errado, era um dado que nunca vinha.
//
// Quem responde agora é o processo principal, contando a sequência
// de leituras sem buraco no histórico local (main.js/calcularUptime).
// Quando essa conta não é confiável — poucas amostras, ou o app
// passou um tempo fechado — o texto DIZ isso em vez de fingir
// precisão.
async function renderUptime(bmId) {
  const el = document.getElementById('tk-uptime');
  if (!el) return;
  el.textContent = '…';
  el.title = '';
  try {
    const u = await window.api.getUptime(bmId);
    if (!u || !u.desde || !u.ms) {
      el.textContent = I18N.t('tracking.uptimeUnknown');
      el.title = I18N.t('tracking.uptimeHint');
      return;
    }
    el.textContent = I18N.t(u.confiavel ? 'tracking.uptimeFor' : 'tracking.uptimeAtLeast',
                            { t: duracaoCurta(u.ms) });
    el.title = I18N.t('tracking.uptimeSince', { d: new Date(u.desde).toLocaleString() });
  } catch {
    el.textContent = I18N.t('tracking.uptimeUnknown');
  }
}

// "2d 4h", "3h 20min", "12min". Sem segundos: para uptime eles são
// ruído, e a linha inteira mudaria a cada atualização.
function duracaoCurta(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return I18N.t('time.minShort', { n: Math.max(1, min) });
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${I18N.t('time.hShort', { n: h })} ${I18N.t('time.minShort', { n: m })}`
                       : I18N.t('time.hShort', { n: h });
  const d = Math.floor(h / 24), hr = h % 24;
  return hr ? `${I18N.t('time.dShort', { n: d })} ${I18N.t('time.hShort', { n: hr })}`
            : I18N.t('time.dShort', { n: d });
}

// ------------------------------------------------------------
// O RANK DO BATTLEMETRICS FOI REMOVIDO.
//
// Obter o número exigia abrir um Chromium invisível, carregar a
// página inteira do BattleMetrics e raspar o HTML. Isso é caro
// (segundos por servidor), frágil (qualquer mudança de layout
// quebra em silêncio) e não é um dado que o app precise: o botão
// "Abrir no BattleMetrics" leva à página, onde o número está sempre
// certo e sempre atualizado.
//
// A raspagem CONTINUA existindo em um lugar só: quando você
// adiciona um servidor pelo ID do BattleMetrics, ela é usada uma
// única vez para descobrir o IP e a porta. Sem isso, adicionar por
// ID deixaria de funcionar.
// ------------------------------------------------------------

// ---------------- Lista de jogadores ----------------
// Servidor de 60 slots enche a tela. A lista tem rolagem própria e,
// a partir de um punhado de jogadores, aparece a busca por nome.
const LIST_TOOLS_THRESHOLD = 8;

let trackingPlayers = [];

function renderPlayers(players) {
  trackingPlayers = Array.isArray(players) ? players : [];
  // As fichas são lidas em BLOCO, uma vez por atualização — não uma
  // por jogador. `renderPlayersList` monta HTML de forma síncrona e
  // não pode esperar o disco; o cache é o que permite isso.
  //
  // A releitura é assíncrona de propósito: a lista aparece já, e as
  // fichas pintam no quadro seguinte. Segurar a lista inteira
  // esperando o disco deixaria a tela travada por um enfeite.
  if (typeof sincronizarFichas === 'function') {
    sincronizarFichas(trackingPlayers.map((p) => p.name)).then(() => {
      if (typeof renderPlayersList === 'function') renderPlayersList();
    });
  }
  // As FICHAS-ANOTAÇÃO (dossiês com ligações) vêm de outra fonte: as
  // anotações deste servidor. Mesma ideia do bloco acima — uma
  // leitura por atualização, e a lista repinta quando chegar.
  if (typeof PlayerLinks !== 'undefined' && AppState.trackingId) {
    PlayerLinks.sincronizar('server:' + AppState.trackingId, AppState.trackingId).then(() => {
      if (typeof renderPlayersList === 'function') renderPlayersList();
    });
  }
  document.getElementById('players-count').textContent = trackingPlayers.length;

  const tools = document.getElementById('players-tools');
  tools.classList.toggle('hidden', trackingPlayers.length < LIST_TOOLS_THRESHOLD);
  if (trackingPlayers.length < LIST_TOOLS_THRESHOLD) {
    const s = document.getElementById('players-search');
    if (s) s.value = '';
  }
  renderPlayersList();
}

// ------------------------------------------------------------
// Jogadores online
//
// Cada linha mostra DOIS tempos, e a diferença entre eles importa:
//
//   sessão  quanto tempo essa pessoa está conectada AGORA. Vem do
//           próprio servidor (A2S), é exato e zera quando ela sai.
//   total   quanto tempo ela já jogou aqui somando tudo que ESTE
//           app viu. É construído das entradas e saídas que o
//           Unturned+ registrou — então só conta desde o dia em
//           que você começou a acompanhar o servidor, e não conta
//           o que aconteceu com o app fechado.
//
// Essa ressalva não é detalhe: sem ela, um "total: 2h" para o
// dono do servidor pareceria erro. O cabeçalho da lista e o "?"
// explicam isso na tela, não só aqui no código.
// ------------------------------------------------------------

// Soma sessões fechadas (join -> leave) por jogador.
function playerHistoryTotals() {
  const totals = {};   // nome -> { seconds, sessions, lastSeen }

  // ------------------------------------------------------------
  // O BUG QUE DEIXAVA O TOTAL SEMPRE VAZIO
  //
  // `e.t` é uma STRING ISO ("2026-08-14T12:30:00.000Z") — é assim
  // que o processo principal grava o evento. Este código tratava
  // ela como número:
  //
  //     .sort((a, b) => a.t - b.t)        -> NaN, ordenação não fazia nada
  //     (e.t - open[name]) / 1000         -> NaN
  //     if (NaN < 30 dias)                -> false, SEMPRE
  //
  // Resultado: nenhuma sessão era contada, `sessions` ficava em 0,
  // e a coluna TOTAL aparecia em branco para todo mundo. Não havia
  // erro no console: NaN atravessa comparação sem reclamar.
  //
  // Agora o tempo vira número UMA vez, na entrada.
  // ------------------------------------------------------------
  const eventos = [];
  for (const e of trackingLogs) {
    const ms = typeof e.t === 'number' ? e.t : Date.parse(e.t);
    if (!Number.isFinite(ms) || !e.name) continue;
    eventos.push({ ms, type: e.type, name: e.name });
  }
  // Do mais antigo para o mais novo: parear entrada com saída
  // exige caminhar no sentido do tempo.
  eventos.sort((a, b) => a.ms - b.ms);

  const open = {};
  for (const e of eventos) {
    const name = e.name;
    if (!totals[name]) totals[name] = { seconds: 0, sessions: 0, lastSeen: 0 };
    totals[name].lastSeen = Math.max(totals[name].lastSeen, e.ms);

    if (e.type === 'join') {
      // Duas entradas seguidas sem saída no meio: fica a mais
      // recente. Acontece quando o app perde uma leitura e reencontra
      // a pessoa; contar a partir da primeira inflaria o total.
      open[name] = e.ms;
    } else if (e.type === 'leave') {
      if (open[name]) {
        const d = Math.max(0, Math.floor((e.ms - open[name]) / 1000));
        // Uma sessão de 30 dias é sinal de janela deixada aberta,
        // não de alguém jogando um mês seguido. Descartamos.
        if (d < 30 * 24 * 3600) { totals[name].seconds += d; totals[name].sessions++; }
        delete open[name];
      }
    }
  }
  return totals;
}

// "3h 12m", "45m", "2m" — sempre curto, cabe na linha.
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d}d ${h % 24}h`; }
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function renderPlayersList() {
  const list = document.getElementById('players-list');
  const input = document.getElementById('players-search');
  const q = (input ? input.value : '').trim().toLowerCase();

  const totals = playerHistoryTotals();

  const shown = trackingPlayers
    .filter((p) => !q || String(p.name || '').toLowerCase().includes(q))
    .sort((a, b) => (b.secondsConnected || 0) - (a.secondsConnected || 0)
                 || String(a.name).localeCompare(String(b.name)));

  const result = document.getElementById('players-result');
  if (result) {
    result.textContent = q
      ? I18N.t('list.results', { n: shown.length, total: trackingPlayers.length })
      : '';
  }

  const badge = document.getElementById('tab-badge-players');
  if (badge) {
    badge.textContent = trackingPlayers.length;
    badge.classList.toggle('hidden', !trackingPlayers.length);
  }

  if (!trackingPlayers.length) {
    list.innerHTML = `<li class="muted">${escapeHtml(I18N.t('tracking.noPlayers'))}</li>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<li class="muted">${escapeHtml(I18N.t('list.noMatch'))}</li>`;
    return;
  }

  const inicios = iniciosDeSessao();

  list.innerHTML = shown.map((p) => {
    const t = totals[p.name] || { seconds: 0, sessions: 0 };
    const seg = segundosDeSessao(p, inicios);
    const session = seg != null ? formatDuration(seg) : I18N.t('players.sessionUnknown');
    // O total do histórico + o que já correu da sessão atual: é o
    // número que a pessoa espera ver ("joguei X neste servidor").
    const grand = t.seconds + (seg || 0);
    const known = t.sessions > 0 || seg != null;

    // A FICHA: quem é essa pessoa para mim.
    //
    // O pedido foi "isso deve ser claro na listagem", e claro aqui
    // quer dizer: reconhecível ANTES de ler. Numa lista de 24 nomes
    // rolando, ninguém lê rótulo — o que funciona é a linha inteira
    // mudar de cor. Por isso a classe vai no <li>, e o selo é só a
    // confirmação para quem parar em cima.
    const fx = FichasUI.de(p.name);
    const vinculo = fx ? fx.link : 'neutral';

    // COM QUEM essa pessoa está ligada, entre quem está online
    // agora. A linha desenhada na canaleta diz QUE existe ligação;
    // este selo diz com quem — porque seguir a linha com o olho
    // numa lista de 24 nomes é trabalho, e o nome cabe aqui.
    const parceiros = (typeof PlayerLinks !== 'undefined')
      ? PlayerLinks.parceirosDe(p.name, shown.map((x) => x.name)) : [];

    // A foto do dossiê, quando existe. É o reconhecimento mais
    // rápido possível numa lista de nomes parecidos — e é o mesmo
    // retrato que aparece na mesa e no cartão.
    const dossie = (typeof PlayerLinks !== 'undefined') ? PlayerLinks.de(p.name) : null;
    const retrato = dossie && dossie.photo
      ? `<img class="p-foto" src="${escapeHtml(dossie.photo)}" alt="" onerror="this.remove()" />`
      : '';

    return `<li class="player-row v-${escapeHtml(vinculo)}" data-player="${escapeHtml(p.name)}">
      <span class="p-name">
        ${retrato}${escapeHtml(p.name)}
        ${vinculo !== 'neutral' ? `<span class="p-link ${escapeHtml(vinculo)}">${
          Icon.svg(vinculo === 'ally' ? 'shield' : 'target', 11)} ${
          escapeHtml(I18N.t('fichas.link_' + vinculo))}</span>` : ''}
        ${fx && fx.group ? `<span class="p-group" title="${
          escapeHtml(I18N.t('fichas.groupOf', { name: fx.group.name }))}">${
          Icon.svg('users', 11)} ${escapeHtml(fx.group.name)}</span>` : ''}
        ${fx && fx.note ? `<span class="p-hasnote" title="${escapeHtml(fx.note.slice(0, 200))}">${
          Icon.svg('note', 11)}</span>` : ''}
        ${parceiros.map((v) => {
          const rel = Dossier.relDe(v.rel);
          return `<span class="p-linked r-${escapeHtml(v.rel)}" style="--rel:${escapeHtml(rel.cor)}"
            title="${escapeHtml(I18N.t('players.link' + v.rel.charAt(0).toUpperCase() + v.rel.slice(1),
                                       { name: v.nome }))}">${
            Icon.svg('link', 10)} ${escapeHtml(v.nome)}</span>`;
        }).join('')}
      </span>
      <span class="p-times">
        <span class="p-time now${seg == null ? ' unknown' : ''}" title="${escapeHtml(I18N.t('players.sessionHint'))}">
          <em>${escapeHtml(I18N.t('players.session'))}</em> ${escapeHtml(session)}
        </span>
        <span class="p-time total${known ? '' : ' unknown'}" title="${escapeHtml(I18N.t('players.totalHint'))}">
          <em>${escapeHtml(I18N.t('players.total'))}</em> ${known ? escapeHtml(formatDuration(grand)) : ''}
        </span>
      </span>
    </li>`;
  }).join('');

  // As chaves só podem ser desenhadas DEPOIS de a lista estar no
  // layout: elas são medidas a partir do `offsetTop` de cada linha,
  // que não existe antes do `innerHTML`.
  if (typeof PlayerLinks !== 'undefined') {
    list.classList.add('players-linkwrap');
    PlayerLinks.desenhar(list);
  }
}

// ------------------------------------------------------------
// HÁ QUANTO TEMPO A PESSOA ESTÁ CONECTADA AGORA
//
// A fonte natural é o A2S_PLAYER, que traz um campo de duração. O
// problema: em boa parte dos servidores de Unturned esse campo vem
// ZERO. E o código lia `!= null`, então zero passava como resposta
// válida e a coluna SESSION aparecia VAZIA ao lado de um TOTAL
// preenchido — o que parece defeito, e era.
//
// Agora: se o servidor informa uma duração que faz sentido, é a
// dela (mais precisa: cobre o tempo antes de o app estar olhando).
// Se não informa, contamos como já contamos o uptime — pelo que o
// app VIU, ou seja, o último "entrou" no histórico local.
//
// Se nenhuma das duas existe (o app abriu agora e a pessoa já
// estava lá), a resposta honesta é "não sei", não um zero.
// ------------------------------------------------------------
function iniciosDeSessao() {
  const inicio = {};        // nome -> instante do último "entrou"
  const eventos = [];
  for (const e of trackingLogs) {
    const ms = typeof e.t === 'number' ? e.t : Date.parse(e.t);
    if (Number.isFinite(ms) && e.name) eventos.push({ ms, type: e.type, name: e.name });
  }
  eventos.sort((a, b) => a.ms - b.ms);
  for (const e of eventos) {
    if (e.type === 'join') inicio[e.name] = e.ms;
    else if (e.type === 'leave') delete inicio[e.name];
  }
  return inicio;
}

function segundosDeSessao(p, inicios) {
  const doServidor = Number(p.secondsConnected);
  // Zero não é resposta: quer dizer "o servidor não informou".
  if (Number.isFinite(doServidor) && doServidor > 0) return doServidor;

  const desde = inicios[p.name];
  if (desde) return Math.max(0, Math.floor((Date.now() - desde) / 1000));

  return null;
}

// ---------------- Logs (join/leave), construídos localmente pelo polling do Query Port ----------------
async function loadLocalHistoryIntoView() {
  const bmId = AppState.trackingId;
  try {
    const { snapshots, events } = await window.api.getLocalHistory(bmId, 500);
    trackingSnapshots = snapshots || [];
    trackingLogs = events || [];
  } catch (e) {
    trackingSnapshots = [];
    trackingLogs = [];
  }
  renderLogs();
  renderSparkline();
}

function mergeNewEvents(existing, incoming) {
  const seen = new Set(existing.map(e => `${e.t}|${e.type}|${e.name}`));
  const fresh = incoming.filter(e => !seen.has(`${e.t}|${e.type}|${e.name}`));
  return [...fresh, ...existing].slice(0, 500);
}

function renderLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '';
  const logs = trackingLogs.slice(0, 100);

  if (logs.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = I18N.t('tracking.noLogs');
    list.appendChild(li);
    return;
  }

  for (const log of logs) {
    const message = log.type === 'join'
      ? I18N.t('log.join', { name: log.name })
      : I18N.t('log.leave', { name: log.name });
    const li = document.createElement('li');
    li.innerHTML = `<span class="log-time">${new Date(log.t).toLocaleTimeString()}</span>
      <span class="${log.type}">${escapeHtml(message)}</span>`;
    list.appendChild(li);
  }
}

async function clearLogs() {
  const bmId = AppState.trackingId;
  if (!bmId) return;
  await window.api.clearLocalHistory(bmId);
  trackingLogs = [];
  trackingSnapshots = [];
  renderLogs();
  renderSparkline();
  toast(I18N.t('tracking.logsCleared'));
}

// ---------------- Sparkline simples do histórico local de player count ----------------
function renderSparkline() {
  const canvas = document.getElementById('tk-history-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const points = trackingSnapshots.slice(-100);
  if (points.length < 2) return;

  const max = Math.max(1, ...points.map(p => p.players));
  const stepX = w / (points.length - 1);

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = i * stepX;
    const y = h - (p.players / max) * (h - 8) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#5ee6a0';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------- Ações externas ----------------
function joinServer() {
  if (!trackingServerCfg) return;
  window.api.openExternal(`steam://connect/${trackingServerCfg.ip}:${trackingServerCfg.port}`);
}

async function pinToOverlay() {
  if (!AppState.trackingId) return;
  AppState.config.overlayServerId = AppState.trackingId;
  await saveAppConfig();
  await window.api.toggleOverlay(); // abre o overlay se estiver fechado
  toast(I18N.t('tracking.pinned'));
}

function openBattleMetrics() {
  if (!AppState.trackingId) return;
  window.api.openExternal(`https://www.battlemetrics.com/servers/unturned/${AppState.trackingId}`);
}

// ============================================================
// Detalhes públicos (A2S_RULES interpretado): descrição, config e MODS
// ============================================================
function resetDetailsView() {
  ['tk-gamemode', 'tk-pvp', 'tk-rocket', 'tk-version'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
  const descEl = document.getElementById('tk-desc');
  if (descEl) { descEl.textContent = ''; descEl.removeAttribute('title'); }
  const modsUl = document.getElementById('tk-mods');
  if (modsUl) modsUl.innerHTML = '';
  trackingMods = [];
  document.getElementById('tk-mod-count').textContent = '0';
  document.getElementById('tk-mods-empty').classList.remove('hidden');
  document.getElementById('mods-tools').classList.add('hidden');
  const modsSearch = document.getElementById('mods-search');
  if (modsSearch) modsSearch.value = '';
  const raw = document.getElementById('tk-raw-rules');
  if (raw) { raw.classList.add('hidden'); raw.innerHTML = ''; }
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value && String(value).trim() ? value : '';
}

// Junta os mods vindos das rules (A2S) com os que o LOG do jogo
// registrou. As rules só publicam o ID numérico; o log traz o NOME
// de cada mod ("City Expansion 2"), que é o que a pessoa reconhece.
function mergeModSources(rulesMods) {
  const byId = new Map();
  for (const m of rulesMods || []) {
    if (!m || !m.id) continue;
    byId.set(String(m.id), { id: String(m.id), name: null, url: m.url });
  }

  const cs = AppState.currentServer;
  const sameServer = cs && trackingServerCfg
    && cs.ip === trackingServerCfg.ip && Number(cs.port) === Number(trackingServerCfg.port);
  const fromLog = sameServer && cs.mods ? cs.mods : (LiveData[AppState.trackingId] || {}).logMods || [];

  for (const m of fromLog || []) {
    if (!m || !m.id) continue;
    const id = String(m.id);
    const found = byId.get(id);
    if (found) { if (m.name) found.name = m.name; }
    else byId.set(id, { id, name: m.name || null, url: null });
  }

  return [...byId.values()].map((m) => ({
    ...m,
    url: m.url || `https://steamcommunity.com/sharedfiles/filedetails/?id=${m.id}`
  })).sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function renderDetails(unturned) {
  const f = unturned.fields || {};

  // Descrição com o rich text do jogo (cores, tamanhos, negrito).
  const descEl = document.getElementById('tk-desc');
  if (f.description) {
    RichText.render(descEl, f.description, { maxScale: 1.7, baseSize: 14 });
  } else {
    descEl.textContent = '';
    descEl.removeAttribute('title');
  }

  setField('tk-gamemode', f.gameMode);
  setField('tk-pvp', f.pvp);
  setField('tk-rocket', f.rocketMod);
  setField('tk-version', f.version);

  // Mods: IDs das rules + nome do log + detalhes da Steam
  trackingMods = mergeModSources(unturned.mods);
  document.getElementById('tk-mod-count').textContent = trackingMods.length;
  document.getElementById('tk-mods-empty').classList.toggle('hidden', trackingMods.length > 0);
  document.getElementById('mods-tools').classList.toggle('hidden', trackingMods.length < LIST_TOOLS_THRESHOLD);
  renderModsList();
  loadWorkshopDetails(trackingMods.map((m) => m.id));

  // Guarda as rules cruas para o botão "ver tudo"
  renderRawRules(unturned.raw || {});
}

// ============================================================
// Mods do Workshop — dados vindos da própria Steam
//
// As rules do A2S só publicam o ID numérico. O log do jogo às
// vezes traz o nome. O resto (ícone, tipo do asset, tamanho,
// data de atualização) vem da API pública do Workshop, com cache
// em disco no processo principal.
// ============================================================
let trackingMods = [];        // [{ id, name, url }]
let workshopDetails = {};     // id -> detalhes da Steam

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDate(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

async function loadWorkshopDetails(ids) {
  if (!ids || !ids.length) return;
  const bmId = AppState.trackingId;

  // Primeiro o que já está em cache (pinta na hora), depois a rede.
  try {
    const cached = await window.api.workshopPeek(ids);
    if (AppState.trackingId !== bmId) return;
    if (cached && Object.keys(cached).length) {
      Object.assign(workshopDetails, cached);
      renderModsList();
    }
  } catch { /* segue para a busca online */ }

  try {
    const fresh = await window.api.workshopDetails(ids);
    if (AppState.trackingId !== bmId) return;
    if (fresh && Object.keys(fresh).length) {
      Object.assign(workshopDetails, fresh);
      renderModsList();
    }
  } catch { /* sem internet: continua mostrando o ID */ }
}

function modRowHtml(mod) {
  const d = workshopDetails[mod.id] || null;
  const name = (d && d.title) || mod.name || I18N.t('details.modUnnamed');

  const icon = d && d.preview
    ? `<img src="${escapeHtml(d.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer"
         onerror="iconFallback(this,'puzzle')">`
    : Icon.svg('puzzle', 18);

  const meta = [];
  if (d) {
    for (const tag of (d.tags || []).slice(0, 3)) {
      meta.push(`<span class="mod-tag">${escapeHtml(tag)}</span>`);
    }
    const size = formatBytes(d.fileSize);
    if (size) meta.push(`<span class="mod-fact">${escapeHtml(size)}</span>`);
    const upd = formatDate(d.updatedAt);
    if (upd) meta.push(`<span class="mod-fact">${escapeHtml(I18N.t('details.modUpdated', { d: upd }))}</span>`);
    if (d.subscriptions) {
      meta.push(`<span class="mod-fact">${escapeHtml(I18N.t('details.modSubs', { n: d.subscriptions.toLocaleString() }))}</span>`);
    }
    if (d.banned) meta.push(`<span class="mod-tag banned">${escapeHtml(I18N.t('details.modBanned'))}</span>`);
  }

  return `
    <li class="mod-row" data-mod-id="${escapeHtml(mod.id)}">
      <span class="mod-icon">${icon}</span>
      <span class="mod-main">
        <span class="mod-name">${escapeHtml(name)}</span>
        ${meta.length ? `<span class="mod-meta">${meta.join('')}</span>` : ''}
        <span class="mod-id">${escapeHtml(mod.id)}</span>
      </span>
      <button class="btn-ghost small mod-open" data-url="${escapeHtml(mod.url)}">${escapeHtml(I18N.t('details.openWorkshop'))}</button>
    </li>`;
}

function renderModsList() {
  const ul = document.getElementById('tk-mods');
  if (!ul) return;
  const input = document.getElementById('mods-search');
  const q = (input ? input.value : '').trim().toLowerCase();

  const shown = trackingMods.filter((m) => {
    if (!q) return true;
    const d = workshopDetails[m.id];
    return [m.id, m.name, d && d.title, ...(d && d.tags ? d.tags : [])]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const result = document.getElementById('mods-result');
  if (result) {
    result.textContent = q ? I18N.t('list.results', { n: shown.length, total: trackingMods.length }) : '';
  }

  if (!trackingMods.length) { ul.innerHTML = ''; return; }
  if (!shown.length) {
    ul.innerHTML = `<li class="muted">${escapeHtml(I18N.t('list.noMatch'))}</li>`;
    return;
  }

  ul.innerHTML = shown.map(modRowHtml).join('');
  ul.querySelectorAll('.mod-open').forEach((btn) => {
    btn.addEventListener('click', () => window.api.openExternal(btn.dataset.url));
  });
}

// Botão "Atualizar da Steam": limpa o cache e busca de novo.
async function refreshWorkshopDetails() {
  if (!trackingMods.length) return;
  await window.api.workshopClearCache();
  workshopDetails = {};
  renderModsList();
  await loadWorkshopDetails(trackingMods.map((m) => m.id));
  toast(I18N.t('details.modsRefreshed', { n: trackingMods.length }));
}

function renderRawRules(raw) {
  const box = document.getElementById('tk-raw-rules');
  if (!box) return;
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    box.innerHTML = `<p class="muted small">${I18N.t('details.noRaw')}</p>`;
    return;
  }
  box.innerHTML = `<table class="raw-table"><tbody>${
    keys.map(k =>
      `<tr><td class="raw-k">${escapeHtml(k)}</td>` +
      `<td class="raw-v">${escapeHtml(raw[k])}</td></tr>`
    ).join('')
  }</tbody></table>`;
}

// ============================================================
// Airdrop: contador regressivo conforme a configuração do servidor
// ============================================================
async function initAirdrop(bmId) {
  stopAirdropTimer();
  airdropState = await window.api.getAirdrop(bmId);
  if (!airdropState) return;

  const intervalInput = document.getElementById('tk-airdrop-interval');
  intervalInput.value = airdropState.intervalSec;

  const src = document.getElementById('tk-airdrop-source');
  src.textContent = airdropState.intervalFromServer
    ? I18N.t('airdrop.sourceServer', { s: airdropState.intervalFromServer })
    : I18N.t('airdrop.sourceManual');

  startAirdropTimer();
  renderAirdrop();
}

function startAirdropTimer() {
  stopAirdropTimer();
  airdropTimer = setInterval(renderAirdrop, 1000);
}
function stopAirdropTimer() {
  if (airdropTimer) clearInterval(airdropTimer);
  airdropTimer = null;
}

function renderAirdrop() {
  if (!airdropState) return;
  const countEl = document.getElementById('tk-airdrop-count');
  const subEl = document.getElementById('tk-airdrop-sub');

  if (!airdropState.lastAirdropAt) {
    countEl.textContent = '';
    countEl.className = 'airdrop-count';
    subEl.textContent = I18N.t('airdrop.idle');
    return;
  }

  const last = new Date(airdropState.lastAirdropAt).getTime();
  const next = last + airdropState.intervalSec * 1000;
  const remaining = Math.round((next - Date.now()) / 1000);

  if (remaining > 0) {
    countEl.textContent = formatMMSS(remaining);
    countEl.className = 'airdrop-count counting';
    subEl.textContent = I18N.t('airdrop.nextIn');
  } else {
    // Passou do tempo previsto — provável a qualquer momento
    const over = Math.abs(remaining);
    countEl.textContent = I18N.t('airdrop.dueNow');
    countEl.className = 'airdrop-count due';
    subEl.textContent = I18N.t('airdrop.overdue', { t: formatMMSS(over) });
  }
}

function formatMMSS(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function markAirdropFell() {
  if (!AppState.trackingId) return;
  const now = new Date().toISOString();
  await window.api.markAirdrop(AppState.trackingId, now);
  if (airdropState) airdropState.lastAirdropAt = now;
  renderAirdrop();
  toast(I18N.t('airdrop.marked'));
}

async function resetAirdrop() {
  if (!AppState.trackingId) return;
  await window.api.markAirdrop(AppState.trackingId, null);
  if (airdropState) airdropState.lastAirdropAt = null;
  renderAirdrop();
}

async function saveAirdropInterval() {
  if (!AppState.trackingId) return;
  const val = parseInt(document.getElementById('tk-airdrop-interval').value, 10);
  if (!Number.isFinite(val) || val < 30) return;
  await window.api.setAirdropInterval(AppState.trackingId, val);
  if (airdropState) airdropState.intervalSec = val;
  renderAirdrop();
}
