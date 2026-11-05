import fs from "node:fs";
import path from "node:path";
import { LEGACY_ENV } from "./legacy-env";
import { REPO_ROOT } from "./paths";

/**
 * App configuration file (OPENROUTER_API_KEY etc.): TRAFFIC_COUNTER_ENV in
 * the desktop app (user data folder, editable in Settings), otherwise the
 * .env at the repository root.
 */
export const ENV_FILE = process.env.TRAFFIC_COUNTER_ENV ?? path.join(REPO_ROOT, ".env");

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/**
 * Applies a config file's text to `env`, with the old variable names under
 * the new ones. Variables already set win — the real environment, and the
 * first line of a name (a file can hold the old and the new name).
 */
export function applyEnvText(text: string, env: Record<string, string | undefined>): void {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const name = LEGACY_ENV[m[1]] ?? m[1];
    if (env[name] !== undefined) continue;
    env[name] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/**
 * The config file's text with `name` set to `value`: replaces the line in
 * place — also a line with the variable's old name, so the old value does not
 * come back on the next start — and drops any other line of the variable.
 */
export function setVariableText(text: string, name: string, value: string): string {
  const names = new Set([name, ...Object.keys(LEGACY_ENV).filter((old) => LEGACY_ENV[old] === name)]);
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const entry = `${name}=${value}`;
  let done = false;
  const out: string[] = [];
  for (const l of lines) {
    const m = l.match(LINE);
    if (m && names.has(m[1])) {
      if (!done) out.push(entry);
      done = true;
    } else out.push(l);
  }
  if (!done) out.push(entry);
  return out.join("\n") + "\n";
}

/**
 * Loads the file into the server process. next.config's loadEnvConfig does
 * not reach the process that runs routes/actions under `next dev`.
 */
if (fs.existsSync(/* turbopackIgnore: true */ ENV_FILE)) {
  applyEnvText(fs.readFileSync(/* turbopackIgnore: true */ ENV_FILE, "utf8"), process.env);
}

/** Writes (or replaces) a variable in the configuration file and in the process. */
export function writeVariable(name: string, value: string): void {
  const text = fs.existsSync(/* turbopackIgnore: true */ ENV_FILE) ? fs.readFileSync(/* turbopackIgnore: true */ ENV_FILE, "utf8") : "";
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, setVariableText(text, name, value), { mode: 0o600 });
  process.env[name] = value;
}
