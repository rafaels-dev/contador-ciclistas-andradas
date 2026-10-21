import fs from "node:fs";
import path from "node:path";
import { RAIZ_REPO } from "./paths";

/**
 * Carrega o .env da raiz do repositório (OPENROUTER_API_KEY etc.) no
 * processo do servidor. O loadEnvConfig do next.config não alcança o
 * processo que executa rotas/actions no `next dev`. Variáveis já definidas
 * no ambiente têm precedência.
 */
const arquivo = path.join(RAIZ_REPO, ".env");
if (fs.existsSync(arquivo)) {
  for (const linha of fs.readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
