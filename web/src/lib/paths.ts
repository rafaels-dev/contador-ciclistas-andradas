import path from "node:path";

// turbopackIgnore: without it the build's file tracing tries to include the
// whole repository and the videos in data/ (tens of GB) in the server

/**
 * Repository root (where config.py, requirements.txt, the YOLO weights and
 * the Python worker live). In the desktop app, the installer's resources folder.
 */
export const REPO_ROOT = process.env.TRAFFIC_COUNTER_ROOT ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");

/** Local app data (database + per-job files). Ignored by git. */
export const DATA_DIR = process.env.TRAFFIC_COUNTER_DATA ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const DB_FILE = path.join(DATA_DIR, "app.db");

export function jobDir(jobId: string): string {
  return path.join(DATA_DIR, "jobs", jobId);
}

export function renderDir(renderId: string): string {
  return path.join(DATA_DIR, "renders", renderId);
}
