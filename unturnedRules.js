// ============================================================
// unturnedRules.js — Interpretação das "rules" (A2S_RULES) que
// o servidor de Unturned publica, transformando o dicionário
// bruto { chave: valor } numa estrutura amigável para exibir.
//
// IMPORTANTE (honestidade de engenharia): os NOMES exatos das
// rules do Unturned mudam entre versões do jogo e entre plugins
// (RocketMod/OpenMod). Por isso este módulo:
//   1) NUNCA descarta nada — sempre devolve `raw` com TODAS as
//      rules, para um "ver tudo" na tela ser a fonte da verdade;
//   2) Extrai os campos conhecidos por HEURÍSTICA (case-insensitive,
//      "contém"), o que continua funcionando mesmo se um prefixo
//      mudar de nome;
//   3) Reagrupa valores que o Unturned quebra em várias rules
//      (padrão "<Base>_Line_00", "<Base>_Line_01", ...).
// ============================================================

// Reagrupa "<Base>_Line_N" -> "<Base>" concatenado, na ordem do índice.
// Remove os fragmentos e os "<Base>_Count" do dicionário resultante.
function dechunk(rules) {
  const out = {};
  const chunks = {}; // base -> [{ i, value }]
  const countKeys = new Set();

  for (const [key, value] of Object.entries(rules)) {
    const m = key.match(/^(.*?)[ _-]?Line[ _-]?(\d+)$/i);
    if (m) {
      const base = m[1];
      const idx = parseInt(m[2], 10);
      (chunks[base] = chunks[base] || []).push({ i: idx, value });
      continue;
    }
    if (/[ _-]?Count$/i.test(key)) {
      countKeys.add(key);
    }
    out[key] = value;
  }

  for (const [base, parts] of Object.entries(chunks)) {
    parts.sort((a, b) => a.i - b.i);
    out[base] = parts.map((p) => p.value).join('');
    // remove o "<base>Count"/"<base>_Count" correspondente, se existir
    for (const ck of countKeys) {
      if (ck.replace(/[ _-]?Count$/i, '') === base) delete out[ck];
    }
  }
  return out;
}

// Primeiro valor cuja CHAVE casa com algum dos padrões (regex ou string "contém").
function pick(rules, patterns) {
  const entries = Object.entries(rules);
  for (const pat of patterns) {
    for (const [k, v] of entries) {
      const ok = pat instanceof RegExp ? pat.test(k) : k.toLowerCase().includes(String(pat).toLowerCase());
      if (ok && v != null && String(v).trim() !== '') return String(v);
    }
  }
  return null;
}

// Extrai IDs de itens do Workshop (arquivos publicados na Steam têm
// IDs numéricos longos, tipicamente 9–10 dígitos). Varre chaves que
// pareçam de mods e, como rede de segurança, também o texto de todos
// os valores. Retorna lista única de IDs (strings).
function extractWorkshop(rules) {
  const ids = new Set();

  const looksLikeModKey = (k) => /workshop|\bmod(s)?\b|steamid|filelist|content/i.test(k);
  const grabIds = (text, minDigits) => {
    const re = new RegExp(`\\b\\d{${minDigits},12}\\b`, 'g');
    const found = String(text).match(re);
    if (found) found.forEach((id) => ids.add(id));
  };

  // 1) chaves que parecem de mods -> confiança alta (aceita IDs a partir de 7 dígitos)
  for (const [k, v] of Object.entries(rules)) {
    if (looksLikeModKey(k)) grabIds(v, 7);
  }
  // 2) se nada foi achado, varre tudo, mas exige IDs longos (9+ dígitos)
  //    para não confundir com portas, appid, versões, etc.
  if (ids.size === 0) {
    for (const v of Object.values(rules)) grabIds(v, 9);
  }

  return [...ids];
}

// Extrai a URL do ÍCONE público do servidor. No Unturned isso vem da
// config "Browser_Icon" (o admin define um link pra um PNG), e costuma
// ser publicado nas rules. Aceita qualquer chave que contenha
// icon/thumbnail/logo cujo valor seja uma URL http(s) de imagem.
function extractIconUrl(rules) {
  const isImgUrl = (v) => /^https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S*)?$/i.test(String(v).trim());
  // 1) chaves que "parecem" de ícone e apontam pra uma imagem
  for (const [k, v] of Object.entries(rules)) {
    if (/icon|thumbnail|logo|avatar/i.test(k) && isImgUrl(v)) return String(v).trim();
  }
  // 2) rede de segurança: chave de ícone com qualquer URL http(s)
  for (const [k, v] of Object.entries(rules)) {
    if (/icon|thumbnail|logo|avatar/i.test(k) && /^https?:\/\/\S+$/i.test(String(v).trim())) {
      return String(v).trim();
    }
  }
  return null;
}

// Procura um valor de intervalo de airdrop na config publicada (em
// segundos). Muitos servidores não publicam isso; retorna null se
// não achar, e o app cai para o valor manual definido pelo usuário.
function extractAirdropSeconds(rules) {
  for (const [k, v] of Object.entries(rules)) {
    if (/airdrop/i.test(k)) {
      const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// Ponto de entrada: recebe as rules cruas + o info do A2S_INFO e
// devolve { raw, dechunked, fields, mods, airdropSeconds }.
function interpret(rawRules, info = {}) {
  const raw = rawRules || {};
  const dechunked = dechunk(raw);

  const fields = {
    map:          info.map || pick(dechunked, [/^map$/i, 'map']),
    description:  pick(dechunked, [/browser.*desc/i, /^desc/i, 'description']),
    rocketMod:    pick(dechunked, [/rocket/i]),
    pluginCount:  pick(dechunked, [/plugin.*count/i, /plugins/i]),
    gameMode:     pick(dechunked, [/gamemode/i, /mode/i]),
    cameraMode:   pick(dechunked, [/camera/i, /perspective/i]),
    pvp:          pick(dechunked, [/\bpvp\b/i, /pve/i]),
    version:      info.version || pick(dechunked, [/^unturned$/i, /version/i]),
  };

  const workshopIds = extractWorkshop(dechunked);
  const mods = workshopIds.map((id) => ({
    id,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
  }));

  const airdropSeconds = extractAirdropSeconds(dechunked);
  const iconUrl = extractIconUrl(dechunked);

  // Rules "restantes" para o viewer bruto (ordenadas por chave)
  const rawSorted = Object.fromEntries(
    Object.entries(dechunked).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    fields,
    mods,
    modCount: mods.length,
    airdropSeconds,
    iconUrl,
    raw: rawSorted,
    rawCount: Object.keys(rawSorted).length
  };
}

module.exports = { interpret, dechunk, pick, extractWorkshop, extractAirdropSeconds, extractIconUrl };
