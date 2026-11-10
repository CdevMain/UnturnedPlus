// ============================================================
// icons.js — Ícones SVG da interface
//
// POR QUE SAIR DOS EMOJIS
//
// Emoji parece prático e é uma armadilha em três frentes:
//
//  1. Ele não é seu. Cada sistema desenha o seu: o 📌 do Windows 10
//     é diferente do 📌 do Windows 11, e num Windows sem a fonte de
//     emoji vira um quadrado vazio. Você não escolhe a aparência do
//     seu próprio app.
//
//  2. Ele não aceita cor. Um emoji é colorido por definição, então
//     nunca combina com o tema, nunca fica "apagado" quando o botão
//     está desabilitado, e nunca acompanha a cor de acento.
//
//  3. Ele nem sempre é o mesmo tamanho. 🗺️ e ✕ têm larguras
//     diferentes, e é por isso que fileiras de botões com emoji
//     ficam com espaçamento irregular por mais CSS que se escreva.
//
// SVG resolve os três: mesmo desenho em toda máquina, herda
// `currentColor`, e tem caixa fixa.
//
// ------------------------------------------------------------
// COMO É USADO
//
//     Icon.svg('star')            -> string de <svg>, para template
//     Icon.svg('star', 18)        -> tamanho em px
//     Icon.set(el, 'star')        -> troca o conteúdo de um nó
//     <span data-icon="star"></span> + Icon.paint()  -> em HTML puro
//
// Os traços são desenhados com `stroke: currentColor`, sem
// preenchimento: assim o ícone fica com o peso do texto ao lado e
// muda de cor junto com ele (hover, desabilitado, acento).
//
// Ícone que não existe devolve um círculo vazio em vez de string
// vazia — um buraco silencioso na interface é pior do que um
// símbolo genérico, porque ninguém percebe que faltou.
// ============================================================

const Icon = (() => {
  'use strict';

  // Todos desenhados numa grade de 24, traço de 1.8, pontas
  // arredondadas. Manter a mesma métrica é o que faz vinte ícones
  // de origens diferentes parecerem uma família só.
  const D = {
    // --- navegação e janela ---
    menu:      'M4 7h16M4 12h16M4 17h16',
    close:     'M6 6l12 12M18 6L6 18',
    check:     'M5 13l4 4L19 7',
    plus:      'M12 5v14M5 12h14',
    minus:     'M5 12h14',
    caretDown: 'M6 9l6 6 6-6',
    caretRight:'M9 6l6 6-6 6',
    back:      'M15 6l-6 6 6 6',
    search:    'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4.2-4.2',
    dots:      'M6 12h.01M12 12h.01M18 12h.01',
    external:  'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',

    // --- objetos do app ---
    star:      'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z',
    folder:    'M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z',
    eye:       'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    gear:      'M12 8.7a3 3 0 100 6 3 3 0 000-6zM19.4 14.7a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.6 14.7H3.4a2 2 0 110-4h.1A1.6 1.6 0 004.6 7.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.2V4.1a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.3.9z',
    bell:      'M18 15V10a6 6 0 10-12 0v5l-2 3h16zM10 21h4',
    map:       'M9 4L3 7v13l6-3 6 3 6-3V4l-6 3z M9 4v13 M15 7v13',
    pin:       'M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    note:      'M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM15 3v5h5M8 13h8M8 17h5',
    users:     'M16 20v-1.5a4 4 0 00-4-4H6a4 4 0 00-4 4V20M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7M22 20v-1.5a4 4 0 00-3-3.9M17 4.1a4 4 0 010 7.8',
    user:      'M19 20v-1.5a5 5 0 00-5-5h-4a5 5 0 00-5 5V20M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7',
    chart:     'M4 20V10M10 20V4M16 20v-7M22 20H2',
    list:      'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    clock:     'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.2 1.9',
    calendar:  'M4 6a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1zM4 10h16M8 3v4M16 3v4',
    trash:     'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13',
    edit:      'M4 19.5h4L19 8.5a2.1 2.1 0 00-3-3L5 16.5zM14.5 7l2.5 2.5',
    copy:      'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1',
    download:  'M12 3v12M7 11l5 5 5-5M4 21h16',
    upload:    'M12 21V9M7 13l5-5 5 5M4 3h16',
    refresh:   'M20 12a8 8 0 11-2.6-5.9M20 4v5h-5',
    image:     'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
    camera:    'M4 8h3l2-2h6l2 2h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7',
    hand:      'M9.5 12V5.5a1.5 1.5 0 013 0V12V4a1.5 1.5 0 013 0v8V6a1.5 1.5 0 013 0v9a6 6 0 01-6 6h-1a6 6 0 01-6-6v-3a1.5 1.5 0 013 0z',
    tag:       'M3 12V4a1 1 0 011-1h8l9 9-9 9zM7.5 7.5h.01',
    news:      'M4 5h13v14H4zM17 9h3v8a2 2 0 01-3 1.7M7 9h7M7 13h7M7 16h4',
    server:    'M3 5h18v6H3zM3 13h18v6H3zM7 8h.01M7 16h.01',
    monitor:   'M3 5h18v11H3zM8 20h8M12 16v4',
    key:       'M14.5 3a6.5 6.5 0 00-6.2 8.5L3 17v4h4v-2h2v-2h2l1.5-1.5A6.5 6.5 0 1014.5 3zM16.5 7.5h.01',
    logout:    'M15 17l5-5-5-5M20 12H9M12 3H5a1 1 0 00-1 1v16a1 1 0 001 1h7',
    login:     'M10 17l-5-5 5-5M5 12h11M13 3h6a1 1 0 011 1v16a1 1 0 01-1 1h-6',
    cloud:     'M7 18a4 4 0 01-.4-8A6 6 0 0118 9.5 3.5 3.5 0 0117.5 18z',
    link:      'M10 13a5 5 0 007.5.6l2-2a5 5 0 00-7-7l-1.2 1.1M14 11a5 5 0 00-7.5-.6l-2 2a5 5 0 007 7l1.2-1.1',
    flag:      'M6.5 21V3.5M6.5 4.5h11l-1.5 3 1.5 3h-11',
    box:       'M12 3l8 4.2v9.6L12 21l-8-4.2V7.2zM4 7.2l8 4.3 8-4.3M12 21v-9.5',
    bomb:      'M11 21a7 7 0 100-14 7 7 0 000 14zM16.5 6.5L19 4M18 3.5l2 2M20.5 7.5h.01',
    shield:    'M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z',
    skull:     'M12 3a8 8 0 00-5 14.2V20h10v-2.8A8 8 0 0012 3zM9.5 11h.01M14.5 11h.01M12 14v2',
    home:      'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z',
    parachute: 'M3 11a9 9 0 0118 0c0 0-3 1-4.5 4L12 21l-4.5-6C6 12 3 11 3 11zM12 2v9M7.5 15L12 11l4.5 4',
    hammer:    'M13.5 6.5l4 4M11.5 8.5l-8 8a2 2 0 003 3l8-8M13 3l8 8-3 3-8-8z',
    door:      'M6 3h12v18H6zM14 12h.01',
    radar:     'M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 12l6-6',
    play:      'M6.5 4.5l12 7.5-12 7.5z',
    warning:   'M12 4l9 16H3zM12 10v4M12 17h.01',
    info:      'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
    mic:       'M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 18v3',
    send:      'M4 12l16-8-6 16-2.5-6z',
    dot:       'M12 13a1 1 0 100-2 1 1 0 000 2',

    // --- time e moderação ---
    eject:     'M12 5l7 9H5zM5 18h14',
    ban:       'M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8',
    crown:     'M4 7l3.5 3.5L12 4l4.5 6.5L20 7l-1.5 10h-13zM5.5 20h13',
    comment:   'M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-5 4V6a1 1 0 011-1z',
    video:     'M3 7a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1zM15 10l6-3v10l-6-3z',
    checkOk:   'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6',
    question:  'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2.4c-.9.6-1.5 1.2-1.5 2.1M12 17h.01',

    // --- raide ---
    rocket:    'M12 2.5c2.6 2.7 3.9 6 3.9 9.4L14 15h-4l-1.9-3.1c0-3.4 1.3-6.7 3.9-9.4zM12 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3M8.1 11.4L5.5 14v3l2.8-2M15.9 11.4L18.5 14v3l-2.8-2M10.5 17.5L12 21l1.5-3.5',
    grenade:   'M11 21a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM14 6.5l2-2M15 3.5h4M19 3.5v3.5',
    gun:       'M3 7h17v4H9l-2 7H3.5L5.5 11H3zM11 11v2.5',
    wall:      'M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19',
    explosion: 'M12 2l2 5 4-2-1.5 4.5L21 11l-4 2.5L19 18l-5-1-2 5-2-5-5 1 2-4.5L3 11l4.5-1.5L6 5l4 2z',
    backpack:  'M6 9a6 6 0 0112 0v10a1 1 0 01-1 1H7a1 1 0 01-1-1zM9 9V7a3 3 0 016 0v2M9 14h6',
    target:    'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 13a1 1 0 100-2 1 1 0 000 2',
    arrowRight:'M4 12h15M14 7l5 5-5 5',

    // --- agenda e sistema ---
    broom:     'M12 3v8M8 11h8l2 10H6zM10 13.5v7.5M14 13.5v7.5',
    bellOff:   'M18 15V10a6 6 0 00-8.3-5.5M6 8v7l-2 3h13M10 21h4M3.5 3.5l17 17',
    repeat:    'M4 9V7a2 2 0 012-2h12l-3-3M20 15v2a2 2 0 01-2 2H6l3 3',
    plug:      'M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5',
    puzzle:    'M9.5 3h4v2.5a1.5 1.5 0 103 0V8h3v4h-2.5a1.5 1.5 0 100 3H20v6h-6v-2.5a1.5 1.5 0 10-3 0V21H5v-6h1.5a1.5 1.5 0 100-3H5V8h4.5z',
    file:      'M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM15 3v5h5',
    clipboard: 'M9 4H7a1 1 0 00-1 1v15a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1h-2M9 4a1 1 0 011-1h4a1 1 0 011 1v1.5H9zM8.5 12h7M8.5 16h5',
    graduation:'M2 9l10-4 10 4-10 4zM6 11.5V17c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5M21 9.5V15',
    satellite: 'M11.5 20.5L3 12a9 9 0 0112.7-.6zM11.5 17.5l3 3M16 3a5 5 0 015 5M16.5 7.5a1 1 0 011 1',
    globe:     'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
    gamepad:   'M10 10.5v3M8.5 12h3M16.5 11h.01M18.5 13h.01M9.5 7.5h7a4.5 4.5 0 014.5 4.5 4 4 0 01-6.9 2.8H9.9A4 4 0 013 12a4.5 4.5 0 014.5-4.5z',
    wave:      'M9.9 11.5V6a1.5 1.5 0 013 0v5.5V4.5a1.5 1.5 0 013 0v7V7a1.5 1.5 0 013 0v8.5a6 6 0 01-10.8 3.6l-2.6-3.5a1.5 1.5 0 012.4-1.8l1.5 2z'
  };

  // Ícones que só fazem sentido preenchidos (a estrela do favorito
  // acesa, a bolinha de estado). Traço + preenchimento na mesma cor.
  const CHEIOS = new Set(['dot']);

  // ------------------------------------------------------------
  // COR INDICATIVA
  //
  // O emoji tinha uma vantagem que o traço monocromático perdeu: a
  // cor dizia alguma coisa antes de você ler o rótulo. A lixeira
  // era vermelha, a estrela dourada, o aviso âmbar — dava para
  // achar o botão pela cor, sem parar para ler.
  //
  // A cor volta, mas com REGRA: indica a NATUREZA da ação, não
  // decora. Um ícone só ganha tom quando o tom acrescenta
  // informação:
  //
  //   vermelho  destrói ou bloqueia (apagar, banir, expulsar)
  //   âmbar     alerta, exige atenção
  //   dourado   favorito, posse, destaque
  //   verde     confirma, está no ar, é o acento do app
  //   azul      informação, servidor, rede
  //   roxo      pessoas
  //   laranja   explosivo, raide
  //
  // O resto herda a cor do texto ao lado (`currentColor`) como
  // antes — é o que mantém uma fileira de botões parecendo uma
  // família, e não uma caixa de lápis de cor.
  //
  // O tom sai como custom property (`--ico`) e não como `stroke`
  // fixo: assim um container desliga tudo com uma regra só
  // (`.ico-neutro`), que é o que se quer num botão selecionado,
  // desabilitado, ou sobre fundo colorido.
  // ------------------------------------------------------------
  const TOM = {
    perigo:  'var(--danger)',
    alerta:  'var(--warn)',
    ouro:    'var(--fav)',
    verde:   'var(--accent)',
    azul:    'var(--cat-server)',
    roxo:    'var(--cat-player)',
    laranja: 'var(--cat-level)'
  };

  const COR = {
    // destrói ou bloqueia. O "X" de fechar fica de FORA: fechar
    // uma janela não apaga nada, e pintar de vermelho faria a
    // pessoa hesitar em cima do botão mais inofensivo da tela.
    trash: TOM.perigo, ban: TOM.perigo, eject: TOM.perigo, skull: TOM.perigo,
    // alerta
    warning: TOM.alerta, bellOff: TOM.alerta, broom: TOM.alerta,
    // posse e destaque
    star: TOM.ouro, crown: TOM.ouro, key: TOM.ouro,
    // confirma / no ar
    check: TOM.verde, checkOk: TOM.verde, play: TOM.verde, radar: TOM.verde,
    // rede e servidor
    server: TOM.azul, monitor: TOM.azul, cloud: TOM.azul, globe: TOM.azul,
    satellite: TOM.azul, plug: TOM.azul, link: TOM.azul, info: TOM.azul,
    // pessoas
    user: TOM.roxo, users: TOM.roxo, comment: TOM.roxo, mic: TOM.roxo,
    // raide e explosivo
    bomb: TOM.laranja, grenade: TOM.laranja, explosion: TOM.laranja,
    rocket: TOM.laranja, gun: TOM.laranja, parachute: TOM.laranja,
    // mapa
    pin: TOM.verde, map: TOM.verde, target: TOM.perigo
  };

  function svg(nome, tamanho = 16) {
    const d = D[nome];
    const t = Number(tamanho) || 16;
    if (!d) {
      // Buraco silencioso é pior do que símbolo genérico: pelo menos
      // este aparece e dá para achar.
      return `<svg class="ico ico-missing" width="${t}" height="${t}" viewBox="0 0 24 24"
                aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none"
                stroke="currentColor" stroke-width="1.8"/></svg>`;
    }
    const cor = COR[nome];
    const estilo = cor ? ` style="--ico:${cor}"` : '';
    return `<svg class="ico${cor ? ' ico-cor' : ''}" width="${t}" height="${t}"` +
           ` viewBox="0 0 24 24" aria-hidden="true"${estilo}` +
           ` fill="${CHEIOS.has(nome) ? 'currentColor' : 'none'}" stroke="currentColor"` +
           ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  }

  function set(el, nome, tamanho) {
    if (el) el.innerHTML = svg(nome, tamanho);
  }

  // Troca todo <span data-icon="x"> da página (ou de um pedaço dela)
  // pelo SVG. Existe para o HTML poder ficar legível — escrever
  // <svg> inteiro dentro do index.html tornaria o arquivo ilegível.
  function paint(raiz = document) {
    for (const el of raiz.querySelectorAll('[data-icon]')) {
      const nome = el.dataset.icon;
      const t = Number(el.dataset.iconSize) || 16;
      // Já pintado: não refaz. `paint` roda de novo a cada troca de
      // idioma e a cada modal aberto.
      if (el.firstElementChild && el.firstElementChild.tagName === 'svg') continue;
      el.innerHTML = svg(nome, t);
    }
  }

  function existe(nome) { return !!D[nome]; }
  function nomes() { return Object.keys(D); }

  return { svg, set, paint, existe, nomes, D, COR, TOM };
})();

// ------------------------------------------------------------
// Ver / esconder a senha
//
// Um campo de senha sem isto é um teste de digitação às cegas — e a
// pessoa acaba digitando no campo de usuário para conferir, ou
// desistindo e colando de outro lugar. O botão vive DENTRO do
// campo, à direita, e é aplicado a qualquer <input type="password">
// da página de uma vez.
//
// O olho fechado usa o mesmo desenho do aberto com um risco por
// cima: dois desenhos diferentes fariam o botão "pular" ao alternar.
// ------------------------------------------------------------
Icon.D.eyeOff = 'M2 12s3.6-6 10-6c1.6 0 3 .4 4.2 1M22 12s-3.6 6-10 6c-1.6 0-3-.4-4.2-1M9.9 9.9a2.5 2.5 0 003.5 3.5M3 3l18 18';

function initPasswordReveal(raiz = document) {
  for (const campo of raiz.querySelectorAll('input[type="password"]')) {
    if (campo.dataset.revealReady) continue;
    campo.dataset.revealReady = '1';

    // O botão precisa de um pai posicionado para se ancorar. O
    // <label> em volta serve; se não houver, embrulhamos o campo.
    let caixa = campo.parentElement;
    if (!caixa || caixa.classList.contains('pw-wrap') === false) {
      const wrap = document.createElement('span');
      wrap.className = 'pw-wrap';
      campo.replaceWith(wrap);
      wrap.appendChild(campo);
      caixa = wrap;
    }

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pw-eye';
    b.tabIndex = -1;   // Tab vai do campo direto para o próximo campo
    b.title = I18N.t('common.showPassword');
    b.innerHTML = Icon.svg('eye', 15);
    b.addEventListener('click', () => {
      const vendo = campo.type === 'text';
      campo.type = vendo ? 'password' : 'text';
      b.innerHTML = Icon.svg(vendo ? 'eye' : 'eyeOff', 15);
      b.title = I18N.t(vendo ? 'common.showPassword' : 'common.hidePassword');
      // Devolve o foco para onde a pessoa estava escrevendo.
      campo.focus();
    });
    caixa.appendChild(b);
  }
}

// ------------------------------------------------------------
// Ask — perguntar alguma coisa sem depender do navegador
//
// POR QUE ISTO EXISTE
//
// `window.prompt()` NÃO É IMPLEMENTADO no Electron. Não é um bug de
// versão nem coisa que se conserte com permissão: a chamada não abre
// caixa nenhuma e devolve `null`. Como todo chamador fazia
//
//     const nome = window.prompt(...);
//     if (!nome) return;
//
// o efeito no app era um botão que não faz NADA. Sem erro na tela,
// sem log, sem pista. Foi assim que "Criar time", "Renomear" e
// "Novo canal" ficaram mortos.
//
// O detalhe que fez isso durar: os testes de tela rodam em Chromium
// puro, onde `prompt()` funciona normalmente. O teste passava e o
// app estava quebrado. Agora o próprio stub de teste APAGA o
// `prompt` para se parecer com o Electron.
//
// `confirm()` até funciona no Electron, mas trava a thread do
// renderer enquanto está aberto e não segue o tema do app. Já que a
// caixa precisava existir, ela atende os dois casos.
//
// As duas funções devolvem Promise:
//     const nome = await Ask.text('Nome do time', { valor: 'Esquadrão' });
//     if (nome === null) return;            // cancelou
//     if (await Ask.confirm('Apagar?')) ...
// ------------------------------------------------------------
const Ask = (() => {
  'use strict';

  let resolverAtual = null;

  function el(id) { return document.getElementById(id); }

  function fechar(valor) {
    const r = resolverAtual;
    resolverAtual = null;
    if (typeof hideModal === 'function') hideModal('modal-ask');
    else el('modal-ask').classList.add('hidden');
    if (r) r(valor);
  }

  function ligar() {
    const caixa = el('modal-ask');
    if (!caixa || caixa.dataset.pronto) return;
    caixa.dataset.pronto = '1';

    el('ask-ok').addEventListener('click', () => {
      const campo = el('ask-field');
      if (campo.classList.contains('hidden')) return fechar(true);
      const v = el('ask-input').value.trim();
      // Texto vazio é o mesmo que não responder. Deixar passar
      // criaria um time sem nome, que é pior do que não criar.
      if (!v) { el('ask-input').focus(); return; }
      fechar(v);
    });
    el('ask-cancel').addEventListener('click', () => fechar(null));
    el('ask-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el('ask-ok').click(); }
    });
    // Esc já é tratado pelo fecha-modal comum, mas ali ninguém
    // resolve a Promise — sem isto o `await` ficaria pendurado para
    // sempre e o botão pareceria travado na segunda tentativa.
    caixa.addEventListener('click', (e) => { if (e.target === caixa) fechar(null); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && resolverAtual && !caixa.classList.contains('hidden')) fechar(null);
    });
  }

  function abrir({ titulo, corpo, rotulo, valor, comCampo, okTexto, opcoes = null }) {
    ligar();
    const caixa = el('modal-ask');
    if (!caixa) {
      // Sem a caixa no HTML não dá para perguntar nada. Devolver
      // "cancelado" é melhor do que estourar no meio de um clique.
      console.error('modal-ask não existe no HTML');
      return Promise.resolve(null);
    }
    // Uma pergunta de cada vez: a anterior é cancelada, não perdida.
    if (resolverAtual) fechar(null);

    el('ask-title').textContent = titulo || '';
    const pCorpo = el('ask-body');
    pCorpo.textContent = corpo || '';
    pCorpo.classList.toggle('hidden', !corpo);

    const campo = el('ask-field');
    campo.classList.toggle('hidden', !comCampo);
    if (comCampo) {
      el('ask-label').textContent = rotulo || '';
      el('ask-input').value = valor || '';
    }
    // Lista de escolha. Escolher JÁ responde, então o "Confirmar"
    // sai da tela — dois cliques para a mesma decisão é um clique a
    // mais sem informação nova.
    const lista = el('ask-list');
    if (lista) {
      lista.classList.toggle('hidden', !opcoes);
      lista.innerHTML = '';
      if (opcoes) {
        for (const o of opcoes) {
          const b = document.createElement('button');
          b.className = 'ask-opt';
          b.type = 'button';
          b.dataset.valor = o.valor;
          b.innerHTML = `<span class="ask-opt-txt"></span>${o.sub ? '<span class="ask-opt-sub"></span>' : ''}`;
          b.querySelector('.ask-opt-txt').textContent = o.texto;
          if (o.sub) b.querySelector('.ask-opt-sub').textContent = o.sub;
          b.addEventListener('click', () => fechar(o.valor));
          lista.appendChild(b);
        }
      }
    }
    el('ask-ok').classList.toggle('hidden', !!opcoes);

    el('ask-ok').textContent = okTexto ||
      (typeof I18N !== 'undefined' ? I18N.t('common.confirm') : 'OK');

    if (typeof showModal === 'function') showModal('modal-ask');
    else caixa.classList.remove('hidden');

    if (comCampo) {
      setTimeout(() => { const i = el('ask-input'); i.focus(); i.select(); }, 40);
    } else if (opcoes) {
      setTimeout(() => { const b = lista && lista.querySelector('.ask-opt'); if (b) b.focus(); }, 40);
    } else {
      setTimeout(() => el('ask-ok').focus(), 40);
    }
    return new Promise((res) => { resolverAtual = res; });
  }

  // Devolve o texto, ou null se cancelou.
  function text(titulo, { valor = '', rotulo = '', corpo = '', ok = '' } = {}) {
    return abrir({ titulo, corpo, rotulo: rotulo || titulo, valor, comCampo: true, okTexto: ok });
  }

  // Devolve true/false.
  function confirm(titulo, { corpo = '', ok = '' } = {}) {
    return abrir({ titulo, corpo, comCampo: false, okTexto: ok })
      .then((v) => v === true);
  }

  // Escolher UM de uma lista. Devolve o `valor` escolhido, ou null.
  //
  //   const bmId = await Ask.pick('Qual servidor?', [
  //     { valor: '111', texto: 'CanadEste #1', sub: '23.27.211.226:27017' }
  //   ]);
  //
  // Existe porque a alternativa era um <select> dentro de um modal
  // de texto: dá para escolher, mas não dá para mostrar o endereço
  // embaixo do nome, e servidor sem endereço é difícil de
  // reconhecer quando dois têm nome parecido.
  function pick(titulo, opcoes = [], { corpo = '' } = {}) {
    if (!opcoes.length) return Promise.resolve(null);
    return abrir({ titulo, corpo, comCampo: false, opcoes })
      .then((v) => (v === true || v === undefined ? null : v));
  }

  return { text, confirm, pick, ligar };
})();
