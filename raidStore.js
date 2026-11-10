// ============================================================
// raidStore.js — Catálogo de raid lido do JOGO INSTALADO
//
// Uma tabela de "quantas cargas para derrubar a porta de metal"
// escrita à mão envelhece em uma atualização e mente em qualquer
// servidor com mod. Então aqui NÃO existe tabela chumbada: os
// números saem dos arquivos do próprio Unturned da máquina.
//
// Os assets do jogo são texto puro em
//   <Unturned>/Bundles/Items/**/<Nome>.dat
// no formato descrito em
//   https://docs.smartlydressedgames.com/en/stable/assets/data-file-format.html
//
// O que interessa, e de onde vem (documentação oficial):
//
//   ALVO (o que se quebra) — Barricade/Structure asset
//     Health            vida total
//     Armor_Tier        LOW | HIGH. "armadura é um multiplicador no
//                       dano recebido": LOW recebe 100%, HIGH recebe
//                       50%. O padrão é LOW, EXCETO quando o nome
//                       contém "Metal" (e "Brick", em structure).
//     Proof_Explosion   imune a dano de explosão em área
//     Vulnerable        pode ser danificado por armas que NÃO têm a
//                       flag Invulnerable (as "fracas")
//     Can_Be_Damaged    padrão true
//
//   FERRAMENTA (o que quebra) — Charge/Throwable/Magazine/Melee/Gun
//     Barricade_Damage  dano em barricada
//     Structure_Damage  dano em estrutura
//     Range             raio da explosão em área (0 = dano direto)
//     Invulnerable      pode danificar alvo que não é Vulnerable
//
// Isso torna o cálculo VERDADEIRO para a versão instalada e para os
// mods do Workshop, que caem na mesma varredura.
//
// Sem o jogo instalado o app cai no catálogo de reserva
// (raidFallback.json), avisando na tela que os números são de
// referência e não da instalação da pessoa.
// ============================================================

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------
// Leitor de .dat
//
// Formato: uma chave e um valor por linha, separados por espaço;
// `//` comenta a linha; chaves sem valor são flags; blocos { } e
// listas [ ] podem aninhar. Aqui achatamos: só as chaves de nível
// raiz interessam, e o conteúdo dos blocos é PULADO de propósito —
// um `Health` dentro de um sub-bloco não é a vida do asset.
// ------------------------------------------------------------
function parseDat(text) {
  const out = {};
  let profundidade = 0;
  for (const bruta of String(text).split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('//')) continue;
    if (linha === '{' || linha === '[') { profundidade += 1; continue; }
    if (linha === '}' || linha === ']') { profundidade = Math.max(0, profundidade - 1); continue; }
    if (profundidade > 0) continue;

    // Chave possivelmente entre aspas, depois o resto da linha.
    const m = linha.match(/^"([^"]+)"\s*(.*)$/) || linha.match(/^(\S+)\s*(.*)$/);
    if (!m) continue;
    const chave = m[1].toLowerCase();
    let valor = (m[2] || '').trim();
    // Comentário no fim de linha só é válido depois de valor entre
    // aspas — fora disso um "//" faz parte do valor.
    const aspas = valor.match(/^"((?:[^"\\]|\\.)*)"/);
    if (aspas) valor = aspas[1].replace(/\\"/g, '"');
    // Flag: chave sem valor vale `true`.
    out[chave] = valor === '' ? true : valor;
  }
  return out;
}

function num(v, padrao = 0) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : padrao;
}
function flag(v) { return v === true || String(v).toLowerCase() === 'true'; }

// ------------------------------------------------------------
// Classificação
// ------------------------------------------------------------

// Tipos de asset que são construção (o que se raida). A lista é uma
// PISTA, não a regra: o que decide é ter Health. Assim um tipo novo
// numa atualização não some do catálogo em silêncio.
const TIPOS_ALVO = new Set([
  'barricade', 'structure', 'door', 'gate', 'hatch', 'ladder', 'storage',
  'beacon', 'bed', 'farm', 'generator', 'library', 'sentry', 'tank',
  'trap', 'oven', 'oxygenator', 'safezone', 'sign', 'spot', 'stereo',
  'charge', 'claim', 'cage', 'clock', 'mannequin', 'note', 'oil'
]);

// "Defaults to low-tier, except when the name contains the word
// 'Metal'" (barricade) / "'Metal' or 'Brick'" (structure).
function armorTierPadrao(nome, ehEstrutura) {
  const n = String(nome || '').toLowerCase();
  if (n.includes('metal')) return 'HIGH';
  if (ehEstrutura && n.includes('brick')) return 'HIGH';
  return 'LOW';
}

function lerAlvo(dat, nome, idPasta) {
  const tipo = String(dat.type || '').toLowerCase();
  const vida = num(dat.health, 0);
  if (!vida) return null;
  if (!TIPOS_ALVO.has(tipo) && !dat.build) return null;
  if (dat.can_be_damaged !== undefined && !flag(dat.can_be_damaged)) return null;

  const ehEstrutura = tipo === 'structure';
  const tierBruto = String(dat.armor_tier || '').toUpperCase();
  return {
    id: num(dat.id, 0),
    guid: String(dat.guid || ''),
    name: nome,
    kind: ehEstrutura ? 'structure' : 'barricade',
    build: String(dat.build || dat.construct || tipo || '').toLowerCase(),
    health: vida,
    armorTier: (tierBruto === 'HIGH' || tierBruto === 'LOW')
      ? tierBruto
      : armorTierPadrao(nome || idPasta, ehEstrutura),
    // "Immune to area-of-effect explosive damage."
    proofExplosion: flag(dat.proof_explosion),
    // "can be damaged by lower-power weapons that do not have the
    // Invulnerable flag". Sem a flag, só arma Invulnerable machuca.
    vulnerable: flag(dat.vulnerable)
  };
}

function lerFerramenta(dat, nome) {
  const tipo = String(dat.type || '').toLowerCase();
  const dBar = num(dat.barricade_damage, 0);
  const dEst = num(dat.structure_damage, 0);
  if (dBar <= 0 && dEst <= 0) return null;
  // Um asset de construção pode ter dano (armadilha, sentry). Não é
  // ferramenta de raid — quem raida é o que a pessoa carrega.
  if (TIPOS_ALVO.has(tipo) && tipo !== 'charge' && num(dat.health, 0) > 0) return null;

  const raio = num(dat.range, 0) || num(dat.range2, 0);
  const explosivo = raio > 0;

  // ---- O QUE CONTA COMO FERRAMENTA DE RAID ----
  //
  // Não é "tudo que tem Barricade_Damage". Por esse critério a
  // marreta e o machado entram — e no jogo você não derruba base a
  // marretada, por mais que o .dat diga que causa 25 de dano. O que
  // derruba base é EXPLOSIVO: C4, Precision Charge, granada,
  // foguete de lançador, munição explosiva, mina.
  //
  // Duas condições, as duas necessárias:
  //   1. tem raio de explosão (Range > 0);
  //   2. o dano é RELEVANTE contra construção.
  //
  // O piso existe porque há explosivo que não é de raid: fumaça,
  // flashbang e afins têm raio e dano quase zero em barricada.
  // Escolhido em 40 porque a granada de fragmentação (50) é o item
  // mais fraco que ainda serve para alguma coisa, e ficar abaixo
  // dela é ruído na lista.
  //
  // Note que a regra é por PROPRIEDADE, não por lista de nomes: um
  // explosivo novo do jogo, ou de um mod, entra sozinho.
  const PISO_RAID = 40;
  const ehRaid = explosivo && Math.max(dBar, dEst) >= PISO_RAID;

  return {
    raidTool: ehRaid,
    id: num(dat.id, 0),
    guid: String(dat.guid || ''),
    name: nome,
    type: tipo,
    barricadeDamage: dBar,
    structureDamage: dEst,
    range: raio,
    explosive: explosivo,
    // Arma "forte": atravessa alvo que não é Vulnerable.
    invulnerable: flag(dat.invulnerable),
    // Munição precisa de arma; carga precisa de detonador. Guardamos
    // para a tela poder dizer "você também precisa de X".
    needsWeapon: tipo === 'magazine',
    needsDetonator: tipo === 'charge'
  };
}

// ------------------------------------------------------------
// Varredura
// ------------------------------------------------------------

// O nome que aparece no jogo mora no English.dat ao lado, não no
// .dat do asset. Sem ele o catálogo listaria nomes de pasta.
function nomeLocalizado(pasta, arquivoDat) {
  for (const cand of ['English.dat', 'Portuguese.dat']) {
    try {
      const t = fs.readFileSync(path.join(pasta, cand), 'utf-8');
      const n = parseDat(t).name;
      if (n && typeof n === 'string') return n;
    } catch { /* segue */ }
  }
  return path.basename(arquivoDat, '.dat').replace(/_/g, ' ');
}

function* caminharDats(raiz, profundidade = 0) {
  if (profundidade > 8) return;
  let entradas = [];
  try { entradas = fs.readdirSync(raiz, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    const p = path.join(raiz, e.name);
    if (e.isDirectory()) { yield* caminharDats(p, profundidade + 1); continue; }
    if (!e.name.toLowerCase().endsWith('.dat')) continue;
    // Arquivos de idioma não são assets.
    if (/^(english|spanish|french|german|russian|portuguese|polish|thai|hungarian|greek|latam|romanian|swedish|turkish|czech|japanese|chinese|korean|italian|dutch|ukrainian|vietnamese|indonesian|danish|finnish|norwegian|bulgarian|croatian)\.dat$/i.test(e.name)) continue;
    yield p;
  }
}

// Varre uma pasta de assets e devolve { alvos, ferramentas }.
function varrer(raizItens) {
  const alvos = [];
  const ferramentas = [];
  for (const arquivo of caminharDats(raizItens)) {
    let dat;
    try { dat = parseDat(fs.readFileSync(arquivo, 'utf-8')); } catch { continue; }
    if (!dat.type && !dat.build) continue;
    const pasta = path.dirname(arquivo);
    const nome = nomeLocalizado(pasta, arquivo);

    // A ordem importa: quem é FERRAMENTA não entra como alvo.
    // A carga explosiva é o caso: ela tem Health (é uma barricada
    // que gruda na parede), mas listá-la entre "o que raidar" é só
    // ruído numa tela cuja pergunta é "o que quero derrubar".
    const fer = lerFerramenta(dat, nome);
    if (fer) { ferramentas.push(fer); continue; }
    const alvo = lerAlvo(dat, nome, path.basename(pasta));
    if (alvo) alvos.push(alvo);
  }
  return { alvos, ferramentas };
}

// Pastas onde os assets podem estar: o jogo, os mapas oficiais (que
// trazem itens próprios) e o conteúdo do Workshop já baixado.
function pastasDeAssets(unturnedPath) {
  const cand = [
    path.join(unturnedPath, 'Bundles', 'Items'),
    path.join(unturnedPath, 'Bundles', 'Objects'),
    path.join(unturnedPath, 'Sandbox'),
    path.join(unturnedPath, 'Workshop', 'Content')
  ];
  return cand.filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

function dedup(linhas) {
  // Mesmo item aparecendo em duas pastas (jogo + Workshop): fica o
  // primeiro, que é o do jogo. Chave por id quando existe, senão
  // pelo nome — mod sem ID numérico ainda entra.
  const vistos = new Set();
  const out = [];
  for (const l of linhas) {
    const chave = l.id ? 'id:' + l.id : 'n:' + String(l.name).toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(l);
  }
  return out;
}

let cacheDir = null;
function init(userDataPath) {
  cacheDir = path.join(userDataPath, 'raid');
  fs.mkdirSync(path.join(cacheDir, 'icons'), { recursive: true });
  return cacheDir;
}

function arquivoCache() { return path.join(cacheDir, 'catalog.json'); }

function lerCache() {
  try { return JSON.parse(fs.readFileSync(arquivoCache(), 'utf-8')); } catch { return null; }
}

function gravarCache(cat) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(arquivoCache() + '.tmp', JSON.stringify(cat), 'utf-8');
    fs.renameSync(arquivoCache() + '.tmp', arquivoCache());
  } catch { /* cache é otimização, não pode derrubar nada */ }
  return cat;
}

// Catálogo de reserva: o mínimo para a tela funcionar sem o jogo
// instalado. Vem de arquivo, não do código, justamente para poder
// ser corrigido sem recompilar.
function fallback() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'raidFallback.json'), 'utf-8'));
    return { source: 'fallback', scannedAt: 0, alvos: j.alvos || [], ferramentas: j.ferramentas || [] };
  } catch {
    return { source: 'none', scannedAt: 0, alvos: [], ferramentas: [] };
  }
}

// Catálogo pronto para a tela. `forcar` refaz a varredura mesmo com
// cache válido (botão "reler do jogo").
function catalogo(unturnedPath, { forcar = false } = {}) {
  const pastas = unturnedPath ? pastasDeAssets(unturnedPath) : [];
  if (!pastas.length) {
    const c = lerCache();
    // Cache serve quando NÃO foi pedida instalação nenhuma (o app
    // ainda não sabe onde o jogo está) ou quando é o cache DAQUELA
    // instalação. Entregar o catálogo de outra pasta seria mentir
    // com números que parecem certos.
    const serve = c && c.alvos && c.alvos.length && (!unturnedPath || c.path === unturnedPath);
    if (serve) return c;
    return unturnedPath ? { ...fallback(), triedPath: unturnedPath } : fallback();
  }

  if (!forcar) {
    const c = lerCache();
    // O cache só vale para a MESMA instalação. Trocar de pasta do
    // jogo (ou instalar um mod novo) tem que reler.
    if (c && c.path === unturnedPath && Date.now() - (c.scannedAt || 0) < 7 * 24 * 3600 * 1000) return c;
  }

  const alvos = [], ferramentas = [];
  for (const p of pastas) {
    const r = varrer(p);
    alvos.push(...r.alvos);
    ferramentas.push(...r.ferramentas);
  }
  const cat = {
    source: 'game',
    path: unturnedPath,
    scannedAt: Date.now(),
    alvos: dedup(alvos).sort((a, b) => a.name.localeCompare(b.name)),
    ferramentas: dedup(ferramentas).sort((a, b) => a.name.localeCompare(b.name))
  };
  // Instalação encontrada mas nada lido (pasta incompleta): melhor a
  // tabela de reserva do que uma tela vazia sem explicação.
  if (!cat.alvos.length) return { ...fallback(), triedPath: unturnedPath };
  return gravarCache(cat);
}

// ------------------------------------------------------------
// Ícones
//
// Os ícones do jogo moram dentro de bundles .unity3d, que não dá
// para ler sem o Unity. A saída é a imagem pública — e a chave dela
// é o GUID, que o próprio .dat local já traz na primeira linha:
//
//     GUID 8d0b21995b084db3a91bb7a75d777f75
//     Type Barricade
//     ID 378
//
// Então NÃO existe consulta de "qual é o ícone deste item": a URL
// se monta a partir do arquivo que já lemos. Isso vale inclusive
// para item de mod, que tem GUID próprio (se o autor publicou o
// ícone no mesmo CDN; se não, cai no emoji).
//
// O ID numérico é o plano B, para asset antigo sem GUID.
//
// Cada ícone é baixado UMA vez e fica em disco: funciona offline
// daí em diante e não bate no site a cada abertura da tela.
// ------------------------------------------------------------
const ICONE_GUID = 'https://cdn.restoremonarchy.com/unturned/assets/vanilla/items/';
const ICONE_ID   = 'https://unturnedhub.com/img/';

// Nome de arquivo seguro. O GUID vem de um .dat que pode ter sido
// editado à mão — sem esta faxina, um "../../" viraria escrita fora
// da pasta do app.
function chaveIcone({ guid, id }) {
  const g = String(guid || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (g.length === 32) return { nome: g + '.webp', url: ICONE_GUID + g + '.webp' };
  const n = Number(id);
  if (Number.isInteger(n) && n > 0) return { nome: n + '.png', url: ICONE_ID + n + '.png' };
  return null;
}

function caminhoIcone(ref) {
  const k = chaveIcone(typeof ref === 'object' && ref ? ref : { id: ref });
  return k ? path.join(cacheDir, 'icons', k.nome) : null;
}

function iconeLocal(ref) {
  const p = caminhoIcone(ref);
  return p && fs.existsSync(p) ? p : null;
}

function baixar(url, destino) {
  const https = require('https');
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      // Redirecionamento do CDN: seguimos um salto, não mais — uma
      // corrente de redirects é jeito conhecido de prender cliente.
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const destinoUrl = new URL(res.headers.location, url).toString();
        https.get(destinoUrl, { timeout: 8000 }, (r2) => {
          if (r2.statusCode !== 200) { r2.resume(); resolve(null); return; }
          coletar(r2, destino, resolve, req);
        }).on('error', () => resolve(null));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      coletar(res, destino, resolve, req);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function coletar(res, destino, resolve, req) {
  const pedacos = [];
  let bytes = 0;
  res.on('data', (d) => {
    bytes += d.length;
    // Teto de 512 KB: ícone de item não chega perto disso, e sem o
    // limite uma resposta errada encheria o disco.
    if (bytes > 512 * 1024) { try { req.destroy(); } catch {} resolve(null); return; }
    pedacos.push(d);
  });
  res.on('end', () => {
    try {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.concat(pedacos));
      resolve(destino);
    } catch { resolve(null); }
  });
  res.on('error', () => resolve(null));
}

async function baixarIcone(ref) {
  const alvo = typeof ref === 'object' && ref ? ref : { id: ref };
  const k = chaveIcone(alvo);
  if (!k) return null;
  const destino = path.join(cacheDir, 'icons', k.nome);
  if (fs.existsSync(destino)) return destino;

  const ok = await baixar(k.url, destino);
  if (ok) return ok;

  // GUID falhou (item de mod, CDN fora do ar): tenta o ID numérico
  // antes de desistir. Um emoji é melhor do que nada, mas um ícone
  // é melhor do que um emoji.
  if (k.url.startsWith(ICONE_GUID) && Number(alvo.id) > 0) {
    const k2 = chaveIcone({ id: alvo.id });
    if (k2) return baixar(k2.url, path.join(cacheDir, 'icons', k2.nome));
  }
  return null;
}

module.exports = {
  init, catalogo, varrer, parseDat, armorTierPadrao,
  iconeLocal, baixarIcone, caminhoIcone, chaveIcone, fallback
};
