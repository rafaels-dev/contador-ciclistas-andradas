// Test cases for the prompt evals: candidates with an audited human label
// (evaluation/llm_calibration_audited.json — night and dusk at Andradas — and
// any other calibration set). The images are NOT in the repository (they show
// people on the street): EVAL_DATA points to the local folders that hold
// calibration.json + filmstrips/ + contexts/, built by
// evaluation/build_llm_calibration.py — or downloaded from the project Drive.
//
//   EVAL_DATA   folders, separated by ";" (Windows) or ":" (elsewhere)
//   EVAL_SAMPLE cases per category per folder (default 6; "all" = every case)
import fs from "node:fs";
import path from "node:path";

// sets built before 0.0.8 have Portuguese keys and categories
const CATEGORY = {
  ciclistas: "cyclists", patinetes: "kick_scooters", scooters: "mopeds", monociclos: "unicycles",
  pedestres: "pedestrians", automoveis: "cars", motocicletas: "motorcycles", outros: "other", descartado: "discarded",
};

function readSet(dir) {
  const file = ["calibration.json", "calibracao.json"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!file) throw new Error(`${dir}: no calibration.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")).map((c) => {
    const label = c.label ?? c.rotulo;
    const context = c.context ?? c.contexto;
    // the audited set kept the paths of when it was built (contextos/)
    const contextPath = [context, context?.replace(/^contextos\//, "contexts/"), context?.replace(/^contexts\//, "contextos/")]
      .filter(Boolean)
      .map((p) => path.join(dir, p))
      .find((p) => fs.existsSync(p));
    return { id: c.id, label: CATEGORY[label] ?? label, filmstrip: path.join(dir, c.filmstrip), context: contextPath ?? "", hour: c.hour ?? c.hora ?? "" };
  });
}

/** The first n cases of each category, in file order (stable between runs, so results compare). */
function sample(cases, n) {
  if (n === Infinity) return cases;
  const seen = {};
  return cases.filter((c) => (seen[c.label] = (seen[c.label] ?? 0) + 1) <= n);
}

export default function generateTests() {
  const dirs = (process.env.EVAL_DATA ?? "").split(path.delimiter).filter(Boolean);
  if (!dirs.length) throw new Error("Set EVAL_DATA to the folder(s) with calibration.json and the images (see web/evals/README.md).");
  const n = process.env.EVAL_SAMPLE === "all" ? Infinity : Number(process.env.EVAL_SAMPLE ?? 6);
  return dirs.flatMap((dir) =>
    sample(readSet(dir), n)
      .filter((c) => fs.existsSync(c.filmstrip))
      .map((c) => ({
        description: `${path.basename(dir)}/${c.id} (${c.label}${c.hour ? `, ${c.hour}` : ""})`,
        vars: c,
        assert: [{ type: "equals", value: c.label }],
      })),
  );
}
