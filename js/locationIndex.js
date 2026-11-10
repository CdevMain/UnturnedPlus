// ============================================================
// locationIndex.js — "que lugar é este?" a partir de uma coordenada
//
// Os nomes de local do Unturned são PONTOS com nome, não polígonos:
// o Nodes.dat guarda "Novosibirsk está em (x, z)" e nada sobre onde
// Novosibirsk começa ou termina. Então a resposta tem que ser
// deduzida da geometria dos próprios pontos.
//
// ------------------------------------------------------------
// POR QUE NÃO É SÓ "O MAIS PERTO"
// ------------------------------------------------------------
// O mais perto sempre existe, e por isso mente. Um marcador no meio
// do mato, a 900 metros de tudo, teria como resposta "Novosibirsk" —
// e aí a informação passa a atrapalhar em vez de ajudar. Quem lê
// "Novosibirsk" vai para a cidade e não acha nada.
//
// ------------------------------------------------------------
// O ALCANCE DE CADA LOCAL SE CALIBRA SOZINHO
// ------------------------------------------------------------
// Poderia ser um raio fixo (300 m?), mas raio fixo erra nos dois
// sentidos: num mapa de 1024 m as cidades ficam coladas e 300 m
// cobre meio mapa; num de 4096 m, 300 m não cobre nem o subúrbio.
//
// Em vez disso, o alcance de cada local sai da DISTÂNCIA ATÉ O
// VIZINHO MAIS PRÓXIMO dele: metade do caminho entre dois lugares
// pertence a cada um. É a mesma ideia de uma partição de Voronoi, e
// se ajusta sozinha a mapa grande, mapa pequeno e mapa de Workshop
// sem nenhuma tabela.
//
// Um local isolado num canto do mapa ganha um alcance enorme por
// esse cálculo, então existe um teto; e dois locais colados ganham
// um alcance minúsculo, então existe um piso.
// ============================================================

(function (raiz) {
  'use strict';

  const PISO = 60;     // metros: nem que os vizinhos estejam colados
  const TETO = 500;    // metros: nem que o local esteja sozinho no mapa

  // Rosa dos ventos com 8 pontas. No Unturned o +Z aponta para o
  // norte, como no mapa que a pessoa vê no jogo.
  const ROSA = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

  function distancia(ax, az, bx, bz) {
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function rumo(dx, dz) {
    // atan2(leste, norte) dá 0 no norte e cresce no sentido horário,
    // que é como se lê uma bússola.
    const graus = (Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360;
    return ROSA[Math.round(graus / 45) % 8];
  }

  // ----------------------------------------------------------
  // Índice
  // ----------------------------------------------------------
  // Recebe os marcadores do mapa e guarda só os locais OFICIAIS.
  // Um ponto que a pessoa criou não serve de referência geográfica:
  // "sua base" não localiza ninguém que não seja você.
  function build(markers) {
    const locais = (markers || [])
      .filter((m) => m && m.official && m.type === 'location' &&
                     Number.isFinite(m.x) && Number.isFinite(m.z))
      .map((m) => ({ id: m.id, name: m.name, x: m.x, z: m.z }));

    // Alcance de cada um = metade da distância até o vizinho mais
    // próximo, preso entre o piso e o teto.
    for (const a of locais) {
      let menor = Infinity;
      for (const b of locais) {
        if (a === b) continue;
        const d = distancia(a.x, a.z, b.x, b.z);
        if (d < menor) menor = d;
      }
      a.reach = Math.round(!Number.isFinite(menor)
        ? TETO                                   // único local do mapa
        : Math.max(PISO, Math.min(TETO, menor / 2)));
    }

    return { locais, count: locais.length };
  }

  // ----------------------------------------------------------
  // Consulta
  // ----------------------------------------------------------
  // Devolve sempre a mesma forma, com `confidence` dizendo o quanto
  // dá para confiar:
  //   'in'   — dentro do alcance do local
  //   'near' — no arredor (até o dobro do alcance)
  //   'far'  — longe: aí a resposta útil é distância + rumo
  //   null   — o mapa não tem local nenhum indexado
  function locate(index, x, z) {
    if (!index || !index.locais.length) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

    let melhor = null, melhorD = Infinity;
    for (const l of index.locais) {
      const d = distancia(x, z, l.x, l.z);
      if (d < melhorD) { melhorD = d; melhor = l; }
    }
    if (!melhor) return null;

    const confidence = melhorD <= melhor.reach ? 'in'
      : melhorD <= melhor.reach * 2 ? 'near'
      : 'far';

    return {
      name: melhor.name,
      id: melhor.id,
      distance: Math.round(melhorD),
      bearing: rumo(x - melhor.x, z - melhor.z),
      reach: Math.round(melhor.reach),
      confidence
    };
  }

  // Texto pronto. Fica aqui, e não em cada tela, porque o card do
  // marcador, a barra do mapa e a lista do time precisam dizer a
  // mesma coisa do mesmo jeito.
  //
  // `t` é a função de tradução; sem ela, cai num formato neutro que
  // ainda é legível.
  function describe(r, t) {
    if (!r) return '';
    const tr = typeof t === 'function' ? t : (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
    if (r.confidence === 'in') return tr('loc.in', { name: r.name });
    if (r.confidence === 'near') return tr('loc.near', { name: r.name });
    // Longe: o nome sozinho enganaria, então vai a distância e o
    // rumo — que é o que a pessoa usa para chegar lá.
    return tr('loc.far', { d: r.distance, dir: tr('loc.dir' + r.bearing), name: r.name });
  }

  // Nome sugerido para um marcador novo. Não é o nome final: é o
  // que aparece já preenchido no campo, para a pessoa não ter que
  // pensar num nome só para poder salvar. "Base" e "Base 2" viram
  // inúteis em uma semana; "Base — Novosibirsk" continua servindo.
  function suggestName(r, base, t) {
    const tr = typeof t === 'function' ? t : (k) => k;
    const rotulo = base || tr('loc.spot');
    if (!r || r.confidence === 'far') return rotulo;
    return `${rotulo} — ${r.name}`;
  }

  const api = { build, locate, describe, suggestName, distancia, rumo, PISO, TETO };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LocationIndex = api;
})(typeof window !== 'undefined' ? window : globalThis);
