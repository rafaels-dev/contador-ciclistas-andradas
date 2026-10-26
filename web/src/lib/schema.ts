/** Database schema (also used by the legacy migration in lib/legacy.ts). */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cameras (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  lines       TEXT NOT NULL DEFAULT '[]',
  area        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- app preferences (GPU, first run, language…); the OpenRouter key is not
-- here but in the configuration file (lib/env.ts)
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  drive_link  TEXT NOT NULL,
  drive_id    TEXT NOT NULL,
  file_name   TEXT,
  camera_id   TEXT REFERENCES cameras(id),
  lines       TEXT NOT NULL DEFAULT '[]',
  area        TEXT,
  video_file  TEXT,
  group_id    TEXT REFERENCES groups(id) ON DELETE SET NULL,
  fps         REAL,
  width       INTEGER,
  height      INTEGER,
  duration_s  REAL,
  status      TEXT NOT NULL DEFAULT 'downloading',
  progress    REAL NOT NULL DEFAULT 0,
  message     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  track           TEXT NOT NULL,    -- '<group>:<tid>' (ped|bike|car|moto|motion)
  line_id         TEXT,             -- line crossed (NULL = no-line mode)
  frame           INTEGER NOT NULL, -- event frame (crossing or middle of the trajectory)
  time_s          REAL NOT NULL,
  direction       TEXT,             -- 'A→B' | 'B→A' relative to the line
  bbox            TEXT,             -- JSON [x1,y1,x2,y2] in px on the event frame
  yolo_class      TEXT,             -- category suggested by the detector
  yolo_conf       REAL,
  alternative     TEXT,             -- another plausible category (bike×moto)
  origin          TEXT,             -- track | motion | person_on_bicycle | person_on_motorcycle
  n_obs           INTEGER,
  filmstrip       TEXT,             -- path relative to the job dir
  context         TEXT,             -- cropped event frame (for the vision model)
  clip            TEXT,
  llm_suggestion  TEXT,             -- category suggested by OpenRouter (or 'discarded')
  llm_cost        REAL,             -- US$ of the call (reported by OpenRouter)
  llm_conf        REAL,
  llm_reason      TEXT,
  llm_model       TEXT,
  llm_status      TEXT NOT NULL DEFAULT 'pending', -- pending | ok | failed
  llm_error       TEXT,             -- JSON with the last attempt's error (HTTP status, provider response…)
  label           TEXT,             -- human decision: category or 'discarded'
  reviewed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);

CREATE TABLE IF NOT EXISTS renders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  jobs        TEXT NOT NULL,              -- JSON: job ids, in video order
  categories  TEXT,                       -- JSON of Category[]; NULL = all
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | rendering | ready | error
  progress    REAL NOT NULL DEFAULT 0,
  message     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`;
