-- Projects: what a task belongs to (e.g. "Barcode API"), alongside its area (DevOps, Backend…)
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#2457e6',
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name COLLATE NOCASE);

ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, date);

-- Carry-over guard: each task can be carried forward at most once, even if two requests race.
ALTER TABLE tasks ADD COLUMN carried_from TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_carried_from ON tasks(carried_from) WHERE carried_from IS NOT NULL;

-- Server-side sessions, so logging out really ends the session.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Old global lockout record is replaced by per-IP records.
DELETE FROM settings WHERE key = 'login_lock';
