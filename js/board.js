// ============================================================
// board.js — a MESA DE INVESTIGAÇÃO
//
//   "faça uma aba customizada para ver todas as notas em algo como
//    se fosse uma mesa de investigação com ligação para cada.
//    isso funciona no server e no teams."
//
// ------------------------------------------------------------
// O QUE ESTA TELA É, E O QUE ELA NÃO É
// ------------------------------------------------------------
// É a mesma lista de anotações, olhada por outro eixo. Na lista, o
// que organiza é o TEMPO (a mais recente em cima). Na mesa, o que
// organiza é a RELAÇÃO: quem anda com quem, qual base é de qual
// grupo, qual plano ataca qual alvo.
//
// Não é um mapa. Não é um organograma automático. A posição de
// cada cartão é escolhida pela pessoa e fica gravada — é o gesto
// de "esse aqui fica perto daquele" que carrega a informação. Um
// layout automático destruiria exatamente isso a cada abertura.
//
// ------------------------------------------------------------
// TRÊS ARMADILHAS QUE ESTA TELA TEM
// ------------------------------------------------------------
// 1. MEDIR EM PAINEL ESCONDIDO. Um cartão dentro de `.hidden` mede
//    zero, e as linhas saem todas do canto superior esquerdo. Por
//    isso quem chama desenha um quadro DEPOIS de mostrar a aba
//    (ver `switchTeamTab`), e `montar` refaz as linhas no primeiro
//    `requestAnimationFrame`.
//
// 2. ARRASTAR COM SCROLL. A mesa rola. Se a conta usar coordenada
//    de viewport (`clientX`) contra posição de layout (`offsetLeft`),
//    o cartão pula ao arrastar numa mesa rolada. Tudo aqui é
//    calculado no espaço da MESA, não da janela.
//
// 3. GRAVAR A CADA PIXEL. Arrastar dispara dezenas de eventos por
//    segundo; gravar em todos significa dezenas de escritas em
//    disco por gesto. Grava-se ao SOLTAR.
// ============================================================

const BoardView = (() => {
  'use strict';

  const LARGURA = 210;    // do cartão
  const ALTURA_MIN = 92;
  const GAP = 34;

  const estado = {
    el: null,
    ad: null,
    cartoes: [],
    pos: new Map(),        // id -> {x,y} no espaço da mesa
    arrastando: null,
    // Zoom da mesa. Não é o zoom do navegador: é uma escala CSS no
    // conteúdo, e por isso toda conta de arrasto precisa dividir
    // por ela — foi o primeiro bug que apareceu ao ligar isto.
    zoom: 1,
    cheia: false,
    // O `click` que vem DEPOIS de arrastar.
    //
    // Soltar o botão dispara `pointerup` e, logo em seguida, um
    // `click` — o navegador não sabe que aquilo foi um arrasto. Sem
    // esta trava, todo arrasto terminava abrindo o editor da
    // anotação em cima da mesa: você organizava um cartão e ganhava
    // um modal na cara. Foi o teste de arrastar que pegou isso, e
    // só porque ele continuava clicando depois.
    ignorarClique: false,
    ligando: null,         // id do cartão que está esperando o par
    aoMudar: null
  };

  // ------------------------------------------------------------
  // Posição
  // ------------------------------------------------------------
  // Cartão sem posição gravada ganha uma vaga na grade, calculada
  // pelo ÍNDICE. Determinístico de propósito: reabrir a mesa tem
  // que devolver o mesmo desenho, e uma posição aleatória faria a
  // mesa se reorganizar sozinha a cada abertura.
  //
  // A vaga NÃO é gravada. Gravar no primeiro desenho encheria o
  // arquivo de posições que ninguém escolheu, e depois seria
  // impossível distinguir "a pessoa pôs aqui" de "caiu aqui".
  function vaga(i, colunas) {
    const c = i % colunas, l = Math.floor(i / colunas);
    // Colunas ímpares descem meia altura. Uma grade perfeita
    // alinhava todo mundo na mesma linha e a mesa parecia uma
    // prateleira: as ligações viravam traços horizontais escondidos
    // atrás dos cartões vizinhos. Escalonado, a linha tem para onde
    // ir e a relação aparece.
    const degrau = (c % 2) ? Math.round((ALTURA_MIN + GAP) / 2) : 0;
    return { x: 20 + c * (LARGURA + GAP), y: 20 + degrau + l * ((ALTURA_MIN + GAP) * 2) };
  }

  // No máximo 4 colunas: além disso a mesa vira uma fileira e perde
  // o sentido de "mesa". O que sobra desce para a linha de baixo, e
  // a rolagem existe justamente para isso.
  function colunasPara(largura) {
    return Math.max(1, Math.min(4, Math.floor((largura - 40) / (LARGURA + GAP))));
  }

  // ------------------------------------------------------------
  // Montagem
  // ------------------------------------------------------------
  async function montar(el, ad, { aoMudar = null } = {}) {
    if (!el || !ad) return;
    estado.el = el;
    estado.ad = ad;
    estado.aoMudar = aoMudar;
    estado.cartoes = await ad.listar();

    const colunas = colunasPara(el.clientWidth || 900);
    estado.pos = new Map();
    estado.cartoes.forEach((c, i) => {
      const p = c.board && Number.isFinite(Number(c.board.x)) ? c.board : vaga(i, colunas);
      estado.pos.set(c.id, { x: Number(p.x), y: Number(p.y) });
    });

    desenhar();
    // Segundo desenho um quadro depois: no primeiro, os cartões
    // ainda não têm altura medida e as linhas apontam para a altura
    // errada. Redesenhar as LINHAS (não a mesa toda) é barato.
    requestAnimationFrame(() => linhas());
    return estado.cartoes.length;
  }

  function desenhar() {
    const el = estado.el;
    if (!el) return;

    if (!estado.cartoes.length) {
      el.innerHTML = `
        <div class="board-empty">
          <p class="muted">${escapeHtml(I18N.t('board.empty'))}</p>
          <p class="muted small">${escapeHtml(I18N.t('board.emptyHow'))}</p>
        </div>`;
      return;
    }

    const arestas = Dossier.arestas(estado.cartoes);

    // Extensão da mesa: o cartão mais à direita/abaixo, com folga.
    // Sem isto, arrastar um cartão para fora não cria barra de
    // rolagem e ele fica inalcançável.
    let maxX = 0, maxY = 0;
    for (const p of estado.pos.values()) {
      maxX = Math.max(maxX, p.x + LARGURA);
      maxY = Math.max(maxY, p.y + ALTURA_MIN);
    }

    el.innerHTML = `
      <div class="board-bar">
        <span class="muted small">${escapeHtml(I18N.t('board.hint'))}</span>
        <span style="flex:1"></span>
        <span class="board-legend">
          ${Object.keys(Dossier.RELS).map((k) => `
            <span class="bl-item"><i style="background:${escapeHtml(Dossier.RELS[k].cor)}"></i>${
              escapeHtml(I18N.t(Dossier.RELS[k].chave))}</span>`).join('')}
        </span>
        <button class="btn-small" id="board-tidy">${Icon.svg('puzzle', 12)} ${escapeHtml(I18N.t('board.tidy'))}</button>
        <span class="board-zoom">
          <button class="btn-small" id="board-out" title="${escapeHtml(I18N.t('map.zoomOut'))}">${Icon.svg('minus', 12)}</button>
          <button class="btn-small" id="board-reset" title="${escapeHtml(I18N.t('map.resetZoom'))}">${Math.round(estado.zoom * 100)}%</button>
          <button class="btn-small" id="board-in" title="${escapeHtml(I18N.t('map.zoomIn'))}">${Icon.svg('plus', 12)}</button>
        </span>
        <button class="btn-small" id="board-full" title="${escapeHtml(I18N.t('board.fullscreen'))}">${
          Icon.svg(estado.cheia ? 'close' : 'external', 12)}</button>
      </div>
      <div class="board-wrap">
        <div class="board-canvas" style="width:${maxX + 60}px;height:${maxY + 80}px;
             transform:scale(${estado.zoom});transform-origin:0 0">
          <svg class="board-links" width="${maxX + 60}" height="${maxY + 80}"></svg>
          ${estado.cartoes.map((c) => cartaoHtml(c)).join('')}
        </div>
      </div>`;

    ligarEventos();
    linhas(arestas);
  }

  function cartaoHtml(c) {
    const p = estado.pos.get(c.id) || { x: 0, y: 0 };
    const t = Dossier.tipoDe(c.type);
    const ico = c.type === 'ficha' ? (c.icon || 'user') : t.icone;
    const marcado = estado.ligando === c.id;
    const resumo = c.type === 'raid'
      ? Dossier.resumoRaid(c.raid)
      : String(c.text || '').replace(/<[^>]*>/g, '').trim();
    return `
      <article class="board-card${marcado ? ' ligando' : ''}" data-bc="${escapeHtml(c.id)}"
               style="left:${p.x}px;top:${p.y}px;width:${LARGURA}px;--tipo:${escapeHtml(t.cor)}">
        <header class="bc-head">
          ${c.photo
            ? `<img class="bc-foto" src="${escapeHtml(c.photo)}" alt="" onerror="this.remove()" />`
            : `<span class="bc-ico">${Icon.svg(ico, 14)}</span>`}
          <strong class="bc-title">${escapeHtml(c.title || I18N.t('notes.untitled'))}</strong>
        </header>
        ${c.type === 'ficha' && c.player
          ? `<p class="bc-player">${escapeHtml(c.player)}</p>` : ''}
        ${resumo ? `<p class="bc-text">${escapeHtml(resumo.slice(0, 90))}${resumo.length > 90 ? '…' : ''}</p>` : ''}
        <footer class="bc-foot">
          ${c.author ? `<span class="bc-author">${escapeHtml(c.author)}</span>` : ''}
          <span style="flex:1"></span>
          <button class="bc-act" data-bact="link" title="${escapeHtml(I18N.t('board.link'))}">${Icon.svg('link', 12)}</button>
          <button class="bc-act" data-bact="open" title="${escapeHtml(I18N.t('common.edit'))}">${Icon.svg('edit', 12)}</button>
        </footer>
      </article>`;
  }

  // ------------------------------------------------------------
  // As linhas
  // ------------------------------------------------------------
  // Curva de Bézier em vez de reta: com duas ligações entre cartões
  // próximos, duas retas se sobrepõem e viram uma só. A curva
  // separa e ainda mostra a direção do olhar.
  function linhas(arestas) {
    const el = estado.el;
    if (!el) return;
    const svg = el.querySelector('.board-links');
    if (!svg) return;
    const lista = arestas || Dossier.arestas(estado.cartoes);

    const caixa = (id) => {
      const card = el.querySelector(`[data-bc="${CSS.escape(id)}"]`);
      const p = estado.pos.get(id) || { x: 0, y: 0 };
      const h = card ? card.offsetHeight : ALTURA_MIN;
      return { x: p.x, y: p.y, w: LARGURA, h,
               cx: p.x + LARGURA / 2, cy: p.y + h / 2 };
    };

    // A linha começa na BORDA do cartão, não no centro dele.
    //
    // Ligando centro a centro, o trecho que atravessa o cartão fica
    // escondido atrás dele (o cartão é opaco e pinta por cima do
    // SVG). Entre dois cartões vizinhos sobrava só o pedacinho do
    // vão, e a mesa parecia sem ligação nenhuma — foi o que apareceu
    // na primeira captura de tela.
    //
    // A conta: caminha do centro na direção do outro cartão até
    // cruzar a borda do retângulo. Escala pelo eixo que "estoura"
    // primeiro; é a forma mais curta de recortar um segmento num
    // retângulo sem tratar oito casos de canto.
    function naBorda(de, para) {
      const dx = para.cx - de.cx, dy = para.cy - de.cy;
      if (!dx && !dy) return { x: de.cx, y: de.cy };
      const tx = dx ? (de.w / 2 + 4) / Math.abs(dx) : Infinity;
      const ty = dy ? (de.h / 2 + 4) / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty, 1);
      return { x: de.cx + dx * t, y: de.cy + dy * t };
    }

    svg.innerHTML = lista.map(({ a, b, rel }) => {
      const cA = caixa(a), cB = caixa(b);
      const A = naBorda(cA, cB), B = naBorda(cB, cA);
      const dx = (B.x - A.x) * 0.4;
      const d = `M ${A.x} ${A.y} C ${A.x + dx} ${A.y}, ${B.x - dx} ${B.y}, ${B.x} ${B.y}`;
      const cor = Dossier.relDe(rel).cor;
      // Bolinha nas pontas: sem ela a curva encosta no cartão sem
      // dizer que é ali que ela termina.
      return `<path d="${d}" stroke="${cor}" fill="none" stroke-width="2.2"
                    stroke-linecap="round" opacity="0.85"
                    class="bl-path r-${rel}" />
              <circle cx="${A.x}" cy="${A.y}" r="3" fill="${cor}" />
              <circle cx="${B.x}" cy="${B.y}" r="3" fill="${cor}" />`;
    }).join('');
  }

  // ------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------
  function ligarEventos() {
    const el = estado.el;
    const canvas = el.querySelector('.board-canvas');
    if (!canvas) return;

    const tidy = el.querySelector('#board-tidy');
    if (tidy) tidy.addEventListener('click', arrumar);

    // ---- zoom ----
    // Limites de propósito: abaixo de 40% o título vira borrão e a
    // mesa deixa de responder à pergunta que ela existe para
    // responder; acima de 200% cabe um cartão e meio na tela.
    const passo = (d) => {
      estado.zoom = Math.min(2, Math.max(0.4, Math.round((estado.zoom + d) * 10) / 10));
      desenhar();
      requestAnimationFrame(() => linhas());
    };
    const bIn = el.querySelector('#board-in');
    if (bIn) bIn.addEventListener('click', () => passo(0.1));
    const bOut = el.querySelector('#board-out');
    if (bOut) bOut.addEventListener('click', () => passo(-0.1));
    const bReset = el.querySelector('#board-reset');
    if (bReset) bReset.addEventListener('click', () => { estado.zoom = 1; desenhar(); requestAnimationFrame(() => linhas()); });
    const bFull = el.querySelector('#board-full');
    if (bFull) bFull.addEventListener('click', telaCheia);

    // Ctrl+roda faz zoom, como em qualquer mapa. Sem Ctrl a roda
    // rola a mesa, que é o que se espera de uma área rolável.
    const wrap = el.querySelector('.board-wrap');
    if (wrap) {
      wrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        passo(e.deltaY < 0 ? 0.1 : -0.1);
      }, { passive: false });
    }

    canvas.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('[data-bc]');
      if (!card) return;
      const act = e.target.closest('[data-bact]');
      if (act) return;   // botão: tratado no click

      // Espaço da MESA, não da janela: a mesa rola, e misturar os
      // dois espaços faz o cartão pular no primeiro arrasto depois
      // de rolar.
      const r = canvas.getBoundingClientRect();
      const p = estado.pos.get(card.dataset.bc) || { x: 0, y: 0 };
      // Dividir pelo ZOOM: `getBoundingClientRect` devolve pixels
      // da tela, já escalados, e `left/top` do cartão estão em
      // pixels da mesa. Sem esta divisão, com a mesa a 50% o cartão
      // andava o dobro do que o ponteiro.
      const z = estado.zoom || 1;
      estado.arrastando = {
        id: card.dataset.bc,
        dx: (e.clientX - r.left) / z - p.x,
        dy: (e.clientY - r.top) / z - p.y,
        moveu: false
      };
      card.setPointerCapture(e.pointerId);
      card.classList.add('arrastando');
    });

    canvas.addEventListener('pointermove', (e) => {
      const d = estado.arrastando;
      if (!d) return;
      const r = canvas.getBoundingClientRect();
      const z = estado.zoom || 1;
      const x = Math.max(0, (e.clientX - r.left) / z - d.dx);
      const y = Math.max(0, (e.clientY - r.top) / z - d.dy);
      // Um clique treme alguns pixels. Sem esta margem, todo clique
      // viraria um arrasto microscópico e gravaria posição nova.
      if (Math.abs(x - (estado.pos.get(d.id) || {}).x) > 2 ||
          Math.abs(y - (estado.pos.get(d.id) || {}).y) > 2) d.moveu = true;
      estado.pos.set(d.id, { x, y });
      const card = canvas.querySelector(`[data-bc="${CSS.escape(d.id)}"]`);
      if (card) { card.style.left = x + 'px'; card.style.top = y + 'px'; }
      linhas();
    });

    const soltar = async (e) => {
      const d = estado.arrastando;
      if (!d) return;
      estado.arrastando = null;
      const card = canvas.querySelector(`[data-bc="${CSS.escape(d.id)}"]`);
      if (card) card.classList.remove('arrastando');
      if (!d.moveu) return;
      estado.ignorarClique = true;
      // Grava ao SOLTAR, uma vez. Ver a armadilha 3 no topo.
      const p = estado.pos.get(d.id);
      await estado.ad.moverNaMesa(d.id, p.x, p.y);
      const c = estado.cartoes.find((z) => z.id === d.id);
      if (c) c.board = { x: p.x, y: p.y };
    };
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);

    canvas.addEventListener('click', async (e) => {
      // Clique que é só o fim de um arrasto: consome e sai.
      if (estado.ignorarClique) { estado.ignorarClique = false; return; }
      const card = e.target.closest('[data-bc]');
      if (!card) return;
      const act = e.target.closest('[data-bact]');
      const id = card.dataset.bc;

      if (act && act.dataset.bact === 'open') { abrir(id); return; }

      if (act && act.dataset.bact === 'link') {
        // Ligar são DOIS cliques: marcar um cartão e escolher o
        // outro. Um modal com uma lista de nomes funciona na lista,
        // mas na mesa a pessoa está olhando para os cartões — pedir
        // que ela procure o mesmo cartão numa lista de texto é
        // desfazer o motivo da tela existir.
        if (!estado.ligando) {
          estado.ligando = id;
          desenhar();
          toast(I18N.t('board.pickOther'));
          return;
        }
        if (estado.ligando === id) { estado.ligando = null; desenhar(); return; }
        const a = estado.ligando;
        estado.ligando = null;

        const jaTem = Dossier.relacaoEntre(
          estado.cartoes.find((c) => c.id === a) || {}, id);
        if (jaTem) {
          if (await Ask.confirm(I18N.t('board.unlinkAsk'))) {
            await estado.ad.desligar(a, id);
            await recarregar();
            return;
          }
          desenhar();
          return;
        }

        const rel = await Ask.pick(I18N.t('notes.linkRel'),
          Object.keys(Dossier.RELS).map((k) => ({
            valor: k, texto: I18N.t(Dossier.RELS[k].chave), sub: I18N.t('notes.rel_' + k + '_sub')
          })));
        if (!rel) { desenhar(); return; }
        const r = await estado.ad.ligar(a, id, rel);
        if (!r || r.ok === false) { toast(I18N.t('notes.linkFailed')); desenhar(); return; }
        await recarregar();
        return;
      }

      // Clique no corpo do cartão que NÃO foi arrasto: abre.
      if (!act) abrir(id);
    });
  }

  // ------------------------------------------------------------
  // TELA CHEIA
  // ------------------------------------------------------------
  // Não usa a API de fullscreen do navegador: ela tira a janela do
  // Electron do lugar, come a barra de título e sai com Esc de um
  // jeito que o resto do app não controla. Aqui é uma classe no
  // elemento — a mesa ocupa a janela inteira, e o Esc é nosso.
  function telaCheia() {
    estado.cheia = !estado.cheia;
    estado.el.classList.toggle('mesa-cheia', estado.cheia);
    document.body.classList.toggle('com-mesa-cheia', estado.cheia);
    desenhar();
    // A mesa mudou de tamanho: as linhas precisam ser remedidas no
    // quadro seguinte, com o novo layout já aplicado.
    requestAnimationFrame(() => linhas());
  }

  function abrir(id) {
    const c = estado.cartoes.find((z) => z.id === id);
    if (!c) return;
    NoteEditor.open(estado.ad.escopo || null, {
      id: c.id, type: c.type, title: c.title, text: c.text, icon: c.icon,
      photo: c.photo, color: c.color, player: c.player, raid: c.raid, links: c.links,
      shots: c.shots, pinned: c.pinned, ...(c.bruto || {})
    }, async () => { await recarregar(); if (estado.aoMudar) await estado.aoMudar(); },
    { adaptador: estado.ad });
  }

  async function recarregar() {
    estado.cartoes = await estado.ad.listar();
    // Mantém as posições já conhecidas; só os cartões novos ganham
    // vaga. Recalcular tudo jogaria a mesa inteira de volta para a
    // grade a cada ligação criada.
    const colunas = colunasPara(estado.el.clientWidth || 900);
    estado.cartoes.forEach((c, i) => {
      if (estado.pos.has(c.id)) return;
      const p = c.board && Number.isFinite(Number(c.board.x)) ? c.board : vaga(i, colunas);
      estado.pos.set(c.id, { x: Number(p.x), y: Number(p.y) });
    });
    desenhar();
    requestAnimationFrame(() => linhas());
    if (estado.aoMudar) await estado.aoMudar();
  }

  // Arrumar devolve todo mundo para a grade. Grava, porque é uma
  // escolha da pessoa — diferente da vaga automática do primeiro
  // desenho, que ninguém pediu.
  async function arrumar() {
    if (!await Ask.confirm(I18N.t('board.tidyAsk'))) return;
    const colunas = colunasPara(estado.el.clientWidth || 900);
    for (let i = 0; i < estado.cartoes.length; i++) {
      const c = estado.cartoes[i];
      const p = vaga(i, colunas);
      estado.pos.set(c.id, p);
      await estado.ad.moverNaMesa(c.id, p.x, p.y);
      c.board = p;
    }
    desenhar();
    requestAnimationFrame(() => linhas());
  }

  // ------------------------------------------------------------
  // Os dois lugares onde a mesa aparece
  // ------------------------------------------------------------
  function montarServidor() {
    const el = document.getElementById('tk-board');
    if (!el || !AppState.trackingId) return;
    return montar(el, Dossier.local('server:' + AppState.trackingId));
  }

  function montarTime(g) {
    const el = document.getElementById('team-board');
    if (!el || !g) return;
    return montar(el, Dossier.time(g.id), {
      aoMudar: async () => { if (typeof loadTeam === 'function') await loadTeam(); }
    });
  }

  // Esc fecha a tela cheia. Registrado uma vez, no módulo — não a
  // cada desenho, que penduraria um ouvinte novo por render.
  //
  // NA FASE DE CAPTURA, E CONSUMINDO O EVENTO.
  //
  // O app já tem um Esc global que volta do servidor para a lista.
  // Sem consumir aqui, um Esc fazia as DUAS coisas: saía da tela
  // cheia e jogava a pessoa na home. Ela pedia para fechar a mesa e
  // perdia o servidor que estava acompanhando.
  //
  // Captura + `stopPropagation` é o que garante a ordem: este
  // ouvinte vê o Esc primeiro e, quando ele é para a mesa, ninguém
  // mais o vê.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !estado.cheia) return;
    // Modal aberto tem prioridade: Esc ali fecha o modal, não a
    // mesa que está atrás dele.
    if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
    e.preventDefault();
    e.stopPropagation();
    telaCheia();
  }, true);

  return { montar, montarServidor, montarTime, recarregar, telaCheia,
           _estado: estado };
})();
