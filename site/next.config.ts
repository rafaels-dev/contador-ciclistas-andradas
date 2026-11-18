import type { NextConfig } from "next";

// Static export: the site is plain files, served by Cloudflare Pages from `out/`.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
