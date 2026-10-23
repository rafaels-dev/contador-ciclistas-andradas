import fs from "node:fs";
import path from "node:path";
import { RAIZ_REPO } from "./paths";

/**
 * Arquivo de configuração do app (OPENROUTER_API_KEY etc.): CONTADOR_ENV no
 * app desktop (pasta de dados do usuário, editável em Configurações), senão o
 * .env da raiz do repositório.
 */
export const ARQUIVO_ENV = process.env.CONTADOR_ENV ?? path.join(RAIZ_REPO, ".env");

/**
 * Carrega o arquivo no processo do servidor. O loadEnvConfig do next.config
 * não alcança o processo que executa rotas/actions no `next dev`. Variáveis
 * já definidas no ambiente têm precedência.
 */
if (fs.existsSync(/* turbopackIgnore: true */ ARQUIVO_ENV)) {
  for (const linha of fs.readFileSync(/* turbopackIgnore: true */ ARQUIVO_ENV, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** Grava (ou troca) uma variável no arquivo de configuração e no processo. */
export function gravarVariavel(nome: string, valor: string): void {
  const linhas = fs.existsSync(/* turbopackIgnore: true */ ARQUIVO_ENV) ? fs.readFileSync(/* turbopackIgnore: true */ ARQUIVO_ENV, "utf8").split(/\r?\n/) : [];
  const nova = `${nome}=${valor}`;
  const i = linhas.findIndex((l) => new RegExp(`^\\s*${nome}\\s*=`).test(l));
  if (i >= 0) linhas[i] = nova;
  else linhas.push(nova);
  fs.mkdirSync(path.dirname(ARQUIVO_ENV), { recursive: true });
  fs.writeFileSync(ARQUIVO_ENV, linhas.filter((l, j) => l || j < linhas.length - 1).join("\n") + "\n", { mode: 0o600 });
  process.env[nome] = valor;
}
