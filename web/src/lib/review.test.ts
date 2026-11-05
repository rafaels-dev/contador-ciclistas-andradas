import { describe, expect, it } from "vitest";
import type { Candidate, Line } from "./db";
import { computeTotals, countsOnLine, possibleDuplicates, proposal, readSuggestionError, type Label } from "./review";

function candidate(fields: Partial<Candidate>): Candidate {
  return {
    id: 1, job_id: "j", track: "bike:1", line_id: "l1", frame: 0, time_s: 0, direction: "A→B", bbox: null,
    yolo_class: "cyclists", yolo_conf: 0.8, alternative: null, origin: "track", n_obs: 10,
    filmstrip: null, context: null, clip: null, llm_suggestion: null, llm_cost: null, llm_conf: null,
    llm_reason: null, llm_model: null, llm_status: "pending", llm_error: null, label: null, reviewed_at: null,
    ...fields,
  };
}

const line = (categories?: Line["categories"]): Line => ({ id: "l1", name: "Bike lane", x1: 0, y1: 0, x2: 1, y2: 1, categories });

describe("countsOnLine", () => {
  it("with no category list, the line counts everything", () => {
    expect(countsOnLine(line(), "cars")).toBe(true);
    expect(countsOnLine(line([]), "cars")).toBe(true);
    expect(countsOnLine(undefined, "cars")).toBe(true);
  });

  it("with a list, only its categories", () => {
    expect(countsOnLine(line(["cyclists"]), "cyclists")).toBe(true);
    expect(countsOnLine(line(["cyclists"]), "cars")).toBe(false);
  });
});

describe("proposal", () => {
  const bikeLane = { l1: line(["cyclists", "kick_scooters"]) };

  it("with no suggestion yet, proposes nothing", () => {
    expect(proposal(candidate({ llm_status: "pending" }), bikeLane)).toEqual({ label: null, offLine: null, fromDetector: false });
  });

  it("proposes the vision model's suggestion", () => {
    const c = candidate({ llm_status: "ok", llm_suggestion: "cyclists" });
    expect(proposal(c, bikeLane)).toEqual({ label: "cyclists", offLine: null, fromDetector: false });
  });

  it("a category the line does not count becomes a discard, keeping what the model saw", () => {
    const c = candidate({ llm_status: "ok", llm_suggestion: "cars" });
    expect(proposal(c, bikeLane)).toEqual({ label: "discarded", offLine: "cars", fromDetector: false });
  });

  it("the model's discard stays a discard", () => {
    const c = candidate({ llm_status: "ok", llm_suggestion: "discarded" });
    expect(proposal(c, bikeLane).label).toBe("discarded");
    expect(proposal(c, bikeLane).offLine).toBeNull();
  });

  it("if the AI failed, proposes the detector's class, flagged as such", () => {
    const c = candidate({ llm_status: "failed", yolo_class: "pedestrians" });
    expect(proposal(c, { l1: line() })).toEqual({ label: "pedestrians", offLine: null, fromDetector: true });
  });

  it("a candidate with no line (video without lines) is not filtered", () => {
    const c = candidate({ line_id: null, llm_status: "ok", llm_suggestion: "cars" });
    expect(proposal(c, bikeLane).label).toBe("cars");
  });
});

describe("readSuggestionError", () => {
  it("reads the JSON stored by the server", () => {
    const error = { at: "2026-10-26T10:00:00Z", status: 400, attempts: 3, message: "Provider returned error", detail: null };
    expect(readSuggestionError({ llm_error: JSON.stringify(error) })).toEqual(error);
  });

  it("reads errors recorded before 0.0.8 (Portuguese keys)", () => {
    const old = { quando: "2026-10-01T10:00:00Z", status: 400, tentativas: 3, mensagem: "Provider returned error", detalhe: "HTTP 400" };
    expect(readSuggestionError({ llm_error: JSON.stringify(old) })).toEqual({
      at: old.quando, status: 400, attempts: 3, message: old.mensagem, detail: old.detalhe,
    });
  });

  it("no error or invalid text: null", () => {
    expect(readSuggestionError({ llm_error: null })).toBeNull();
    expect(readSuggestionError({ llm_error: "not json" })).toBeNull();
  });
});

describe("computeTotals", () => {
  it("counts only human decisions, by line, category and direction", () => {
    const t = computeTotals([
      { line_id: "l1", direction: "A→B", label: "cyclists" },
      { line_id: "l1", direction: "A→B", label: "cyclists" },
      { line_id: "l1", direction: "B→A", label: "cyclists" },
      { line_id: "l2", direction: "A→B", label: "pedestrians" },
      { line_id: null, direction: null, label: "other" },
      { line_id: "l1", direction: "A→B", label: "discarded" },
      { line_id: "l1", direction: "A→B", label: null },
    ]);
    expect(t.byLine).toEqual({
      l1: { cyclists: { "A→B": 2, "B→A": 1 } },
      l2: { pedestrians: { "A→B": 1 } },
      "": { other: { "—": 1 } },
    });
    expect([t.counted, t.discarded, t.pending]).toEqual([5, 1, 1]);
  });
});

describe("possibleDuplicates", () => {
  type C = Parameters<typeof possibleDuplicates>[0][number];
  const c = (id: number, time_s: number, bbox: number[] | null, extra: Partial<C> = {}): C => ({
    id, line_id: "l1", direction: "A→B", time_s, bbox: bbox && JSON.stringify(bbox), ...extra,
  });
  const allCyclists = (): Label => "cyclists";

  it("same line, direction and class, close in time and with overlapping boxes", () => {
    const pairs = possibleDuplicates([c(1, 10, [0, 0, 100, 100]), c(2, 10.5, [20, 20, 110, 110])], allCyclists);
    expect(pairs.get(1)).toEqual([2]);
    expect(pairs.get(2)).toEqual([1]);
  });

  it("far apart in time: no", () => {
    const pairs = possibleDuplicates([c(1, 10, [0, 0, 100, 100]), c(2, 11.5, [0, 0, 100, 100])], allCyclists);
    expect(pairs.size).toBe(0);
  });

  it("separate boxes: no (two cyclists side by side)", () => {
    const pairs = possibleDuplicates([c(1, 10, [0, 0, 100, 100]), c(2, 10.2, [200, 0, 300, 100])], allCyclists);
    expect(pairs.size).toBe(0);
  });

  it("different direction, line or class: no", () => {
    const base = c(1, 10, [0, 0, 100, 100]);
    expect(possibleDuplicates([base, c(2, 10, [0, 0, 100, 100], { direction: "B→A" })], allCyclists).size).toBe(0);
    expect(possibleDuplicates([base, c(2, 10, [0, 0, 100, 100], { line_id: "l2" })], allCyclists).size).toBe(0);
    const labels: Record<number, Label> = { 1: "cyclists", 2: "pedestrians" };
    expect(possibleDuplicates([base, c(2, 10, [0, 0, 100, 100])], (id) => labels[id]).size).toBe(0);
  });

  it("discarded and unlabeled ones are left out", () => {
    const list = [c(1, 10, [0, 0, 100, 100]), c(2, 10, [0, 0, 100, 100])];
    expect(possibleDuplicates(list, () => "discarded").size).toBe(0);
    expect(possibleDuplicates(list, () => null).size).toBe(0);
  });

  it("a manual count next to the detector's: by line, class and time, no box", () => {
    const manual = c(2, 11.8, null, { origin: "manual" });
    expect(possibleDuplicates([c(1, 10, [0, 0, 100, 100]), manual], allCyclists).get(2)).toEqual([1]);
    // without direction it matches either; with a different one, no
    expect(possibleDuplicates([c(1, 10, [0, 0, 100, 100], { direction: "B→A" }), c(2, 11, null, { origin: "manual", direction: null })], allCyclists).get(2)).toEqual([1]);
    expect(possibleDuplicates([c(1, 10, [0, 0, 100, 100], { direction: "B→A" }), c(2, 11, null, { origin: "manual" })], allCyclists).size).toBe(0);
    // more than 2 s apart: another object
    expect(possibleDuplicates([c(1, 10, [0, 0, 100, 100]), c(2, 12.5, null, { origin: "manual" })], allCyclists).size).toBe(0);
  });

  it("two detector candidates 1.5 s apart are still not duplicates (the wider window is only for manual ones)", () => {
    expect(possibleDuplicates([c(1, 10, [0, 0, 100, 100]), c(2, 11.5, [0, 0, 100, 100])], allCyclists).size).toBe(0);
  });

  it("input order does not matter", () => {
    const pairs = possibleDuplicates([c(2, 10.5, [0, 0, 100, 100]), c(3, 30, null), c(1, 10, [0, 0, 100, 100])], allCyclists);
    expect(pairs.get(1)).toEqual([2]);
    expect(pairs.has(3)).toBe(false);
  });
});
