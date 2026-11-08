import path from "node:path";
// old variable names (CONTADOR_DADOS…) before anything below reads them
import "./legacy-env";

// turbopackIgnore: without it the build's file tracing tries to include the
// whole repository and the videos in data/ (tens of GB) in the server

/**
 * Repository root (where config.py, requirements.txt, the YOLO weights and
 * the Python worker live). In the desktop app, the installer's resources folder.
 */
export const REPO_ROOT = process.env.TRAFFIC_COUNTER_ROOT ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");

/** Local app data: the database (and, before 0.0.10, the per-job files). Ignored by git. */
export const DATA_DIR = process.env.TRAFFIC_COUNTER_DATA ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const DB_FILE = path.join(DATA_DIR, "app.db");

// jobDir/renderDir: in db.ts (each job and final video records its folder)
