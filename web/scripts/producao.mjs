// Roda o app em modo de produção nesta máquina, com os dados de sempre
// (web/data, .env da raiz): compila o servidor standalone numa cópia limpa
// (desktop/scripts/preparar.mjs --so-web — `next build` direto em web/
// estoura a memória com os vídeos de data/) e o sobe em 127.0.0.1:3000.
//   npm run producao            compila e sobe
//   npm run producao -- --sem-build   só sobe o último build

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.resolve(WEB, "..");
const SERVIDOR = path.join(RAIZ, "desktop", "recursos", "web", "server.js");

if (!process.argv.includes("--sem-build") || !fs.existsSync(SERVIDOR)) {
  execFileSync(process.execPath, [path.join(RAIZ, "desktop", "scripts", "preparar.mjs"), "--so-web"], { stdio: "inherit" });
}

const porta = process.env.PORT ?? "3000";
const proc = spawn(process.execPath, [SERVIDOR], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: porta,
    HOSTNAME: "127.0.0.1",
    CONTADOR_DADOS: process.env.CONTADOR_DADOS ?? path.join(WEB, "data"),
    CONTADOR_RAIZ: RAIZ,
    CONTADOR_ENV: process.env.CONTADOR_ENV ?? path.join(RAIZ, ".env"),
  },
});
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => proc.kill(sinal));
proc.on("exit", (c) => process.exit(c ?? 0));
