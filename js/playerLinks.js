// ============================================================
// playerLinks.js — a LINHA entre dois nomes na lista de jogadores
//
//   "caso algum nome seja encontrado na listagem, ele mostra
//    aliados e team com uma linha ligando esses nomes na listagem
//    mesmo de playerlist"
//
// ------------------------------------------------------------
// POR QUE UMA LINHA, E NÃO UM RÓTULO
// ------------------------------------------------------------
// Rótulo já existe: a ficha pinta a linha do jogador de verde ou
// vermelho e põe um selo com o nome do grupo. Isso responde "quem é
// essa pessoa para mim?".
//
// A linha responde outra coisa, que rótulo nenhum responde:
// "essas duas pessoas que estão online AGORA andam juntas". Numa
// lista de 24 nomes, ver que o quarto e o décimo nono estão ligados
// é a informação que muda o que você faz nos próximos minutos — e
// ela só aparece quando os dois nomes estão desenhados ligados.
//
// ------------------------------------------------------------
// COMO A LINHA É DESENHADA
// ------------------------------------------------------------
// Uma chave (bracket) na canaleta à esquerda: sai da linha de cima,
// vai até a canaleta, desce, e volta para a linha de baixo.
//
// Não é uma reta ligando os dois nomes: numa lista vertical, uma
// reta atravessaria por cima de tudo que está no meio e ficaria
// ilegível com duas ligações. A chave é o desenho que uma árvore
// genealógica usa, pelo mesmo motivo.
//
// Cada ligação ganha uma FAIXA própria (uma coluna na canaleta), o
// que evita duas chaves sobrepostas parecerem uma só.
//
// ------------------------------------------------------------
// AS DUAS ARMADILHAS
// ------------------------------------------------------------
// 1. A lista ROLA. O SVG mora DENTRO do <ul>, com a altura total do
//    conteúdo (`scrollHeight`), e não sobre ele: assim rola junto,
//    de graça, sem escutar evento de scroll.
//
// 2. Medir antes de existir. As posições vêm de `offsetTop` das
//    linhas, que só valem depois de a lista estar no layout. Por
//    isso o desenho é sempre DEPOIS do `innerHTML`, e é refeito
//    quando a lista muda de tamanho.
// ============================================================

const PlayerLinks = (() => {
  'use strict';

  const CANALETA = 9;     // largura de cada faixa, em px
  const MARGEM = 6;

  const estado = {
    escopo: null,
    bmId: null,
    // Uma chave pode ter MAIS DE UM dossiê: o seu, no disco, e o do
    // time, que outra pessoa escreveu. Guardar só um perderia as
    // ligações do outro — e o efeito seria uma linha sumindo da
    // lista sem explicação.
    porChave: new Map(),   // chave do jogador -> [dossiês]
    porId: new Map(),      // id do dossiê     -> chave do jogador
    ligado: false
  };

  // ------------------------------------------------------------
  // Leitura
  // ------------------------------------------------------------
  // Uma consulta por atualização, não uma por jogador. A lista se
  // monta de forma síncrona e não pode esperar o disco 24 vezes.
  //
  // Duas fontes, e as duas importam:
  //
  //   SUAS anotações do servidor (escopo "server:<bmId>")
  //   os dossiês dos TIMES vinculados a este servidor
  //
  // A segunda existe porque a Sara pediu que isso funcionasse "no
  // server e no teams". Sem ela, uma ficha que o time inteiro
  // montou não desenharia linha nenhuma na lista de quem está
  // olhando o servidor — que é exatamente o momento em que ela
  // serve para alguma coisa.
  function guardar(cartao, chave) {
    if (!chave) return;
    if (!estado.porChave.has(chave)) estado.porChave.set(chave, []);
    estado.porChave.get(chave).push(cartao);
    estado.porId.set(cartao.id, chave);
  }

  async function sincronizar(scope, bmId = null) {
    estado.escopo = scope;
    estado.bmId = bmId;
    estado.porChave = new Map();
    estado.porId = new Map();
    if (!scope) return;

    // ---- as suas, do disco ----
    let fichas = {};
    try { fichas = (await window.api.notesFichas(scope)) || {}; } catch { fichas = {}; }
    for (const [chave, n] of Object.entries(fichas)) {
      guardar({ id: n.id, player: n.player, icon: n.icon, photo: n.photo || null,
                links: n.links || [], origem: 'local', bruto: n }, chave);
    }

    // ---- as dos times vinculados a este servidor ----
    if (!bmId) return;
    let grupos = [];
    try { grupos = (await window.api.teamGroupsForServer(bmId)) || []; } catch { grupos = []; }
    for (const g of grupos) {
      let itens = [];
      // `serverBmId: bmId` traz o que é DESTE servidor mais o que não
      // tem servidor nenhum — a mesma regra de três estados do
      // store. Um dossiê de jogador costuma não ter servidor, e é
      // certo que ele valha nos dois.
      try { itens = (await window.api.teamItems(g.id, { serverBmId: bmId })) || []; } catch { itens = []; }
      for (const it of itens) {
        const d = it.data || {};
        if (it.kind !== 'note' || d.type !== 'ficha' || !d.player) continue;
        guardar({ id: it.id, player: d.player, icon: d.icon, photo: d.photo || null,
                  links: d.links || [], origem: 'time', time: g.name, bruto: it },
                chaveDeNome(d.player));
      }
    }
  }

  // O primeiro dossiê deste jogador, se houver. Quem pergunta quer
  // saber "existe dossiê?" — a ficha do jogador usa isto para
  // decidir entre abrir e criar.
  function de(nome) {
    const lista = estado.porChave.get(chaveDeNome(nome));
    return (lista && lista[0]) || null;
  }

  function todosDe(nome) {
    return estado.porChave.get(chaveDeNome(nome)) || [];
  }

  // ------------------------------------------------------------
  // Quais ligações aparecem
  // ------------------------------------------------------------
  // Só as que têm OS DOIS LADOS na tela. Uma chave saindo de um
  // nome e indo para lugar nenhum é pior do que não desenhar: ela
  // afirma uma relação com alguém que não está ali.
  //
  // `related` fica de fora do desenho de propósito. O pedido fala
  // de aliados e time; "relacionado" é uma anotação de investigação
  // ("tem a ver, ainda não sei como") e encheria a canaleta de
  // linhas cinzas que não ajudam a decidir nada no meio de uma
  // partida. Ela continua visível na mesa e no cartão.
  const DESENHAVEIS = new Set(['ally', 'team', 'enemy']);

  function ligacoesEntre(nomes) {
    const presentes = new Map();   // chave -> nome como está na lista
    for (const n of nomes) presentes.set(chaveDeNome(n), n);

    const vistas = new Set();
    const out = [];
    for (const [chave, nome] of presentes) {
      for (const ficha of (estado.porChave.get(chave) || [])) {
        for (const l of (ficha.links || [])) {
          if (!DESENHAVEIS.has(l.rel)) continue;
          const outraChave = estado.porId.get(l.to);
          if (!outraChave || outraChave === chave) continue;
          if (!presentes.has(outraChave)) continue;
          // Duas pessoas ligadas pelo SEU dossiê e também pelo do
          // time dão uma linha só. Duas linhas idênticas empilhadas
          // não acrescentam nada e ainda gastam uma faixa da
          // canaleta.
          const par = [chave, outraChave].sort().join('|');
          if (vistas.has(par)) continue;
          vistas.add(par);
          out.push({ a: nome, b: presentes.get(outraChave), rel: l.rel });
        }
      }
    }
    return out;
  }

  // Com quem ESTE nome está ligado, entre os que estão na lista.
  // É o que alimenta o selo ao lado do nome — a linha diz que há
  // ligação, o selo diz com quem.
  function parceirosDe(nome, nomes) {
    return ligacoesEntre(nomes)
      .filter((l) => l.a === nome || l.b === nome)
      .map((l) => ({ nome: l.a === nome ? l.b : l.a, rel: l.rel }));
  }

  // ------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------
  function desenhar(ul) {
    if (!ul) return 0;
    // Limpa o desenho anterior SEMPRE, mesmo quando não há nada a
    // desenhar: senão as linhas da atualização passada continuam na
    // tela apontando para nomes que já saíram.
    const velho = ul.querySelector('.players-links');
    if (velho) velho.remove();

    const linhas = [...ul.querySelectorAll('.player-row[data-player]')];
    if (linhas.length < 2) { ul.style.paddingLeft = ''; return 0; }

    const nomes = linhas.map((li) => li.dataset.player);
    const ligacoes = ligacoesEntre(nomes);
    if (!ligacoes.length) { ul.style.paddingLeft = ''; return 0; }

    const topoDe = new Map();
    for (const li of linhas) {
      topoDe.set(li.dataset.player, li.offsetTop + li.offsetHeight / 2);
    }

    // FAIXAS. Duas ligações que não se cruzam podem dividir a mesma
    // faixa; as que se cruzam precisam de faixas diferentes. A conta
    // exata é um problema de coloração de grafo — aqui basta a
    // heurística gulosa: percorre da ligação mais curta para a mais
    // longa e põe cada uma na primeira faixa livre.
    //
    // Curta primeiro porque ligação de vizinhos é a mais comum, e
    // assim ela fica na faixa colada na lista, deixando as longas
    // por fora. O desenho fica parecido com uma chave de torneio,
    // que é o que a leitura espera.
    const comAlcance = ligacoes.map((l) => {
      const y1 = topoDe.get(l.a), y2 = topoDe.get(l.b);
      return { ...l, y1: Math.min(y1, y2), y2: Math.max(y1, y2), alcance: Math.abs(y1 - y2) };
    }).sort((x, y) => x.alcance - y.alcance);

    const faixas = [];   // faixa -> [{y1,y2}]
    for (const l of comAlcance) {
      let f = 0;
      while (true) {
        const ocupada = (faixas[f] || []).some((o) => !(l.y2 < o.y1 || l.y1 > o.y2));
        if (!ocupada) break;
        f++;
      }
      (faixas[f] = faixas[f] || []).push({ y1: l.y1, y2: l.y2 });
      l.faixa = f;
    }

    const largura = MARGEM + (faixas.length) * CANALETA;
    // A canaleta é aberta EMPURRANDO a lista, não sobrepondo: uma
    // linha por cima dos nomes é ilegível, e o nome é o que importa.
    ul.style.paddingLeft = largura + 'px';

    // Empurrar a lista muda a altura das linhas (o texto reflui).
    // Medir de novo depois do padding é o que impede a chave de
    // apontar alguns pixels acima do nome em listas apertadas.
    for (const li of linhas) topoDe.set(li.dataset.player, li.offsetTop + li.offsetHeight / 2);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'players-links');
    svg.setAttribute('width', String(largura));
    svg.setAttribute('height', String(ul.scrollHeight));

    for (const l of comAlcance) {
      const y1 = topoDe.get(l.a), y2 = topoDe.get(l.b);
      const x = largura - MARGEM - l.faixa * CANALETA;
      const cor = Dossier.relDe(l.rel).cor;
      const d = `M ${largura - 1} ${Math.min(y1, y2)} H ${x} V ${Math.max(y1, y2)} H ${largura - 1}`;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', cor);
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', '0.85');
      path.setAttribute('class', 'pl-path r-' + l.rel);
      svg.appendChild(path);

      // Bolinha em cada ponta: sem ela, a chave parece encostar na
      // linha sem dizer em qual nome exatamente ela termina.
      for (const y of [y1, y2]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(largura - 1));
        c.setAttribute('cy', String(y));
        c.setAttribute('r', '2.4');
        c.setAttribute('fill', cor);
        svg.appendChild(c);
      }
    }

    ul.appendChild(svg);
    return comAlcance.length;
  }

  return { sincronizar, de, todosDe, ligacoesEntre, parceirosDe, desenhar, _estado: estado };
})();
