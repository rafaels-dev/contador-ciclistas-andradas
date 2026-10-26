import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrateLegacy } from "./legacy";
import { SCHEMA } from "./schema";
import { DATA_DIR, DB_FILE } from "./paths";

/**
 * Job flow (fixed order — the render only happens after the human review):
 *   downloading → awaiting_lines (the user draws the lines on the first frame)
 *   → detecting → suggesting (OpenRouter for EVERY candidate)
 *   → awaiting_review
 * Any step may go to `error` (message in jobs.error). The final video is a
 * separate `render`: it joins one or more jobs with a complete review (the
 * counter adds across them) and does not change the jobs' status — the review
 * stays editable and it can be generated again. (rendering/done: legacy.)
 */
export const JOB_STATUSES = [
  "downloading",
  "awaiting_lines",
  "detecting",
  "suggesting",
  "awaiting_review",
  "rendering",
  "done",
  "error",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// kick scooters (standing), electric mopeds (seated, no pedaling) and
// unicycles: only the vision model and the review tell them apart — YOLO
// delivers them as person/bicycle/motorcycle. "other": everything that moves
// and has no category of its own (including what only the worker's
// background subtraction saw)
export const CATEGORIES = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "cars", "motorcycles", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Counting line drawn by the user over the first frame: a segment at any
 * angle (bike lanes have different geometries per camera). Coordinates
 * normalized to 0–1 to be resolution independent. With no line at all, every
 * trajectory with a relevant displacement becomes a candidate.
 */
export type Line = {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** categories counted on this line (empty/absent = all); the others go to
   *  the review already proposed as discarded — see lib/review.ts */
  categories?: Category[];
};

/**
 * Analysis area (0–1 of the frame): the worker detects only inside it, at the
 * video's original resolution — on a high 4K camera, the distant cyclist
 * keeps the pixels the downscaled 1080p took away. Does not change the final video.
 */
export type Area = { x: number; y: number; w: number; h: number };

export type Job = {
  id: string;
  drive_link: string;
  drive_id: string;
  file_name: string | null;
  camera_id: string | null;
  lines: string; // JSON of Line[] — frozen copy at detection time
  area: string | null; // JSON of Area (null = whole frame)
  video_file: string | null; // relative to the job dir, or absolute (local video used in place)
  group_id: string | null; // library group (null = no group)
  fps: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  status: JobStatus;
  progress: number;
  /** progress text: plain text or an encoded translatable message (lib/i18n/message.ts) */
  message: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

/** Library group (a place, a collection day…): only organizes and eases the final video. */
export type Group = { id: string; name: string; created_at: string };



// globalThis: survives `next dev` hot reloads (otherwise each reload would
// reopen the database and mark running jobs as interrupted)
const g = globalThis as { __tcDb?: DatabaseSync };

/** Stored when a server restart interrupts a running step (translated on screen). */
export const INTERRUPTED = JSON.stringify({ $t: "errors.interrupted" });

export function db(): DatabaseSync {
  if (!g.__tcDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const d = new DatabaseSync(DB_FILE);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    // databases from versions in Portuguese (≤ 0.0.7): tables, columns,
    // values and the files of the processed videos move to the English names
    migrateLegacy(d, DATA_DIR);
    d.exec(SCHEMA);
    // new process: no worker survived the server restart
    d.prepare(
      `UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now')
       WHERE status IN ('downloading', 'detecting')`,
    ).run(INTERRUPTED);
    d.prepare(
      `UPDATE renders SET status = 'error', error = ?, updated_at = datetime('now')
       WHERE status IN ('queued', 'rendering')`,
    ).run(INTERRUPTED);
    g.__tcDb = d;
  }
  return g.__tcDb;
}

// node:sqlite returns null-prototype objects, which React does not serialize
// to Client Components — convert them into plain objects.
function plain(row: object): object {
  return { ...row };
}

export type Candidate = {
  id: number;
  job_id: string;
  track: string;
  line_id: string | null;
  frame: number;
  time_s: number;
  direction: string | null;
  bbox: string | null;
  yolo_class: Category | null;
  yolo_conf: number | null;
  alternative: Category | null;
  origin: string | null;
  n_obs: number | null;
  filmstrip: string | null;
  context: string | null;
  clip: string | null;
  llm_suggestion: Category | "discarded" | null;
  llm_cost: number | null;
  llm_conf: number | null;
  llm_reason: string | null;
  llm_model: string | null;
  llm_status: "pending" | "ok" | "failed";
  llm_error: string | null;
  label: Category | "discarded" | null;
  reviewed_at: string | null;
};

export type Camera = { id: string; name: string; lines: string; area: string | null; created_at: string };

type JobFields = Partial<Omit<Job, "id" | "created_at" | "updated_at">>;

export function updateJob(id: string, fields: JobFields): void {
  const keys = Object.keys(fields) as (keyof JobFields)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db()
    .prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), id);
}

export function listCandidates(jobId: string): Candidate[] {
  return db()
    .prepare("SELECT * FROM candidates WHERE job_id = ? ORDER BY frame, id")
    .all(jobId)
    .map(plain) as Candidate[];
}

export function replaceCandidates(
  jobId: string,
  items: Omit<Candidate, "id" | "job_id" | "llm_suggestion" | "llm_cost" | "llm_conf" | "llm_reason" | "llm_model" | "llm_status" | "llm_error" | "label" | "reviewed_at">[],
): void {
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM candidates WHERE job_id = ?").run(jobId);
    const ins = d.prepare(
      `INSERT INTO candidates (job_id, track, line_id, frame, time_s, direction, bbox, yolo_class,
         yolo_conf, alternative, origin, n_obs, filmstrip, context, clip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of items) {
      ins.run(jobId, c.track, c.line_id, c.frame, c.time_s, c.direction, c.bbox, c.yolo_class,
        c.yolo_conf, c.alternative, c.origin, c.n_obs, c.filmstrip, c.context, c.clip);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function listCameras(): Camera[] {
  return db().prepare("SELECT * FROM cameras ORDER BY name").all().map(plain) as Camera[];
}

export function saveCamera(id: string, name: string, lines: Line[], area?: Area | null): void {
  // area undefined = keeps the camera's (e.g. only the line categories changed)
  db()
    .prepare(
      `INSERT INTO cameras (id, name, lines, area) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, lines = excluded.lines,
         area = CASE WHEN ? THEN excluded.area ELSE cameras.area END`,
    )
    .run(id, name, JSON.stringify(lines), area ? JSON.stringify(area) : null, area === undefined ? 0 : 1);
}

export function listJobs(): Job[] {
  return db().prepare("SELECT * FROM jobs ORDER BY created_at DESC").all().map(plain) as Job[];
}

export function getJob(id: string): Job | undefined {
  const row = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? (plain(row) as Job) : undefined;
}

export function createJob(data: { id: string; drive_link: string; drive_id: string; group_id?: string | null }): void {
  db()
    .prepare("INSERT INTO jobs (id, drive_link, drive_id, group_id) VALUES (?, ?, ?, ?)")
    .run(data.id, data.drive_link, data.drive_id, data.group_id ?? null);
}

export function listGroups(): (Group & { n: number })[] {
  return db()
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM jobs j WHERE j.group_id = g.id) AS n
       FROM groups g ORDER BY g.name COLLATE NOCASE`,
    )
    .all()
    .map(plain) as (Group & { n: number })[];
}

export function getGroup(id: string): Group | undefined {
  const row = db().prepare("SELECT * FROM groups WHERE id = ?").get(id);
  return row ? (plain(row) as Group) : undefined;
}

export function saveGroup(id: string, name: string): void {
  db()
    .prepare("INSERT INTO groups (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
    .run(id, name);
}

/** Deletes only the group: the videos stay in the library, without a group. */
export function deleteGroup(id: string): void {
  const d = db();
  d.prepare("UPDATE jobs SET group_id = NULL WHERE group_id = ?").run(id);
  d.prepare("DELETE FROM groups WHERE id = ?").run(id);
}

export function moveJobs(ids: string[], groupId: string | null): void {
  const upd = db().prepare("UPDATE jobs SET group_id = ? WHERE id = ?");
  for (const id of ids) upd.run(groupId, id);
}

export function recordSuggestion(
  id: number,
  data: {
    llm_suggestion: string | null;
    llm_conf: number | null;
    llm_reason: string | null;
    llm_model: string | null;
    llm_cost: number | null;
    llm_status: "ok" | "failed" | "pending";
    /** error JSON (only when it failed); omitted = cleared */
    llm_error?: string | null;
  },
): void {
  db()
    .prepare(
      `UPDATE candidates SET llm_suggestion = ?, llm_conf = ?, llm_reason = ?, llm_model = ?, llm_cost = ?, llm_status = ?, llm_error = ?
       WHERE id = ?`,
    )
    .run(data.llm_suggestion, data.llm_conf, data.llm_reason, data.llm_model, data.llm_cost, data.llm_status, data.llm_error ?? null, id);
}

/** Candidates whose suggestion failed, across all jobs (diagnostics report). */
export function listFailedCandidates(limit = 200): Candidate[] {
  return db()
    .prepare(`SELECT * FROM candidates WHERE llm_status = 'failed' ORDER BY job_id, id LIMIT ?`)
    .all(limit)
    .map(plain) as Candidate[];
}

/** How many candidates per line, detector class and suggestion status ("nothing was counted" diagnostics). */
export function candidateSummary(jobId: string): { line_id: string | null; yolo_class: string | null; origin: string | null; llm_status: string; llm_suggestion: string | null; label: string | null; n: number }[] {
  return db()
    .prepare(
      `SELECT line_id, yolo_class, origin, llm_status, llm_suggestion, label, COUNT(*) AS n FROM candidates
       WHERE job_id = ? GROUP BY line_id, yolo_class, origin, llm_status, llm_suggestion, label ORDER BY line_id, n DESC`,
    )
    .all(jobId)
    .map(plain) as ReturnType<typeof candidateSummary>;
}

/** Saves human decisions (label null = back to pending). Only touches the job's candidates. */
export function reviewCandidates(jobId: string, decisions: { id: number; label: Category | "discarded" | null }[]): void {
  const d = db();
  const upd = d.prepare(
    `UPDATE candidates SET label = ?, reviewed_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END
     WHERE id = ? AND job_id = ?`,
  );
  d.exec("BEGIN");
  try {
    for (const x of decisions) upd.run(x.label, x.label, x.id, jobId);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function reviewSummary(jobId: string): { total: number; reviewed: number } {
  const r = db()
    .prepare("SELECT COUNT(*) AS total, COUNT(label) AS reviewed FROM candidates WHERE job_id = ?")
    .get(jobId) as { total: number; reviewed: number };
  return { total: r.total, reviewed: r.reviewed };
}

export function suggestionSummary(jobId: string): { total: number; ok: number; failed: number; cost: number } {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(llm_status = 'ok') AS ok, SUM(llm_status = 'failed') AS failed,
              COALESCE(SUM(llm_cost), 0) AS cost FROM candidates WHERE job_id = ?`,
    )
    .get(jobId) as { total: number; ok: number | null; failed: number | null; cost: number };
  return { total: r.total, ok: r.ok ?? 0, failed: r.failed ?? 0, cost: r.cost };
}

export type RenderStatus = "queued" | "rendering" | "ready" | "error";

export type Render = {
  id: string;
  name: string;
  jobs: string; // JSON of string[]
  /** JSON of Category[] included in the video and the count; null = all */
  categories: string | null;
  status: RenderStatus;
  progress: number;
  message: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export function createRender(id: string, name: string, jobs: string[], categories: Category[] | null = null): void {
  db().prepare("INSERT INTO renders (id, name, jobs, categories) VALUES (?, ?, ?, ?)").run(id, name, JSON.stringify(jobs), categories ? JSON.stringify(categories) : null);
}

export function getRender(id: string): Render | undefined {
  const row = db().prepare("SELECT * FROM renders WHERE id = ?").get(id);
  return row ? (plain(row) as Render) : undefined;
}

export function listRenders(): Render[] {
  return db().prepare("SELECT * FROM renders ORDER BY created_at DESC").all().map(plain) as Render[];
}

export function updateRender(id: string, fields: Partial<Pick<Render, "status" | "progress" | "message" | "error" | "categories">>): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  db()
    .prepare(`UPDATE renders SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), id);
}

export function readSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function writeSetting(key: string, value: string | null): void {
  if (value === null) db().prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
