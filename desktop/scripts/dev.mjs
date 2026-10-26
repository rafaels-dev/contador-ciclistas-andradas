// `npm run dev`: opens the app window over a server already running
// (http://127.0.0.1:3000 or DEV_URL). In its own script because the
// package.json VAR=value syntax does not work in the Windows cmd.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const url = process.env.TRAFFIC_COUNTER_DESKTOP_URL ?? process.env.DEV_URL ?? "http://127.0.0.1:3000";
const proc = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, TRAFFIC_COUNTER_DESKTOP_URL: url } });
proc.on("exit", (c) => process.exit(c ?? 0));
