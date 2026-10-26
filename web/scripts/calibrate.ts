/**
 * Vision model calibration: runs suggestCategory (the same code as the app)
 * over cases with a human label and measures accuracy per class and cost.
 *
 * Usage (in web/, with the root .env loaded):
 *   node scripts/calibrate.ts CALIBRATION_DIR model1,model2 [--no-context] [--hint] [--limit N] [--locale pt-BR]
 * CALIBRATION_DIR holds calibration.json ([{id, label, yolo, filmstrip, context, hour}],
 * built by evaluation/build_llm_calibration.py; image paths relative to the folder).
 * Raw results: CALIBRATION_DIR/results/<model>__<variant>.json
 * For checking the prompts in every language, see evals/ (npm run eval:prompts).
 */
import fs from "node:fs";
import path from "node:path";
import { isLocale, type Locale } from "../src/i18n/locales.ts";
import { SUGGESTIONS, suggestCategory, type Suggestion } from "../src/lib/openrouter.ts";

type Case = { id: string; label: Suggestion; yolo: Suggestion; filmstrip: string; context: string; hour: string };

const [dir, modelList, ...rest] = process.argv.slice(2);
const noContext = rest.includes("--no-context");
const hint = rest.includes("--hint");
const opt = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const limit = Number(opt("--limit") ?? Infinity);
const localeArg = opt("--locale") ?? "en";
if (!dir || !modelList || !isLocale(localeArg)) {
  console.error("usage: node scripts/calibrate.ts CALIBRATION_DIR model1,model2 [--no-context] [--hint] [--limit N] [--locale LOCALE]");
  process.exit(1);
}
const locale: Locale = localeArg;
const variant = `${noContext ? "filmstrip" : "filmstrip+context"}${hint ? "+hint" : ""}${locale === "en" ? "" : `+${locale}`}`;

const cases = (JSON.parse(fs.readFileSync(path.join(dir, "calibration.json"), "utf8")) as Case[]).slice(0, limit);
fs.mkdirSync(path.join(dir, "results"), { recursive: true });

async function run(model: string) {
  const output = path.join(dir, "results", `${model.replace("/", "_")}__${variant}.json`);
  const done: Record<string, { category: Suggestion | null; confidence: number; cost: number; error?: string }> =
    fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : {};
  const pending = cases.filter((c) => !done[c.id] || done[c.id].error);
  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const c = pending[i++];
      try {
        const r = await suggestCategory(
          {
            filmstrip: path.join(dir, c.filmstrip),
            context: noContext ? null : path.join(dir, c.context),
            detectorHint: hint ? c.yolo : null,
          },
          { model, fallbacks: [], locale },
        );
        done[c.id] = { category: r.category, confidence: r.confidence, cost: r.cost_usd ?? 0 };
      } catch (e) {
        done[c.id] = { category: null, confidence: 0, cost: 0, error: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.writeFileSync(output, JSON.stringify(done, null, 1));

  let hits = 0, yoloHits = 0, cost = 0, errors = 0;
  const byClass = Object.fromEntries(SUGGESTIONS.map((k) => [k, { n: 0, ok: 0 }]));
  const confusion: Record<string, number> = {};
  for (const c of cases) {
    const r = done[c.id];
    cost += r.cost;
    if (r.error) errors++;
    byClass[c.label].n++;
    if (r.category === c.label) {
      hits++;
      byClass[c.label].ok++;
    } else {
      const k = `${c.label}→${r.category}`;
      confusion[k] = (confusion[k] ?? 0) + 1;
    }
    if (c.yolo === c.label) yoloHits++;
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  console.log(
    `\n${model} [${variant}]  accuracy ${pct(hits, cases.length)} (YOLO ${pct(yoloHits, cases.length)})  ` +
      `cost US$ ${cost.toFixed(4)} (${((cost / cases.length) * 1000).toFixed(3)}/thousand)  errors ${errors}`,
  );
  console.log("  " + SUGGESTIONS.filter((k) => byClass[k].n).map((k) => `${k} ${pct(byClass[k].ok, byClass[k].n)} (n=${byClass[k].n})`).join(" · "));
  console.log("  confusions: " + Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", "));
}

for (const model of modelList.split(",")) await run(model);
