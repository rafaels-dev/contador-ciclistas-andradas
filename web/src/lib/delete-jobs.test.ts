import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the database and the job folders go to a temporary data folder
const data = fs.mkdtempSync(path.join(os.tmpdir(), "tc-delete-"));
process.env.TRAFFIC_COUNTER_DATA = data;
process.env.TRAFFIC_COUNTER_TEMP = path.join(data, "temp");

describe("deleteJobs", () => {
  let lib: typeof import("./db") & typeof import("./runner") & typeof import("./paths");
  beforeAll(async () => {
    lib = { ...(await import("./db")), ...(await import("./runner")), ...(await import("./paths")) };
  });
  afterAll(() => {
    lib.db().close(); // Windows: an open database cannot be deleted
    fs.rmSync(data, { recursive: true, force: true });
  });

  it("removes the job, its candidates and its folder, but not a video from the computer", () => {
    const own = path.join(data, "my video.mp4");
    fs.writeFileSync(own, "video");
    lib.createJob({ id: "local1", drive_link: own, drive_id: "local" });
    lib.updateJob("local1", { status: "awaiting_review", video_file: own });
    lib.createJob({ id: "drive1", drive_link: "https://drive", drive_id: "x" });
    lib.replaceCandidates("local1", [{
      track: "bike:1", line_id: null, frame: 10, time_s: 1, direction: null, bbox: null, yolo_class: "cyclists",
      yolo_conf: 0.9, alternative: null, origin: "track", n_obs: 5, filmstrip: null, context: null, clip: null,
    }]);
    for (const id of ["local1", "drive1"]) {
      fs.mkdirSync(path.join(lib.jobDir(id), "candidates"), { recursive: true });
      fs.writeFileSync(path.join(lib.jobDir(id), "tracks.json.gz"), "");
    }
    lib.createJob({ id: "kept", drive_link: "https://drive", drive_id: "y" });

    lib.deleteJobs(["local1", "drive1", "missing"]);

    expect(lib.listJobs().map((j) => j.id)).toEqual(["kept"]);
    expect(lib.listCandidates("local1")).toEqual([]);
    expect(fs.existsSync(lib.jobDir("local1"))).toBe(false);
    expect(fs.existsSync(lib.jobDir("drive1"))).toBe(false);
    expect(fs.readFileSync(own, "utf-8")).toBe("video");
  });
});
