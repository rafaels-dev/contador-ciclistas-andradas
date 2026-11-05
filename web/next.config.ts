import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The .env (OPENROUTER_API_KEY etc.) lives at the repository root, shared
// with the Python worker — load it from there besides the standard web/.env*.
loadEnvConfig(path.resolve(__dirname, ".."));

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // self-contained server in .next/standalone — what the desktop app embeds
  // (desktop/scripts/prepare.mjs). Does not change `next dev`.
  output: "standalone",
  // data (videos, database) is read at run time, never bundled
  outputFileTracingExcludes: { "*": ["data/**", "scripts/**", "evals/**"] },
  cacheComponents: true,
  // no partialPrefetching: in the production build (Next 16.4) it stopped
  // server actions' refresh() from updating the screen (it worked in `next dev`)
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

export default withNextIntl(nextConfig);
