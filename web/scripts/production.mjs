// Runs the app in production mode on this machine, with the usual data
// (web/data, the root .env): builds the standalone server in a clean copy
// (desktop/scripts/prepare.mjs --web-only — `next build` straight in web/
// runs out of memory with the videos in data/) and starts it on 127.0.0.1:3000.
//   npm run production                  builds and starts
//   npm run production -- --no-build    only starts the last build

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const SERVER = path.join(ROOT, "desktop", "resources", "web", "server.js");

if (!process.argv.includes("--no-build") || !fs.existsSync(SERVER)) {
  execFileSync(process.execPath, [path.join(ROOT, "desktop", "scripts", "prepare.mjs"), "--web-only"], { stdio: "inherit" });
}

const port = process.env.PORT ?? "3000";
const proc = spawn(process.execPath, [SERVER], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HOSTNAME: "127.0.0.1",
    TRAFFIC_COUNTER_DATA: process.env.TRAFFIC_COUNTER_DATA ?? path.join(WEB, "data"),
    TRAFFIC_COUNTER_ROOT: ROOT,
    TRAFFIC_COUNTER_ENV: process.env.TRAFFIC_COUNTER_ENV ?? path.join(ROOT, ".env"),
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => proc.kill(signal));
proc.on("exit", (c) => process.exit(c ?? 0));
