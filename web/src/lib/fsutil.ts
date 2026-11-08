import fs from "node:fs";
import path from "node:path";

/** `child` is inside `parent` (with `self`, also when it is `parent` itself). Case-insensitive on Windows. */
export function inside(child: string, parent: string, { self = false } = {}): boolean {
  const fold = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(fold(parent), fold(child));
  if (rel === "") return self;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** A file/folder name Windows accepts (no reserved characters, no trailing dot/space). */
export function safeName(name: string, fallback: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80).replace(/[. ]+$/, "") || fallback;
}

/** Free space on the disk of `folder` (it may not exist yet: the nearest existing parent is on the same disk). */
export function freeOn(folder: string): number | null {
  for (let p = path.resolve(folder); ; p = path.dirname(p)) {
    try {
      const st = fs.statfsSync(p);
      return st.bavail * st.bsize;
    } catch {
      if (path.dirname(p) === p) return null;
    }
  }
}

/** A string matched literally inside a regular expression (pkill -f patterns). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
