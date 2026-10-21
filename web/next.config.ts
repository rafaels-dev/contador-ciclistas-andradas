import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// O .env (OPENROUTER_API_KEY etc.) fica na raiz do repositório, compartilhado
// com o worker Python — carrega de lá além do web/.env* padrão.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
