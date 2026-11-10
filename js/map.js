// ============================================================
// map.js — Sistema de mapas v2
// - Imagens importadas da instalação local (Map.png / Chart.png)
// - Marcadores em camadas: locais, airdrops, itens, custom
// - Conversão coordenada do mundo <-> pixel da imagem
// - Editor: clique para adicionar, botão direito para remover
// ============================================================
function newMarkerId() {
  return 'mk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const MapView = {
  canvas: null, ctx: null,
  image: null, mapName: null, view: 'map', // 'map' | 'chart'
  fallbackImage: null, fallbackSrc: null,  // ícone do servidor (mapa ausente)

  // Transformação
  scale: 1, offsetX: 0, offsetY: 0,
  dragging: false, lastX: 0, lastY: 0, moved: false,

  // Marcadores
  markersData: { worldSize: null, markers: [] },
  layers: { location: true, airdrop: true, item: true, custom: true, base: true },
  addMode: false,

  // (A tabela fixa de tamanhos por nome de mapa foi removida: ela
  // dizia 512 m para o Alpha Valley, que tem 1024, e não servia
  // para mapa de Workshop nenhum. O tamanho agora vem dos tiles do
  // Landscape / Level.dat, lidos pelo processo principal.)
  worldMeters: null,

  // Marcadores vindos do jogo (auto: true) x criados pelo usuário.
  showAuto: true,

  // `icon` aqui é NOME DE ÍCONE SVG, não emoji. Os quatro tipos do
  // app são desenhados por nós e precisam acompanhar o tema; a
  // categoria criada por você continua com o emoji que VOCÊ
  // escolheu, porque ali o desenho é seu, não do app.
  MARKER_STYLE: {
    location: { color: '#6ee06e', icon: 'pin', r: 5 },
    airdrop:  { color: '#e6b450', icon: 'parachute', r: 6 },
    item:     { color: '#5cb8e0', icon: 'box', r: 4 },
    custom:   { color: '#e05c9a', icon: 'star', r: 5 },
    // Base: liga o ponto ao layout da base (aba Inventário).
    base:     { color: '#e0a35c', icon: 'home', r: 6 }
  },

  // ---------- Categorias criadas pelo usuário ----------
  //
  // Os quatro tipos acima são do app. Além deles cabem ATÉ TRÊS
  // categorias suas ("Time", "Loot", "Inimigo"...), cada uma com
  // nome, emoji e cor. Elas vivem na config (valem para todos os
  // mapas — uma categoria "Time" que só existisse no Russia não
  // serviria para nada) e entram em tudo que lista tipo: chips do
  // card, filtros, camadas, desenho.
  //
  // O limite de 3 não é técnico, é de tela: a barra de camadas tem
  // largura finita e sete chips já é o teto do que dá para ler.
  MAX_CATS: 3,
  customCats: [],

  // Sincroniza com a config. Chamado no boot e a cada gravação das
  // categorias. Devolve as categorias normalizadas.
  setCats(cats) {
    const limpos = [];
    for (const c of Array.isArray(cats) ? cats : []) {
      if (limpos.length >= this.MAX_CATS) break;
      const id = String(c && c.id || '').trim();
      if (!/^cat_[a-z0-9]+$/i.test(id)) continue;
      limpos.push({
        id,
        name: String(c.name || '').slice(0, 20) || id,
        emoji: String(c.emoji || '⭐').slice(0, 4),
        color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#b48ee6'
      });
    }
    this.customCats = limpos;
    // Camada nova nasce LIGADA; camada de categoria apagada some do
    // objeto, senão `layers` cresceria para sempre.
    for (const c of limpos) if (this.layers[c.id] === undefined) this.layers[c.id] = true;
    for (const k of Object.keys(this.layers)) {
      if (k.startsWith('cat_') && !limpos.some((c) => c.id === k)) delete this.layers[k];
    }
    return limpos;
  },

  cat(id) { return this.customCats.find((c) => c.id === id) || null; },

  // Estilo de desenho de QUALQUER tipo, embutido ou criado aqui.
  // Todo lugar que desenha ou lista marcador passa por aqui — é o
  // que impede uma categoria nova de aparecer em metade das telas.
  style(type) {
    if (this.MARKER_STYLE[type]) return this.MARKER_STYLE[type];
    const c = this.cat(type);
    // Categoria sua: `emoji` preenchido, `icon` vazio. Quem desenha
    // usa `iconHtml` e não precisa saber de qual dos dois veio.
    if (c) return { color: c.color, icon: null, emoji: c.emoji, r: 5, custom: true };
    return this.MARKER_STYLE.custom;
  },

  // O símbolo do tipo, pronto para colocar no HTML: SVG para os
  // tipos do app, emoji para as categorias suas. Um lugar só que
  // decide, porque a regra "qual dos dois" apareceu em quatro
  // telas diferentes e ia divergir na primeira mudança.
  iconHtml(type, tamanho = 14) {
    const st = this.style(type);
    if (st.icon && typeof Icon !== 'undefined') return Icon.svg(st.icon, tamanho);
    return st.emoji ? escapeHtml(st.emoji) : '';
  },

  typeLabel(type) {
    const c = this.cat(type);
    if (c) return c.name;
    if (this.MARKER_STYLE[type]) {
      return I18N.t('map.t' + type.charAt(0).toUpperCase() + type.slice(1));
    }
    // Categoria apagada com marcadores ainda apontando para ela.
    return I18N.t('markers.catGone');
  },

  // Tipos válidos, na ordem em que aparecem na interface.
  allTypes() {
    const base = ['location', 'airdrop', 'item', 'custom', 'base'];
    return [...base, ...this.customCats.map((c) => c.id)].map((t) => ({
      value: t, label: this.typeLabel(t),
      icon: this.style(t).icon, emoji: this.style(t).emoji || '',
      iconHtml: this.iconHtml(t, 14), color: this.style(t).color,
      custom: !this.MARKER_STYLE[t]
    }));
  },

  // Marcadores de uma categoria que deixou de existir voltam para
  // 'custom' — melhor do que sumirem do mapa sem explicação.
  reclaimOrphanTypes() {
    let n = 0;
    for (const m of this.markersData.markers || []) {
      if (this.MARKER_STYLE[m.type]) continue;
      if (this.cat(m.type)) continue;
      m.type = 'custom'; n += 1;
    }
    return n;
  },

  // ---------- Mover marcador ----------
  //
  // Duas formas, porque servem a situações diferentes: arrastar
  // (preciso, quando o ponto está na tela) e "mover" pelo card
  // (quando você achou o ponto pela lista e o alvo está longe).
  // Local oficial não se move: a coordenada dele é o que o índice
  // de locais usa para dizer onde as coisas ficam.
  moveMode: false,
  dragMarker: -1,

  setMoveMode(on) {
    this.moveMode = !!on;
    if (on) this.setAddMode(false);
    if (this.canvas) this.canvas.style.cursor = on ? 'move' : 'grab';
    const wrap = document.querySelector('.map-wrap');
    if (wrap) wrap.classList.toggle('moving', !!on);
    const btn = document.getElementById('btn-marker-move');
    if (btn) btn.classList.toggle('active', !!on);
    const hint = document.getElementById('map-moving-hint');
    if (hint) hint.classList.toggle('hidden', !on);
  },

  podeMover(m) { return !!m && !m.official; },

  // Reposiciona pelo card: o próximo clique no mapa é o destino.
  pedirNovaPosicao(index, aoTerminar) {
    const m = this.markersData.markers[index];
    if (!this.podeMover(m)) { toast(I18N.t('markers.moveLocked')); return false; }
    if (!this.image) { toast(I18N.t('map.noMap')); return false; }
    this.setAddMode(false);
    this.canvas.style.cursor = 'crosshair';
    const wrap = document.querySelector('.map-wrap');
    if (wrap) wrap.classList.add('adding');
    this.awaitPositionPick = async (w) => {
      this.awaitPositionPick = null;
      if (wrap) wrap.classList.remove('adding');
      const alvo = this.markersData.markers[index];
      if (!alvo) return;
      alvo.x = w.x; alvo.z = w.z;
      alvo.auto = false;
      await this.saveMarkers();
      this.draw();
      toast(I18N.t('markers.moved', { name: alvo.name || '', x: w.x, z: w.z }));
      if (aoTerminar) aoTerminar(alvo);
    };
    toast(I18N.t('markers.movePick'));
    return true;
  },

  init() {
    this.canvas = document.getElementById('map-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // ---------- Pan ----------
    this.canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      // No modo mover (ou com Shift), pegar em cima de um ponto
      // arrasta O PONTO, não o mapa. Shift existe para quem não
      // quer entrar no modo só para ajustar um marcador.
      if (this.moveMode || e.shiftKey) {
        const pt = this.eventoPx(e);
        const idx = this.findMarkerAt(pt.x, pt.y);
        const m = idx >= 0 ? this.markersData.markers[idx] : null;
        if (m && !this.podeMover(m)) { toast(I18N.t('markers.moveLocked')); return; }
        if (m) {
          this.dragMarker = idx;
          this.moved = false;
          this.canvas.style.cursor = 'grabbing';
          return;
        }
      }
      this.dragging = true; this.moved = false;
      const p0 = this.eventoPx(e);
      this.lastX = p0.x; this.lastY = p0.y;
      this.canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', async () => {
      // Grava UMA vez, ao soltar. Salvar a cada mousemove faria
      // dezenas de escritas em disco por arrasto.
      if (this.dragMarker >= 0) {
        const m = this.markersData.markers[this.dragMarker];
        this.dragMarker = -1;
        if (m && this.moved) {
          m.auto = false;
          await this.saveMarkers();
          this.draw();
          toast(I18N.t('markers.moved', { name: m.name || '', x: m.x, z: m.z }));
        }
      }
      this.dragging = false;
      if (this.canvas) {
        this.canvas.style.cursor = this.addMode ? 'crosshair' : (this.moveMode ? 'move' : 'grab');
      }
    });
    this.canvas.addEventListener('mousemove', e => {
      const pm = this.eventoPx(e);
      if (this.dragMarker >= 0) {
        const m = this.markersData.markers[this.dragMarker];
        const w = this.canvasToWorld(pm.x, pm.y);
        if (m && w) { m.x = w.x; m.z = w.z; this.moved = true; this.draw(); this.updateCoordBar(pm.x, pm.y); }
        return;
      }
      if (this.dragging) {
        const dx = pm.x - this.lastX, dy = pm.y - this.lastY;
        // O limiar de "isto foi arrasto, não clique" também é em
        // pixels do buffer agora; senão ele seria mais sensível
        // numa tela a 150% do que numa a 100%.
        if (Math.abs(dx) + Math.abs(dy) > 2 * this.dpr()) this.moved = true;
        this.offsetX += dx; this.offsetY += dy;
        this.lastX = pm.x; this.lastY = pm.y;
        this.draw();
      } else {
        this.hover(pm.x, pm.y);
      }
    });

    // ---------- Zoom ----------
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(10, Math.max(0.2, this.scale * factor));
      const pz = this.eventoPx(e);
      const mx = pz.x, my = pz.y;
      this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale);
      this.offsetY = my - (my - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;
      this.draw();
    }, { passive: false });

    // ---------- Clique ----------
    // Fora do modo marcador, clicar em cima de um ponto ABRE o card
    // dele (nome, tipo, coordenada e as anotações/prints daquele
    // lugar). Era a peça que faltava: dava para criar o ponto, mas
    // não para pendurar nada nele.
    this.canvas.addEventListener('click', e => {
      if (this.moved || !this.image) return;

      // O grupo pediu para marcar "estou aqui": o próximo clique
      // é a posição, não a seleção de um marcador.
      if (this.awaitPositionPick) {
        const w = this.canvasToWorld(...Object.values(this.eventoPx(e)));
        this.canvas.style.cursor = 'grab';
        if (w) this.awaitPositionPick(w);
        return;
      }

      if (this.moveMode) return;   // no modo mover, o clique é o arrasto

      if (!this.addMode) {
        const pc = this.eventoPx(e);
        const idx = this.findMarkerAt(pc.x, pc.y);
        if (idx >= 0 && typeof openMarkerCard === 'function') openMarkerCard(idx);
        return;
      }

      const pn = this.eventoPx(e);
      const world = this.canvasToWorld(pn.x, pn.y);
      if (!world) return;

      // Nasce sem nome e ABRE o card já em edição. Antes o nome e o
      // tipo eram digitados numa barra ANTES de clicar, o que
      // obriga a decidir o nome de um ponto que você ainda não viu.
      const m = {
        id: newMarkerId(),
        // Nome já sugerido com o local: "Base — Novosibirsk". Um
        // campo vazio faz a pessoa inventar "Base", "Base 2",
        // "Base 3" — nomes que não servem para nada uma semana
        // depois. Longe de qualquer cidade a sugestão não inventa
        // lugar nenhum, e é só um valor inicial: dá para apagar.
        name: (typeof LocationIndex !== 'undefined')
          ? LocationIndex.suggestName(this.whereIs(world.x, world.z), null,
                                      (k, v) => I18N.t(k, v))
          : '',
        type: this.lastMarkerType || 'custom',
        x: world.x, z: world.z
      };
      // Veio do "Marcar no mapa" de uma base: o ponto nasce ligado a ela.
      if (this.pendingBase && typeof basesMarkerPlaced === 'function') {
        basesMarkerPlaced(m, this.pendingBase);
        this.pendingBase = null;
      }
      this.markersData.markers.push(m);
      this.saveMarkers();
      this.draw();
      this.setAddMode(false);
      if (typeof openMarkerCard === 'function') {
        openMarkerCard(this.markersData.markers.length - 1, { novo: true });
      }
    });

    // ---------- Botão direito: remover marcador próximo ----------
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!this.image) return;
      const idx = this.findMarkerAt(e.offsetX, e.offsetY);
      if (idx >= 0) {
        const removed = this.markersData.markers.splice(idx, 1)[0];
        this.saveMarkers();
        this.draw();
        toast(I18N.t('map.markerRemoved', { name: removed.name }));
      }
    });

    this.canvas.addEventListener('dblclick', () => this.resetView());

    // Redimensiona junto com a janela e com a troca de aba.
    if (window.ResizeObserver) {
      const wrap = document.querySelector('.map-wrap');
      if (wrap) new ResizeObserver(() => { this.resize(); this.draw(); }).observe(wrap);
    }
    window.addEventListener('resize', () => { this.resize(); this.draw(); });

    // Esc sai da tela cheia antes de qualquer outra coisa.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const panel = document.getElementById('panel-map');
      if (panel && panel.classList.contains('map-full')) {
        e.stopPropagation();
        this.toggleFullscreen();
      }
    }, true);

    this.resize();
    this.draw();
  },

  // ---------- Coordenadas ----------
  //
  // A conta certa NÃO é esticar a imagem sobre o tamanho nominal do
  // mundo. Os mapas do Unturned são renderizados a 1 pixel = 1
  // metro, e às vezes com a borda aparada: o Map.png do PEI tem
  // 1923x1927 px para um mundo de 2048 m. Esticar metia 6,5% de
  // erro, o que na borda do mapa dava uns 60 m de deslocamento —
  // era isso que fazia o marcador cair ao lado do lugar.
  //
  // Conferido desenhando as duas contas sobre as pontes do PEI
  // (Confederation e Liberation), que são finas e inconfundíveis:
  // com 1 px = 1 m os pontos caem em cima das pontes.
  //
  // `mpp` (metros por pixel) vem do processo principal, que compara
  // o tamanho do mundo (tiles do Landscape / Level.dat) com a
  // largura real do PNG. Só sai de 1 se a imagem tiver sido MUITO
  // reduzida, o que acontece em alguns mapas de Workshop.
  mpp: 1,

  // mundo (x,z; origem no centro da imagem) -> pixel da imagem
  worldToImage(wx, wz) {
    const m = this.mpp || 1;
    return {
      px: wx / m + this.image.naturalWidth / 2,
      py: this.image.naturalHeight / 2 - wz / m
    };
  },

  // ------------------------------------------------------------
  // O MARCADOR SAÍA FORA DO LUGAR: duas unidades misturadas
  //
  // O canvas tem DOIS tamanhos. O que o CSS mostra
  // (`clientWidth`) e o buffer de pixels (`width`), que é
  // `clientWidth × devicePixelRatio`. Num monitor a 100% os dois
  // são iguais e tudo funciona por acidente. No Windows a 125% ou
  // 150% — que é o padrão de fábrica em quase todo notebook — eles
  // divergem.
  //
  // `this.offsetX/offsetY/scale` vivem no espaço do BUFFER: é o que
  // vai para `ctx.setTransform`. Mas o mouse fala em pixels CSS.
  //
  // O arrasto fazia:
  //     const dx = e.offsetX - this.lastX;   // CSS
  //     this.offsetX += dx;                   // buffer
  //
  // ou seja, a 150% o mapa andava 1,5× menos do que a mão — e a
  // partir daí toda conversão de clique para coordenada saía
  // deslocada. Quanto mais você arrastava, pior ficava. Era esse o
  // "aparece um pouquinho errado".
  //
  // Agora existe UM lugar que traduz mouse → buffer, e nenhum
  // handler lê `e.offsetX` direto.
  // ------------------------------------------------------------
  dpr() {
    if (!this.canvas || !this.canvas.clientWidth) return 1;
    return this.canvas.width / this.canvas.clientWidth;
  },

  // Posição do mouse no espaço do buffer.
  //
  // Usa `getBoundingClientRect` em vez de `e.offsetX` de propósito:
  // `offsetX` é relativo ao alvo do evento, e quando o ponteiro
  // passa por cima de um filho do canvas (a barra de coordenadas, o
  // tooltip) ele passa a medir a partir do filho. O rect do canvas
  // é sempre o mesmo referencial.
  eventoPx(e) {
    const r = this.canvas.getBoundingClientRect();
    const escalaX = r.width ? this.canvas.width / r.width : 1;
    const escalaY = r.height ? this.canvas.height / r.height : 1;
    return {
      x: (e.clientX - r.left) * escalaX,
      y: (e.clientY - r.top) * escalaY
    };
  },

  // Recebe pixels do BUFFER (ver eventoPx).
  canvasToWorld(cx, cy) {
    if (!this.image) return null;
    const ix = (cx - this.offsetX) / this.scale;
    const iy = (cy - this.offsetY) / this.scale;
    const m = this.mpp || 1;
    return {
      x: Math.round((ix - this.image.naturalWidth / 2) * m),
      z: Math.round((this.image.naturalHeight / 2 - iy) * m)
    };
  },

  // Devolve pixels do BUFFER, no mesmo espaço de `eventoPx`. Antes
  // devolvia pixels CSS e era comparada contra `e.offsetX` (CSS) —
  // combinava por acidente a 100% e errava a 125%/150%, que é onde
  // o "clique no marcador" deixava de acertar o marcador.
  markerCanvasPos(m) {
    const { px, py } = this.worldToImage(m.x, m.z);
    return {
      x: px * this.scale + this.offsetX,
      y: py * this.scale + this.offsetY
    };
  },

  findMarkerAt(cx, cy) {
    let best = -1, bestDist = 14;
    this.markersData.markers.forEach((m, i) => {
      if (!this.layers[m.type]) return;
      if (m.auto && !this.showAuto) return;
      const p = this.markerCanvasPos(m);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  },

  hover(cx, cy) {
    const tip = document.getElementById('map-tooltip');
    if (!tip || !this.image) return;
    const idx = this.findMarkerAt(cx, cy);
    if (idx >= 0) {
      const m = this.markersData.markers[idx];
      // `innerHTML`: o símbolo pode ser um SVG agora. O nome do
      // marcador é do usuário e continua escapado.
      tip.innerHTML = `${this.iconHtml(m.type, 13)} ${escapeHtml(m.name)} (${m.x}, ${m.z})`;
      // REGRESSÃO MINHA, vinda da correção do DPR: `cx`/`cy`
      // passaram a chegar em pixels do BUFFER, mas `style.left` é
      // CSS. Numa tela a 150% o balão aparecia a uma vez e meia a
      // distância do ponto — o mouse num canto e o nome no outro.
      //
      // A divisão fica aqui porque este é o único ponto que sai do
      // espaço do CANVAS para o espaço da PÁGINA.
      const k = this.dpr();
      tip.style.left = (cx / k + 14) + 'px';
      tip.style.top = (cy / k - 8) + 'px';
      tip.classList.remove('hidden');
    } else {
      tip.classList.add('hidden');
    }
    this.updateCoordBar(cx, cy);
  },

  // Barra de coordenada: X/Z do ponto sob o cursor e em que local
  // ele fica. É o que transforma "clique aqui em 320, -140" numa
  // frase que a outra pessoa entende sem abrir o app.
  updateCoordBar(cx, cy) {
    const el = document.getElementById('map-coordbar');
    if (!el) return;
    if (!this.image) { el.classList.add('hidden'); return; }
    const w = this.canvasToWorld(cx, cy);
    const onde = this.whereIsText(w.x, w.z);
    el.innerHTML = `<span class="mcb-xy">X ${Math.round(w.x)} · Z ${Math.round(w.z)}</span>` +
                   (onde ? `<span class="mcb-loc">${Icon.svg('pin', 12)} ${escapeHtml(onde)}</span>` : '');
    el.classList.remove('hidden');
  },

  // ---------- Carregamento ----------
  // Zera TUDO que pertence ao servidor anterior.
  //
  // Existe por causa de um bug de verdade: o mapa só era carregado
  // dentro de `applyInfoToView`, que só roda quando o servidor
  // RESPONDE. Abrir um servidor offline deixava na tela o mapa, os
  // marcadores e o zoom do servidor anterior — e, como marcador é
  // gravado por NOME DE MAPA, um clique ali gravava um ponto no
  // mapa do outro servidor.
  //
  // As camadas ligadas/desligadas não entram aqui: são preferência
  // da pessoa, não dado do servidor.
  reset() {
    this.mapName = null;
    this.image = null;
    this.fallbackImage = null;
    this.fallbackSrc = null;
    this.markersData = { worldSize: null, markers: [] };
    this.viewCarregada = null;
    this.mpp = 1;
    this.worldMeters = null;
    this.scale = 1; this.offsetX = 0; this.offsetY = 0;
    this.dragging = false; this.moved = false;
    this.awaitPositionPick = null;
    this.dragMarker = -1;
    if (typeof this.setAddMode === 'function') this.setAddMode(false); else this.addMode = false;
    if (typeof this.setMoveMode === 'function') this.setMoveMode(false);
    // As CATEGORIAS não se perdem aqui: elas são do usuário, não do
    // mapa. Trocar de servidor zera o desenho, não as etiquetas.
    this.draw();
  },

  async loadForMap(mapName) {
    if (!mapName) { this.reset(); return; }
    // Mesmo mapa E MESMA VISTA já desenhados: não recarrega, senão
    // perderia o zoom de quem está olhando o mapa neste instante.
    //
    // O `view` na condição não é detalhe: sem ele, trocar entre
    // Satélite e Carta chamava esta função com o MESMO nome de mapa,
    // caía neste return e a imagem nunca mudava — o seletor mexia
    // numa variável e mais nada. Foi o preço de uma guarda escrita
    // pensando só em "trocar de servidor".
    if (this.mapName === mapName && this.viewCarregada === this.view &&
        (this.image || this.fallbackImage)) return;
    this.mapName = mapName;
    this.viewCarregada = this.view;

    this.markersData = await window.api.loadMarkers(mapName);
    if (!this.markersData.markers) this.markersData = { worldSize: null, markers: [] };
    // Marcadores gravados com uma categoria que foi apagada desde
    // então voltam para 'custom' — senão sumiriam do mapa (nenhuma
    // camada os liga) sem nenhuma pista do porquê.
    if (this.reclaimOrphanTypes()) await this.saveMarkers();
    this.rebuildLocationIndex();

    // Escala do mapa: sem isso os marcadores saem do lugar.
    try {
      const esc = await window.api.mapScale(mapName);
      this.mpp = (esc && esc.metersPerPixel) || 1;
      this.worldMeters = (esc && esc.worldSize) || null;
    } catch {
      this.mpp = 1; this.worldMeters = null;
    }

    // Migração: marcadores criados antes das anotações não têm id.
    // Damos um agora e gravamos uma vez só — depois disso, o id de
    // cada ponto nunca muda, mesmo que ele mude de lugar na lista.
    let migrated = false;
    for (const m of this.markersData.markers) {
      if (!m.id) { m.id = newMarkerId(); migrated = true; }
    }
    if (migrated) await this.saveMarkers();

    const filePath = await window.api.mapImagePath(mapName, this.view);
    if (!filePath) {
      // Mapa não importado (mapa de Workshop que o usuário não tem,
      // ou mapas ainda não sincronizados). Em vez de um quadriculado
      // vazio, mostramos o ÍCONE do servidor dessaturado — dá
      // contexto e deixa claro que aquilo não é o mapa de verdade.
      this.image = null;
      this.loadFallbackIcon();
      this.draw();
      return;
    }

    this.fallbackImage = null;
    this.image = new Image();
    this.image.onload = () => this.resetView();
    this.image.onerror = () => { this.image = null; this.loadFallbackIcon(); this.draw(); };
    this.image.src = 'file:///' + filePath.replace(/\\/g, '/');
  },

  // Carrega o ícone do servidor em tracking para servir de fundo
  // quando não existe imagem do mapa.
  loadFallbackIcon() {
    const url = (typeof LiveData !== 'undefined' && AppState.trackingId)
      ? (LiveData[AppState.trackingId] || {}).icon
      : null;
    if (!url) { this.fallbackImage = null; return; }
    if (this.fallbackImage && this.fallbackSrc === url) return;

    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { this.fallbackImage = img; this.fallbackSrc = url; this.draw(); };
    img.onerror = () => { this.fallbackImage = null; this.fallbackSrc = null; this.draw(); };
    img.src = url;
  },

  async setView(view) {
    this.view = view;
    if (this.mapName) await this.loadForMap(this.mapName);
  },

  async saveMarkers() {
    if (this.mapName) await window.api.saveMarkers(this.mapName, this.markersData);
  },

  // ------------------------------------------------------------
  // Índice de locais — "que lugar é este?"
  // ------------------------------------------------------------
  // Refeito sempre que a lista de marcadores muda, porque extrair
  // os nós do jogo pode acrescentar locais novos. É O(n²) sobre os
  // locais oficiais — 25 no Russia, 21 no PEI: barato.
  rebuildLocationIndex() {
    this.locIndex = (typeof LocationIndex !== 'undefined')
      ? LocationIndex.build(this.markersData.markers)
      : null;
  },

  // Onde fica esta coordenada. Devolve null quando o mapa não tem
  // local nenhum indexado — e aí quem chama simplesmente não mostra
  // nada, em vez de mostrar um palpite.
  whereIs(x, z) {
    if (!this.locIndex) this.rebuildLocationIndex();
    if (typeof LocationIndex === 'undefined') return null;
    return LocationIndex.locate(this.locIndex, x, z);
  },

  whereIsText(x, z) {
    if (typeof LocationIndex === 'undefined') return '';
    return LocationIndex.describe(this.whereIs(x, z), (k, v) => I18N.t(k, v));
  },

  // ------------------------------------------------------------
  // Extrai NOMES DE LOCALIZAÇÃO e AIRDROPS do próprio arquivo do
  // mapa (Environment/Nodes.dat). Ver unturnedNodes.js.
  //
  // Os marcadores extraídos ficam marcados com `auto: true`: uma
  // nova extração substitui só esses, então nada que o usuário
  // criou à mão é perdido no processo.
  // ------------------------------------------------------------
  async extractNodes() {
    if (!this.mapName) { toast(I18N.t('map.noMap')); return null; }
    const r = await window.api.extractMapNodes(this.mapName);

    if (!r || !r.ok) {
      toast(I18N.t(r && r.reason === 'map_not_found' ? 'map.nodesNoMap' : 'map.nodesFail'));
      return r;
    }
    if (!r.markers.length) { toast(I18N.t('map.nodesEmpty')); return r; }

    const manual = (this.markersData.markers || []).filter((m) => !m.auto);
    this.markersData.markers = [...r.markers, ...manual];
    // Locais novos entraram: o índice tem que ser refeito, senão o
    // app continuaria respondendo "onde é isso?" com o mapa antigo.
    this.rebuildLocationIndex();
    await this.saveMarkers();
    this.draw();

    const locs = r.markers.filter((m) => m.type === 'location').length;
    const drops = r.markers.filter((m) => m.type === 'airdrop').length;
    toast(r.partial
      ? I18N.t('map.nodesPartial', { l: locs, a: drops })
      : I18N.t('map.nodesOk', { l: locs, a: drops }));
    return r;
  },

  // Um dono só para o modo marcador. Antes o botão, a faixa de
  // aviso e o cursor eram ligados em lugares diferentes, e quando o
  // clique no mapa desligava o modo a faixa continuava na tela.
  setAddMode(on) {
    if (on && this.moveMode) this.setMoveMode(false);
    this.addMode = on;
    if (!on) this.pendingBase = null;
    this.canvas.style.cursor = on ? 'crosshair' : 'grab';
    const wrap = document.querySelector('.map-wrap');
    if (wrap) wrap.classList.toggle('adding', on);
    const btn = document.getElementById('btn-marker-mode');
    if (btn) btn.classList.toggle('active', on);
    const hint = document.getElementById('map-adding-hint');
    if (hint) hint.classList.toggle('hidden', !on);
  },

  // ---------- Tamanho ----------
  // O canvas tinha 640x640 fixo no HTML: em monitor grande sobrava
  // tela vazia e em notebook o mapa saía cortado. Agora ele mede o
  // espaço disponível e se ajusta, mantendo a proporção da imagem.
  // Quem manda no TAMANHO NA TELA é o CSS (width/height 100% do
  // wrapper). O JS só ajusta o BUFFER de pixels para bater com o
  // tamanho que o CSS já decidiu.
  //
  // A primeira versão fazia o contrário — o JS escrevia
  // style.width em pixels — e bastava o resize não rodar num
  // momento qualquer (aba escondida, troca de layout) para o mapa
  // ficar travado num tamanho antigo enquanto o painel ao redor
  // crescia. Agora, se o JS atrasar, o pior que acontece é um
  // quadro borrado até o próximo draw.
  resize() {
    if (!this.canvas) return false;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return false;                 // ainda escondido
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.canvas.width === bw && this.canvas.height === bh) return false;
    const primeira = !this.canvas.width || this.canvas.width === 300;
    this.canvas.width = bw;
    this.canvas.height = bh;
    if (primeira) this.resetView();
    return true;
  },

  // Zoom pelos botões: amplia em volta do CENTRO da tela, não do
  // canto, senão o mapa foge da vista a cada clique.
  zoomBy(fator) {
    if (!this.image) return;
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    const novo = Math.max(0.15, Math.min(12, this.scale * fator));
    this.offsetX = cx - (cx - this.offsetX) * (novo / this.scale);
    this.offsetY = cy - (cy - this.offsetY) * (novo / this.scale);
    this.scale = novo;
    this.draw();
  },

  toggleFullscreen() {
    const panel = document.getElementById('panel-map');
    if (!panel) return;
    const on = !panel.classList.contains('map-full');
    panel.classList.toggle('map-full', on);
    document.body.classList.toggle('map-full-open', on);
    const btn = document.getElementById('btn-map-full');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.title = I18N.t(on ? 'map.exitFull' : 'map.fullscreen');
    }
    // Reenquadra: entrar em tela cheia é justamente para ver mais,
    // então manter o zoom antigo deixaria o mapa pequeno no meio de
    // uma tela vazia.
    requestAnimationFrame(() => { this.resize(); this.resetView(); });
  },

  resetView() {
    if (this.image && this.image.naturalWidth) {
      const s = Math.min(
        this.canvas.width / this.image.naturalWidth,
        this.canvas.height / this.image.naturalHeight
      );
      this.scale = s;
      this.offsetX = (this.canvas.width - this.image.naturalWidth * s) / 2;
      this.offsetY = (this.canvas.height - this.image.naturalHeight * s) / 2;
    } else {
      this.scale = 1; this.offsetX = 0; this.offsetY = 0;
    }
    this.draw();
  },

  // ------------------------------------------------------------
  // LEVAR A VISTA ATÉ UM PONTO
  //
  // Nasceu de uma reclamação concreta da Sara: no painel do grupo
  // dá para VER que alguém compartilhou uma posição, mas não dá
  // para clicar nela — "tem que ir lá no mapa ver". Ou seja, o app
  // sabia a coordenada e mesmo assim obrigava a pessoa a procurar
  // o ponto no olho, com o mapa inteiro na tela.
  //
  // Centralizar sozinho não resolve: num mapa de 4 km você chega
  // na região certa e continua sem saber QUAL ponto era. Por isso
  // vem junto o destaque — um anel que pulsa alguns segundos e
  // some. É o que diz "é este aqui".
  // ------------------------------------------------------------
  irPara(x, z, { zoom = null, destacar = true } = {}) {
    if (!this.image || !this.image.naturalWidth || !this.canvas) return false;
    this.resize();
    if (zoom) this.scale = Math.max(0.15, Math.min(12, zoom));
    const { px, py } = this.worldToImage(x, z);
    // offset vive no espaço do BUFFER (ver a nota sobre DPR acima),
    // e canvas.width JÁ é buffer. Nada de dividir por dpr aqui.
    this.offsetX = this.canvas.width / 2 - px * this.scale;
    this.offsetY = this.canvas.height / 2 - py * this.scale;
    if (destacar) this.destacar(x, z); else this.draw();
    return true;
  },

  destaque: null,      // { x, z, ate }
  _animando: false,

  destacar(x, z, ms = 3200) {
    this.destaque = { x, z, ate: Date.now() + ms, inicio: Date.now() };
    if (this._animando) { this.draw(); return; }
    this._animando = true;
    const passo = () => {
      // A animação PARA sozinha. Um requestAnimationFrame eterno
      // num app que fica aberto o dia todo é bateria queimada para
      // desenhar exatamente o mesmo quadro.
      if (!this.destaque || Date.now() > this.destaque.ate) {
        this.destaque = null; this._animando = false; this.draw(); return;
      }
      this.draw();
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  },

  // Desenha o anel do destaque. Em pixels do BUFFER, como a camada
  // do grupo — senão a 150% ele sai com dois terços do tamanho.
  drawDestaque(ctx) {
    const d = this.destaque;
    if (!d || !this.image) return;
    const restante = d.ate - Date.now();
    if (restante <= 0) return;
    const k = this.dpr();
    const p = this.markerCanvasPos({ x: d.x, z: d.z });
    const t = (Date.now() - d.inicio) / 620;
    const fase = t - Math.floor(t);              // 0..1, repetindo
    const raio = (12 + fase * 26) * k;
    const alpha = Math.min(1, restante / 700) * (1 - fase);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, raio, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3 * k;
    ctx.stroke();
    ctx.restore();

    // Um alvo fixo por baixo do anel: se a pessoa piscar no meio do
    // pulso, ainda tem o que olhar.
    ctx.save();
    ctx.globalAlpha = Math.min(1, restante / 700);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.restore();
  },

  // ---------- Desenho ----------
  draw() {
    // O buffer pode estar defasado (aba acabou de abrir, janela
    // mudou de tamanho). Conferir aqui é barato e evita desenhar
    // esticado por um quadro.
    this.resize();
    const { ctx, canvas } = this;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.image && this.image.naturalWidth) {
      ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, 0, 0);

      // Marcadores (tamanho constante na tela)
      for (const m of this.markersData.markers) {
        if (!this.layers[m.type]) continue;
        if (m.auto && !this.showAuto) continue;
        const st = this.style(m.type);
        const { px, py } = this.worldToImage(m.x, m.z);
        const r = st.r / this.scale;

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeStyle = '#0c130e';
        ctx.stroke();

        // O nome da LOCALIZAÇÃO sempre aparece — é justamente para
        // isso que ela existe. Os outros tipos só com zoom.
        if (m.type === 'location' || this.scale > 0.6) {
          ctx.font = `${11 / this.scale}px "Segoe UI", sans-serif`;
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(0,0,0,.8)';
          ctx.lineWidth = 3 / this.scale;
          ctx.textAlign = 'center';
          ctx.strokeText(m.name, px, py - r - 3 / this.scale);
          ctx.fillText(m.name, px, py - r - 3 / this.scale);
        }
      }

      // Camada do GRUPO por cima da sua, com cor própria: nunca
      // pode dar dúvida sobre o que é seu e o que veio do grupo.
      // Desenhada sem a transformação do zoom, para os pontos e os
      // nomes não esticarem junto com a imagem.
      if (typeof drawTeamLayer === 'function') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawTeamLayer(ctx);
      }

      // O destaque vem por ÚLTIMO, por cima da camada do grupo:
      // ele existe justamente para ser o que a pessoa acha primeiro.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawDestaque(ctx);
    } else {
      // Placeholder
      ctx.strokeStyle = '#2b3a31'; ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Ícone do servidor, SEM COR, como fundo do "mapa faltando".
      if (this.fallbackImage && this.fallbackImage.naturalWidth) {
        const img = this.fallbackImage;
        const s = Math.min(canvas.width, canvas.height) * 0.55;
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = ratio >= 1 ? s : s * ratio;
        const h = ratio >= 1 ? s / ratio : s;
        ctx.save();
        ctx.filter = 'grayscale(1) brightness(0.8)';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2 - 18, w, h);
        ctx.restore();
      }

      ctx.fillStyle = '#8ba394';
      ctx.font = '15px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      const label = this.mapName
        ? I18N.t('map.notImported', { name: this.mapName })
        : I18N.t('map.noMap');
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    }
  }
};
