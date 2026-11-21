-- Work Log schema
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD (your local day)
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Other',
  status      TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('plan','prog','done','block')),
  minutes     REAL NOT NULL DEFAULT 0,
  note        TEXT NOT NULL DEFAULT '',
  carried     INTEGER NOT NULL DEFAULT 0,    -- 1 = a copy was brought forward to a later day
  from_date   TEXT,                          -- set on the copy: the day it was carried from
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(status, carried, date);

-- Small key/value store: email settings, running timer, export token
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
