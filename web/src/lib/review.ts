import type { Candidate, Category, Line } from "./db";

/**
 * Human review rules, shared between server and browser (only type imports
 * from ./db: node:sqlite cannot go into the client bundle).
 */

export type Label = Category | "discarded";

/**
 * llm_model of what did not go through the vision model: a YOLO car on a
 * line that does not count cars (the proposal is already to discard). Goes
 * into the bulk accept.
 */
export const NO_CONSULTATION = "detector";

/** Category names are translated: messages → categories.singular / categories.plural. */
export const LABELS: readonly Label[] = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "cars", "motorcycles", "other", "discarded"];

/** The counted categories (LABELS without "discarded"), for the browser — db.ts cannot go into the client bundle. */
export const COUNTED_CATEGORIES: readonly Category[] = LABELS.filter((c): c is Category => c !== "discarded");

/** Categories a line counts; no list (or an empty one) = all. */
export function countsOnLine(line: Line | undefined, label: Category): boolean {
  return !line?.categories?.length || line.categories.includes(label);
}

export type Proposal = {
  label: Label | null;
  /** the model saw a category this line does not count (e.g. a bus on the bike lane line) */
  offLine: Category | null;
  /** the AI failed: the proposal is the detector's (YOLO) class, with no confidence — never in the bulk accept */
  fromDetector: boolean;
};

/**
 * What the screen offers the human to accept: the vision model's
 * suggestion, replaced by "discarded" when the category is not counted on
 * the crossed line. If the AI failed on this candidate, the detector's class
 * is used, flagged as such.
 */
export function proposal(c: Candidate, lines: Record<string, Line>): Proposal {
  const fromDetector = c.llm_status === "failed";
  const s = c.llm_status === "ok" ? c.llm_suggestion : fromDetector ? c.yolo_class : null;
  if (!s) return { label: null, offLine: null, fromDetector };
  if (s !== "discarded" && c.line_id && !countsOnLine(lines[c.line_id], s)) {
    return { label: "discarded", offLine: s, fromDetector };
  }
  return { label: s, offLine: null, fromDetector };
}

/** Error stored by the server when the suggestion failed (JSON in candidates.llm_error). */
export type SuggestionError = { at?: string; status?: number | null; attempts?: number; message?: string; detail?: string | null };

export function readSuggestionError(c: Pick<Candidate, "llm_error">): SuggestionError | null {
  if (!c.llm_error) return null;
  try {
    const e = JSON.parse(c.llm_error) as SuggestionError & { quando?: string; tentativas?: number; mensagem?: string; detalhe?: string | null };
    // errors recorded before 0.0.8 have Portuguese keys
    return { at: e.at ?? e.quando, status: e.status, attempts: e.attempts ?? e.tentativas, message: e.message ?? e.mensagem, detail: e.detail ?? e.detalhe ?? null };
  } catch {
    return null;
  }
}

export type Totals = {
  /** line → category → direction ('A→B' | 'B→A' | '—') → n */
  byLine: Record<string, Partial<Record<Category, Record<string, number>>>>;
  pending: number;
  discarded: number;
  counted: number;
};

/** Totals from human decisions only (label) — that is what goes into the final video. */
export function computeTotals(candidates: Pick<Candidate, "line_id" | "direction" | "label">[]): Totals {
  const t: Totals = { byLine: {}, pending: 0, discarded: 0, counted: 0 };
  for (const c of candidates) {
    if (!c.label) t.pending++;
    else if (c.label === "discarded") t.discarded++;
    else {
      t.counted++;
      const line = (t.byLine[c.line_id ?? ""] ??= {});
      const cat = (line[c.label] ??= {});
      const direction = c.direction ?? "—";
      cat[direction] = (cat[direction] ?? 0) + 1;
    }
  }
  return t;
}

/** Two crossings of the same object arrive together; different objects in the same lane come spaced. */
export const DUPLICATE_WINDOW_S = 1;

function overlap(a: number[], b: number[]): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = (c: number[]) => (c[2] - c[0]) * (c[3] - c[1]);
  return (w * h) / Math.min(area(a), area(b));
}

/**
 * Possible double count of the same object (e.g. the model looked at the
 * cyclist next to the car, or tracking split one object in two): same line
 * and direction, same class, crossing within DUPLICATE_WINDOW_S with
 * overlapping boxes. Only points it out for the human to check — discards
 * nothing. Returns id → ids of the similar candidates.
 */
export function possibleDuplicates(
  candidates: Pick<Candidate, "id" | "line_id" | "direction" | "time_s" | "bbox">[],
  labelOf: (id: number) => Label | null,
): Map<number, number[]> {
  const pairs = new Map<number, number[]>();
  const order = [...candidates].sort((a, b) => a.time_s - b.time_s);
  const box = (c: (typeof order)[number]) => (c.bbox ? (JSON.parse(c.bbox) as number[]) : null);
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    const la = labelOf(a.id);
    if (!la || la === "discarded") continue;
    for (let j = i + 1; j < order.length && order[j].time_s - a.time_s <= DUPLICATE_WINDOW_S; j++) {
      const b = order[j];
      if (b.line_id !== a.line_id || b.direction !== a.direction || labelOf(b.id) !== la) continue;
      const [ba, bb] = [box(a), box(b)];
      if (!ba || !bb || overlap(ba, bb) < 0.3) continue;
      pairs.set(a.id, [...(pairs.get(a.id) ?? []), b.id]);
      pairs.set(b.id, [...(pairs.get(b.id) ?? []), a.id]);
    }
  }
  return pairs;
}
