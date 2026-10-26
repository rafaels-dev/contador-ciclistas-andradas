// Builds desktop/resources/ for electron-builder:
//   web/     standalone Next server (+ .next/static and public)
//   engine/  Python worker, config.py, requirements.txt and the YOLO weights
//   bin/     uv for the platform (installs the engine's Python on the first run)
//
// Next is built in a clean copy of web/ (no data/ or .next/): besides being
// reproducible, Turbopack does not scan the videos in data/ (tens of GB).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(DESKTOP, "..");
const STAGING = path.join(DESKTOP, ".staging");
const RESOURCES = path.join(DESKTOP, "resources");
const WIN = process.platform === "win32";

// --web-only: only the Next server (used by `npm run production` in web/)
const WEB_ONLY = process.argv.includes("--web-only");

// uv version downloaded when there is none on the PATH (CI)
const UV_VERSION = "0.12.1";

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: WIN });
}

function copy(from, to, filter) {
  fs.cpSync(from, to, { recursive: true, filter, dereference: true });
}

// 1. Next server
const staging = path.join(STAGING, "web");
fs.rmSync(STAGING, { recursive: true, force: true });
const skip = new Set(["data", ".next", "node_modules", "tsconfig.tsbuildinfo", "evals"]);
copy(path.join(ROOT, "web"), staging, (src) => !skip.has(path.basename(src)) || path.dirname(src) !== path.join(ROOT, "web"));
run("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"], staging);
run("npx", ["next", "build"], staging);

const web = path.join(RESOURCES, "web");
fs.rmSync(WEB_ONLY ? web : RESOURCES, { recursive: true, force: true });
copy(path.join(staging, ".next", "standalone"), web);
copy(path.join(staging, ".next", "static"), path.join(web, ".next", "static"));
if (fs.existsSync(path.join(staging, "public"))) copy(path.join(staging, "public"), path.join(web, "public"));

if (WEB_ONLY) {
  console.log(`\nserver ready in ${web}`);
  process.exit(0);
}

// 2. engine (what worker/ uses at run time). The bicycle fine-tune (best.pt,
// 6 MB) is in git; yolov8n.pt comes from Ultralytics when there is no copy at
// the root (BICYCLE_WEIGHTS_URL is still an alternative to the file)
const WEIGHTS = {
  "yolov8n.pt": "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt",
  [path.join("runs", "ft_blur", "weights", "best.pt")]: process.env.BICYCLE_WEIGHTS_URL,
};
const engine = path.join(RESOURCES, "engine");
copy(path.join(ROOT, "worker"), path.join(engine, "worker"), (src) => !src.includes("__pycache__"));
for (const f of ["config.py", "requirements.txt", ...Object.keys(WEIGHTS)]) {
  const from = path.join(ROOT, f);
  const to = path.join(engine, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
  else if (WEIGHTS[f]) {
    console.log(`downloading ${f}`);
    const r = await fetch(WEIGHTS[f]);
    if (!r.ok) throw new Error(`Could not download ${f}: HTTP ${r.status}`);
    fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  } else throw new Error(`${f} is missing at the repository root (or set BICYCLE_WEIGHTS_URL).`);
}

// 3. uv
const bin = path.join(RESOURCES, "bin");
fs.mkdirSync(bin, { recursive: true });
const uvName = WIN ? "uv.exe" : "uv";
let local = null;
try {
  local = execFileSync(WIN ? "where" : "which", ["uv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
} catch {
  // no uv on the PATH: downloaded below
}
if (local && fs.existsSync(local) && !process.env.CI) {
  fs.copyFileSync(local, path.join(bin, uvName));
} else {
  const target = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  }[`${process.platform}-${process.arch}`];
  const ext = WIN ? "zip" : "tar.gz";
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.${ext}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uv-"));
  const archive = path.join(tmp, `uv.${ext}`);
  console.log(`downloading ${url}`);
  fs.writeFileSync(archive, Buffer.from(await (await fetch(url)).arrayBuffer()));
  run("tar", ["-xf", archive, "-C", tmp], tmp);
  const found = fs.readdirSync(tmp, { recursive: true }).find((f) => path.basename(String(f)) === uvName);
  fs.copyFileSync(path.join(tmp, String(found)), path.join(bin, uvName));
}
if (!WIN) fs.chmodSync(path.join(bin, uvName), 0o755);

console.log(`\nresources ready in ${RESOURCES}`);
