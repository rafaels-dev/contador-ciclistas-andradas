import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Videos on the computer itself, used in place (no copy). The app runs on
 * the user's machine, so the server browses the folders instead of the
 * browser's file picker (which does not reveal the file path).
 */

/**
 * Browsing folders exposes the disk to whoever reaches the app: that is why
 * the server only listens on 127.0.0.1 (package.json scripts) and, if it is
 * ever published on a network, TRAFFIC_COUNTER_LOCAL_FILES=0 turns local videos off.
 */
export function localFilesAllowed(): boolean {
  return process.env.TRAFFIC_COUNTER_LOCAL_FILES !== "0";
}

export const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".m4v", ".ts", ".webm"];

/** `home`: the user folder (the screen shows its translated name). */
export type FolderItem = { name: string; path: string; bytes?: number; home?: boolean };
export type FolderContent = { path: string; parent: string | null; folders: FolderItem[]; videos: FolderItem[] };

/**
 * Accepts whatever the user pastes: strips quotes (Windows' "Copy as path"
 * adds them) and, with the server on Linux/WSL, turns C:\folder into /mnt/c/folder.
 */
export function normalizePath(raw: string): string {
  let p = raw.trim().replace(/^"(.*)"$/, "$1");
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (win && process.platform !== "win32") {
    p = path.posix.join("/mnt", win[1].toLowerCase(), win[2].replace(/\\/g, "/"));
  }
  return path.resolve(p);
}

export function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/** Shortcuts to start browsing: the user folder and the drives. */
export function roots(): FolderItem[] {
  const list: FolderItem[] = [{ name: path.basename(os.homedir()), path: os.homedir(), home: true }];
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (fs.existsSync(`${letter}:\\`)) list.push({ name: `${letter}:`, path: `${letter}:\\` });
    }
  } else {
    // WSL: Windows drives mounted at /mnt/<letter>
    for (const d of fs.existsSync("/mnt") ? fs.readdirSync("/mnt") : []) {
      if (/^[a-z]$/.test(d)) list.push({ name: `${d.toUpperCase()}: (Windows)`, path: `/mnt/${d}` });
    }
  }
  return list;
}

function opens(folder: string): boolean {
  try {
    fs.opendirSync(folder).closeSync();
    return true;
  } catch {
    return false;
  }
}

export function listFolder(dir: string): FolderContent {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: FolderItem[] = [];
  const videos: FolderItem[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("$")) continue; // hidden and system
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full); // follows shortcuts/symlinks
      if (st.isDirectory()) {
        // Windows: the user folder has compatibility junctions ("Application
        // Data", "Cookies", "My Documents"…) that do not open — they would only confuse
        if (process.platform === "win32" && e.isSymbolicLink() && !opens(full)) continue;
        folders.push({ name: e.name, path: full });
      }
      else if (st.isFile() && isVideo(e.name)) videos.push({ name: e.name, path: full, bytes: st.size });
    } catch {
      // no permission or broken link: not listed
    }
  }
  const order = (a: FolderItem, b: FolderItem) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, folders: folders.sort(order), videos: videos.sort(order) };
}
