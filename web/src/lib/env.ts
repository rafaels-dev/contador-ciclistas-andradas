import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths";

/**
 * App configuration file (OPENROUTER_API_KEY etc.): TRAFFIC_COUNTER_ENV in
 * the desktop app (user data folder, editable in Settings), otherwise the
 * .env at the repository root.
 */
export const ENV_FILE = process.env.TRAFFIC_COUNTER_ENV ?? path.join(REPO_ROOT, ".env");

/** Variables renamed when the code moved to English (old config files keep working). */
const RENAMED: Record<string, string> = {
  OPENROUTER_CONCORRENCIA: "OPENROUTER_CONCURRENCY",
  OPENROUTER_DICA_YOLO: "OPENROUTER_YOLO_HINT",
  CONTADOR_ARQUIVOS_LOCAIS: "TRAFFIC_COUNTER_LOCAL_FILES",
};

/**
 * Loads the file into the server process. next.config's loadEnvConfig does
 * not reach the process that runs routes/actions under `next dev`. Variables
 * already set in the environment take precedence.
 */
if (fs.existsSync(/* turbopackIgnore: true */ ENV_FILE)) {
  for (const line of fs.readFileSync(/* turbopackIgnore: true */ ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const name = RENAMED[m[1]] ?? m[1];
    if (name in process.env) continue;
    process.env[name] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** Writes (or replaces) a variable in the configuration file and in the process. */
export function writeVariable(name: string, value: string): void {
  const lines = fs.existsSync(/* turbopackIgnore: true */ ENV_FILE) ? fs.readFileSync(/* turbopackIgnore: true */ ENV_FILE, "utf8").split(/\r?\n/) : [];
  const entry = `${name}=${value}`;
  const i = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (i >= 0) lines[i] = entry;
  else lines.push(entry);
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, lines.filter((l, j) => l || j < lines.length - 1).join("\n") + "\n", { mode: 0o600 });
  process.env[name] = value;
}
