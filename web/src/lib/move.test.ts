import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA } from "./schema";

// Cristiano's computer after 0.0.9: everything in the app data folder (accents in the path, as
// in the old "Contador de Tráfego" folder), the program disk full; another disk to move to
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-move-"));
const DATA = path.join(root, "Contador de Tráfego", "data");
const OTHER = path.join(root, "HD externo");
process.env.TRAFFIC_COUNTER_DATA = DATA;
process.env.TRAFFIC_COUNTER_TEMP = path.join(root, "Temp", "Traffic Counter");
process.env.TRAFFIC_COUNTER_FINALS = path.join(root, "Documentos", "Vídeos Finais");
process.env.TRAFFIC_COUNTER_PROJECT = path.join(root, "Documentos", "Traffic Counter");
process.env.TRAFFIC_COUNTER_SYSTEM_LOCALES = "pt-BR";

const write = (file: string, bytes: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
};
const job = (id: string, ...rel: string[]) => path.join(DATA, "jobs", id, ...rel);

describe("moving folders to another disk (a 0.0.9 library)", () => {
  let lib: typeof import("./db") & typeof import("./move") & typeof import("./storage") & typeof import("./project");
  const labels = () => lib.listCandidates("a0000001").map((c) => c.label);
  const finished = async () => {
    for (let i = 0; i < 200 && lib.moveState().running; i++) await new Promise((r) => setTimeout(r, 25));
    return lib.moveState();
  };

  beforeAll(async () => {
    fs.mkdirSync(DATA, { recursive: true });
    const d = new DatabaseSync(path.join(DATA, "app.db"));
    d.exec(SCHEMA);
    for (const [t, c] of [["jobs", "temp_folder"], ["renders", "folder"], ["groups", "project_file"], ["groups", "project_saved_at"]]) d.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
    // a 24-hour video from the computer, reviewed, and one from the Drive
    d.exec(`INSERT INTO jobs (id, drive_link, drive_id, status, video_file, file_name) VALUES ('a0000001', 'C:\\videos\\24h.mp4', 'local', 'awaiting_review', 'C:\\videos\\24h.mp4', '24h.mp4')`);
    d.exec(`INSERT INTO jobs (id, drive_link, drive_id, status, video_file, file_name) VALUES ('a0000002', 'https://drive', 'XYZ', 'awaiting_review', 'video.mp4', 'drive.mp4')`);
    for (let i = 1; i <= 3; i++) {
      d.exec(`INSERT INTO candidates (job_id, track, frame, time_s, filmstrip, label) VALUES ('a0000001', 'bike:${i}', ${i * 10}, ${i}, 'candidates/filmstrips/${i}.jpg', 'cyclists')`);
    }
    d.exec(`INSERT INTO renders (id, name, jobs, status) VALUES ('b0000001', 'Cristiano 24h', '["a0000001"]', 'ready')`);
    d.exec(`INSERT INTO renders (id, name, jobs, status) VALUES ('b0000002', 'Tentativa', '["a0000001"]', 'ready')`);
    d.close();
    for (let i = 1; i <= 3; i++) write(job("a0000001", "candidates", "filmstrips", `${i}.jpg`), 1000);
    write(job("a0000001", "tracks.json.gz"), 300);
    write(job("a0000002", "video.mp4"), 40_000);
    write(job("a0000002", "tracks.json.gz"), 300);
    write(path.join(DATA, "renders", "b0000001", "final_video.mp4"), 90_000);
    write(path.join(DATA, "renders", "b0000001", "events.csv"), 50);
    write(path.join(DATA, "renders", "b0000002", "final_video.mp4"), 10_000);
    lib = { ...(await import("./db")), ...(await import("./move")), ...(await import("./storage")), ...(await import("./project")) };
  });
  afterAll(() => {
    lib.db().close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("asks with the size of what is already there: the temporary files left by 0.0.9 too", () => {
    const plan = lib.planFolderMove("temp", OTHER);
    expect(plan).toMatchObject({ target: path.join(OTHER, "Traffic Counter"), bytes: 43_000, items: 2, busy: false });
  });

  it("moves the review images and the Drive copy out of the app folder, keeping trajectories and decisions", async () => {
    expect(lib.changeFolder("temp", OTHER, true)).toBeNull();
    expect(await finished()).toMatchObject({ moved: 2, failed: 0, total: 43_000 });
    const temp = path.join(OTHER, "Traffic Counter", "jobs");
    expect(lib.jobFile("a0000001", "candidates/filmstrips/2.jpg")).toBe(path.join(temp, "a0000001", "candidates", "filmstrips", "2.jpg"));
    expect(fs.existsSync(job("a0000001", "candidates"))).toBe(false);
    expect(fs.existsSync(job("a0000001", "tracks.json.gz"))).toBe(true); // lasting: stays with the database
    expect(lib.jobFile("a0000002", "video.mp4")).toBe(path.join(temp, "a0000002", "video.mp4"));
    expect(fs.statSync(lib.jobFile("a0000002", "video.mp4")).size).toBe(40_000);
    expect(labels()).toEqual(["cyclists", "cyclists", "cyclists"]);
    expect(lib.tempRoot()).toBe(path.join(OTHER, "Traffic Counter"));
  });

  it("a final video that cannot be copied stays where it was, working; the others move", async () => {
    const finals = path.join(OTHER, "Vídeos Finais");
    // something already at the destination of one of them, in the way (a file where its folder would go)
    write(path.join(finals, "Tentativa (b0000002)"), 5);
    expect(lib.planFolderMove("finals", finals)).toMatchObject({ bytes: 100_050, items: 2 });
    expect(lib.changeFolder("finals", finals, true)).toBeNull();
    expect(await finished()).toMatchObject({ moved: 1, failed: 1 });
    expect(lib.renderDir("b0000001")).toBe(path.join(finals, "Cristiano 24h (b0000001)"));
    expect(fs.statSync(path.join(lib.renderDir("b0000001"), "final_video.mp4")).size).toBe(90_000);
    expect(fs.existsSync(path.join(lib.renderDir("b0000001"), "events.csv"))).toBe(true);
    expect(fs.existsSync(path.join(DATA, "renders", "b0000001"))).toBe(false);
    // the one in the way: untouched, still found
    expect(lib.renderDir("b0000002")).toBe(path.join(DATA, "renders", "b0000002"));
    expect(fs.statSync(path.join(lib.renderDir("b0000002"), "final_video.mp4")).size).toBe(10_000);
  });

  it("moves the project files and the original videos, updating every path", async () => {
    const originals = lib.originalsFolder();
    const video = path.join(originals, "Andradas_07.mp4");
    write(video, 2000);
    lib.updateJob("a0000001", { drive_link: video, video_file: video });
    lib.saveGroup("g0000001", "Andradas");
    lib.moveJobs(["a0000001"], "g0000001");
    const file = lib.saveProject("g0000001");
    expect(file).toBe(path.join(lib.projectsFolder(), "Andradas.tcproj"));

    const target = path.join(OTHER, "Contagens");
    expect(lib.changeFolder("project", target, true)).toBeNull();
    expect(await finished()).toMatchObject({ moved: 2, failed: 0 });
    const moved = path.join(target, "Vídeos Originais", "Andradas_07.mp4");
    expect(lib.getJob("a0000001")).toMatchObject({ video_file: moved, drive_link: moved });
    expect(fs.statSync(moved).size).toBe(2000);
    const projectFile = path.join(target, "Projetos", "Andradas.tcproj");
    expect(lib.getGroup("g0000001")?.project_file).toBe(projectFile);
    // the relative path in the project file still finds the video
    const p = lib.readProject(projectFile);
    expect(lib.resolveVideo(p.videos[0].source as { type: "file"; path: string; relative: boolean }, projectFile)).toBe(moved);
  });

  it("work that touches the files waits for the move to finish", async () => {
    const state = await import("./move-state");
    lib.moveJobs(["a0000002"], null);
    expect(lib.changeFolder("temp", path.join(root, "third"), true)).toBeNull();
    expect(state.moving()).toBe(true);
    let started = false;
    const waiting = state.moveFinished().then(() => (started = true));
    expect(started).toBe(false);
    await waiting;
    expect(lib.moveState().running).toBe(false);
    expect(lib.jobFile("a0000002", "video.mp4")).toBe(path.join(root, "third", "Traffic Counter", "jobs", "a0000002", "video.mp4"));
    expect(lib.changeFolder("temp", OTHER, true)).toBeNull();
    await finished();
  });

  it("refuses to move while something is running", () => {
    lib.updateRender("b0000002", { status: "rendering" });
    expect(lib.planFolderMove("temp", root)).toMatchObject({ busy: true });
    expect(lib.changeFolder("temp", root, true)).toBe("busy");
    expect(lib.tempRoot()).toBe(path.join(OTHER, "Traffic Counter")); // nothing changed
    lib.updateRender("b0000002", { status: "ready" });
  });
});
