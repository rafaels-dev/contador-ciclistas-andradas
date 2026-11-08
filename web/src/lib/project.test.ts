import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-project-"));
const DATA = path.join(root, "data");
const PROJECT = path.join(root, "Contagens de Tráfego"); // accents: fs.cpSync garbles them on Windows
process.env.TRAFFIC_COUNTER_DATA = DATA;
process.env.TRAFFIC_COUNTER_TEMP = path.join(root, "temp");
process.env.TRAFFIC_COUNTER_FINALS = path.join(root, "finals");
process.env.TRAFFIC_COUNTER_PROJECT = PROJECT;
process.env.TRAFFIC_COUNTER_SYSTEM_LOCALES = "en"; // folder names in English

const write = (file: string, content: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe("project files", () => {
  let lib: typeof import("./db") & typeof import("./project") & typeof import("./storage");
  beforeAll(async () => {
    lib = { ...(await import("./db")), ...(await import("./project")), ...(await import("./storage")) };
  });
  afterAll(() => {
    lib.db().close(); // Windows: an open database cannot be deleted
    fs.rmSync(root, { recursive: true, force: true });
  });

  const detected = (frame: number, filmstrip = `candidates/filmstrips/${frame}.jpg`) => ({
    track: `bike:${frame}`, line_id: "l1", frame, time_s: frame / 15, direction: "A→B", bbox: "[1,2,3,4]", yolo_class: "cyclists" as const,
    yolo_conf: 0.9, alternative: null, origin: "track", n_obs: 5, filmstrip, context: null, clip: `candidates/clips/${frame}.mp4`,
  });

  it("writes relative paths for videos in the project files folder and fixed ones for the rest", () => {
    const file = path.join(PROJECT, "Projects", "x.tcproj");
    expect(lib.videoReference(path.join(PROJECT, "Original Videos", "06h.mp4"), file, PROJECT)).toEqual({
      type: "file",
      path: "../Original Videos/06h.mp4",
      relative: true,
    });
    const outside = path.join(root, "elsewhere", "07h.mp4");
    expect(lib.videoReference(outside, file, PROJECT)).toEqual({ type: "file", path: outside, relative: false });
    // a project saved outside the folder: fixed paths
    expect(lib.videoReference(path.join(PROJECT, "a.mp4"), path.join(root, "x.tcproj"), PROJECT)).toMatchObject({ relative: false });
  });

  it("saves a group and opens it back — on another computer and with the folder moved — without losing a decision", () => {
    const inside = path.join(lib.originalsFolder(), "Andradas_06.mp4");
    const outside = path.join(root, "elsewhere", "Andradas_07.mp4");
    write(inside, "video 06");
    write(outside, "video 07");
    lib.saveGroup("g0000001", "Andradas");
    const jobs = [
      { id: "a0000001", link: inside, drive: "local", chosen: path.join(root, "where it was imported from.mp4") },
      { id: "a0000002", link: outside, drive: "local" },
      { id: "a0000003", link: "https://drive.google.com/file/d/XYZ/view", drive: "XYZ" },
    ];
    for (const j of jobs) {
      // drive_link: what was chosen on import; video_file: the file the job reads (they can differ)
      lib.createJob({ id: j.id, drive_link: "chosen" in j ? (j.chosen as string) : j.link, drive_id: j.drive, group_id: "g0000001" });
      lib.updateJob(j.id, {
        status: "awaiting_review",
        file_name: path.basename(j.link),
        video_file: j.drive === "local" ? j.link : "video.mp4",
        lines: JSON.stringify([{ id: "l1", name: "Linha 1", x1: 0.5, y1: 0, x2: 0.5, y2: 1 }]),
        fps: 15,
        width: 1920,
        height: 1080,
        duration_s: 3600,
      });
      lib.replaceCandidates(j.id, [detected(10), detected(20)]);
      write(path.join(lib.jobDir(j.id), "tracks.json.gz"), Buffer.from([1, 2, 3]));
      write(path.join(lib.jobDir(j.id), "frame0.jpg"), "jpg");
    }
    const [c10, c20] = lib.listCandidates("a0000001");
    lib.reviewCandidates("a0000001", [{ id: c10.id, label: "cyclists" }, { id: c20.id, label: "discarded" }]);
    const manual = lib.insertManualCandidate("a0000001", { frame: 99, time_s: 6.6, line_id: "l1", direction: "B→A", label: "kick_scooters", filmstrip: "manual/99.jpg" });
    write(path.join(lib.jobDir("a0000001"), "manual", "99.jpg"), "thumb");

    const file = lib.saveProject("g0000001");
    expect(file).toBe(path.join(PROJECT, "Projects", "Andradas.tcproj"));
    const p = lib.readProject(file);
    expect(p.videos.map((v) => v.source)).toEqual([
      { type: "file", path: "../Original Videos/Andradas_06.mp4", relative: true },
      { type: "file", path: outside, relative: false },
      { type: "drive", drive_id: "XYZ", link: "https://drive.google.com/file/d/XYZ/view" },
    ]);
    const data = path.join(PROJECT, "Projects", "Andradas.tcdata", "a0000001");
    expect(fs.existsSync(path.join(data, "tracks.json.gz"))).toBe(true);
    expect(fs.existsSync(path.join(data, "manual", "99.jpg"))).toBe(true);
    expect(lib.getGroup("g0000001")?.project_file).toBe(file);

    // another computer: an empty library, and the whole project files folder copied to another place
    for (const j of jobs) {
      lib.deleteJob(j.id);
      fs.rmSync(lib.jobDir(j.id), { recursive: true, force: true });
    }
    lib.deleteGroup("g0000001");
    const moved = path.join(root, "Outro disco", "Contagens de Tráfego");
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(PROJECT, moved);

    const r = lib.openProject(path.join(moved, "Projects", "Andradas.tcproj"));
    expect(r).toMatchObject({ added: 3, existing: 0 });
    expect(lib.getGroup(r.groupId)?.name).toBe("Andradas");
    const back = lib.getJob("a0000001")!;
    expect(back.video_file).toBe(path.join(moved, "Original Videos", "Andradas_06.mp4")); // relative: follows the folder
    expect(fs.readFileSync(back.video_file!, "utf8")).toBe("video 06");
    expect(lib.getJob("a0000002")!.video_file).toBe(outside); // fixed path
    expect(lib.getJob("a0000003")).toMatchObject({ drive_id: "XYZ", video_file: "video.mp4" });
    expect(back).toMatchObject({ status: "awaiting_review", group_id: r.groupId, fps: 15, duration_s: 3600 });
    const labels = lib.listCandidates("a0000001").map((c) => [c.frame, c.origin, c.label]);
    expect(labels).toEqual([
      [10, "track", "cyclists"],
      [20, "track", "discarded"],
      [99, "manual", "kick_scooters"],
    ]);
    expect(lib.listCandidates("a0000001")[2]).toMatchObject({ track: manual.track, direction: "B→A", filmstrip: "manual/99.jpg" });
    expect(fs.readFileSync(path.join(lib.jobDir("a0000001"), "tracks.json.gz"))).toEqual(Buffer.from([1, 2, 3]));
    expect(fs.existsSync(path.join(lib.jobDir("a0000001"), "manual", "99.jpg"))).toBe(true);

    // opening again never overwrites the work in the library
    lib.reviewCandidates("a0000001", [{ id: lib.listCandidates("a0000001")[1].id, label: "cyclists" }]);
    expect(lib.openProject(path.join(moved, "Projects", "Andradas.tcproj"))).toMatchObject({ groupId: r.groupId, added: 0, existing: 3 });
    expect(lib.listCandidates("a0000001")[1].label).toBe("cyclists");
  });

  it("never saves over another project (its saved decisions would be deleted)", () => {
    lib.saveGroup("g0000009", "Other");
    const other = path.join(root, "other.tcproj");
    fs.writeFileSync(other, "{}");
    expect(() => lib.saveProject("g0000009", other)).toThrow(lib.ProjectProblem);
    const opened = lib.listGroups().find((g) => g.project_file && g.id !== "g0000009")!;
    try {
      lib.saveProject("g0000009", opened.project_file!);
      throw new Error("should not save");
    } catch (e) {
      expect((e as InstanceType<typeof lib.ProjectProblem>).reason).toBe("exists");
    }
    expect(fs.readFileSync(other, "utf8")).toBe("{}");
  });

  it("an edited project file cannot point outside the job folder", () => {
    const dir = path.join(root, "evil");
    const file = path.join(dir, "evil.tcproj");
    write(path.join(dir, "evil.tcdata", "e0000001", "candidates.json"), JSON.stringify([
      { track: "1", line_id: "l1", frame: 1, time_s: 0, direction: "A->B", bbox: "[0,0,1,1]", yolo_class: "cyclists",
        filmstrip: "../../../../secret.jpg", context: "candidates/contexts/0.jpg", clip: "C:/Windows/win.ini", llm_status: "ok", origin: "track", label: "cyclists" },
    ]));
    write(file, JSON.stringify({
      format: "traffic-counter-project", version: 1, name: "Evil", saved_at: null,
      videos: [
        { id: "e0000001", name: "a.mp4", source: { type: "file", path: "a.mp4", relative: true }, lines: [], status: "pwned", data: "evil.tcdata/e0000001" },
        { id: "e0000002", name: "b.mp4", source: { type: "file", path: "b.mp4", relative: true }, lines: [], status: "reviewing", data: "../../outside" },
      ],
    }));
    const r = lib.openProject(file);
    expect(r.added).toBe(1); // the one whose data folder is outside the project is left out
    expect(lib.getJob("e0000001")!.status).toBe("error");
    const [c] = lib.listCandidates("e0000001");
    expect(c.filmstrip).toBeNull();
    expect(c.clip).toBeNull();
    expect(c.context).toBe("candidates/contexts/0.jpg");
    expect(() => lib.jobFile("e0000001", "../../secret.jpg")).toThrow();
  });

  it("refuses what is not a project, or one from a newer version", () => {
    const bad = path.join(root, "bad.tcproj");
    write(bad, "not json");
    expect(() => lib.openProject(bad)).toThrow(lib.ProjectProblem);
    write(bad, JSON.stringify({ format: "traffic-counter-project", version: 99, videos: [] }));
    try {
      lib.openProject(bad);
      throw new Error("should not open");
    } catch (e) {
      expect((e as InstanceType<typeof lib.ProjectProblem>).reason).toBe("newer");
    }
  });
});
