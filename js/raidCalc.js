// ============================================================
// raidCalc.js — A conta do raid
//
// Módulo PURO de propósito: entra dado, sai número, sem tocar em
// DOM, disco ou rede. É o que permite testar a regra do jogo
// isolada da tela — e a regra é a parte que, se estiver errada,
// faz alguém atravessar o mapa com metade das cargas necessárias.
//
// ------------------------------------------------------------
// A REGRA (documentação oficial do Unturned)
//
// 1. Armadura é um MULTIPLICADOR NO DANO RECEBIDO. Alvo LOW recebe
//    100% do dano; alvo HIGH recebe 50%.
//      https://docs.smartlydressedgames.com/en/stable/items/barricade-asset.html
//      https://docs.smartlydressedgames.com/en/stable/items/structure-asset.html
//    O multiplicador é configurável no servidor, então entra aqui
//    como parâmetro em vez de constante.
//
// 2. `Proof_Explosion` = "immune to area-of-effect explosive
//    damage". Explosivo não arranha; arma de dano direto sim.
//
// 3. `Vulnerable` = "can be damaged by lower-power weapons that do
//    not have the Invulnerable flag". Sem essa flag no ALVO, só
//    ferramenta com `Invulnerable` causa dano.
//
// 4. Barricada usa `Barricade_Damage`; estrutura usa
//    `Structure_Damage`. São campos diferentes e frequentemente
//    valores diferentes no mesmo item.
//
// ------------------------------------------------------------
// O QUE ESTE MÓDULO NÃO FINGE SABER
//
// A queda de dano com a distância dentro do raio da explosão não
// está documentada com fórmula. Todo o cálculo aqui assume o
// impacto NO ALVO (dano cheio), que é como se raida na prática:
// a carga é grudada na parede. Se você joga a granada de longe,
// vai precisar de mais — e a tela diz isso em vez de esconder.
// ============================================================
(function (raiz) {
  'use strict';

  const PADRAO = {
    // "low-tier armor take 100% ... high-tier armor take 50%"
    multLow: 1,
    multHigh: 0.5
  };

  // Dano que UMA unidade da ferramenta causa neste alvo. 0 significa
  // "não funciona", e o `porque` diz qual regra barrou — a tela usa
  // isso para explicar em vez de só sumir com a opção.
  function danoPorUnidade(ferramenta, alvo, cfg = {}) {
    const c = { ...PADRAO, ...cfg };
    if (!ferramenta || !alvo) return { dano: 0, porque: 'invalid' };

    if (ferramenta.explosive) {
      // Explosão: a única defesa é Proof_Explosion.
      if (alvo.proofExplosion) return { dano: 0, porque: 'proofExplosion' };
    } else if (!alvo.vulnerable && !ferramenta.invulnerable) {
      // Dano direto num alvo "duro": precisa de arma com Invulnerable.
      return { dano: 0, porque: 'needsInvulnerable' };
    }

    const base = alvo.kind === 'structure'
      ? Number(ferramenta.structureDamage || 0)
      : Number(ferramenta.barricadeDamage || 0);
    if (!(base > 0)) return { dano: 0, porque: 'noDamage' };

    const mult = alvo.armorTier === 'HIGH' ? c.multHigh : c.multLow;
    return { dano: base * mult, porque: null, mult, base };
  }

  // Quantas unidades para derrubar UM alvo.
  function unidadesPara(ferramenta, alvo, cfg) {
    const d = danoPorUnidade(ferramenta, alvo, cfg);
    if (!d.dano) return { ...d, unidades: Infinity };
    const vida = Number(alvo.health || 0);
    const unidades = Math.ceil(vida / d.dano);
    return {
      ...d,
      unidades,
      // Dano jogado fora no último golpe. Duas ferramentas que
      // precisam do mesmo número de unidades não são iguais: a que
      // desperdiça menos é a que sobra munição para a próxima porta.
      desperdicio: unidades * d.dano - vida
    };
  }

  // Ranking de ferramentas para um alvo, da melhor para a pior.
  //
  // Critério 1: MENOS UNIDADES. É o que a pessoa carrega na mochila.
  //
  // Critério 2 (empate): MENOS DESPERDÍCIO — que é o mesmo que
  // dizer "a ferramenta mais fraca que ainda resolve no mesmo número
  // de golpes". Parece contraintuitivo à primeira vista (por que
  // preferir o foguete de 400 à carga de 500?), mas é exatamente o
  // que se faz raidando: se os dois derrubam a porta com 4 unidades,
  // gastar os 4 foguetes guarda as 4 cargas para a parede que o
  // foguete não abre. O empate não é entre iguais — é entre "gastar
  // o recurso caro" e "gastar o barato".
  //
  // O que NÃO temos é preço/peso de cada item; se um dia isso vier
  // do jogo, o desempate vira custo de verdade e esta função é o
  // único lugar que muda.
  function ranquear(ferramentas, alvo, cfg) {
    return (ferramentas || [])
      .map((f) => ({ ferramenta: f, ...unidadesPara(f, alvo, cfg) }))
      .filter((r) => Number.isFinite(r.unidades))
      .sort((a, b) => (a.unidades - b.unidades) || (a.desperdicio - b.desperdicio) ||
                      String(a.ferramenta.name).localeCompare(String(b.ferramenta.name)));
  }

  // ------------------------------------------------------------
  // Plano de raid
  //
  // Uma lista de alvos com quantidade ("2 portas de metal, 1 parede
  // de metal") e um conjunto de ferramentas permitidas.
  //
  // Com estoque ILIMITADO a resposta é simples e vale a pena dizer
  // em voz alta: uma ferramenta só é sempre a melhor por alvo, e
  // misturar nunca ajuda. Misturar SÓ importa quando você tem
  // quantidade limitada de alguma — por isso o estoque é opcional e,
  // quando informado, muda o algoritmo.
  // ------------------------------------------------------------
  function planejar(itens, ferramentas, cfg = {}) {
    const estoque = cfg.estoque || null;   // { idFerramenta: n }
    const linhas = [];
    const faltando = [];
    const usoTotal = {};

    // Restante de cada ferramenta neste plano.
    const resta = {};
    if (estoque) {
      for (const f of ferramentas) {
        const k = chave(f);
        resta[k] = Number(estoque[k]);
        if (!Number.isFinite(resta[k])) resta[k] = 0;
      }
    }

    for (const item of itens || []) {
      const alvo = item.alvo;
      const qtd = Math.max(1, Number(item.qtd) || 1);
      const ranking = ranquear(ferramentas, alvo, cfg);

      if (!ranking.length) {
        faltando.push({ alvo, qtd, motivo: motivoGeral(ferramentas, alvo, cfg) });
        continue;
      }

      const usado = [];
      let restamAlvos = qtd;

      if (!estoque) {
        // Sem estoque: a melhor ferramenta faz tudo.
        const melhor = ranking[0];
        usado.push({ ferramenta: melhor.ferramenta, unidades: melhor.unidades * qtd, porAlvo: melhor.unidades });
        restamAlvos = 0;
      } else {
        // Com estoque: gasta primeiro a ferramenta que resolve o
        // alvo com menos unidades e que você TEM. Guloso pelo
        // ranking, que é a ordem certa aqui porque cada alvo é
        // independente e o custo é linear no número de unidades.
        for (const r of ranking) {
          if (restamAlvos <= 0) break;
          const k = chave(r.ferramenta);
          const cabem = Math.floor((resta[k] || 0) / r.unidades);
          if (cabem <= 0) continue;
          const usar = Math.min(cabem, restamAlvos);
          resta[k] -= usar * r.unidades;
          restamAlvos -= usar;
          usado.push({ ferramenta: r.ferramenta, unidades: usar * r.unidades, porAlvo: r.unidades, alvos: usar });
        }
        if (restamAlvos > 0) faltando.push({ alvo, qtd: restamAlvos, motivo: 'estoque' });
      }

      for (const u of usado) {
        const k = chave(u.ferramenta);
        usoTotal[k] = (usoTotal[k] || 0) + u.unidades;
      }
      linhas.push({
        alvo, qtd,
        usado,
        naoResolvidos: restamAlvos,
        ranking: ranking.slice(0, 6),
        vidaTotal: Number(alvo.health || 0) * qtd
      });
    }

    // Lista de compras: o que levar na mochila.
    const compras = Object.entries(usoTotal).map(([k, n]) => ({
      chave: k,
      ferramenta: acharPorChave(ferramentas, k),
      unidades: n
    })).sort((a, b) => b.unidades - a.unidades);

    return {
      linhas,
      faltando,
      compras,
      totalUnidades: compras.reduce((s, c) => s + c.unidades, 0),
      vidaTotal: linhas.reduce((s, l) => s + l.vidaTotal, 0)
    };
  }

  // Por que NENHUMA ferramenta serve. Serve para a tela dizer "essa
  // parede é imune a explosivo, use arma" em vez de "sem resultado".
  function motivoGeral(ferramentas, alvo, cfg) {
    const motivos = new Set((ferramentas || [])
      .map((f) => danoPorUnidade(f, alvo, cfg).porque)
      .filter(Boolean));
    if (!ferramentas || !ferramentas.length) return 'noTools';
    if (motivos.size === 1) return [...motivos][0];
    if (motivos.has('needsInvulnerable')) return 'needsInvulnerable';
    if (motivos.has('proofExplosion')) return 'proofExplosion';
    return 'noDamage';
  }

  // Chave estável de uma ferramenta. O ID numérico é o certo; itens
  // de mod às vezes não têm, então o nome é o plano B.
  function chave(f) {
    return f && f.id ? 'i' + f.id : 'n' + String((f && f.name) || '').toLowerCase();
  }
  function acharPorChave(ferramentas, k) {
    return (ferramentas || []).find((f) => chave(f) === k) || null;
  }

  // Filtros que a tela oferece: "só explosivo", "explosivo + arma X".
  function filtrar(ferramentas, filtro = {}) {
    let out = ferramentas || [];
    if (filtro.somenteExplosivos) out = out.filter((f) => f.explosive);
    if (filtro.semExplosivos) out = out.filter((f) => !f.explosive);
    if (Array.isArray(filtro.permitidas) && filtro.permitidas.length) {
      const ok = new Set(filtro.permitidas);
      out = out.filter((f) => ok.has(chave(f)));
    }
    if (Array.isArray(filtro.tipos) && filtro.tipos.length) {
      const ok = new Set(filtro.tipos);
      out = out.filter((f) => ok.has(f.type));
    }
    return out;
  }

  const api = { PADRAO, danoPorUnidade, unidadesPara, ranquear, planejar, filtrar, chave, motivoGeral };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.RaidCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
