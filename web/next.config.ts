import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// O .env (OPENROUTER_API_KEY etc.) fica na raiz do repositório, compartilhado
// com o worker Python — carrega de lá além do web/.env* padrão.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  // servidor autocontido em .next/standalone — é o que o app desktop embute
  // (desktop/scripts/preparar.mjs). Não muda o `next dev`.
  output: "standalone",
  // os dados (vídeos, banco) são lidos em tempo de execução, nunca empacotados
  outputFileTracingExcludes: { "*": ["data/**", "scripts/**"] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
