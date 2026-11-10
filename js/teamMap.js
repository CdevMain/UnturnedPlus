// ============================================================
// teamMap.js — o mapa do GRUPO, dentro da aba do grupo
//
// Por que existe um segundo mapa, se já tem o da aba Mapa:
//
// O mapa grande mostra TUDO — localizações automáticas, airdrops,
// seus marcadores pessoais, os do grupo. Para achar o que o grupo
// compartilhou você tem que garimpar no meio do resto. E era essa
// a reclamação: "o shared tem só o marcador e não funciona, não
// consigo clicar pra ver a posição, tem que ir lá no mapa".
//
// Este mapa mostra SÓ o que é do grupo, e nada mais: o fundo vai
// esmaecido de propósito, serve só de referência geográfica. O que
// está compartilhado é a única coisa acesa na tela.
//
// Ele não substitui o mapa grande. É um índice visual: clicou num
// ponto, a lista ao lado marca o item correspondente; clicou duas
// vezes, o mapa grande abre já centralizado ali.
//
// O MAPA É ESCOLHIDO NA ABA, não herdado do tracking.
//
// Antes ele desenhava `MapView.image` — o mapa do servidor aberto.
// Quem entrava na área do time pelo menu, sem servidor nenhum
// aberto, via um retângulo preto dizendo "abra um servidor com
// mapa": a aba do time exigindo que você saísse dela.
//
// Agora o time tem servidores vinculados, e o seletor no topo diz
// qual deles o mapa mostra. A imagem e a escala são carregadas
// AQUI, sem passar pelo MapView — que é do tracking e trocaria o
// mapa da outra tela junto.
// ============================================================
const TeamMap = {
  canvas: null,
  ctx: null,
  selecionado: null,     // id do item ou 'pos:<userId>'
  pontos: [],            // recalculado a cada draw, para o clique

  // Mapa próprio (não é o do MapView).
  bmId: null,
  mapaNome: null,
  img: null,
  mpp: 1,
  carregando: false,
  // Modo "clique para marcar": o próximo clique no mapa vira
  // coordenada em vez de seleção.
  marcando: false,

  init() {
    this.canvas = document.getElementById('team-map');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.canvas.addEventListener('click', (e) => {
      // Modo marcar: o clique vira coordenada e abre o formulário
      // já preenchido. É o caminho curto — apontar no mapa é mais
      // fácil que digitar dois números.
      if (this.marcando) {
        const c = this.deTela(e);
        this.marcando = false;
        this.canvas.classList.remove('marcando');
        if (c && typeof abrirMarcadorDoTime === 'function') {
          abrirMarcadorDoTime({ x: Math.round(c.x), z: Math.round(c.z) });
        }
        return;
      }
      const p = this.pegar(e);
      this.selecionado = p ? p.id : null;
      this.draw();
      this.sincronizarLista();
    });

    // Clique duplo leva ao mapa grande. Um clique só seria hostil:
    // trocar a pessoa de aba sem ela pedir é perder o contexto.
    this.canvas.addEventListener('dblclick', (e) => {
      const p = this.pegar(e);
      if (p) abrirNoMapa(p.x, p.z, p.srv || null);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      this.canvas.style.cursor = this.pegar(e) ? 'pointer' : 'default';
    });

    window.addEventListener('resize', () => this.draw());
  },

  // Mesma armadilha do mapa grande: o canvas tem caixa CSS e buffer
  // de pixels, e num Windows a 125% eles não são a mesma coisa.
  // Tudo aqui dentro vive no buffer.
  dpr() {
    if (!this.canvas || !this.canvas.clientWidth) return 1;
    return this.canvas.width / this.canvas.clientWidth;
  },

  eventoPx(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (r.width ? this.canvas.width / r.width : 1),
      y: (e.clientY - r.top) * (r.height ? this.canvas.height / r.height : 1)
    };
  },

  resize() {
    const c = this.canvas;
    if (!c) return false;
    const larg = c.clientWidth, alt = c.clientHeight;
    if (!larg || !alt) return false;              // aba escondida
    const k = window.devicePixelRatio || 1;
    const w = Math.round(larg * k), h = Math.round(alt * k);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return true;
  },

  // Enquadra a imagem inteira: aqui não existe zoom nem arrasto de
  // propósito. Quem quer navegar tem o mapa grande; este é o índice.
  enquadrar(img) {
    const s = Math.min(this.canvas.width / img.naturalWidth,
                       this.canvas.height / img.naturalHeight);
    return {
      s,
      ox: (this.canvas.width - img.naturalWidth * s) / 2,
      oy: (this.canvas.height - img.naturalHeight * s) / 2
    };
  },

  paraTela(x, z, img, enq) {
    const m = this.escalaAtual();
    const px = x / m + img.naturalWidth / 2;
    const py = img.naturalHeight / 2 - z / m;
    return { x: px * enq.s + enq.ox, y: py * enq.s + enq.oy };
  },

  // O caminho de volta: pixel na tela -> coordenada do jogo. É o
  // que transforma um clique em marcador. Sem ela, "colocar
  // marcador" só aceitaria número digitado.
  deTela(e) {
    const img = this.imagemAtual();
    if (!img || !img.naturalWidth) return null;
    const enq = this.enquadrar(img);
    const { x, y } = this.eventoPx(e);
    const px = (x - enq.ox) / enq.s;
    const py = (y - enq.oy) / enq.s;
    const m = this.escalaAtual();
    return {
      x: (px - img.naturalWidth / 2) * m,
      z: (img.naturalHeight / 2 - py) * m
    };
  },

  // ------------------------------------------------------------
  // Qual servidor o mapa mostra
  // ------------------------------------------------------------
  // Guarda a escolha por TIME: quem acompanha dois times não quer
  // que escolher o mapa de um mude o do outro.
  chaveEscolha() { return 'tmap:' + (Team.currentId || '-'); },

  escolhaSalva() {
    try { return localStorage.getItem(this.chaveEscolha()) || null; } catch { return null; }
  },

  async usarServidor(bmId, { lembrar = true } = {}) {
    this.bmId = bmId || null;
    if (lembrar) {
      try {
        if (bmId) localStorage.setItem(this.chaveEscolha(), bmId);
        else localStorage.removeItem(this.chaveEscolha());
      } catch { /* sem localStorage, só não lembra */ }
    }
    const nome = this.mapaDoServidor(bmId);
    await this.carregarMapa(nome);
    this.draw();
    this.sincronizarLista();
  },

  mapaDoServidor(bmId) {
    if (!bmId) return null;
    const live = (typeof LiveData !== 'undefined' && LiveData[bmId]) || {};
    if (live.map) return live.map;
    const vinculado = (Team.servers || []).find((s) => s.bmId === bmId);
    if (vinculado && vinculado.map) return vinculado.map;
    const cfg = (AppState.config.servers || []).find((s) => s.bmId === bmId);
    return (cfg && cfg.lastMap) || null;
  },

  // A imagem que este mapa desenha.
  //
  // Quando o mapa escolhido é o MESMO que o tracking já carregou,
  // reaproveita: é o mesmo PNG de vários MB, já decodificado na
  // memória. Baixar e decodificar de novo para desenhar um
  // retângulo de 400px seria desperdício puro — e, pior, deixaria
  // este mapa em branco por alguns segundos enquanto o outro já
  // está pronto ao lado.
  imagemAtual() {
    if (this.img && this.img.naturalWidth) return this.img;
    if (typeof MapView !== 'undefined' && MapView.image && MapView.image.naturalWidth
        && MapView.mapName === this.mapaNome) {
      return MapView.image;
    }
    return null;
  },

  escalaAtual() {
    if (this.img && this.img.naturalWidth) return this.mpp || 1;
    if (typeof MapView !== 'undefined' && MapView.mapName === this.mapaNome) {
      return MapView.mpp || 1;
    }
    return this.mpp || 1;
  },

  async carregarMapa(nome) {
    if (this.mapaNome === nome && (this.img || !nome)) return;
    this.mapaNome = nome;
    this.img = null;
    this.mpp = 1;
    if (!nome) return;

    // Já está carregado do lado do tracking: nada a fazer.
    if (typeof MapView !== 'undefined' && MapView.mapName === nome && MapView.image) {
      this.mpp = MapView.mpp || 1;
      return;
    }

    this.carregando = true;
    this.draw();
    try {
      const esc = await window.api.mapScale(nome);
      this.mpp = (esc && esc.metersPerPixel) || 1;
      const caminho = await window.api.mapImagePath(nome, 'map');
      if (caminho) {
        await new Promise((res) => {
          const img = new Image();
          img.onload = () => { this.img = img; res(); };
          img.onerror = () => { this.img = null; res(); };
          img.src = 'file:///' + String(caminho).replace(/\\/g, '/');
        });
      }
    } catch {
      this.img = null;
    }
    this.carregando = false;
    this.draw();
  },

  pegar(e) {
    const { x, y } = this.eventoPx(e);
    let melhor = null, dist = 13 * this.dpr();
    for (const p of this.pontos) {
      const d = Math.hypot(p.px - x, p.py - y);
      if (d < dist) { dist = d; melhor = p; }
    }
    return melhor;
  },

  itens() {
    if (typeof Team === 'undefined') return { marcadores: [], posicoes: [] };
    const numero = (v) => Number.isFinite(Number(v));
    // FILTRA PELO SERVIDOR DESENHADO.
    //
    // Coordenada só quer dizer alguma coisa dentro do mapa onde foi
    // tirada. Desenhar o marcador do servidor A no mapa do servidor
    // B não é um detalhe estético: é mandar alguém para um lugar
    // que não existe. O que não tem servidor (o antigo, de antes do
    // vínculo) entra nos dois, que é a mesma regra de três estados
    // do store.
    const daqui = (dele) => {
      const d = dele || null;
      if (!this.bmId) return true;
      return d === null || d === this.bmId;
    };
    return {
      marcadores: (Team.items || []).filter((i) =>
        i.kind === 'marker' && i.data && numero(i.data.x) && numero(i.data.z)
        && daqui(i.serverBmId)),
      posicoes: (Team.positions || []).filter((p) =>
        numero(p.x) && numero(p.z) && daqui(p.serverBmId))
    };
  },

  draw() {
    if (!this.canvas || !this.ctx) return;
    if (!this.resize()) return;
    const { ctx, canvas } = this;
    const k = this.dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.pontos = [];

    const aviso = (chave) => {
      ctx.fillStyle = '#8ba394';
      ctx.font = `${13 * k}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(I18N.t(chave), canvas.width / 2, canvas.height / 2);
    };

    // A imagem é a DESTA aba. Se ainda não há servidor escolhido, o
    // aviso diz o que fazer — e o que fazer está logo acima, no
    // seletor, e não "abra um servidor" como dizia antes.
    const img = this.imagemAtual();
    if (!img || !img.naturalWidth) {
      // Três motivos diferentes, três frases. "Sem mapa" para tudo
      // faria a pessoa procurar o problema no lugar errado: importar
      // o mapa não resolve um servidor cujo mapa ninguém sabe qual é.
      aviso(this.carregando ? 'team.mapLoading'
            : (!this.bmId ? 'team.mapPickServer'
               : (!this.mapaNome ? 'team.mapUnknown' : 'team.mapNoImage')));
      return;
    }

    const enq = this.enquadrar(img);

    // Fundo esmaecido: ele é referência, não é o assunto.
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(img, enq.ox, enq.oy, img.naturalWidth * enq.s, img.naturalHeight * enq.s);
    ctx.restore();

    const { marcadores, posicoes } = this.itens();

    for (const it of marcadores) {
      const x = Number(it.data.x), z = Number(it.data.z);
      const p = this.paraTela(x, z, img, enq);
      this.pontos.push({ id: it.id, px: p.x, py: p.y, x, z, srv: it.serverBmId || null, tipo: 'item' });
      this.ponto(p, '#5cb8e0', this.selecionado === it.id, it.data.name, k);
    }

    for (const pos of posicoes) {
      const id = 'pos:' + (pos.userId || pos.name);
      const x = Number(pos.x), z = Number(pos.z);
      const p = this.paraTela(x, z, img, enq);
      this.pontos.push({ id, px: p.x, py: p.y, x, z, srv: pos.serverBmId || null, tipo: 'pos' });
      ctx.save();
      // Posição velha esmaecida, mesma regra da camada do mapa
      // grande: mandar gente para onde alguém estava há duas horas
      // custa caro dentro do jogo.
      if (pos.stale) ctx.globalAlpha = 0.4;
      // Foto no lugar da bolinha, igual ao mapa grande — e pelo
      // mesmo motivo de sempre: os dois mapas mostram o MESMO dado,
      // e mostrar diferente faz duvidar de qual está certo.
      const foto = (typeof imagemDeAvatar === 'function')
        ? imagemDeAvatar(fotoDoMembro(pos.userId), () => this.draw())
        : null;
      const nome = (typeof nomeNoMapa === 'function') ? nomeNoMapa(pos) : pos.name;
      if (foto) {
        fotoRedonda(ctx, foto, p.x, p.y, 10 * k, '#e6b450', k);
        if (this.selecionado === id) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 15 * k, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 2.5 * k;
          ctx.stroke();
        }
        if (this.selecionado === id && nome) this.rotulo(p, nome, 18 * k, k);
      } else {
        this.ponto(p, '#e6b450', this.selecionado === id, nome, k);
      }
      ctx.restore();
    }

    if (!marcadores.length && !posicoes.length) aviso('team.mapEmpty');
  },

  ponto(p, cor, aceso, rotulo, k) {
    const { ctx } = this;
    if (aceso) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12 * k, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2.5 * k;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 * k, 0, Math.PI * 2);
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = '#0c130e';
    ctx.stroke();

    // O nome só aparece no ponto aceso. Com o grupo inteiro
    // compartilhando, escrever tudo vira um borrão ilegível.
    if (aceso && rotulo) this.rotulo(p, rotulo, 14 * k, k);
  },

  // O texto ao lado de um ponto. Separado porque a foto tem raio
  // diferente da bolinha e precisa afastar o nome mais — com
  // deslocamento fixo, a foto ficava por cima das primeiras letras.
  rotulo(p, texto, dx, k) {
    const { ctx } = this;
    ctx.font = `700 ${11 * k}px system-ui`;
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 3 * k;
    ctx.strokeText(texto, p.x + dx, p.y + 4 * k);
    ctx.fillStyle = '#fff';
    ctx.fillText(texto, p.x + dx, p.y + 4 * k);
  },

  // Marca na lista o que foi escolhido no mapa (e vice-versa): os
  // dois lados mostram a MESMA seleção, senão viram dois painéis
  // que por acaso estão lado a lado.
  sincronizarLista() {
    for (const el of document.querySelectorAll('#team-mapitems .ti-card, #team-positions .tp-row')) {
      el.classList.toggle('aceso', el.dataset.pin === this.selecionado);
    }
  },

  selecionar(id, { rolar = true } = {}) {
    this.selecionado = id;
    this.draw();
    this.sincronizarLista();
    if (!rolar) return;
    const el = document.querySelector(`[data-pin="${window.CSS ? CSS.escape(id) : id}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
};

// Leva ao mapa grande, centralizado e com o anel de destaque.
//
// Fica aqui e não dentro do TeamMap porque a lista também chama:
// clicar no item da lista e clicar no ponto do mapa têm que fazer
// exatamente a mesma coisa.
//
// O `bmId` existe porque o time virou TELA PRÓPRIA. Antes o grupo
// era aba de um servidor, então "o mapa" só podia ser o daquele
// servidor e bastava trocar de aba. Agora um item pode ser do
// servidor B enquanto o servidor aberto é o A — mandar para o mapa
// do A colocaria o anel de destaque numa coordenada que ali não quer
// dizer nada. Então: abre o servidor CERTO, e só depois centraliza.
async function abrirNoMapa(x, z, bmId = null) {
  const alvo = bmId || AppState.trackingId;
  if (!alvo) { toast(I18N.t('team.openAServer')); return false; }

  // Sai da área do time, se for de onde viemos.
  if (typeof TeamView !== 'undefined' && TeamView.aberta) {
    TeamView.aberta = false;
    document.getElementById('view-team').classList.add('hidden');
  }

  // Servidor diferente do que está aberto: abre o certo. `openTracking`
  // já cuida de esconder as outras telas e de carregar o mapa dele.
  if (alvo !== AppState.trackingId) {
    await openTracking(alvo);
  } else {
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-tracking').classList.remove('hidden');
  }

  switchTrackingTab('map');

  if (typeof MapView === 'undefined' || !MapView.image || !MapView.image.naturalWidth) {
    // Sem mapa importado não há para onde ir. Dizer isso é melhor do
    // que trocar de tela e deixar a pessoa olhando um quadriculado
    // sem entender o que aconteceu.
    toast(I18N.t('map.noMap'));
    return false;
  }

  // Um quadro de espera: a aba acabou de aparecer e o canvas ainda
  // pode estar com tamanho zero. `irPara` sem tamanho centraliza no
  // lugar errado.
  requestAnimationFrame(() => {
    MapView.resize();
    MapView.irPara(x, z, { zoom: Math.max(MapView.scale, 1.6) });
  });
  return true;
}

// ============================================================
// A BARRA DA ABA MAPA — seletor de servidor e "colocar marcador"
// ============================================================
// Fica aqui, e não no teamView.js, porque tudo isto existe em
// função do canvas: quem escolhe o servidor escolhe QUAL mapa
// desenhar, e quem coloca marcador coloca NELE.

function renderTeamMapBar() {
  const sel = document.getElementById('team-map-server');
  const btn = document.getElementById('team-map-mark');
  if (!sel) return;

  // SEM SERVIDOR VINCULADO, VALE O QUE ESTÁ ABERTO.
  //
  // Antes de existir vínculo, este mapa sempre desenhava o servidor
  // do tracking. Trocar isso por "escolha um servidor do time"
  // tiraria o mapa de quem tem time e ainda não vinculou nada — que
  // é todo mundo no primeiro dia. Então a lista começa com o
  // servidor aberto, marcado como tal.
  const vinculados = Team.servers || [];
  const aberto = AppState.trackingId &&
    !vinculados.some((s) => s.bmId === AppState.trackingId)
    ? [{ bmId: AppState.trackingId,
         name: (((AppState.config.servers || []).find((x) => x.bmId === AppState.trackingId) || {}).name
                || AppState.trackingId) + ' · ' + I18N.t('team.mapOpenServer'),
         avulso: true }]
    : [];
  const servidores = [...vinculados, ...aberto];
  const atual = TeamMap.bmId || TeamMap.escolhaSalva() ||
    // Sem escolha anterior: o servidor aberto no tracking, se ele
    // for do time; senão o primeiro vinculado. Adivinhar bem aqui
    // poupa um clique em quase toda abertura.
    (servidores.some((s) => s.bmId === AppState.trackingId) ? AppState.trackingId : null) ||
    (servidores[0] ? servidores[0].bmId : null);

  sel.innerHTML = servidores.length
    ? servidores.map((s) =>
        `<option value="${escapeHtml(s.bmId)}"${s.bmId === atual ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')
    : `<option value="">${escapeHtml(I18N.t('team.noServersShort'))}</option>`;
  sel.disabled = !servidores.length;

  // Sem servidor nenhum não há onde pendurar um marcador: a
  // coordenada não teria mapa. O botão some em vez de dar erro.
  if (btn) btn.classList.toggle('hidden', !servidores.length || !Team.caps['marker.share']);

  if (atual && atual !== TeamMap.bmId) TeamMap.usarServidor(atual, { lembrar: false });
}

// ------------------------------------------------------------
// Colocar marcador
// ------------------------------------------------------------
// Duas entradas para o mesmo formulário: o botão (digita X e Z) e
// o clique no mapa (já vem preenchido). O formulário é o mesmo
// porque o resto — nome, servidor, anotação — é igual nos dois.
function abrirMarcadorDoTime({ x = '', z = '' } = {}) {
  const g = currentGroup();
  if (!g) return;
  document.getElementById('tmk-name').value = '';
  document.getElementById('tmk-text').value = '';
  document.getElementById('tmk-x').value = x === '' ? '' : Math.round(x);
  document.getElementById('tmk-z').value = z === '' ? '' : Math.round(z);

  const sel = document.getElementById('tmk-server');
  const servidores = [...(Team.servers || [])];
  // O servidor aberto também entra aqui, pelo mesmo motivo do
  // seletor da barra: dá para marcar antes de vincular.
  if (AppState.trackingId && !servidores.some((s) => s.bmId === AppState.trackingId)) {
    const cfg = (AppState.config.servers || []).find((x) => x.bmId === AppState.trackingId);
    servidores.push({ bmId: AppState.trackingId, name: (cfg && cfg.name) || AppState.trackingId });
  }
  const escolhido = TeamMap.bmId || (servidores[0] || {}).bmId || '';
  sel.innerHTML = servidores.map((s) =>
    `<option value="${escapeHtml(s.bmId)}"${s.bmId === escolhido ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

  showModal('modal-teammark');
  setTimeout(() => document.getElementById('tmk-name').focus(), 40);
}

async function salvarMarcadorDoTime() {
  const g = currentGroup();
  if (!g) return;
  const nome = document.getElementById('tmk-name').value.trim();
  // CAMPO VAZIO NÃO É ZERO.
  //
  // `Number('')` devolve 0, e 0 é finito: a checagem de "tem
  // coordenada?" passava com os dois campos em branco e o marcador
  // ia parar no meio exato do mapa. Um ponto no centro que ninguém
  // colocou é pior do que a recusa.
  const cruX = document.getElementById('tmk-x').value.trim();
  const cruZ = document.getElementById('tmk-z').value.trim();
  const x = cruX === '' ? NaN : Number(cruX);
  const z = cruZ === '' ? NaN : Number(cruZ);
  const texto = document.getElementById('tmk-text').value.trim();
  const bmId = document.getElementById('tmk-server').value || null;

  // Marcador sem coordenada não é marcador — é uma anotação, e para
  // isso existe a aba Notas. Recusar aqui evita um ponto invisível
  // no mapa que ninguém entende por que não aparece.
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    toast(I18N.t('team.markNeedXZ'));
    document.getElementById('tmk-x').focus();
    return;
  }

  const r = await window.api.teamCreateItem(g.id, {
    kind: 'marker',
    papelRemoto: (typeof papelRemoto === 'function') ? papelRemoto() : null,
    data: { name: nome || I18N.t('map.markerDefault'), x: Math.round(x), z: Math.round(z),
            text: texto || null, serverBmId: bmId }
  });
  if (!r.ok) { toast(erroTime(r)); return; }
  hideModal('modal-teammark');
  await loadTeam();
  toast(I18N.t('team.markSaved'));
}

function initTeamMapBar() {
  const sel = document.getElementById('team-map-server');
  if (sel) {
    sel.addEventListener('change', () => {
      TeamMap.usarServidor(sel.value || null);
    });
  }
  const btn = document.getElementById('team-map-mark');
  if (btn) {
    btn.addEventListener('click', () => {
      // Com o mapa carregado, oferece apontar. Sem imagem, vai
      // direto ao formulário — não adianta pedir um clique num
      // retângulo vazio.
      if (TeamMap.imagemAtual()) {
        TeamMap.marcando = true;
        TeamMap.canvas.classList.add('marcando');
        toast(I18N.t('team.markClickMap'));
        return;
      }
      abrirMarcadorDoTime({});
    });
  }
  const salvar = document.getElementById('tmk-save');
  if (salvar) salvar.addEventListener('click', salvarMarcadorDoTime);
  const cancelar = document.getElementById('tmk-cancel');
  if (cancelar) cancelar.addEventListener('click', () => hideModal('modal-teammark'));
}
