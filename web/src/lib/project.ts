import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CANDIDATE_FIELDS,
  getGroup,
  getJob,
  groupByProjectFile,
  insertProjectJob,
  jobDir,
  listCandidates,
  listGroupJobs,
  moveJobs,
  saveGroup,
  setGroupProject,
  tempRoot,
  type CandidateData,
  type Job,
  type JobStatus,
} from "./db";
import { copyTree } from "./copy";
import { inside, safeName } from "./fsutil";
import { movedVideo } from "./legacy";
import { folderOf, projectsFolder } from "./storage";

/**
 * Project file: a library group saved to disk, to keep the work outside the
 * app database or take it to another computer — "Andradas.tcproj" (JSON:
 * the videos, their lines and where each original video is) and, next to
 * it, "Andradas.tcdata/<video id>/" with what cannot be made again without
 * processing the video again: trajectories, first frame, manual-count
 * thumbnails and every candidate with its suggestion and review decision.
 * The review images are not saved (they are made again from the
 * trajectories — "Make the images again" on the video page).
 *
 * A video inside the project files folder (Settings → Storage, e.g. its
 * Original Videos/ subfolder) is saved with a path relative to the project
 * file, so the whole folder can be moved or copied to another disk or
 * computer; a video anywhere else keeps its fixed (absolute) path.
 *
 * Opening never overwrites anything: a video already in the library (same
 * id) keeps what is in the database; the others come in with their saved
 * state.
 */
export const PROJECT_EXT = ".tcproj";
export const PROJECT_FORMAT = "traffic-counter-project";
export const PROJECT_VERSION = 1;

/** Lasting files of a video copied into the project data folder (all optional). */
const LASTING = ["tracks.json.gz", "tracks_meta.json", "points.json", "frame0.jpg", "lines.json", "manual"];

type Source = { type: "file"; path: string; relative: boolean } | { type: "drive"; drive_id: string; link: string };

export type ProjectVideo = {
  id: string;
  name: string | null;
  source: Source;
  camera_id: string | null;
  lines: unknown[];
  area: unknown | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  status: JobStatus;
  error: string | null;
  /** folder with its lasting files, relative to the project file */
  data: string;
};

export type ProjectFile = {
  format: typeof PROJECT_FORMAT;
  version: number;
  app_version: string | null;
  name: string;
  saved_at: string;
  videos: ProjectVideo[];
};

export type ProjectError = "notFound" | "invalid" | "newer" | "empty" | "notWritable" | "exists";
export class ProjectProblem extends Error {
  constructor(readonly reason: ProjectError, detail?: string) {
    super(detail ?? reason);
  }
}


/** How a video is written in a project file at `file`: relative when both are in the project files folder. */
export function videoReference(video: string, file: string, root = folderOf("project")): Source {
  if (inside(video, root, { self: true }) && inside(file, root, { self: true })) {
    // forward slashes: the same file opens on Windows, macOS and Linux
    return { type: "file", path: path.relative(path.dirname(file), video).split(path.sep).join("/"), relative: true };
  }
  return { type: "file", path: video, relative: false };
}

/** The video's place on this computer. */
export function resolveVideo(source: Extract<Source, { type: "file" }>, file: string): string {
  return source.relative ? path.resolve(path.dirname(file), ...source.path.split("/")) : source.path;
}

/** "Andradas.tcproj" → "Andradas.tcdata" */
export function dataFolderOf(file: string): string {
  return file.slice(0, -PROJECT_EXT.length) + ".tcdata";
}

/** Default place for a group's project file: Projects/<name>.tcproj, not taking another project's name. */
export function defaultProjectFile(name: string, groupId: string): string {
  const clean = safeName(name, "project");
  const dir = projectsFolder();
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${clean}${n > 1 ? ` (${n})` : ""}${PROJECT_EXT}`);
    const owner = groupByProjectFile(file);
    if (!fs.existsSync(file) || owner?.id === groupId) return file;
  }
}

/** The file a local job actually reads (video_file; drive_link is what was chosen when importing). */
function localVideo(j: Job): string {
  const file = j.video_file && path.isAbsolute(j.video_file) ? j.video_file : j.drive_link;
  return movedVideo(file) as string;
}

function copyLasting(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const name of LASTING) {
    const src = path.join(from, name);
    if (fs.existsSync(src)) copyTree(src, path.join(to, name));
  }
}

/** Writes a file without ever leaving half of it: a temporary file next to it, then a rename. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/** Saves a group as a project file (its current one, or `file`). Returns the file. */
export function saveProject(groupId: string, file?: string): string {
  const group = getGroup(groupId);
  if (!group) throw new ProjectProblem("notFound");
  const target = path.resolve(file ?? group.project_file ?? defaultProjectFile(group.name, groupId));
  const finalFile = target.toLowerCase().endsWith(PROJECT_EXT) ? target : target + PROJECT_EXT;
  // another project's file: saving over it would delete its saved trajectories and decisions
  const owner = groupByProjectFile(finalFile);
  if ((owner && owner.id !== groupId) || (!owner && fs.existsSync(finalFile))) throw new ProjectProblem("exists", finalFile);
  const dataDir = dataFolderOf(finalFile);
  const jobs = listGroupJobs(groupId);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    throw new ProjectProblem("notWritable", dataDir);
  }

  const videos: ProjectVideo[] = jobs.map((j) => {
    const data = path.join(dataDir, j.id);
    copyLasting(jobDir(j.id), data);
    const candidates = listCandidates(j.id).map((c) => Object.fromEntries(CANDIDATE_FIELDS.map((f) => [f, c[f]])) as CandidateData);
    writeAtomic(path.join(data, "candidates.json"), JSON.stringify(candidates));
    return {
      id: j.id,
      name: j.file_name,
      source: j.drive_id === "local" ? videoReference(localVideo(j), finalFile) : { type: "drive", drive_id: j.drive_id, link: j.drive_link },
      camera_id: j.camera_id,
      lines: JSON.parse(j.lines) as unknown[],
      area: j.area ? (JSON.parse(j.area) as unknown) : null,
      fps: j.fps,
      width: j.width,
      height: j.height,
      duration_s: j.duration_s,
      status: j.status,
      error: j.error,
      data: path.relative(path.dirname(finalFile), data).split(path.sep).join("/"),
    };
  });
  // videos taken out of the group since the last save
  const kept = new Set(jobs.map((j) => j.id));
  for (const name of fs.readdirSync(dataDir)) {
    if (/^[0-9a-f]{8}$/.test(name) && !kept.has(name)) fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
  }

  const savedAt = new Date().toISOString();
  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app_version: process.env.TRAFFIC_COUNTER_VERSION ?? null,
    name: group.name,
    saved_at: savedAt,
    videos,
  };
  writeAtomic(finalFile, JSON.stringify(project, null, 1));
  setGroupProject(groupId, finalFile, savedAt);
  return finalFile;
}

export function readProject(file: string): ProjectFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new ProjectProblem("notFound", file);
  }
  let p: ProjectFile;
  try {
    p = JSON.parse(raw) as ProjectFile;
  } catch {
    throw new ProjectProblem("invalid", file);
  }
  if (p?.format !== PROJECT_FORMAT || !Array.isArray(p.videos)) throw new ProjectProblem("invalid", file);
  if (p.version > PROJECT_VERSION) throw new ProjectProblem("newer", file);
  return p;
}

/** A step that was running when the project was saved did not survive: it is redone from the video page. */
const INTERRUPTED: Partial<Record<JobStatus, JobStatus>> = { downloading: "error", detecting: "error", rendering: "awaiting_review" };

/**
 * Opens a project file as a library group (the group that already came from
 * it, or a new one). Returns the group id and how many videos came in.
 */
export function openProject(file: string): { groupId: string; added: number; existing: number } {
  const target = path.resolve(file);
  const p = readProject(target);
  const groupId = groupByProjectFile(target)?.id ?? randomUUID().slice(0, 8);
  if (!getGroup(groupId)) saveGroup(groupId, p.name || path.basename(target, PROJECT_EXT));
  let added = 0;
  let existing = 0;
  for (const v of p.videos) {
    if (!/^[\w-]{1,40}$/.test(String(v.id))) continue;
    if (getJob(v.id)) {
      // already in the library: what is in the database is the most recent work
      existing += 1;
      moveJobs([v.id], groupId);
      continue;
    }
    const data = path.resolve(path.dirname(target), ...String(v.data).split("/"));
    let candidates: CandidateData[] = [];
    try {
      candidates = JSON.parse(fs.readFileSync(path.join(data, "candidates.json"), "utf8")) as CandidateData[];
    } catch {
      // a project saved before the detection: no candidates yet
    }
    const local = v.source.type === "file";
    const video = local ? resolveVideo(v.source as Extract<Source, { type: "file" }>, target) : null;
    const status = INTERRUPTED[v.status] ?? v.status;
    copyLasting(data, jobDir(v.id));
    insertProjectJob(
      {
        id: v.id,
        drive_link: local ? (video as string) : (v.source as Extract<Source, { type: "drive" }>).link,
        drive_id: local ? "local" : (v.source as Extract<Source, { type: "drive" }>).drive_id,
        file_name: v.name,
        camera_id: v.camera_id,
        lines: JSON.stringify(v.lines ?? []),
        area: v.area ? JSON.stringify(v.area) : null,
        video_file: local ? video : "video.mp4",
        temp_folder: path.join(tempRoot(), "jobs", v.id),
        group_id: groupId,
        fps: v.fps,
        width: v.width,
        height: v.height,
        duration_s: v.duration_s,
        status,
        error: status === "error" ? (v.error ?? JSON.stringify({ $t: "errors.interrupted" })) : null,
      } as Omit<Job, "created_at" | "updated_at" | "progress" | "message">,
      candidates,
    );
    added += 1;
  }
  setGroupProject(groupId, target, p.saved_at ?? null);
  return { groupId, added, existing };
}

export type ProjectEntry = { file: string; name: string; saved_at: string | null; videos: number; groupId: string | null };

/** Project files in the Projects folder, plus the ones already open elsewhere; most recent first. */
export function listProjects(): ProjectEntry[] {
  const files = new Set<string>();
  const dir = projectsFolder();
  try {
    for (const name of fs.readdirSync(dir)) if (name.toLowerCase().endsWith(PROJECT_EXT)) files.add(path.join(dir, name));
  } catch {
    // no Projects folder yet
  }
  const out: ProjectEntry[] = [];
  for (const file of files) {
    try {
      const p = readProject(file);
      out.push({ file, name: p.name, saved_at: p.saved_at ?? null, videos: p.videos.length, groupId: groupByProjectFile(file)?.id ?? null });
    } catch {
      // not a project of this app: left out
    }
  }
  return out.sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""));
}
