// `npm run dev`: abre a janela do app sobre um servidor já rodando
// (http://127.0.0.1:3000 ou DEV_URL). Em script próprio porque a sintaxe
// VAR=valor do package.json não funciona no cmd do Windows.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const url = process.env.CONTADOR_DESKTOP_URL ?? process.env.DEV_URL ?? "http://127.0.0.1:3000";
const proc = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, CONTADOR_DESKTOP_URL: url } });
proc.on("exit", (c) => process.exit(c ?? 0));
