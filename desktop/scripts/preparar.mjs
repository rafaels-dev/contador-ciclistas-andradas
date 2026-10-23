// Monta desktop/recursos/ para o electron-builder:
//   web/    servidor Next standalone (+ .next/static e public)
//   motor/  worker Python, config.py, requirements.txt e os pesos do YOLO
//   bin/    uv da plataforma (instala o Python do motor na 1ª execução)
//
// O Next é compilado numa cópia limpa de web/ (sem data/ nem .next/): além de
// reprodutível, o Turbopack não varre os vídeos de data/ (dezenas de GB).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.resolve(DESKTOP, "..");
const PREPARO = path.join(DESKTOP, ".preparo");
const RECURSOS = path.join(DESKTOP, "recursos");
const WIN = process.platform === "win32";

// --so-web: só o servidor Next (usado por `npm run producao` em web/)
const SO_WEB = process.argv.includes("--so-web");

// versão do uv baixada quando não há um no PATH (CI)
const VERSAO_UV = "0.12.1";

function rodar(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: WIN });
}

function copiar(de, para, filtro) {
  fs.cpSync(de, para, { recursive: true, filter: filtro, dereference: true });
}

// 1. servidor Next
const staging = path.join(PREPARO, "web");
fs.rmSync(PREPARO, { recursive: true, force: true });
const ignorar = new Set(["data", ".next", "node_modules", "tsconfig.tsbuildinfo"]);
copiar(path.join(RAIZ, "web"), staging, (src) => !ignorar.has(path.basename(src)) || path.dirname(src) !== path.join(RAIZ, "web"));
rodar("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"], staging);
rodar("npx", ["next", "build"], staging);

const web = path.join(RECURSOS, "web");
fs.rmSync(SO_WEB ? web : RECURSOS, { recursive: true, force: true });
copiar(path.join(staging, ".next", "standalone"), web);
copiar(path.join(staging, ".next", "static"), path.join(web, ".next", "static"));
if (fs.existsSync(path.join(staging, "public"))) copiar(path.join(staging, "public"), path.join(web, "public"));

if (SO_WEB) {
  console.log(`\nservidor pronto em ${web}`);
  process.exit(0);
}

// 2. motor (o que worker/ usa em tempo de execução). Os pesos não vão para o
// git: no CI vêm de URLs (o fine-tune de bicicletas, de um release do projeto)
const PESOS = {
  "yolov8n.pt": "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt",
  [path.join("runs", "ft_blur", "weights", "best.pt")]: process.env.PESOS_BICICLETAS_URL,
};
const motor = path.join(RECURSOS, "motor");
copiar(path.join(RAIZ, "worker"), path.join(motor, "worker"), (src) => !src.includes("__pycache__"));
for (const f of ["config.py", "requirements.txt", ...Object.keys(PESOS)]) {
  const de = path.join(RAIZ, f);
  const para = path.join(motor, f);
  fs.mkdirSync(path.dirname(para), { recursive: true });
  if (fs.existsSync(de)) fs.copyFileSync(de, para);
  else if (PESOS[f]) {
    console.log(`baixando ${f}`);
    const r = await fetch(PESOS[f]);
    if (!r.ok) throw new Error(`Não consegui baixar ${f}: HTTP ${r.status}`);
    fs.writeFileSync(para, Buffer.from(await r.arrayBuffer()));
  } else throw new Error(`Falta ${f} na raiz do repositório (ou defina PESOS_BICICLETAS_URL).`);
}

// 3. uv
const bin = path.join(RECURSOS, "bin");
fs.mkdirSync(bin, { recursive: true });
const nomeUv = WIN ? "uv.exe" : "uv";
let local = null;
try {
  local = execFileSync(WIN ? "where" : "which", ["uv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
} catch {
  // sem uv no PATH: baixa abaixo
}
if (local && fs.existsSync(local) && !process.env.CI) {
  fs.copyFileSync(local, path.join(bin, nomeUv));
} else {
  const alvo = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  }[`${process.platform}-${process.arch}`];
  const ext = WIN ? "zip" : "tar.gz";
  const url = `https://github.com/astral-sh/uv/releases/download/${VERSAO_UV}/uv-${alvo}.${ext}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uv-"));
  const pacote = path.join(tmp, `uv.${ext}`);
  console.log(`baixando ${url}`);
  fs.writeFileSync(pacote, Buffer.from(await (await fetch(url)).arrayBuffer()));
  rodar("tar", ["-xf", pacote, "-C", tmp], tmp);
  const achado = fs.readdirSync(tmp, { recursive: true }).find((f) => path.basename(String(f)) === nomeUv);
  fs.copyFileSync(path.join(tmp, String(achado)), path.join(bin, nomeUv));
}
if (!WIN) fs.chmodSync(path.join(bin, nomeUv), 0o755);

console.log(`\nrecursos prontos em ${RECURSOS}`);
