// node --test (no Electron): the data folder of versions up to 0.0.7 keeps working.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, describe, it } = require("node:test");
const { dataPath, readWindowState, useDataFolder } = require("./data-folder.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-data-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function appData(name, files) {
  const dir = path.join(tmp, name);
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

const OLD = {
  "Contador de Tráfego/config.env": "OPENROUTER_API_KEY=k\n",
  "Contador de Tráfego/dados/app.db": "db",
  "Contador de Tráfego/servidor.log": "log",
  "Contador de Tráfego/janela.json": '{"width":800,"height":600,"maximizado":true}',
  "Contador de Tráfego/motor/pyvenv.cfg": "venv",
};

describe("useDataFolder", () => {
  it("moves the 0.0.7 folder to Traffic Counter, with the names inside", () => {
    const root = appData("a", OLD);
    const dir = useDataFolder(root);
    assert.equal(dir, path.join(root, "Traffic Counter"));
    assert.equal(fs.existsSync(path.join(root, "Contador de Tráfego")), false);
    assert.equal(fs.readFileSync(path.join(dir, "config.env"), "utf8"), "OPENROUTER_API_KEY=k\n");
    assert.equal(fs.readFileSync(path.join(dir, "data", "app.db"), "utf8"), "db");
    assert.equal(fs.existsSync(path.join(dir, "server.log")), true);
    assert.equal(fs.existsSync(path.join(dir, "window.json")), true);
    // the venv is not moved: the server is pointed at motor/
    assert.equal(fs.existsSync(path.join(dir, "motor", "pyvenv.cfg")), true);
    assert.equal(dataPath(dir, "engine", "motor"), path.join(dir, "motor"));
    assert.equal(readWindowState(path.join(dir, "window.json")).maximized, true);
  });

  it("keeps the old folder when it cannot be moved, and still finds everything", () => {
    const root = appData("b", OLD);
    const rename = fs.renameSync;
    fs.renameSync = (a, b) => {
      if (a.endsWith("Contador de Tráfego")) throw new Error("EBUSY");
      return rename(a, b);
    };
    const logs = [];
    let dir;
    try {
      dir = useDataFolder(root, "", (m) => logs.push(m));
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(dir, path.join(root, "Contador de Tráfego"));
    assert.match(logs[0], /could not move/);
    assert.equal(fs.existsSync(path.join(dir, "config.env")), true);
    assert.equal(fs.existsSync(path.join(dir, "data", "app.db")), true);
  });

  it("finds the old names inside when they could not be renamed", () => {
    const dir = appData("c", { "dados/app.db": "db", "janela.json": '{"maximizado":false}' });
    assert.equal(dataPath(dir, "data", "dados"), path.join(dir, "dados"));
    assert.equal(dataPath(dir, "window.json", "janela.json"), path.join(dir, "janela.json"));
    assert.equal(readWindowState(path.join(dir, "janela.json")).maximized, false);
  });

  it("does nothing when the new folder already exists", () => {
    const root = appData("d", { ...OLD, "Traffic Counter/data/app.db": "new" });
    const dir = useDataFolder(root);
    assert.equal(fs.readFileSync(path.join(dir, "data", "app.db"), "utf8"), "new");
    assert.equal(fs.existsSync(path.join(root, "Contador de Tráfego", "dados", "app.db")), true);
  });

  it("keeps development data apart (suffix)", () => {
    const root = appData("e", { "Contador de Tráfego (dev)/dados/app.db": "dev" });
    assert.equal(useDataFolder(root, " (dev)"), path.join(root, "Traffic Counter (dev)"));
  });

  it("a missing window file gives the default size", () => {
    assert.deepEqual(readWindowState(path.join(tmp, "none.json")), { width: 1440, height: 900, maximized: false });
  });
});
