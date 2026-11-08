import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the database and the three folders go to temporary folders
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-storage-"));
const DATA = path.join(root, "data");
const TEMP = path.join(root, "temp");
const FINALS = path.join(root, "Vídeos Finais"); // accents: fs.cpSync garbles them on Windows
process.env.TRAFFIC_COUNTER_DATA = DATA;
process.env.TRAFFIC_COUNTER_TEMP = TEMP;
process.env.TRAFFIC_COUNTER_FINALS = FINALS;
process.env.TRAFFIC_COUNTER_PROJECT = path.join(root, "project");

const write = (file: string, bytes: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
};

describe("storage", () => {
  let lib: typeof import("./db") & typeof import("./storage");
  beforeAll(async () => {
    lib = { ...(await import("./db")), ...(await import("./storage")) };
  });
  afterAll(() => {
    lib.db().close(); // Windows: an open database cannot be deleted
    fs.rmSync(root, { recursive: true, force: true });
  });

  const candidate = (frame: number) => ({
    track: `bike:${frame}`, line_id: "l1", frame, time_s: frame / 15, direction: "A→B", bbox: null, yolo_class: "cyclists" as const,
    yolo_conf: 0.9, alternative: null, origin: "track", n_obs: 5, filmstrip: `candidates/filmstrips/${frame}.jpg`, context: null, clip: null,
  });

  it("keeps the lasting files in the data folder and the temporary ones apart; jobs from 0.0.9 keep everything where it was", () => {
    lib.createJob({ id: "a0000001", drive_link: "x", drive_id: "x" });
    expect(lib.jobDir("a0000001")).toBe(path.join(DATA, "jobs", "a0000001"));
    expect(lib.jobTempDir("a0000001")).toBe(path.join(TEMP, "jobs", "a0000001"));
    // 0.0.9: no temporary folder recorded — everything in the data folder, as before
    lib.db().prepare("INSERT INTO jobs (id, drive_link, drive_id) VALUES ('a0000000', 'x', 'local')").run();
    expect(lib.jobTempDir("a0000000")).toBe(path.join(DATA, "jobs", "a0000000"));
    write(path.join(DATA, "jobs", "a0000000", "candidates", "filmstrips", "1.jpg"), 10);
    expect(lib.jobFile("a0000000", "candidates/filmstrips/1.jpg")).toBe(path.join(DATA, "jobs", "a0000000", "candidates", "filmstrips", "1.jpg"));
    // a new job's media: in the temporary folder (also where it would be made)
    expect(lib.jobFile("a0000001", "candidates/filmstrips/1.jpg")).toBe(path.join(TEMP, "jobs", "a0000001", "candidates", "filmstrips", "1.jpg"));
    // final videos: in their own folder, named after the video
    expect(lib.finalVideoFolder("b0000001", 'Andradas: 06h + 07h.mp4')).toBe(path.join(FINALS, "Andradas_ 06h + 07h.mp4 (b0000001)"));
  });

  it("measures and deletes only the chosen kinds, never what is still needed", () => {
    // reviewed Drive video: review media + downloaded copy in the temporary folder, trajectories in the data folder
    lib.updateJob("a0000001", { status: "awaiting_review", video_file: "video.mp4" });
    lib.replaceCandidates("a0000001", [candidate(10)]);
    lib.reviewCandidates("a0000001", [{ id: lib.listCandidates("a0000001")[0].id, label: "cyclists" }]);
    write(path.join(TEMP, "jobs", "a0000001", "candidates", "filmstrips", "10.jpg"), 3000);
    write(path.join(TEMP, "jobs", "a0000001", "video.mp4"), 50_000);
    write(path.join(DATA, "jobs", "a0000001", "tracks.json.gz"), 100);

    // review not finished: its images stay out of the cleanup
    lib.createJob({ id: "a0000002", drive_link: "/videos/own.mp4", drive_id: "local" });
    lib.updateJob("a0000002", { status: "awaiting_review", video_file: "/videos/own.mp4" });
    lib.replaceCandidates("a0000002", [candidate(20)]);
    write(path.join(TEMP, "jobs", "a0000002", "candidates", "filmstrips", "20.jpg"), 4000);

    // final video already generated, and one still being generated
    lib.createRender("b0000001", "Final", ["a0000001"], null, null, lib.finalVideoFolder("b0000001", "Final"));
    lib.updateRender("b0000001", { status: "ready" });
    write(path.join(lib.renderDir("b0000001"), "final_video.mp4"), 20_000);
    write(path.join(lib.renderDir("b0000001"), "events.csv"), 10);
    lib.createRender("b0000002", "Running", ["a0000002"], null, null, lib.finalVideoFolder("b0000002", "Running"));
    lib.updateRender("b0000002", { status: "rendering" });
    write(path.join(lib.renderDir("b0000002"), "final_video.mp4"), 7000);

    // leftovers: a deleted video's folder in the app's data folder; a folder that is not the app's is
    // ignored, and so is the shared temporary folder (another copy of the app may use it)
    write(path.join(DATA, "jobs", "deadbeef", "video.mp4"), 900);
    write(path.join(DATA, "jobs", "my-notes", "keep.txt"), 900);
    write(path.join(TEMP, "jobs", "cafebabe", "video.mp4"), 900);

    const u = lib.storageUsage();
    expect(u.folders.temp.path).toBe(TEMP);
    expect(u.folders.finals.path).toBe(FINALS);
    expect(u.kinds).toEqual({
      finalVideos: { bytes: 20_000, items: 1 },
      reviewMedia: { bytes: 3000, items: 1 },
      driveVideos: { bytes: 50_000, items: 1 },
      leftovers: { bytes: 900, items: 1 },
    });

    expect(lib.freeSpace(["finalVideos", "reviewMedia", "leftovers"])).toBe(23_900);
    expect(fs.existsSync(path.join(lib.renderDir("b0000001"), "final_video.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(lib.renderDir("b0000001"), "events.csv"))).toBe(true);
    expect(fs.existsSync(path.join(TEMP, "jobs", "a0000001", "candidates"))).toBe(false);
    expect(fs.existsSync(path.join(DATA, "jobs", "a0000001", "tracks.json.gz"))).toBe(true);
    expect(fs.existsSync(path.join(TEMP, "jobs", "a0000001", "video.mp4"))).toBe(true); // not chosen
    expect(fs.existsSync(path.join(TEMP, "jobs", "a0000002", "candidates"))).toBe(true);
    expect(fs.existsSync(path.join(lib.renderDir("b0000002"), "final_video.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(DATA, "jobs", "deadbeef"))).toBe(false);
    expect(fs.existsSync(path.join(DATA, "jobs", "my-notes"))).toBe(true);
    expect(fs.existsSync(path.join(TEMP, "jobs", "cafebabe"))).toBe(true);
    // the decisions are in the database
    expect(lib.listCandidates("a0000001")[0].label).toBe("cyclists");
  });

  it("changes a folder only for what comes next; the temporary one gets its own subfolder", () => {
    expect(lib.chooseFolder("temp", "relative/folder")).toBe("notAbsolute");
    const other = path.join(root, "other disk");
    expect(lib.chooseFolder("temp", other)).toBeNull();
    expect(lib.tempRoot()).toBe(path.join(other, "Traffic Counter"));
    lib.createJob({ id: "a0000003", drive_link: "x", drive_id: "x" });
    expect(lib.jobTempDir("a0000003")).toBe(path.join(other, "Traffic Counter", "jobs", "a0000003"));
    expect(lib.jobTempDir("a0000001")).toBe(path.join(TEMP, "jobs", "a0000001")); // stays where it is
    expect(lib.chooseFolder("temp", null)).toBeNull();
    expect(lib.tempRoot()).toBe(TEMP);

    expect(lib.chooseFolder("finals", other)).toBeNull();
    expect(lib.folderOf("finals")).toBe(other); // the user's own folder, as chosen
    expect(lib.renderDir("b0000001")).toBe(path.join(FINALS, "Final (b0000001)")); // stays where it is
    expect(lib.chooseFolder("finals", null)).toBeNull();
    expect(lib.folderOf("finals")).toBe(FINALS);
  });
});
