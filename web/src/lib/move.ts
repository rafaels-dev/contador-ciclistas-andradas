import fs from "node:fs";
import path from "node:path";
import { jobWorking, renderWorking } from "./activity";
import { jobDir, listGroups, listJobs, listRenders, renderDir, setGroupProject, updateJob, updateRenderFolder } from "./db";
import { freeOn, inside } from "./fsutil";
import { idleMove, moveStateRef, wakeMoveWaiters, type MoveState } from "./move-state";
import { DATA_DIR } from "./paths";
import { mediaRebuilding } from "./runner";
import { chooseFolder, finalVideoName, folderOf, folderTarget, originalsFolder, projectsFolder, sizeOf, type FolderError, type FolderKind } from "./storage";

/**
 * Moving the content of a folder when the user points it somewhere else
 * (Settings → Storage: "Move everything there?"). Cristiano's program disk
 * filled up: he must be able to send what is already there to another disk.
 *
 * - temp: every job's temporary files — those in the current temporary
 *   folder and, for videos from before 0.0.10, the review images, the Drive
 *   copy and the preview that were left in the app data folder (what frees the
 *   program disk). The trajectories stay in the data folder.
 * - finals: every final video's folder (also the ones from before 0.0.10).
 * - project: the Projects and Original Videos folders; the project files and
 *   the videos' paths are updated.
 *
 * Each item is moved the safe way: a rename when on the same disk; otherwise
 * a copy, a check of every file's size, the database pointed at the copy, and
 * only then the original deleted. A failure leaves that item where it was,
 * still working. Asynchronous copies (fs.promises): tens of GB must not block
 * the app server. Nothing moves while a detection, suggestion, final video
 * or image rebuild is running.
 */

type Item = {
  from: string;
  to: string;
  bytes: number;
  /** points the database at the new place (after the copy is checked) */
  done: () => void;
};

export type { MoveState };
const state = moveStateRef;
const idle = idleMove;

export function moveState(): MoveState {
  return { ...state() };
}

/** Something is running that reads or writes these files. */
export function busy(): boolean {
  return listJobs().some((j) => jobWorking(j) || mediaRebuilding(j.id) !== null) || listRenders().some(renderWorking) || state().running;
}

const same = (a: string, b: string) => inside(a, b, { self: true }) && inside(b, a, { self: true });
/** `file` inside `from` → the same place inside `to` (null when not inside). */
const rebase = (file: string | null, from: string, to: string) =>
  file && inside(file, from) ? path.join(to, path.relative(from, file)) : null;

/** What would move to `target` (a folder already resolved by folderTarget). */
function plan(kind: FolderKind, target: string): Item[] {
  const items: Item[] = [];
  const add = (from: string, to: string, done: () => void) => {
    if (same(from, to) || inside(to, from) || !fs.existsSync(from)) return;
    const bytes = sizeOf(from);
    items.push({ from, to, bytes, done });
  };

  if (kind === "temp") {
    for (const j of listJobs()) {
      const to = path.join(target, "jobs", j.id);
      if (j.temp_folder) {
        add(j.temp_folder, to, () => updateJob(j.id, { temp_folder: to }));
        continue;
      }
      // before 0.0.10: what can be made again was left next to the trajectories
      const parts = ["candidates", "preview.jpg"];
      if (j.drive_id !== "local" && j.video_file && !path.isAbsolute(j.video_file)) parts.push(j.video_file);
      for (const rel of parts) {
        // jobFile looks in the temporary folder first and then in jobDir: each part works wherever it is
        add(path.join(jobDir(j.id), rel), path.join(to, rel), () => updateJob(j.id, { temp_folder: to }));
      }
    }
  } else if (kind === "finals") {
    for (const r of listRenders()) {
      const from = renderDir(r.id);
      // before 0.0.10 the folder was the bare id; it gets the readable name
      const name = r.folder ? path.basename(from) : finalVideoName(r.id, r.name);
      const to = path.join(target, name);
      add(from, to, () => updateRenderFolder(r.id, to));
    }
  } else {
    // only the app's two subfolders: the project files folder may hold other things (by
    // default even the final videos folder, which has its own setting)
    for (const from of [projectsFolder(), originalsFolder()]) {
      const to = path.join(target, path.basename(from));
      add(from, to, () => {
        for (const grp of listGroups()) {
          const file = rebase(grp.project_file, from, to);
          if (file) setGroupProject(grp.id, file, grp.project_saved_at);
        }
        for (const j of listJobs()) {
          const link = rebase(j.drive_link, from, to);
          const video = rebase(j.video_file, from, to);
          if (link || video) updateJob(j.id, { ...(link && { drive_link: link }), ...(video && { video_file: video }) });
        }
      });
    }
  }
  return items;
}

export type MovePlan = { target: string; bytes: number; items: number; free: number | null; busy: boolean };

/** How much would move if `kind` went to `folder` (null = the default), and whether it fits there. */
export function planFolderMove(kind: FolderKind, folder: string | null): MovePlan | { error: FolderError } {
  const target = folderTarget(kind, folder);
  if (typeof target !== "string") return target;
  const items = plan(kind, target);
  // the same disk: a rename takes no space
  const bytes = items.reduce((s, i) => s + i.bytes, 0);
  return { target, bytes, items: items.length, free: freeOn(target), busy: busy() };
}

/**
 * Changes the folder and, with `move`, starts moving its content there in the
 * background (follow with moveState). Refused while something is running.
 */
export function changeFolder(kind: FolderKind, folder: string | null, move: boolean): FolderError | "busy" | null {
  if (move && busy()) return "busy";
  const target = folderTarget(kind, folder);
  if (typeof target !== "string") return target.error;
  // planned before the change: the project files still come from the old folder
  const items = move ? plan(kind, target) : [];
  const error = chooseFolder(kind, folder);
  if (error) return error;
  if (move && kind === "temp") {
    // videos whose temporary folder has nothing yet: their next files go to the new place
    for (const j of listJobs()) {
      if (j.temp_folder && !fs.existsSync(j.temp_folder)) updateJob(j.id, { temp_folder: path.join(target, "jobs", j.id) });
    }
  }
  if (items.length) void run(kind, items);
  return null;
}

/** Moves the final videos from before 0.0.10 (in the app data folder) to the current final videos folder. */
export function moveOldFinals(): "busy" | null {
  if (busy()) return "busy";
  const items = plan("finals", folderOf("finals")).filter((i) => inside(i.from, path.join(DATA_DIR, "renders")));
  if (items.length) void run("finals", items);
  return null;
}

async function run(kind: FolderKind, items: Item[]): Promise<void> {
  const s = state();
  Object.assign(s, idle(), { running: true, kind, items: items.length, total: items.reduce((a, i) => a + i.bytes, 0) });
  try {
    for (const item of items) {
      s.current = path.basename(item.from);
      try {
        await moveItem(item, (n) => (s.copied += n));
        s.moved += 1;
      } catch (e) {
        s.failed += 1;
        console.error(`[move] ${item.from} → ${item.to}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    s.running = false;
    s.current = null;
    s.copied = s.total;
    wakeMoveWaiters();
  }
}

/** All files under a folder (or the file itself) with their sizes, by relative path. */
async function listFiles(root: string, rel = ""): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const st = await fs.promises.stat(path.join(root, rel));
  if (!st.isDirectory()) return out.set(rel, st.size);
  for (const e of await fs.promises.readdir(path.join(root, rel))) {
    for (const [k, v] of await listFiles(root, path.join(rel, e))) out.set(k, v);
  }
  return out;
}

/** Copies file by file (not fs.cp: it garbles accented paths on Windows), counting the bytes. */
async function copyAsync(from: string, to: string, onBytes: (n: number) => void): Promise<void> {
  const st = await fs.promises.stat(from);
  if (!st.isDirectory()) {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
    onBytes(st.size);
    return;
  }
  await fs.promises.mkdir(to, { recursive: true });
  for (const name of await fs.promises.readdir(from)) await copyAsync(path.join(from, name), path.join(to, name), onBytes);
}

async function moveItem(item: Item, onBytes: (n: number) => void): Promise<void> {
  await fs.promises.mkdir(path.dirname(item.to), { recursive: true });
  // the same disk and nothing at the destination: an instant rename
  if (!fs.existsSync(item.to)) {
    try {
      await fs.promises.rename(item.from, item.to);
      item.done();
      onBytes(item.bytes);
      return;
    } catch {
      // another disk (EXDEV) or a file in use: copy instead
    }
  }
  const files = await listFiles(item.from);
  await copyAsync(item.from, item.to, onBytes);
  const copied = await listFiles(item.to);
  for (const [rel, size] of files) {
    if (copied.get(rel) !== size) throw new Error(`the copy of ${rel} is incomplete`);
  }
  item.done();
  await fs.promises.rm(item.from, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
