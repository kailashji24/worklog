import { DEFAULT_SETTINGS, STATUSES, type Settings, type Status, type Task, type Timer } from "../shared/types";

interface Row {
  id: string;
  date: string;
  title: string;
  category: string;
  status: Status;
  minutes: number;
  note: string;
  carried: number;
  from_date: string | null;
  created_at: number;
  updated_at: number;
}

const toTask = (r: Row): Task => ({
  id: r.id,
  date: r.date,
  title: r.title,
  category: r.category,
  status: r.status,
  minutes: r.minutes,
  note: r.note,
  carried: !!r.carried,
  fromDate: r.from_date,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const isStatus = (s: unknown): s is Status => typeof s === "string" && (STATUSES as readonly string[]).includes(s);

export async function listTasks(db: D1Database, from: string, to: string): Promise<Task[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE date BETWEEN ?1 AND ?2 ORDER BY date, created_at")
    .bind(from, to)
    .all<Row>();
  return results.map(toTask);
}

/** Unfinished tasks from before `day` that haven't been carried forward yet. */
export async function listOpenBefore(db: D1Database, day: string): Promise<Task[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE status != 'done' AND carried = 0 AND date < ?1 ORDER BY date, created_at LIMIT 200")
    .bind(day)
    .all<Row>();
  return results.map(toTask);
}

export async function getTask(db: D1Database, id: string): Promise<Task | null> {
  const r = await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<Row>();
  return r ? toTask(r) : null;
}

export async function insertTask(db: D1Database, t: Task) {
  await db
    .prepare(
      "INSERT INTO tasks (id,date,title,category,status,minutes,note,carried,from_date,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
    )
    .bind(t.id, t.date, t.title, t.category, t.status, t.minutes, t.note, t.carried ? 1 : 0, t.fromDate, t.createdAt, t.updatedAt)
    .run();
}

export async function saveTask(db: D1Database, t: Task) {
  await db
    .prepare("UPDATE tasks SET date=?2,title=?3,category=?4,status=?5,minutes=?6,note=?7,carried=?8,from_date=?9,updated_at=?10 WHERE id=?1")
    .bind(t.id, t.date, t.title, t.category, t.status, t.minutes, t.note, t.carried ? 1 : 0, t.fromDate, Date.now())
    .run();
}

export async function deleteTask(db: D1Database, id: string) {
  await db.prepare("DELETE FROM tasks WHERE id = ?1").bind(id).run();
}

/* ---------- key/value settings ---------- */

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
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, JSON.stringify(value))
    .run();
}

export async function delKV(db: D1Database, key: string) {
  await db.prepare("DELETE FROM settings WHERE key = ?1").bind(key).run();
}

export const getSettings = async (db: D1Database): Promise<Settings> => ({
  ...DEFAULT_SETTINGS,
  ...((await getKV<Partial<Settings>>(db, "email")) ?? {}),
});

export const getTimer = (db: D1Database) => getKV<Timer>(db, "timer");

/** Stops the running timer (if any) and adds the elapsed minutes to its task. */
export async function stopTimer(db: D1Database): Promise<Task | null> {
  const timer = await getTimer(db);
  if (!timer) return null;
  await delKV(db, "timer");
  const task = await getTask(db, timer.taskId);
  if (!task) return null;
  task.minutes += Math.max(0, (Date.now() - timer.startedAt) / 60000);
  await saveTask(db, task);
  return task;
}
