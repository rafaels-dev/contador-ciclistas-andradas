// User data folder. Up to 0.0.7 the product was "Contador de Tráfego": the
// folder (named after the product), and the names inside it, were Portuguese.
// No Electron here, so the tests run with plain Node (data-folder.test.cjs).

const fs = require("node:fs");
const path = require("node:path");

// names inside the folder: before 0.0.8 → now
const RENAMED = [["dados", "data"], ["servidor.log", "server.log"], ["janela.json", "window.json"]];

/**
 * Moves the old folder to "Traffic Counter" on the first start; if the move
 * fails (a file in use), keeps using the old folder — nothing is lost. The
 * engine venv keeps its folder (motor/): moving a Python environment can break
 * it, and reinstalling is 3 GB. Returns the folder to use.
 */
function useDataFolder(appData, suffix = "", log = console.error) {
  const target = path.join(appData, `Traffic Counter${suffix}`);
  const old = path.join(appData, `Contador de Tráfego${suffix}`);
  let dir = target;
  if (!fs.existsSync(target) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, target);
    } catch (e) {
      log(`[data] could not move ${old}: ${e?.message ?? e}`);
      dir = old;
    }
  }
  for (const [from, to] of RENAMED) {
    const a = path.join(dir, from);
    const b = path.join(dir, to);
    try {
      if (fs.existsSync(a) && !fs.existsSync(b)) fs.renameSync(a, b);
    } catch (e) {
      log(`[data] could not rename ${from}: ${e?.message ?? e}`);
    }
  }
  return dir;
}

/** `name` inside the folder — or its old name, when that one stayed (rename failed). */
function dataPath(dir, name, legacy) {
  const a = path.join(dir, name);
  const b = path.join(dir, legacy);
  return fs.existsSync(b) && !fs.existsSync(a) ? b : a;
}

/** Saved window size/position; window.json from before 0.0.8 says "maximizado". */
function readWindowState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...s, maximized: s.maximized ?? s.maximizado ?? false };
  } catch {
    return { width: 1440, height: 900, maximized: false };
  }
}

module.exports = { useDataFolder, dataPath, readWindowState };
