import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA } from "./schema";

// a library left by 0.0.9: database without the 0.0.10 columns, files in the data folder
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-upgrade-"));
const DATA = path.join(root, "data");
process.env.TRAFFIC_COUNTER_DATA = DATA;
process.env.TRAFFIC_COUNTER_TEMP = path.join(root, "temp");
process.env.TRAFFIC_COUNTER_FINALS = path.join(root, "finals");

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe("upgrade from 0.0.9", () => {
  let lib: typeof import("./db");
  beforeAll(async () => {
    fs.mkdirSync(DATA, { recursive: true });
    const d = new DatabaseSync(path.join(DATA, "app.db"));
    d.exec(SCHEMA);
    for (const [t, c] of [["jobs", "temp_folder"], ["renders", "folder"], ["groups", "project_file"], ["groups", "project_saved_at"]]) {
      d.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
    }
    d.exec(`INSERT INTO jobs (id, drive_link, drive_id, status, video_file) VALUES ('a0000001', 'https://drive', 'XYZ', 'awaiting_review', 'video.mp4')`);
    d.exec(`INSERT INTO candidates (job_id, track, frame, time_s, filmstrip, label) VALUES ('a0000001', 'bike:1', 10, 0.6, 'candidates/filmstrips/1.jpg', 'cyclists')`);
    d.exec(`INSERT INTO renders (id, name, jobs, status) VALUES ('b0000001', 'Old', '["a0000001"]', 'ready')`);
    d.close();
    write(path.join(DATA, "jobs", "a0000001", "candidates", "filmstrips", "1.jpg"), "jpg");
    write(path.join(DATA, "jobs", "a0000001", "video.mp4"), "video");
    write(path.join(DATA, "renders", "b0000001", "final_video.mp4"), "mp4");
    lib = await import("./db");
  });
  afterAll(() => {
    lib.db().close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("backs up the database, adds the columns and keeps finding every file where 0.0.9 left it", () => {
    expect(lib.listCandidates("a0000001")[0].label).toBe("cyclists");
    const backups = fs.readdirSync(DATA).filter((f) => /^app\.db\..+\.bak$/.test(f));
    expect(backups).toHaveLength(1);
    // the backup is a whole database, with the decisions
    const copy = new DatabaseSync(path.join(DATA, backups[0]));
    expect(copy.prepare("SELECT label FROM candidates").get()).toEqual({ label: "cyclists" });
    copy.close();

    expect(lib.getJob("a0000001")?.temp_folder).toBeNull();
    expect(lib.jobFile("a0000001", "candidates/filmstrips/1.jpg")).toBe(path.join(DATA, "jobs", "a0000001", "candidates", "filmstrips", "1.jpg"));
    expect(lib.jobFile("a0000001", "video.mp4")).toBe(path.join(DATA, "jobs", "a0000001", "video.mp4"));
    expect(lib.renderDir("b0000001")).toBe(path.join(DATA, "renders", "b0000001"));
    expect(fs.existsSync(path.join(lib.renderDir("b0000001"), "final_video.mp4"))).toBe(true);
  });
});
