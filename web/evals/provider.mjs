// promptfoo provider: classifies one candidate with suggestCategory — the same
// code, prompt and fallback-free model call the app makes — in the language
// set in the provider's config. The output is the internal category
// (cyclists, pedestrians…), compared with the human label.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suggestCategory } from "../src/lib/openrouter.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The OpenRouter key, from the environment or from the app's configuration
 * file (the desktop app's, otherwise the repository .env). Never printed.
 */
function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const appData = process.env.APPDATA ?? path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support" : ".config");
  const files = [
    process.env.TRAFFIC_COUNTER_ENV,
    path.join(appData, "Traffic Counter", "config.env"),
    path.join(appData, "Contador de Tráfego", "config.env"),
    path.join(ROOT, ".env"),
  ].filter(Boolean);
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const m = /^\s*OPENROUTER_API_KEY\s*=\s*(.*?)\s*$/m.exec(fs.readFileSync(file, "utf8"));
    if (m?.[1]) return m[1].replace(/^(['"])(.*)\1$/, "$2");
  }
  return null;
}

const KEY = loadKey();

export default class SuggestionProvider {
  constructor(options) {
    this.config = options?.config ?? {};
    this.label = options?.label;
  }

  id() {
    return `traffic-counter:${this.config.locale ?? "en"}:${this.config.model ?? "default"}`;
  }

  async callApi(_prompt, context) {
    if (!KEY) return { error: "No OpenRouter key: set OPENROUTER_API_KEY or save one in the app's Settings." };
    const v = context.vars;
    try {
      const r = await suggestCategory(
        { filmstrip: v.filmstrip, context: v.context || null },
        { key: KEY, locale: this.config.locale ?? "en", model: this.config.model, fallbacks: [] },
      );
      return { output: r.category, cost: r.cost_usd ?? undefined, metadata: { confidence: r.confidence, reason: r.reason, model: r.model } };
    } catch (e) {
      return { error: e?.message ?? String(e) };
    }
  }
}
