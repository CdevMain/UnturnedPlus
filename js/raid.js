// ============================================================
// raid.js — Calculadora de raid (tela)
//
// A pergunta que esta tela responde é uma só: "o que eu levo na
// mochila para derrubar isso?"
//
// A conta mora em raidCalc.js (módulo puro, testado fora do
// navegador). Aqui é só interface: escolher os alvos, escolher o
// que se pode usar, ler o resultado e transformá-lo numa nota.
//
// Três decisões que valem explicar:
//
// 1. Os números vêm da INSTALAÇÃO do jogo. Uma tabela chumbada
//    envelheceria na primeira atualização e mentiria em qualquer
//    servidor com mod. Quando o app não acha o jogo, a tela diz
//    isso na cara em vez de mostrar números de reserva como se
//    fossem os seus.
//
// 2. Ferramenta que NÃO funciona no alvo não some da lista: fica
//    com o motivo escrito ("imune a explosão", "precisa de arma
//    forte"). Sumir em silêncio faz a pessoa achar que esqueceu de
//    marcar alguma coisa.
//
// 3. O relatório é uma anotação de verdade, no mesmo sistema de
//    notas do resto do app — ela vai no backup, dá para fixar e
//    dá para achar pela busca depois.
// ============================================================

const Raid = {
  catalogo: { source: 'none', alvos: [], ferramentas: [], hasGame: false, scannedAt: 0 },
  carregado: false,

  // Alvos escolhidos: [{ alvo, qtd }]
  itens: [],
  // Ferramentas permitidas (chaves do RaidCalc). null = todas.
  permitidas: null,
  filtro: 'all',           // all | explosivos | diretos
  estoqueLigado: false,
  estoque: {},             // chave -> unidades disponíveis
  buscaAlvo: '',
  plano: null,
  // Cache de URL de ícone por id, para não pedir ao processo
  // principal o mesmo ícone a cada re-render.
  icones: new Map(),

  // ----------------------------------------------------------
  async abrir() {
    showModal('modal-raid');
    if (!this.carregado) await this.carregar(false);
    else this.render();
  },

  async carregar(forcar) {
    const aviso = document.getElementById('raid-source');
    aviso.textContent = I18N.t('raid.loading');
    aviso.className = 'raid-source loading';
    this.catalogo = await window.api.raidCatalog({ forcar: !!forcar });
    this.carregado = true;
    // Trocar de catálogo invalida escolhas antigas: um id de alvo
    // do fallback pode não existir na instalação da pessoa.
    if (forcar) { this.itens = []; this.permitidas = null; this.plano = null; }
    this.render();
  },

  // ----------------------------------------------------------
  // Ferramentas visíveis dado o filtro de cima.
  // Os filtros separam por CUSTO, não por tipo de dano: o catálogo
  // já vem só com explosivo, então "só explosivos" não filtraria
  // nada. A pergunta real de quem raida é "dá para fazer sem gastar
  // carga?".
  ferramentasDoFiltro() {
    const todas = this.catalogo.ferramentas || [];
    if (this.filtro === 'cargas') return todas.filter((f) => f.type === 'charge');
    if (this.filtro === 'baratos') return todas.filter((f) => f.type !== 'charge');
    return todas;
  },

  // Ferramentas que entram na CONTA: o filtro de cima mais as
  // marcadas individualmente.
  ferramentasAtivas() {
    const base = this.ferramentasDoFiltro();
    if (!this.permitidas) return base;
    const ok = new Set(this.permitidas);
    return base.filter((f) => ok.has(RaidCalc.chave(f)));
  },

  recalcular() {
    const ativas = this.ferramentasAtivas();
    this.plano = this.itens.length
      ? RaidCalc.planejar(this.itens, ativas, {
          estoque: this.estoqueLigado ? this.estoque : null
        })
      : null;
    this.renderResultado();
  },

  // ----------------------------------------------------------
  // Ícones
  //
  // Vêm do processo principal (arquivo local em cache, baixado uma
  // vez). Enquanto não chegam, um ícone SVG segura o lugar: o
  // layout não pode pular quando a imagem carrega.
  // A chave do ícone é o GUID quando existe (é o que o CDN usa), e
  // o ID numérico como plano B. Guardamos a chave no DOM para
  // conseguir trocar só os marcadores certos quando a imagem chega.
  chaveIcone(item) {
    const g = String((item && item.guid) || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    if (g.length === 32) return g;
    const n = Number(item && item.id) || 0;
    return n > 0 ? String(n) : '';
  },

  iconeHtml(item, classe = 'ri') {
    const chave = this.chaveIcone(item);
    const cache = chave ? this.icones.get(chave) : null;
    if (cache) {
      return `<span class="${classe}"><img src="${escapeHtml(cache)}" alt="" loading="lazy"
                onerror="this.style.display='none'" /></span>`;
    }
    if (chave) this.pedirIcone(item);
    return `<span class="${classe} emoji" data-icon-key="${escapeHtml(chave)}">${this.simboloDe(item)}</span>`;
  },

  // Enquanto o ícone de verdade não chega da CDN (ou quando ele
  // não existe), o item aparece com um símbolo da família da
  // interface — antes era emoji, que mudava de desenho conforme o
  // Windows e nunca acompanhava a cor do tema.
  simboloDe(item) {
    return Icon.svg(this.nomeIconeDe(item), 18);
  },

  nomeIconeDe(item) {
    if (!item) return 'question';
    const t = String(item.type || item.build || '').toLowerCase();
    if (t.includes('door') || t.includes('gate') || t.includes('hatch')) return 'door';
    if (t.includes('charge')) return 'bomb';
    if (t.includes('magazine')) return 'rocket';
    if (t.includes('throwable')) return 'grenade';
    if (t.includes('melee')) return 'hammer';
    if (t.includes('gun')) return 'gun';
    if (item.kind === 'structure') return 'wall';
    return 'box';
  },

  async pedirIcone(item) {
    const chave = this.chaveIcone(item);
    if (!chave) return;
    if (!this._pedindo) this._pedindo = new Set();
    if (this.icones.has(chave) || this._pedindo.has(chave)) return;
    this._pedindo.add(chave);
    const url = await window.api.raidIcon({ guid: item.guid, id: item.id });
    this._pedindo.delete(chave);
    if (!url) { this.icones.set(chave, null); return; }   // não tenta de novo
    this.icones.set(chave, url);
    // Troca só os marcadores daquela chave: um re-render inteiro a
    // cada ícone que chega faria a tela piscar dezenas de vezes.
    for (const el of document.querySelectorAll(`[data-icon-key="${chave}"]`)) {
      el.classList.remove('emoji');
      el.removeAttribute('data-icon-key');
      el.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.style.display='none'" />`;
    }
  },

  // ----------------------------------------------------------
  // Desenho
  // ----------------------------------------------------------
  render() {
    this.renderDestino();
    this.renderFonte();
    this.renderCatalogo();
    this.renderSelecionados();
    this.renderFerramentas();
    this.recalcular();
  },

  renderFonte() {
    const el = document.getElementById('raid-source');
    const c = this.catalogo;
    if (c.source === 'game') {
      const quando = c.scannedAt ? formatNoteDate(c.scannedAt) : '';
      el.className = 'raid-source game';
      el.innerHTML = `${Icon.svg('checkOk', 14)} ${escapeHtml(I18N.t('raid.srcGame', {
        a: (c.alvos || []).length, f: (c.ferramentas || []).length, when: quando }))}`;
    } else if (c.source === 'fallback') {
      el.className = 'raid-source fallback';
      el.innerHTML = `${Icon.svg('warning', 14)} ${escapeHtml(I18N.t('raid.srcFallback'))}`;
    } else {
      el.className = 'raid-source empty';
      el.innerHTML = `${Icon.svg('ban', 14)} ${escapeHtml(I18N.t('raid.srcNone'))}`;
    }
  },

  renderCatalogo() {
    const box = document.getElementById('raid-catalog');
    const q = this.buscaAlvo.trim().toLowerCase();
    const escolhidos = new Set(this.itens.map((i) => this.chaveAlvo(i.alvo)));
    const linhas = (this.catalogo.alvos || [])
      .filter((a) => !q || String(a.name).toLowerCase().includes(q))
      .slice(0, 200);

    document.getElementById('raid-catalog-count').textContent =
      I18N.t('list.results', { n: linhas.length, total: (this.catalogo.alvos || []).length });

    if (!linhas.length) {
      box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('list.noMatch'))}</p>`;
      return;
    }
    box.innerHTML = linhas.map((a) => `
      <button class="raid-item${escolhidos.has(this.chaveAlvo(a)) ? ' on' : ''}"
              data-add-target="${escapeHtml(this.chaveAlvo(a))}">
        ${this.iconeHtml(a)}
        <span class="ri-name">${escapeHtml(a.name)}</span>
        <span class="ri-hp">${a.health} HP</span>
        <span class="ri-tier ${a.armorTier === 'HIGH' ? 'high' : 'low'}">${
          escapeHtml(I18N.t(a.armorTier === 'HIGH' ? 'raid.tierHigh' : 'raid.tierLow'))}</span>
      </button>`).join('');

    box.onclick = (e) => {
      const b = e.target.closest('[data-add-target]');
      if (!b) return;
      this.adicionar(b.dataset.addTarget);
    };
  },

  chaveAlvo(a) { return a && a.id ? 'a' + a.id : 'an' + String(a && a.name).toLowerCase(); },

  adicionar(chave) {
    const alvo = (this.catalogo.alvos || []).find((a) => this.chaveAlvo(a) === chave);
    if (!alvo) return;
    const ja = this.itens.find((i) => this.chaveAlvo(i.alvo) === chave);
    if (ja) ja.qtd += 1; else this.itens.push({ alvo, qtd: 1 });
    this.renderCatalogo();
    this.renderSelecionados();
    this.recalcular();
  },

  renderSelecionados() {
    const box = document.getElementById('raid-selected');
    const vazio = document.getElementById('raid-selected-empty');
    vazio.classList.toggle('hidden', this.itens.length > 0);

    box.innerHTML = this.itens.map((it, i) => `
      <div class="raid-sel" data-sel="${i}">
        ${this.iconeHtml(it.alvo, 'ri sm')}
        <span class="ri-name">${escapeHtml(it.alvo.name)}</span>
        <span class="ri-hp">${it.alvo.health} HP</span>
        <div class="raid-qty">
          <button class="btn-small" data-qty="-1">${Icon.svg('minus', 13)}</button>
          <input type="number" min="1" max="999" value="${it.qtd}" data-qty-in="${i}" />
          <button class="btn-small" data-qty="1">${Icon.svg('plus', 13)}</button>
        </div>
        <button class="btn-small danger" data-sel-del="${i}">${Icon.svg('close', 13)}</button>
      </div>`).join('');

    box.onclick = (e) => {
      const linha = e.target.closest('[data-sel]');
      if (!linha) return;
      const i = Number(linha.dataset.sel);
      const del = e.target.closest('[data-sel-del]');
      const q = e.target.closest('[data-qty]');
      if (del) { this.itens.splice(i, 1); }
      else if (q) {
        this.itens[i].qtd = Math.max(1, Math.min(999, this.itens[i].qtd + Number(q.dataset.qty)));
      } else return;
      this.renderCatalogo();
      this.renderSelecionados();
      this.recalcular();
    };
    box.onchange = (e) => {
      const inp = e.target.closest('[data-qty-in]');
      if (!inp) return;
      const i = Number(inp.dataset.qtyIn);
      this.itens[i].qtd = Math.max(1, Math.min(999, Number(inp.value) || 1));
      this.renderSelecionados();
      this.recalcular();
    };
  },

  renderFerramentas() {
    const box = document.getElementById('raid-tools');
    const lista = this.ferramentasDoFiltro();
    const ativas = new Set(this.ferramentasAtivas().map((f) => RaidCalc.chave(f)));

    for (const b of document.querySelectorAll('#raid-filters [data-filter]')) {
      b.classList.toggle('on', b.dataset.filter === this.filtro);
    }
    document.getElementById('raid-stock-box').classList.toggle('hidden', !this.estoqueLigado);

    if (!lista.length) {
      box.innerHTML = `<p class="muted small">${escapeHtml(I18N.t('raid.noTools'))}</p>`;
      return;
    }

    box.innerHTML = lista.map((f) => {
      const k = RaidCalc.chave(f);
      const on = ativas.has(k);
      return `
        <label class="raid-tool${on ? ' on' : ''}">
          <input type="checkbox" data-tool="${escapeHtml(k)}" ${on ? 'checked' : ''} />
          ${this.iconeHtml(f, 'ri sm')}
          <span class="ri-name">${escapeHtml(f.name)}</span>
          <span class="ri-dmg">${f.barricadeDamage} / ${f.structureDamage}</span>
          ${f.explosive ? `<span class="ri-tag exp" title="${escapeHtml(I18N.t('raid.aoeHint', { r: f.range }))}">${Icon.svg('explosion', 12)} ${f.range}m</span>` : ''}
          ${f.invulnerable ? `<span class="ri-tag inv" title="${escapeHtml(I18N.t('raid.invHint'))}">${Icon.svg('shield', 12)}</span>` : ''}
          ${this.estoqueLigado
            ? `<input type="number" class="raid-stock" min="0" max="9999" placeholder="0"
                      value="${this.estoque[k] != null ? this.estoque[k] : ''}" data-stock="${escapeHtml(k)}" />`
            : ''}
        </label>`;
    }).join('');

    box.onchange = (e) => {
      const cb = e.target.closest('[data-tool]');
      const st = e.target.closest('[data-stock]');
      if (st) {
        this.estoque[st.dataset.stock] = Math.max(0, Number(st.value) || 0);
        this.recalcular();
        return;
      }
      if (!cb) return;
      // A primeira desmarcação materializa a lista: até então
      // `permitidas` é null, que quer dizer "todas as do filtro".
      if (!this.permitidas) this.permitidas = lista.map((f) => RaidCalc.chave(f));
      const k = cb.dataset.tool;
      this.permitidas = cb.checked
        ? [...new Set([...this.permitidas, k])]
        : this.permitidas.filter((x) => x !== k);
      this.renderFerramentas();
      this.recalcular();
    };
  },

  // ----------------------------------------------------------
  renderResultado() {
    const box = document.getElementById('raid-result');
    const acoes = document.getElementById('raid-result-actions');
    if (!this.plano) {
      box.innerHTML = `<p class="muted small raid-empty">${escapeHtml(I18N.t('raid.pickSomething'))}</p>`;
      acoes.classList.add('hidden');
      return;
    }
    acoes.classList.remove('hidden');
    const p = this.plano;

    const compras = p.compras.length ? `
      <div class="raid-bag">
        <h4>${Icon.svg('backpack', 15)} ${escapeHtml(I18N.t('raid.bag'))}</h4>
        <div class="raid-bag-items">
          ${p.compras.map((c) => `
            <div class="raid-bag-item">
              ${this.iconeHtml(c.ferramenta, 'ri sm')}
              <span class="ri-name">${escapeHtml(c.ferramenta ? c.ferramenta.name : c.chave)}</span>
              <b class="ri-n">×${c.unidades}</b>
              ${c.ferramenta && c.ferramenta.needsDetonator
                ? `<span class="ri-note muted small">${escapeHtml(I18N.t('raid.needsDetonator'))}</span>` : ''}
              ${c.ferramenta && c.ferramenta.needsWeapon
                ? `<span class="ri-note muted small">${escapeHtml(I18N.t('raid.needsWeapon'))}</span>` : ''}
            </div>`).join('')}
        </div>
        <p class="muted small">${escapeHtml(I18N.t('raid.totalHp', { hp: p.vidaTotal.toLocaleString(I18N.lang) }))}</p>
      </div>` : '';

    const linhas = p.linhas.map((l) => {
      const melhor = l.usado[0];
      const alternativas = l.ranking.slice(0, 4).map((r) => `
        <div class="raid-alt${r === l.ranking[0] ? ' best' : ''}">
          ${this.iconeHtml(r.ferramenta, 'ri xs')}
          <span class="ri-name">${escapeHtml(r.ferramenta.name)}</span>
          <b>×${r.unidades}</b>
          <span class="muted small">${escapeHtml(I18N.t('raid.perHit', { d: Math.round(r.dano) }))}</span>
          ${r.desperdicio > 0
            ? `<span class="muted small">${escapeHtml(I18N.t('raid.waste', { n: Math.round(r.desperdicio) }))}</span>`
            : `<span class="exact small">${escapeHtml(I18N.t('raid.exact'))}</span>`}
        </div>`).join('');

      return `
        <article class="raid-line">
          <header>
            ${this.iconeHtml(l.alvo, 'ri sm')}
            <span class="ri-name">${escapeHtml(l.alvo.name)}</span>
            <span class="ri-x">×${l.qtd}</span>
            <span class="ri-hp">${l.alvo.health} HP</span>
            <span class="ri-tier ${l.alvo.armorTier === 'HIGH' ? 'high' : 'low'}">${
              escapeHtml(I18N.t(l.alvo.armorTier === 'HIGH' ? 'raid.tierHigh' : 'raid.tierLow'))}</span>
          </header>
          <div class="raid-best">
            ${l.usado.map((u) => `
              <span class="raid-best-chip">
                ${this.iconeHtml(u.ferramenta, 'ri xs')}
                <b>×${u.unidades}</b>
                <span class="muted small">${escapeHtml(I18N.t('raid.each', { n: u.porAlvo }))}</span>
              </span>`).join('')}
            ${l.naoResolvidos ? `<span class="raid-missing">${escapeHtml(I18N.t('raid.short', { n: l.naoResolvidos }))}</span>` : ''}
          </div>
          <details class="raid-alts">
            <summary>${escapeHtml(I18N.t('raid.alternatives'))}</summary>
            ${alternativas}
          </details>
        </article>`;
    }).join('');

    // Alvos que NENHUMA ferramenta escolhida resolve. Aparecem com
    // o motivo — é a informação mais útil da tela quando acontece.
    const impossiveis = p.faltando.filter((f) => f.motivo !== 'estoque').map((f) => `
      <div class="raid-block">
        ${this.iconeHtml(f.alvo, 'ri sm')}
        <span class="ri-name">${escapeHtml(f.alvo.name)}</span>
        <span class="raid-why">${escapeHtml(I18N.t('raid.why.' + f.motivo))}</span>
      </div>`).join('');

    box.innerHTML = compras + linhas +
      (impossiveis ? `<div class="raid-blocks"><h4>${Icon.svg('ban', 15)} ${escapeHtml(I18N.t('raid.blocked'))}</h4>${impossiveis}</div>` : '');
  },

  // ----------------------------------------------------------
  // Relatório
  //
  // Vira uma anotação normal do servidor aberto (ou uma anotação
  // avulsa quando não há servidor). Guardamos o texto em rich text
  // do jogo, que é o que o painel de notas já sabe renderizar.
  // ----------------------------------------------------------
  textoRelatorio() {
    const p = this.plano;
    if (!p) return '';
    const L = [];
    L.push(`<b>${I18N.t('raid.reportTitle')}</b>`);
    L.push(I18N.t('raid.reportSource', {
      src: I18N.t(this.catalogo.source === 'game' ? 'raid.srcShortGame' : 'raid.srcShortFallback')
    }));
    L.push('');

    // O relatório vira NOTA: é texto rico guardado no disco, não
    // um pedaço da tela. Por isso aqui não entra SVG nem emoji —
    // ícone dentro de nota viraria marcação solta na exportação.
    L.push(`<b>${I18N.t('raid.bag')}</b>`);
    for (const c of p.compras) {
      const f = c.ferramenta;
      const extra = f && f.needsDetonator ? ` (${I18N.t('raid.needsDetonator')})`
                  : f && f.needsWeapon ? ` (${I18N.t('raid.needsWeapon')})` : '';
      L.push(`  ${(f && f.name) || c.chave} <b>×${c.unidades}</b>${extra}`);
    }
    L.push('');

    L.push(`<b>${I18N.t('raid.targets')}</b>`);
    for (const l of p.linhas) {
      const tier = I18N.t(l.alvo.armorTier === 'HIGH' ? 'raid.tierHigh' : 'raid.tierLow');
      L.push(`  ${l.alvo.name} ×${l.qtd} · ${l.alvo.health} HP · ${tier}`);
      for (const u of l.usado) {
        L.push(`     > ${(u.ferramenta && u.ferramenta.name) || '?'} ×${u.unidades} (${I18N.t('raid.each', { n: u.porAlvo })})`);
      }
      if (l.naoResolvidos) L.push(`     ! ${I18N.t('raid.short', { n: l.naoResolvidos })}`);
    }

    const bloqueados = p.faltando.filter((f) => f.motivo !== 'estoque');
    if (bloqueados.length) {
      L.push('');
      L.push(`<b>${I18N.t('raid.blocked')}</b>`);
      for (const f of bloqueados) L.push(`  ${f.alvo.name}: ${I18N.t('raid.why.' + f.motivo)}`);
    }

    L.push('');
    L.push(`<i>${I18N.t('raid.reportFoot')}</i>`);
    return L.join('\n');
  },

  // Preenche o seletor de destino com os servidores da lista. O
  // servidor aberto vem pré-escolhido — é o palpite certo em quase
  // todo caso, e continua trocável.
  renderDestino() {
    const sel = document.getElementById('raid-note-server');
    if (!sel) return;
    const servers = (AppState.config && AppState.config.servers) || [];
    sel.innerHTML = servers.map((s) =>
      `<option value="${escapeHtml(s.bmId)}">${escapeHtml(s.name || s.bmId)}</option>`).join('');
    if (!servers.length) {
      sel.innerHTML = `<option value="">${escapeHtml(I18N.t('raid.noServer'))}</option>`;
    }
    if (AppState.trackingId) sel.value = AppState.trackingId;
  },

  async salvarRelatorio() {
    if (!this.plano) return;
    const sel = document.getElementById('raid-note-server');
    const bmId = sel && sel.value;
    if (!bmId) { toast(I18N.t('raid.noServer')); return; }
    const scope = `server:${bmId}`;
    const total = this.plano.compras.map((c) => `${(c.ferramenta && c.ferramenta.name) || '?'} ×${c.unidades}`).join(', ');
    // SALVA COMO PLANO DE RAID, não como nota solta.
    //
    // O texto sempre foi guardado; o que faltava era o TIPO e a
    // conta em campo próprio. Sem isso, o plano não aparecia no
    // filtro "Plano de raid", entrava na mesa como um cartão verde
    // qualquer, e o resumo ("Carga ×8") tinha que ser lido do meio
    // do texto por quem olhasse.
    //
    // A conta vai como FOTOGRAFIA do resultado: se o catálogo do
    // jogo mudar amanhã, o plano de hoje continua dizendo o que foi
    // combinado hoje. Ver o comentário em notes.js.
    await window.api.noteSave({
      id: null,
      scope,
      type: 'raid',
      title: `${I18N.t('raid.reportTitle')}: ${this.plano.linhas.map((l) => `${l.alvo.name}×${l.qtd}`).join(', ').slice(0, 70)}`,
      text: this.textoRelatorio(),
      raid: {
        lines: (this.plano.linhas || []).map((l) => ({
          name: (l.alvo && l.alvo.name) || '?', qty: l.qtd || 1 })),
        buys: (this.plano.compras || []).map((c) => ({
          name: (c.ferramenta && c.ferramenta.name) || '?', units: c.unidades || 0 })),
        total: this.plano.total != null ? this.plano.total : null,
        note: this.plano.aviso || null
      },
      color: '#e0a45c',
      pinned: false,
      shots: [],
      markers: []
    });
    const alvo = (AppState.config.servers || []).find((s) => s.bmId === bmId);
    toast(I18N.t('raid.reportSavedIn', { server: (alvo && alvo.name) || bmId }));

    // A aba de notas do servidor tem que mostrar a nota nova sem
    // precisar de troca de aba.
    const painel = document.querySelector('#tkpane-notes .notes-panel');
    if (painel && typeof NotesPanel !== 'undefined') await NotesPanel.reload(painel);

    // Salvou para o servidor que está aberto: fecha a calculadora e
    // leva para a nota. Salvar e continuar olhando a mesma tela faz
    // parecer que nada aconteceu — que foi a reclamação.
    if (bmId === AppState.trackingId) {
      hideModal('modal-raid');
      const aba = document.querySelector('.tk-tab[data-tk="notes"]');
      if (aba) aba.click();
    }
  },

  async copiarRelatorio() {
    if (!this.plano) return;
    // Sem as tags de cor: o destino é o chat do jogo ou o Discord.
    const limpo = this.textoRelatorio().replace(/<\/?[a-z][^>]*>/gi, '');
    let ok = false;
    try { await navigator.clipboard.writeText(limpo); ok = true; }
    catch { try { ok = await window.api.copyText(limpo); } catch { ok = false; } }
    toast(I18N.t(ok ? 'raid.copied' : 'raid.copyFail'));
  }
};

function initRaid() {
  const modal = document.getElementById('modal-raid');
  if (!modal) return;

  document.getElementById('drawer-raid').addEventListener('click', () => {
    closeDrawer();
    Raid.abrir();
  });
  document.getElementById('raid-close').addEventListener('click', () => hideModal('modal-raid'));
  document.getElementById('raid-rescan').addEventListener('click', () => Raid.carregar(true));

  document.getElementById('raid-search').addEventListener('input', (e) => {
    Raid.buscaAlvo = e.target.value;
    Raid.renderCatalogo();
  });

  document.getElementById('raid-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    Raid.filtro = b.dataset.filter;
    // Trocar o filtro zera a seleção fina: manter chaves de
    // ferramentas que sumiram da lista daria um resultado que não
    // bate com o que está marcado na tela.
    Raid.permitidas = null;
    Raid.renderFerramentas();
    Raid.recalcular();
  });

  document.getElementById('raid-stock-on').addEventListener('change', (e) => {
    Raid.estoqueLigado = e.target.checked;
    Raid.renderFerramentas();
    Raid.recalcular();
  });

  document.getElementById('raid-clear').addEventListener('click', () => {
    Raid.itens = [];
    Raid.renderCatalogo();
    Raid.renderSelecionados();
    Raid.recalcular();
  });

  document.getElementById('raid-save-note').addEventListener('click', () => Raid.salvarRelatorio());
  document.getElementById('raid-copy').addEventListener('click', () => Raid.copiarRelatorio());
}
