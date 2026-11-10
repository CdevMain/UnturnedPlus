// ============================================================
// mapSync.js — sincronização das imagens de mapas (Map.png/Chart.png)
// da instalação local do Unturned para a pasta de dados do app.
//
// Sem dependência do Electron, para poder ser testado isoladamente.
// Copia mapas oficiais E do Workshop, detecta mapas novos e recopia
// quando a imagem muda (comparando tamanho + mtime).
// ============================================================
const fs = require('fs');
const path = require('path');

// Raízes de onde vêm os mapas: a pasta "Maps" oficial + a pasta de mapas
// do Workshop da Steam (mapas custom que os servidores realmente usam).
function mapSourceRoots(installPath) {
  const roots = [];
  const official = path.join(installPath, 'Maps');
  if (fs.existsSync(official)) roots.push(official);
  // .../steamapps/common/Unturned -> .../steamapps/workshop/content/304930
  const workshop = path.resolve(installPath, '..', '..', 'workshop', 'content', '304930');
  if (fs.existsSync(workshop)) roots.push(workshop);
  return roots;
}

// Varre uma raiz até certa profundidade procurando PASTAS que contenham
// Map.png ou Chart.png diretamente. Cobre os mapas oficiais e a estrutura
// variável dos mapas do Workshop.
function collectMapDirs(root, maxDepth = 3) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const hasImg = entries.some(e => e.isFile() && (e.name === 'Map.png' || e.name === 'Chart.png'));
    if (hasImg) { found.push({ name: path.basename(dir), dir }); return; } // não desce mais neste ramo
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

// Copia um arquivo só se for novo ou tiver mudado (tamanho/mtime).
function copyIfChanged(from, to) {
  try {
    const s = fs.statSync(from);
    if (fs.existsSync(to)) {
      const d = fs.statSync(to);
      if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1000) return false; // igual
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    try { fs.utimesSync(to, s.atime, s.mtime); } catch {}
    return true;
  } catch { return false; }
}

// Sincroniza todos os mapas encontrados para destDir.
// Retorna { added, updated, unchanged, total }.
function sync(installPath, destDir) {
  const roots = mapSourceRoots(installPath);
  if (!roots.length) throw new Error('Nenhuma pasta de mapas encontrada.');

  const added = [], updated = [], unchanged = [];
  const seen = new Set();

  for (const root of roots) {
    for (const { name, dir } of collectMapDirs(root)) {
      if (seen.has(name)) continue; // evita duplicar por nome entre raízes
      seen.add(name);
      const dst = path.join(destDir, name);
      const existedBefore = fs.existsSync(dst);
      let changed = false;
      for (const img of ['Map.png', 'Chart.png']) {
        const from = path.join(dir, img);
        if (fs.existsSync(from) && copyIfChanged(from, path.join(dst, img))) changed = true;
      }
      if (!existedBefore) added.push(name);
      else if (changed) updated.push(name);
      else unchanged.push(name);
    }
  }
  return { added, updated, unchanged, total: added.length + updated.length + unchanged.length };
}

module.exports = { sync, mapSourceRoots, collectMapDirs, copyIfChanged };
