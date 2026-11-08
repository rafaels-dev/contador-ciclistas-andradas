import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/locales";
import { jobWorking, renderWorking } from "./activity";
import { SYSTEM_TEMP_DIR, jobDir, jobFile, jobTempDir, listJobs, listRenders, readSetting, renderDir, reviewSummary, tempRoot, writeSetting } from "./db";
import { freeOn, safeName } from "./fsutil";
import { DATA_DIR } from "./paths";

/**
 * Where the app keeps files (Settings → Storage). Cristiano filled his
 * program disk with a 24-hour video: up to 0.0.9 everything went to the app
 * data folder — the Drive copy, the review images (~120 MB per hour) and the
 * final video (2 Mbit/s: ~21 GB for 24 h of whole video). Three folders now:
 *
 * - temp: what can be made again (review images and clips, Drive copy,
 *   detection preview). The system temporary folder by default, inside its
 *   own "Traffic Counter" subfolder.
 * - finals: the final videos (MP4, spreadsheet, report), one subfolder each.
 *   Documents/Traffic Counter/Final Videos by default.
 * - project: the project files folder, with Projects/ (.tcproj + .tcdata,
 *   lib/project.ts) and Original Videos/ (videos inside it are referenced by a
 *   relative path). Documents/Traffic Counter by default.
 *
 * The database and each video's lasting files (trajectories, first frame,
 * manual-count thumbnails: what would need the video processed again) stay
 * in the app data folder, as up to 0.0.9. Changing a folder applies to the
 * next videos: nothing is moved without the user asking.
 */
export const FOLDERS = ["temp", "finals", "project"] as const;
export type FolderKind = (typeof FOLDERS)[number];

const SETTING: Record<FolderKind, string> = { temp: "temp_dir", finals: "finals_dir", project: "project_dir" };

/** Subfolder names, in the app language when created; an existing one in any language is kept. */
const NAMES: Record<"projects" | "originals" | "finals", Record<Locale, string>> = {
  projects: { en: "Projects", "pt-BR": "Projetos", es: "Proyectos", fr: "Projets", de: "Projekte", nl: "Projecten", it: "Progetti", da: "Projekter" },
  originals: {
    en: "Original Videos",
    "pt-BR": "Vídeos Originais",
    es: "Videos Originales",
    fr: "Vidéos originales",
    de: "Originalvideos",
    nl: "Originele video's",
    it: "Video originali",
    da: "Originale videoer",
  },
  finals: { en: "Final Videos", "pt-BR": "Vídeos Finais", es: "Videos Finales", fr: "Vidéos finales", de: "Fertige Videos", nl: "Eindvideo's", it: "Video finali", da: "Færdige videoer" },
};

function subfolder(root: string, kind: keyof typeof NAMES): string {
  for (const name of Object.values(NAMES[kind])) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, NAMES[kind][appLocale()]);
}

/** Documents/Traffic Counter (Electron passes the system's Documents folder). */
function documentsRoot(): string {
  return path.join(process.env.TRAFFIC_COUNTER_DOCUMENTS || path.join(os.homedir(), "Documents"), "Traffic Counter");
}

function defaultFolder(kind: FolderKind): string {
  if (kind === "temp") return process.env.TRAFFIC_COUNTER_TEMP || SYSTEM_TEMP_DIR;
  if (kind === "finals") return process.env.TRAFFIC_COUNTER_FINALS || subfolder(documentsRoot(), "finals");
  return process.env.TRAFFIC_COUNTER_PROJECT || documentsRoot();
}

export function folderOf(kind: FolderKind): string {
  if (kind === "temp") return tempRoot();
  return readSetting(SETTING[kind]) || defaultFolder(kind);
}

/** Projects/ inside the project files folder (created on use). */
export function projectsFolder(): string {
  return subfolder(folderOf("project"), "projects");
}

/** Original Videos/ inside the project files folder (created on use). */
export function originalsFolder(): string {
  return subfolder(folderOf("project"), "originals");
}

/** "Andradas_06.mp4 + Andradas_07.mp4 (382e27a0)": a final video's folder name. */
export function finalVideoName(renderId: string, name: string): string {
  // what Windows does not accept in a name, and a name ending in a dot/space
  return `${safeName(name, "video")} (${renderId})`;
}

/** Folder of a new final video: "<name> (<id>)" in the final videos folder. */
export function finalVideoFolder(renderId: string, name: string): string {
  return path.join(folderOf("finals"), finalVideoName(renderId, name));
}

export type FolderError = "notAbsolute" | "notWritable";

/**
 * Where a chosen folder really goes (null = the default): the temporary files
 * get the app's own subfolder, never mixed with the user's files.
 */
export function folderTarget(kind: FolderKind, folder: string | null): string | { error: FolderError } {
  if (folder === null) return defaultFolder(kind);
  const clean = folder.trim();
  if (!path.isAbsolute(clean)) return { error: "notAbsolute" };
  const name = path.basename(SYSTEM_TEMP_DIR);
  return path.resolve(kind === "temp" && path.basename(clean) !== name ? path.join(clean, name) : clean);
}

/** Changes one of the folders (null = back to the default). Applies to what is created from now on (lib/move.ts moves the rest). */
export function chooseFolder(kind: FolderKind, folder: string | null): FolderError | null {
  const target = folderTarget(kind, folder);
  if (typeof target !== "string") return target.error;
  try {
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe);
  } catch {
    return "notWritable";
  }
  writeSetting(SETTING[kind], path.resolve(target) === path.resolve(defaultFolder(kind)) ? null : target);
  return null;
}

// ---------------------------------------------------------------- space

/**
 * What can be deleted, by kind — never something in use (a detection, a
 * final video being generated) and never the review decisions:
 * - finalVideos: the MP4 of final videos already generated (the count, the
 *   spreadsheet and the report stay; "Generate again" makes it again).
 * - reviewMedia: images and clips of videos whose review is complete.
 * - driveVideos: copies downloaded from the Drive (downloaded again for a final video).
 * - leftovers: folders of videos and final videos no longer in the app.
 */
export const KINDS = ["finalVideos", "reviewMedia", "driveVideos", "leftovers"] as const;
export type Kind = (typeof KINDS)[number];

export type FolderInfo = { path: string; isDefault: boolean; free: number | null; bytes: number };

export type Usage = {
  folders: Record<FolderKind, FolderInfo>;
  /** the app data folder: database + each video's lasting files */
  data: { path: string; bytes: number };
  kinds: Record<Kind, { bytes: number; items: number }>;
  /** final videos from before 0.0.10, still in the app data folder (can be moved to the final videos folder) */
  oldFinals: { bytes: number; items: number };
};

/** Size of a file or folder (0 if missing). */
export function sizeOf(target: string): number {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of fs.readdirSync(target)) n += sizeOf(path.join(target, e));
  return n;
}


type Target = { kind: Kind; path: string };

function targets(): Target[] {
  const out: Target[] = [];
  const jobs = listJobs();
  const renders = listRenders();
  // a final video being generated reads its videos' files
  const inUse = new Set(renders.filter(renderWorking).flatMap((r) => JSON.parse(r.jobs) as string[]));

  for (const r of renders) {
    if (!renderWorking(r)) out.push({ kind: "finalVideos", path: path.join(renderDir(r.id), "final_video.mp4") });
  }
  for (const j of jobs) {
    if (jobWorking(j) || inUse.has(j.id)) continue;
    const review = reviewSummary(j.id);
    if (["awaiting_review", "rendering", "done"].includes(j.status) && review.total > 0 && review.reviewed === review.total) {
      out.push({ kind: "reviewMedia", path: jobFile(j.id, "candidates") });
    }
    if (j.drive_id !== "local" && j.video_file && !path.isAbsolute(j.video_file)) {
      out.push({ kind: "driveVideos", path: jobFile(j.id, j.video_file) });
    }
  }
  // folders of items no longer in the database (only the app's own: 8-hex ids), in this
  // app's folders only — another copy of the app on the computer may share the system temporary folder
  const known = new Set([
    ...jobs.flatMap((j) => [jobDir(j.id), jobTempDir(j.id)]),
    ...renders.map((r) => renderDir(r.id)),
  ].map((p) => path.resolve(p)));
  const parents = new Set(
    [path.join(DATA_DIR, "jobs"), path.join(DATA_DIR, "renders")].map((p) => path.resolve(p)),
  );
  for (const parent of parents) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(parent);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(parent, name);
      if (/^[0-9a-f]{8}$/.test(name) && !known.has(p)) out.push({ kind: "leftovers", path: p });
    }
  }
  return out;
}

export function storageUsage(): Usage {
  const kinds = Object.fromEntries(KINDS.map((k) => [k, { bytes: 0, items: 0 }])) as Usage["kinds"];
  for (const t of targets()) {
    const bytes = sizeOf(t.path);
    if (!bytes) continue;
    kinds[t.kind].bytes += bytes;
    kinds[t.kind].items += 1;
  }
  const folders = Object.fromEntries(
    FOLDERS.map((k) => {
      const p = folderOf(k);
      const isDefault = path.resolve(p) === path.resolve(defaultFolder(k));
      // the project files folder may hold the user's own videos: only the projects are measured
      const bytes = k === "project" ? sizeOf(projectsFolder()) : sizeOf(p);
      return [k, { path: p, isDefault, free: freeOn(p), bytes }];
    }),
  ) as Usage["folders"];
  const oldFinals = { bytes: 0, items: 0 };
  for (const r of oldFinalVideos()) {
    oldFinals.bytes += sizeOf(path.join(DATA_DIR, "renders", r.id));
    oldFinals.items += 1;
  }
  return { folders, data: { path: DATA_DIR, bytes: sizeOf(path.join(DATA_DIR, "jobs")) + sizeOf(path.join(DATA_DIR, "renders")) }, kinds, oldFinals };
}

/** Deletes the chosen kinds; returns the bytes freed. A file still open (Windows) stays and goes to the log. */
export function freeSpace(kinds: Kind[]): number {
  const chosen = new Set(kinds);
  let freed = 0;
  for (const t of targets()) {
    if (!chosen.has(t.kind)) continue;
    const bytes = sizeOf(t.path);
    if (!bytes) continue;
    try {
      fs.rmSync(t.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      freed += bytes;
    } catch (e) {
      console.error(`[storage] ${t.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return freed;
}

// ---------------------------------------------------------------- moving the old final videos

/** Final videos from before 0.0.10 still in the app data folder (lib/move.ts moves them to the final videos folder). */
export function oldFinalVideos() {
  return listRenders().filter((r) => !r.folder && !renderWorking(r) && fs.existsSync(path.join(DATA_DIR, "renders", r.id)));
}
