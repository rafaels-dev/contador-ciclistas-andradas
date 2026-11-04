"use server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { msg } from "@/i18n/message";
import { requireAccess } from "@/lib/access";
import { createJob, getGroup, updateJob } from "@/lib/db";
import { driveFileId, driveFolderId, listFolderVideos, type DriveFile } from "@/lib/drive";
import { isVideo, listFolder, localFilesAllowed, normalizePath, roots, type FolderContent, type FolderItem } from "@/lib/local-files";
import { deleteJobs, startDownload } from "@/lib/runner";

/** `error`: a stored message (show it with formatStored and the root translator). */
export type NewJobState = { error?: string; folder?: { id: string; files: DriveFile[] } };

/** Import target group (ignores an id that does not exist). */
function validGroup(id: unknown): string | null {
  const g = String(id ?? "");
  return g && getGroup(g) ? g : null;
}

export async function newJob(_prev: NewJobState, formData: FormData): Promise<NewJobState> {
  await requireAccess();
  const link = String(formData.get("link") ?? "").trim();
  const group = validGroup(formData.get("group"));

  const folderId = driveFolderId(link);
  if (folderId) {
    try {
      const files = await listFolderVideos(folderId);
      if (!files.length) return { error: msg("newJob.noVideosInFolder") };
      return { folder: { id: folderId, files } };
    } catch (e) {
      // a DriveError carries a stored message; anything else (network) is plain text
      return { error: (e as Error).message };
    }
  }

  const driveId = driveFileId(link);
  if (!driveId) {
    // a pasted path of a video on the computer works too
    const local = localFilesAllowed() && /^[A-Za-z]:[\/]|^["/]/.test(link) ? normalizePath(link) : null;
    if (local && fs.existsSync(local) && fs.statSync(local).isFile() && isVideo(local)) {
      redirect(`/jobs/${createLocalJob(local, group)}`);
    }
    return { error: msg(local ? "newJob.videoNotFound" : "newJob.invalidLink") };
  }

  const id = randomUUID().slice(0, 8);
  createJob({ id, drive_link: link, drive_id: driveId, group_id: group });
  startDownload(id);
  redirect(`/jobs/${id}`);
}

/** Job of a video on the computer: the file is read in place, no copy. */
function createLocalJob(file: string, group: string | null): string {
  const id = randomUUID().slice(0, 8);
  createJob({ id, drive_link: file, drive_id: "local", group_id: group });
  updateJob(id, { file_name: path.basename(file) });
  startDownload(id);
  return id;
}

/** `error`: a stored message (formatStored). `selected`: the video whose path was pasted. */
export type FolderState = { content?: FolderContent; roots: FolderItem[]; error?: string; selected?: string };

/** Folder browser of the computer (the app runs locally). No path: the user folder. */
export async function browseFolder(dirPath: string | null): Promise<FolderState> {
  await requireAccess();
  if (!localFilesAllowed()) return { roots: [], error: msg("localPicker.disabled") };
  const base = { roots: roots() };
  try {
    let target = dirPath ? normalizePath(dirPath) : base.roots[0].path;
    let selected: string | undefined;
    if (fs.statSync(target).isFile()) {
      // pasted the path of a video: opens its folder with the video checked
      selected = target;
      target = path.dirname(target);
    }
    return { ...base, content: listFolder(target), selected };
  } catch {
    return { ...base, error: msg("localPicker.folderNotFound") };
  }
}

export async function createLocalJobs(paths: string[], groupId: string | null = null): Promise<void> {
  await requireAccess();
  if (!localFilesAllowed()) return;
  const group = validGroup(groupId);
  const ids = paths
    .map(normalizePath)
    .filter((p) => isVideo(p) && fs.existsSync(p) && fs.statSync(p).isFile())
    .map((p) => createLocalJob(p, group));
  refresh(); // the side library (layout) is not rebuilt by the redirect alone
  if (ids.length === 1) redirect(`/jobs/${ids[0]}`);
  redirect(group ? `/?group=${group}` : "/");
}

/** One job per video checked in the folder; downloads start in parallel. */
export async function createJobsFromFolder(formData: FormData): Promise<void> {
  const chosen = formData.getAll("file").map(String);
  const group = validGroup(formData.get("group"));
  const ids: string[] = [];
  for (const item of chosen) {
    const [driveId, ...rest] = item.split("|");
    if (!/^[\w-]{20,}$/.test(driveId)) continue;
    const id = randomUUID().slice(0, 8);
    createJob({ id, drive_link: `https://drive.google.com/file/d/${driveId}/view`, drive_id: driveId, group_id: group });
    updateJob(id, { file_name: rest.join("|").slice(0, 200) || null });
    startDownload(id);
    ids.push(id);
  }
  refresh(); // the side library (layout) is not rebuilt by the redirect alone
  if (ids.length === 1) redirect(`/jobs/${ids[0]}`);
  redirect(group ? `/?group=${group}` : "/");
}

/** Removes the videos from the library (the original file on the computer is kept). */
export async function deleteVideos(ids: string[]): Promise<void> {
  await requireAccess();
  deleteJobs(ids.map(String).filter((id) => /^[\w-]{1,40}$/.test(id)));
  refresh();
}
