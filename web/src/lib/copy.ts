import fs from "node:fs";
import path from "node:path";

/**
 * Copies a file or folder, overwriting. Not fs.cpSync: on Windows (Node 22)
 * it garbles paths with accents ("Vídeos Finais" came out as "VÃ­deos
 * Finais", and the copy was then not found) — and user folders have them
 * ("Contador de Tráfego", user names). Symbolic links and junctions are skipped.
 */
export function copyTree(from: string, to: string): void {
  // links and junctions are not followed: a project folder from elsewhere could point at any file on the disk
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) return;
  if (!st.isDirectory()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name));
}
