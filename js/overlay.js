// ============================================================
// overlay.js — HUD in-game (janela transparente sempre no topo)
//
// Mostra o servidor fixado com a MESMA linguagem visual da janela
// principal: cabeçalho igual ao card da home (ícone, nome,
// bandeira, IP copiável), descrição renderizada com o rich text do
// jogo, os três números em "stat tiles" como no Quick View, e os
// blocos de airdrop / eventos / online no estilo dos painéis.
//
// Fonte dos dados: Query Port LOCAL (A2S), consultado direto no
// servidor — NÃO depende do BattleMetrics.
// F8 = mostrar/ocultar | F9 = modo fantasma (cliques atravessam)
//
// DETALHE DE IMPLEMENTAÇÃO: a versão anterior remontava todo o
// conteúdo com innerHTML a cada ciclo de atualização e reatava os
// listeners dos botões de airdrop no fim. Isso significa que um
// clique que caísse exatamente no instante da atualização era
// perdido. Aqui o markup é ESTÁTICO (está no overlay.html) e o
// código só escreve nos nós folha — os botões são ligados uma vez.
// ============================================================
(function () {
  let config = null;
  let timer = null;         // rede de segurança (não é o relógio principal)
  let ultimoPush = 0;       // quando chegou o último 'query:update' útil
  let airdropTicker = null; // atualização por segundo do contador
  let airdrop = null;       // { intervalSec, lastAirdropAt, intervalFromServer }
  let lastNames = null;
  let boundServerId = null; // servidor para o qual os botões estão ligados
  let playingHere = false;  // o jogador está NESTE servidor agora?
  const localLogs = [];

  const $ = (id) => document.getElementById(id);
  const esc = (str) => { const d = document.createElement('div'); d.textContent = String(str == null ? '' : str); return d.innerHTML; };
  const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  // Traduções: o overlay usa o mesmo dicionário do app.
  const t = (key, vars) => (typeof I18N !== 'undefined' ? I18N.t(key, vars) : key);

  function pushLog(type, name) {
    localLogs.unshift({ time: new Date(), type, name });
    if (localLogs.length > 30) localLogs.pop();
  }

  function fmt(totalSec) {
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ----------------------------------------------------------
  // Aparência configurável
  //
  // Cor de destaque, transparência do fundo, escala da fonte e
  // quais blocos aparecem. Tudo aplicado por variável CSS ou
  // classe — nada de recarregar a janela.
  // ----------------------------------------------------------
  function applyUi(ui) {
    if (!ui) return;
    const root = document.documentElement;

    if (ui.accent) root.style.setProperty('--accent', ui.accent);
    if (ui.opacity != null) {
      root.style.setProperty('--hud-bg-alpha', String(Math.max(0.2, Math.min(1, ui.opacity / 100))));
    }
    if (ui.scale != null) {
      root.style.fontSize = `${Math.max(70, Math.min(160, ui.scale)) * 13 / 100}px`;
    }

    const s = ui.sections || {};
    const blocks = {
      description: 'ov-desc',
      stats: 'ov-stats',
      airdrop: 'ov-block-airdrop',
      events: 'ov-block-events',
      online: 'ov-block-online'
    };
    for (const [key, id] of Object.entries(blocks)) {
      const el = $(id);
      if (el) el.classList.toggle('section-off', s[key] === false);
    }
  }

  // ----------------------------------------------------------
  // Rótulos fixos (trocam quando o idioma muda no app)
  // ----------------------------------------------------------
  function applyLabels() {
    setText('ov-label-players', t('tracking.players'));
    setText('ov-label-map', t('tracking.map'));
    setText('ov-label-mods', t('overlay.mods')); // curto: o HUD é estreito
    setText('ov-label-airdrop', t('airdrop.title'));
    setText('ov-label-fell', t('overlay.fell'));
    setText('ov-ad-reset', t('airdrop.reset'));
    setText('ov-label-events', t('overlay.events'));
    setText('ov-label-online', t('tracking.playersOnline'));
    setText('ov-empty-text', t('overlay.empty'));
    setText('ov-live-text', t('current.playingNow'));
    setText('ov-foot-hint', t('overlay.hintToggle'));
    const ip = $('ov-ip');
    if (ip) ip.title = t('card.copyIp');
    const ct = $('ov-ct');
    if (ct && !ct.classList.contains('clickthrough-on')) ct.textContent = t('overlay.hintGhost');
  }

  // ----------------------------------------------------------
  // Estados da tela
  // ----------------------------------------------------------
  function showEmpty() {
    setText('ov-name', 'Unturned+');
    show('ov-empty', true);
    show('ov-error', false);
    show('ov-main', false);
  }

  function showError(message) {
    show('ov-empty', false);
    show('ov-main', false);
    show('ov-error', true);
    setText('ov-error-text', message || t('overlay.noResponse'));
  }

  function showMain() {
    show('ov-empty', false);
    show('ov-error', false);
    show('ov-main', true);
  }

  // ----------------------------------------------------------
  // Atualização do conteúdo (sempre no lugar, nunca recriando)
  // ----------------------------------------------------------
  function renderHeader(server, info, unturned) {
    const name = info.name || server.name || '';
    setText('ov-name', name);
    setText('ov-server-name', name);

    const icon = $('ov-icon');
    const iconUrl = unturned && unturned.iconUrl;
    if (iconUrl && icon.dataset.src !== iconUrl) {
      icon.dataset.src = iconUrl;
      icon.innerHTML = `<img src="${esc(iconUrl)}" alt="" referrerpolicy="no-referrer" onerror="iconFallback(this)">`;
    } else if (!iconUrl && icon.dataset.src) {
      icon.dataset.src = '';
      icon.innerHTML = Icon.svg('gamepad', 18);
    }

    const address = `${server.ip}:${server.port}`;
    const ipEl = $('ov-ip');
    ipEl.textContent = address;
    ipEl.dataset.copy = address;

    // Bandeira do país (cache no processo principal — 1 consulta por IP)
    const geo = GeoFlag.peek(server.ip);
    $('ov-flag').innerHTML = geo ? GeoFlag.html(geo) : '';
    if (geo === undefined) {
      GeoFlag.resolve(server.ip).then((g) => { if (g) $('ov-flag').innerHTML = GeoFlag.html(g); });
    }

    const pill = $('ov-status');
    pill.textContent = t('status.online');
    pill.className = 'status-pill online';

    // Descrição com as cores/tamanhos que o servidor definiu no jogo
    const desc = unturned && unturned.fields ? unturned.fields.description : null;
    const descEl = $('ov-desc');
    if (desc) RichText.render(descEl, desc, { maxScale: 1.15, baseSize: 14 });
    else { descEl.innerHTML = ''; descEl.removeAttribute('title'); }

    show('ov-live', playingHere);
  }

  function renderStats(info, unturned) {
    setText('ov-players', `${info.players}/${info.maxPlayers == null ? '?' : info.maxPlayers}`);
    setText('ov-map', info.map || '');
    setText('ov-mods', unturned && unturned.modCount ? String(unturned.modCount) : '');
    $('ov-stat-players').classList.remove('offline');
  }

  function renderEvents() {
    setText('ov-events-count', String(localLogs.length));
    const ul = $('ov-events');
    if (!localLogs.length) {
      ul.innerHTML = `<li class="empty">${esc(t('overlay.waiting'))}</li>`;
      return;
    }
    ul.innerHTML = localLogs.map((l) =>
      `<li><span class="t">${esc(l.time.toLocaleTimeString())}</span>` +
      `<span class="${l.type}">${Icon.svg(l.type === 'join' ? 'plus' : 'minus', 11)} ${esc(l.name)}</span></li>`
    ).join('');
  }

  function renderOnline(names) {
    setText('ov-online-count', String(names.length));
    const ul = $('ov-online');
    if (!names.length) {
      ul.innerHTML = `<li class="empty">${esc(t('tracking.noPlayers'))}</li>`;
      return;
    }
    const shown = names.slice(0, 20);
    ul.innerHTML = shown.map((n) =>
      `<li><span class="status-dot online"></span><span class="ov-player-name">${esc(n)}</span></li>`
    ).join('') + (names.length > 20
      ? `<li class="more">${esc(t('overlay.more', { n: names.length - 20 }))}</li>`
      : '');
  }

  // ----------------------------------------------------------
  // Próximo wipe/evento
  // ----------------------------------------------------------
  // Dentro do jogo cabe UMA linha. Mostra o item mais próximo do
  // servidor atual e some quando não há nada agendado — bloco vazio
  // no HUD é espaço roubado da tela do jogo.
  //
  // A contagem é formatada aqui porque a janela do overlay não
  // carrega o agenda.js. Mesmo formato, texto vindo do i18n.
  async function renderSched(server) {
    const box = $('ov-sched');
    if (!box) return;
    if (!server || !window.api.schedSummary) { box.classList.add('hidden'); return; }
    let resumo;
    try { resumo = await window.api.schedSummary(); } catch { resumo = null; }
    const s = resumo && resumo[String(server.bmId)];
    const item = s && (s.wipe || s.next);
    if (!item) { box.classList.add('hidden'); return; }

    const falta = item.nextAt - Date.now();
    const ico = $('ov-sched-ico');
    if (ico) ico.innerHTML = Icon.svg(item.kind === 'wipe' ? 'broom' : 'calendar', 13);
    setText('ov-sched-name', item.title);
    setText('ov-sched-count', falta <= 0 ? t('sched.now') : contagemCurta(falta));
    box.className = 'ov-sched ' + urgencia(falta);
  }

  function contagemCurta(ms) {
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    if (d >= 1) return t('sched.inDH', { d, h });
    if (h >= 1) return t('sched.inHM', { h, m: min % 60 });
    return t('sched.inMin', { n: Math.max(1, min) });
  }

  function urgencia(ms) {
    if (ms <= 0) return 'now';
    if (ms <= 3600e3) return 'imminent';
    if (ms <= 86400e3) return 'soon';
    if (ms <= 3 * 86400e3) return 'near';
    return 'far';
  }

  function renderAirdrop() {
    const el = $('ov-ad-count'), sub = $('ov-ad-sub');
    if (!el || !airdrop) return;
    if (!airdrop.lastAirdropAt) {
      el.textContent = '';
      el.className = 'ov-ad-count';
      sub.textContent = t('overlay.airdropIdle');
      return;
    }
    const next = new Date(airdrop.lastAirdropAt).getTime() + airdrop.intervalSec * 1000;
    const rem = Math.round((next - Date.now()) / 1000);
    if (rem > 0) {
      el.textContent = fmt(rem);
      el.className = 'ov-ad-count counting';
      sub.textContent = t('airdrop.nextIn');
    } else {
      el.textContent = t('airdrop.dueNow');
      el.className = 'ov-ad-count due';
      sub.textContent = t('airdrop.overdue', { t: fmt(Math.abs(rem)) });
    }
  }

  // ----------------------------------------------------------
  // Ciclo de atualização
  // ----------------------------------------------------------
  // Desenha um resultado de query JÁ PRONTO. O processo principal
  // consulta o servidor uma vez e transmite para as duas janelas —
  // esta função é o ponto de entrada tanto do push quanto da
  // consulta de emergência lá embaixo.
  function desenhar(payload) {
    const server = (config && (config.servers || []).find((s) => s.bmId === boundServerId)) || null;

    if (!payload || payload.error || !payload.info) {
      // Servidor offline: mantemos o cabeçalho, mas deixamos claro.
      if (server) {
        showMain();
        renderHeader(server, { name: server.name }, null);
        const pill = $('ov-status');
        pill.textContent = t('status.offline');
        pill.className = 'status-pill offline';
        setText('ov-players', '');
        setText('ov-map', '');
        setText('ov-mods', '');
        $('ov-stat-players').classList.add('offline');
        renderOnline([]);
        renderEvents();
        renderAirdrop();
        renderSched(server);
      } else {
        showError(t('overlay.noResponse'));
      }
      return;
    }

    const { info, players, unturned } = payload;
    const names = (players || []).map((p) => p.name).sort((a, b) => a.localeCompare(b));

    // Detecta join/leave comparando com o ciclo anterior
    const now = new Set(names);
    if (lastNames) {
      for (const n of now) if (!lastNames.has(n)) pushLog('join', n);
      for (const n of lastNames) if (!now.has(n)) pushLog('leave', n);
    }
    lastNames = now;

    showMain();
    renderHeader(server || { ip: '', port: '' }, info, unturned);
    renderStats(info, unturned);
    renderEvents();
    renderOnline(names);
    renderAirdrop();
    renderSched(server);
  }

  // Recarrega o contexto local (config + airdrop). Barato: é leitura
  // de arquivo no processo principal, não vai na rede.
  async function carregarContexto() {
    config = await window.api.getConfig();
    const bmId = config.overlayServerId;
    if (!bmId) { boundServerId = null; showEmpty(); return false; }
    boundServerId = bmId;
    try { airdrop = await window.api.getAirdrop(bmId); } catch { airdrop = null; }
    return true;
  }

  // Consulta de emergência: só usada quando o push não chega (o app
  // principal foi fechado, o polling parou, etc.).
  async function refresh() {
    // Conta como "dado fresco": senão a rede de segurança dispararia
    // de novo 5s depois, virando o relógio próprio que acabamos de
    // remover.
    ultimoPush = Date.now();
    if (!(await carregarContexto())) return;
    try {
      const r = await window.api.queryServerByBmId(boundServerId);
      desenhar({ bmId: boundServerId, ...r });
    } catch (e) {
      desenhar({ bmId: boundServerId, error: e.message });
    }
  }

  // O HUD NÃO tem relógio próprio de consulta.
  //
  // Antes existiam dois setInterval independentes — um aqui e um no
  // processo principal — e nada os sincronizava. Na prática o HUD
  // mostrava a saída de um jogador com até um ciclo inteiro de
  // atraso em relação ao app, além de consultar o servidor de jogo
  // em dobro. Agora o processo principal consulta uma vez e
  // transmite; o que sobra aqui é só uma rede de segurança que
  // dispara se nenhum push chegar (app principal fechado, polling
  // parado). O ticker de 1s é local: só redesenha o contador do
  // airdrop, não vai na rede.
  // Tique curto de propósito: o corpo é uma comparação de números,
  // não custa nada, e garante que a queda do push seja notada logo
  // depois de a tolerância vencer em vez de no próximo múltiplo de
  // um tique grande.
  const REDE_SEGURANCA_MS = 5000;

  function startLoops() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const intervalo = Math.max(15, (config && config.refreshInterval) || 30) * 1000;
      // Tolerância de 1,5x o intervalo antes de assumir que o push
      // morreu — senão brigaríamos com o ciclo normal.
      if (Date.now() - ultimoPush > intervalo * 1.5) refresh();
    }, REDE_SEGURANCA_MS);

    if (airdropTicker) clearInterval(airdropTicker);
    airdropTicker = setInterval(renderAirdrop, 1000); // contagem suave
  }

  // Caminho normal: o processo principal terminou de consultar este
  // servidor e mandou o resultado. Instantâneo e idêntico ao que o
  // app está mostrando no mesmo momento.
  window.api.onQueryUpdate(async (payload) => {
    if (!payload || !payload.bmId) return;
    if (!boundServerId) { if (!(await carregarContexto())) return; }
    if (payload.bmId !== boundServerId) return;
    ultimoPush = Date.now();
    desenhar(payload);
  });

  // ----------------------------------------------------------
  // Ligações (feitas UMA vez — o markup é estático)
  // ----------------------------------------------------------
  $('ov-close').addEventListener('click', () => window.api.hideOverlay());

  $('ov-ad-fell').addEventListener('click', async () => {
    if (!boundServerId) return;
    const ts = new Date().toISOString();
    await window.api.markAirdrop(boundServerId, ts);
    if (airdrop) airdrop.lastAirdropAt = ts;
    renderAirdrop();
  });

  $('ov-ad-reset').addEventListener('click', async () => {
    if (!boundServerId) return;
    await window.api.markAirdrop(boundServerId, null);
    if (airdrop) airdrop.lastAirdropAt = null;
    renderAirdrop();
  });

  // Copiar o IP direto do HUD, como no card da home.
  $('ov-ip').addEventListener('click', async (e) => {
    const el = e.currentTarget;
    const text = el.dataset.copy;
    if (!text) return;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch { try { ok = await window.api.copyText(text); } catch { ok = false; } }
    el.classList.add(ok ? 'copied' : 'copy-failed');
    setTimeout(() => el.classList.remove('copied', 'copy-failed'), 1200);
  });

  window.api.onOverlayConfigChanged(async () => {
    lastNames = null;
    localLogs.length = 0;
    const cfg = await window.api.getConfig();
    // Trocou o idioma no app? O HUD acompanha.
    if (typeof I18N !== 'undefined' && cfg.language !== I18N.lang) {
      await I18N.load(cfg.language);
      applyLabels();
    }
    refresh();
  });

  // O jogador entrou no servidor que está fixado? Acende o chip
  // "jogando agora", igual ao card da home.
  window.api.onCurrentServer((payload) => {
    if (!payload || payload.disconnected) {
      playingHere = false;
      show('ov-live', false);
      return;
    }
    const server = config && (config.servers || []).find((s) => s.bmId === (config.overlayServerId));
    playingHere = !!(server && payload.ip === server.ip && Number(payload.port) === Number(server.port));
    show('ov-live', playingHere);
  });

  window.api.onClickThroughChanged((on) => {
    const el = $('ov-ct');
    el.textContent = on ? t('overlay.hintGhostOn') : t('overlay.hintGhost');
    el.className = on ? 'clickthrough-on' : '';
  });

  window.api.onOverlayUi(applyUi);

  (async () => {
    config = await window.api.getConfig();
    if (typeof I18N !== 'undefined') await I18N.load(config.language);
    // Os <span data-icon> do overlay.html viram SVG aqui. Esta
    // janela não passa pelo boot do app principal, então a pintura
    // é responsabilidade dela.
    if (typeof Icon !== 'undefined') Icon.paint();
    applyUi(config.overlayUi);
    applyLabels();
    startLoops();
    // Primeira pintura: o processo principal também dispara uma
    // leitura no did-finish-load desta janela; o que chegar primeiro
    // pinta, o outro só confirma.
    await refresh();
  })();
})();
