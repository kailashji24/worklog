import { DEFAULT_SETTINGS, STATUSES, type Project, type Settings, type Status, type Task, type Timer } from "../shared/types";

interface TaskRow {
  id: string;
  date: string;
  title: string;
  category: string;
  status: Status;
  minutes: number;
  note: string;
  project_id: string | null;
  carried: number;
  from_date: string | null;
  created_at: number;
  updated_at: number;
}

interface ProjectRow {
  id: string;
  name: string;
  color: string;
  archived: number;
  created_at: number;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  date: r.date,
  title: r.title,
  category: r.category,
  status: r.status,
  minutes: r.minutes,
  note: r.note,
  projectId: r.project_id ?? null,
  carried: !!r.carried,
  fromDate: r.from_date,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, color: r.color, archived: !!r.archived, createdAt: r.created_at });

export const isStatus = (s: unknown): s is Status => typeof s === "string" && (STATUSES as readonly string[]).includes(s);

/* ---------------- tasks ---------------- */

export async function listTasks(db: D1Database, from: string, to: string): Promise<Task[]> {
  const { results } = await db.prepare("SELECT * FROM tasks WHERE date BETWEEN ?1 AND ?2 ORDER BY date, created_at").bind(from, to).all<TaskRow>();
  return results.map(toTask);
}

export async function listAllTasks(db: D1Database): Promise<Task[]> {
  const { results } = await db.prepare("SELECT * FROM tasks ORDER BY date, created_at").all<TaskRow>();
  return results.map(toTask);
}

/** Unfinished tasks from before `day` that haven't been carried forward yet. */
export async function listOpenBefore(db: D1Database, day: string): Promise<Task[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE status != 'done' AND carried = 0 AND date < ?1 ORDER BY date, created_at LIMIT 200")
    .bind(day)
    .all<TaskRow>();
  return results.map(toTask);
}

export async function getTask(db: D1Database, id: string): Promise<Task | null> {
  const r = await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<TaskRow>();
  return r ? toTask(r) : null;
}

const INSERT_TASK =
  "INSERT INTO tasks (id,date,title,category,status,minutes,note,project_id,carried,from_date,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)";
const bindTask = (s: D1PreparedStatement, t: Task) =>
  s.bind(t.id, t.date, t.title, t.category, t.status, t.minutes, t.note, t.projectId, t.carried ? 1 : 0, t.fromDate, t.createdAt, t.updatedAt);

export const insertTaskStmt = (db: D1Database, t: Task) => bindTask(db.prepare(INSERT_TASK), t);
export const upsertTaskStmt = (db: D1Database, t: Task) => bindTask(db.prepare(INSERT_TASK.replace("INSERT INTO", "INSERT OR REPLACE INTO")), t);

export async function insertTask(db: D1Database, t: Task) {
  await insertTaskStmt(db, t).run();
}

export async function saveTask(db: D1Database, t: Task) {
  await db
    .prepare("UPDATE tasks SET date=?2,title=?3,category=?4,status=?5,minutes=?6,note=?7,project_id=?8,carried=?9,from_date=?10,updated_at=?11 WHERE id=?1")
    .bind(t.id, t.date, t.title, t.category, t.status, t.minutes, t.note, t.projectId, t.carried ? 1 : 0, t.fromDate, Date.now())
    .run();
}

export async function deleteTask(db: D1Database, id: string) {
  await db.prepare("DELETE FROM tasks WHERE id = ?1").bind(id).run();
}

/**
 * Bring unfinished tasks from before `today` into today, in one atomic batch.
 * The unique index on carried_from means a task can only ever be copied once,
 * so two simultaneous taps can't create duplicates.
 */
export async function carryForward(db: D1Database, today: string): Promise<number> {
  const now = Date.now();
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks (id,date,title,category,status,minutes,note,project_id,carried,from_date,carried_from,created_at,updated_at)
         SELECT lower(hex(randomblob(16))), ?1, title, category, status, 0, note, project_id, 0, date, id, ?2, ?2
         FROM tasks WHERE status != 'done' AND carried = 0 AND date < ?1`,
      )
      .bind(today, now),
    db
      .prepare("UPDATE tasks SET carried = 1, updated_at = ?2 WHERE status != 'done' AND carried = 0 AND date < ?1 AND id IN (SELECT carried_from FROM tasks WHERE carried_from IS NOT NULL)")
      .bind(today, now),
  ]);
  return ins.meta.changes ?? 0;
}

/* ---------------- projects ---------------- */

export async function listProjects(db: D1Database): Promise<Project[]> {
  const { results } = await db.prepare("SELECT * FROM projects ORDER BY archived, name COLLATE NOCASE").all<ProjectRow>();
  return results.map(toProject);
}

export async function getProject(db: D1Database, id: string): Promise<Project | null> {
  const r = await db.prepare("SELECT * FROM projects WHERE id = ?1").bind(id).first<ProjectRow>();
  return r ? toProject(r) : null;
}

export async function findProjectByName(db: D1Database, name: string): Promise<Project | null> {
  const r = await db.prepare("SELECT * FROM projects WHERE name = ?1 COLLATE NOCASE").bind(name).first<ProjectRow>();
  return r ? toProject(r) : null;
}

export async function insertProject(db: D1Database, p: Project) {
  await db.prepare("INSERT INTO projects (id,name,color,archived,created_at) VALUES (?1,?2,?3,?4,?5)").bind(p.id, p.name, p.color, p.archived ? 1 : 0, p.createdAt).run();
}

export async function saveProject(db: D1Database, p: Project) {
  await db.prepare("UPDATE projects SET name=?2, color=?3, archived=?4 WHERE id=?1").bind(p.id, p.name, p.color, p.archived ? 1 : 0).run();
}

/** Deleting a project keeps its tasks; they just lose the project. */
export async function deleteProject(db: D1Database, id: string) {
  await db.batch([db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?1").bind(id), db.prepare("DELETE FROM projects WHERE id = ?1").bind(id)]);
}

/* ---------------- key/value settings ---------------- */

export async function getKV<T>(db: D1Database, key: string): Promise<T | null> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first<{ value: string }>();
  if (!r) return null;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}

export async function setKV(db: D1Database, key: string, value: unknown) {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, JSON.stringify(value)).run();
}

export async function delKV(db: D1Database, key: string) {
  await db.prepare("DELETE FROM settings WHERE key = ?1").bind(key).run();
}

export const getSettings = async (db: D1Database): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...((await getKV<Partial<Settings>>(db, "email")) ?? {}),
});

/* ---------------- timer ---------------- */

export const getTimer = (db: D1Database) => getKV<Timer>(db, "timer");

/**
 * Stops the running timer (if any) and adds the elapsed minutes to its task.
 * DELETE … RETURNING claims the timer in one statement, so two simultaneous stops
 * can't both add the time; the minutes are added with an in-place increment.
 */
export async function stopTimer(db: D1Database): Promise<Task | null> {
  const row = await db.prepare("DELETE FROM settings WHERE key = 'timer' RETURNING value").first<{ value: string }>();
  if (!row) return null;
  let timer: Timer;
  try {
    timer = JSON.parse(row.value) as Timer;
  } catch {
    return null;
  }
  const add = Math.max(0, (Date.now() - timer.startedAt) / 60000);
  await db.prepare("UPDATE tasks SET minutes = minutes + ?2, updated_at = ?3 WHERE id = ?1").bind(timer.taskId, add, Date.now()).run();
  return getTask(db, timer.taskId);
}

/* ---------------- sessions ---------------- */

export async function createSession(db: D1Database, id: string, expiresAt: number) {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now),
    db.prepare("INSERT INTO sessions (id, expires_at, created_at) VALUES (?1, ?2, ?3)").bind(id, expiresAt, now),
  ]);
}

export async function sessionValid(db: D1Database, id: string) {
  const r = await db.prepare("SELECT expires_at FROM sessions WHERE id = ?1").bind(id).first<{ expires_at: number }>();
  return !!r && r.expires_at > Date.now();
}

export async function deleteSession(db: D1Database, id: string) {
  await db.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
}

export async function deleteAllSessions(db: D1Database) {
  await db.prepare("DELETE FROM sessions").run();
}
