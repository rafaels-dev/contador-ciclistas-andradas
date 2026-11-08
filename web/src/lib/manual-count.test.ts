import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the database goes to a temporary data folder
const data = fs.mkdtempSync(path.join(os.tmpdir(), "tc-manual-"));
process.env.TRAFFIC_COUNTER_DATA = data;
process.env.TRAFFIC_COUNTER_TEMP = path.join(data, "temp");

describe("manual counts", () => {
  let lib: typeof import("./db");
  beforeAll(async () => {
    lib = await import("./db");
    lib.createJob({ id: "j1", drive_link: "x", drive_id: "x" });
    lib.createJob({ id: "j2", drive_link: "y", drive_id: "y" });
  });
  afterAll(() => {
    lib.db().close(); // Windows: an open database cannot be deleted
    fs.rmSync(data, { recursive: true, force: true });
  });

  const detected = (frame: number) => ({
    track: `bike:${frame}`, line_id: "l1", frame, time_s: frame / 15, direction: "A→B", bbox: null, yolo_class: "cyclists" as const,
    yolo_conf: 0.9, alternative: null, origin: "track", n_obs: 5, filmstrip: null, context: null, clip: null,
  });

  it("is born decided, with its own track and no suggestion to ask for", () => {
    const c = lib.insertManualCandidate("j1", { frame: 150, time_s: 10, line_id: "l1", direction: "B→A", label: "kick_scooters", filmstrip: "manual/150-a.jpg" });
    expect(c).toMatchObject({ origin: "manual", label: "kick_scooters", llm_status: "ok", track: `manual:${c.id}`, direction: "B→A" });
    expect(c.reviewed_at).not.toBeNull();
    expect(lib.reviewSummary("j1")).toEqual({ total: 1, reviewed: 1 });
  });

  it("survives a new detection, which replaces only the detector's candidates", () => {
    lib.replaceCandidates("j1", [detected(30), detected(60)]);
    lib.replaceCandidates("j1", [detected(90)]);
    const origins = lib.listCandidates("j1").map((c) => [c.origin, c.frame]);
    expect(origins).toEqual([["track", 90], ["manual", 150]]);
  });

  it("only manual ones are moved or removed, and only in their own job", () => {
    const [auto, manual] = lib.listCandidates("j1");
    expect(lib.updateManualCandidate("j1", auto.id, { line_id: "l2", direction: null })).toBe(false);
    expect(lib.deleteManualCandidate("j1", auto.id)).toBe(false);
    expect(lib.deleteManualCandidate("j2", manual.id)).toBe(false);
    expect(lib.updateManualCandidate("j1", manual.id, { line_id: "l2", direction: null })).toBe(true);
    expect(lib.listCandidates("j1")[1]).toMatchObject({ line_id: "l2", direction: null });
    expect(lib.deleteManualCandidate("j1", manual.id)).toBe(true);
    expect(lib.listCandidates("j1").map((c) => c.origin)).toEqual(["track"]);
  });
});
