import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { CATEGORIES, DEFAULT_SETTINGS, PROJECT_COLORS, type Project, type Settings, type Task } from "../shared/types";
import { addDays, isDateKey } from "../shared/dates";
import { exportCsv, exportMarkdown } from "../shared/report";
import * as db from "./db";
import { AIError, gemini, polishPrompt, reportPrompt } from "./gemini";

export type Bindings = {
  DB: D1Database;
  APP_PASSWORD?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};
type Env = { Bindings: Bindings };

const app = new Hono<Env>().basePath("/api");
const COOKIE = "wl_session";
const SESSION_DAYS = 30;
const MAX_RANGE_DAYS = 400;
const LOCK_AFTER = 8; // wrong passwords…
const LOCK_WINDOW_MS = 15 * 60_000; // …within this window…
const LOCK_FOR_MS = 10 * 60_000; // …lock that IP for this long

const secretOf = (c: Context<Env>) => `${c.env.APP_PASSWORD}::worklog-session`;
const bad = (c: Context<Env>, msg: string, status: 400 | 401 | 404 | 409 | 429 = 400) => c.json({ error: msg }, status);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const randomId = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time string comparison. */
function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/* ---------------- auth ---------------- */

interface Lock {
  fails: number;
  first: number;
  until: number;
}
const lockKey = (c: Context<Env>) => `lock:${c.req.header("cf-connecting-ip") ?? "local"}`;

app.post("/login", async (c) => {
  if (!c.env.APP_PASSWORD) return c.json({ error: "APP_PASSWORD is not set on the server." }, 503);
  const key = lockKey(c);
  const now = Date.now();
  const lock = await db.getKV<Lock>(c.env.DB, key);
  if (lock && lock.until > now) return bad(c, "Too many wrong attempts. Try again in a few minutes.", 429);

  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  if (!safeEqual(String(password ?? ""), c.env.APP_PASSWORD)) {
    // Count failures per IP inside a rolling window; after a lock the count starts fresh.
    const fresh = !lock || now - lock.first > LOCK_WINDOW_MS || lock.until > 0;
    const fails = (fresh ? 0 : lock!.fails) + 1;
    const next: Lock = fails >= LOCK_AFTER ? { fails: 0, first: now, until: now + LOCK_FOR_MS } : { fails, first: fresh ? now : lock!.first, until: 0 };
    await db.setKV(c.env.DB, key, next);
    await new Promise((r) => setTimeout(r, 600));
    return bad(c, "Wrong password.", 401);
  }
  if (lock) await db.delKV(c.env.DB, key);

  const sid = randomId();
  const expMs = now + SESSION_DAYS * 86_400_000;
  await db.createSession(c.env.DB, sid, expMs);
  const token = await sign({ sid, exp: Math.floor(expMs / 1000) }, secretOf(c));
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  return c.json({ ok: true });
});

async function sessionId(c: Context<Env>): Promise<string | null> {
  const token = getCookie(c, COOKIE);
  if (!token || !c.env.APP_PASSWORD) return null;
  try {
    const payload = await verify(token, secretOf(c), "HS256");
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

async function isLoggedIn(c: Context<Env>) {
  const sid = await sessionId(c);
  return !!sid && (await db.sessionValid(c.env.DB, sid));
}

app.post("/logout", async (c) => {
  const sid = await sessionId(c);
  if (sid) await db.deleteSession(c.env.DB, sid);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Export links may use ?token=… so another AI can read your log without logging in. */
async function hasExportToken(c: Context<Env>) {
  const given = c.req.query("token");
  if (!given) return false;
  const saved = await db.getKV<string>(c.env.DB, "export_token");
  return !!saved && safeEqual(given, saved);
}

const requireAuth = async (c: Context<Env>, next: Next) => {
  if (await isLoggedIn(c)) return next();
  if (c.req.method === "GET" && c.req.path === "/api/export" && (await hasExportToken(c))) return next();
  return bad(c, "Please log in.", 401);
};

app.get("/me", async (c) => c.json({ loggedIn: await isLoggedIn(c), passwordSet: !!c.env.APP_PASSWORD }));

app.use("*", requireAuth);

/** Log out every device (e.g. if you logged in on a shared computer). */
app.post("/logout-all", async (c) => {
  await db.deleteAllSessions(c.env.DB);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/* ---------------- tasks ---------------- */

function readRange(c: Context<Env>): [string, string] | null {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDateKey(from) || !isDateKey(to) || from > to) return null;
  if (addDays(from, MAX_RANGE_DAYS) < to) return null;
  return [from, to];
}

app.get("/tasks", async (c) => {
  const r = readRange(c);
  if (!r) return bad(c, "Give a valid from/to date range (max 400 days).");
  return c.json({ tasks: await db.listTasks(c.env.DB, r[0], r[1]) });
});

app.get("/tasks/open", async (c) => {
  const before = c.req.query("before");
  if (!isDateKey(before)) return bad(c, "Give a valid 'before' date.");
  return c.json({ tasks: await db.listOpenBefore(c.env.DB, before) });
});

export function taskFromBody(b: Record<string, unknown>, base?: Task): Task | string {
  const now = Date.now();
  const title = b.title !== undefined ? clean(b.title, 500) : (base?.title ?? "");
  if (!title) return "Task title is required.";
  const date = b.date !== undefined ? b.date : base?.date;
  if (!isDateKey(date)) return "A valid date (YYYY-MM-DD) is required.";
  const status = b.status !== undefined ? b.status : (base?.status ?? "done");
  if (!db.isStatus(status)) return "Status must be plan, prog, done or block.";
  const minutes = b.minutes !== undefined ? Number(b.minutes) : (base?.minutes ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60 * 7) return "Minutes must be a positive number.";
  const projectId = b.projectId !== undefined ? (typeof b.projectId === "string" && b.projectId ? b.projectId.slice(0, 64) : null) : (base?.projectId ?? null);
  return {
    id: base?.id ?? (typeof b.id === "string" && /^[\w-]{6,64}$/.test(b.id) ? b.id : crypto.randomUUID()),
    date,
    title,
    category: b.category !== undefined ? clean(b.category, 40) || "Other" : (base?.category ?? "Other"),
    status,
    minutes,
    note: b.note !== undefined ? clean(b.note, 1000) : (base?.note ?? ""),
    projectId,
    carried: b.carried !== undefined ? !!b.carried : (base?.carried ?? false),
    fromDate: b.fromDate !== undefined ? (isDateKey(b.fromDate) ? b.fromDate : null) : (base?.fromDate ?? null),
    createdAt: base?.createdAt ?? (typeof b.createdAt === "number" ? b.createdAt : now),
    updatedAt: now,
  };
}

async function checkProject(c: Context<Env>, t: Task) {
  if (t.projectId && !(await db.getProject(c.env.DB, t.projectId))) return "That project doesn't exist any more.";
  return null;
}

app.post("/tasks", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return bad(c, "Send a JSON body.");
  const t = taskFromBody(body);
  if (typeof t === "string") return bad(c, t);
  const pe = await checkProject(c, t);
  if (pe) return bad(c, pe);
  if (await db.getTask(c.env.DB, t.id)) return bad(c, "A task with this id already exists.", 409);
  await db.insertTask(c.env.DB, t);
  return c.json({ task: t }, 201);
});

app.patch("/tasks/:id", async (c) => {
  const base = await db.getTask(c.env.DB, c.req.param("id"));
  if (!base) return bad(c, "Task not found.", 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return bad(c, "Send a JSON body.");
  let t = taskFromBody(body, base);
  if (typeof t === "string") return bad(c, t);
  const pe = await checkProject(c, t);
  if (pe) return bad(c, pe);
  // Marking a timed task done stops its timer first so the time is kept.
  const timer = await db.getTimer(c.env.DB);
  if (timer?.taskId === t.id && t.status === "done") {
    const stopped = await db.stopTimer(c.env.DB);
    if (stopped && body.minutes === undefined) t = { ...t, minutes: stopped.minutes };
  }
  await db.saveTask(c.env.DB, t);
  return c.json({ task: t });
});

app.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const timer = await db.getTimer(c.env.DB);
  if (timer?.taskId === id) await db.delKV(c.env.DB, "timer");
  await db.deleteTask(c.env.DB, id);
  return c.json({ ok: true });
});

/** Bring unfinished tasks from earlier days into `today` (originals are kept as history). */
app.post("/tasks/carry", async (c) => {
  const { today } = await c.req.json<{ today?: string }>().catch(() => ({ today: "" }));
  if (!isDateKey(today)) return bad(c, "Give today's date.");
  return c.json({ carried: await db.carryForward(c.env.DB, today) });
});

/* ---------------- projects ---------------- */

app.get("/projects", async (c) => c.json({ projects: await db.listProjects(c.env.DB) }));

app.post("/projects", async (c) => {
  const b = await c.req.json<Partial<Project>>().catch(() => null);
  const name = clean(b?.name, 60);
  if (!name) return bad(c, "Give the project a name.");
  if (await db.findProjectByName(c.env.DB, name)) return bad(c, "A project with this name already exists.", 409);
  const existing = await db.listProjects(c.env.DB);
  const p: Project = {
    id: crypto.randomUUID(),
    name,
    color: isColor(b?.color) ? b.color : PROJECT_COLORS[existing.length % PROJECT_COLORS.length],
    archived: false,
    createdAt: Date.now(),
  };
  await db.insertProject(c.env.DB, p);
  return c.json({ project: p }, 201);
});

app.patch("/projects/:id", async (c) => {
  const p = await db.getProject(c.env.DB, c.req.param("id"));
  if (!p) return bad(c, "Project not found.", 404);
  const b = await c.req.json<Partial<Project>>().catch(() => null);
  if (!b) return bad(c, "Send a JSON body.");
  if (b.name !== undefined) {
    const name = clean(b.name, 60);
    if (!name) return bad(c, "Give the project a name.");
    const dupe = await db.findProjectByName(c.env.DB, name);
    if (dupe && dupe.id !== p.id) return bad(c, "A project with this name already exists.", 409);
    p.name = name;
  }
  if (b.color !== undefined && isColor(b.color)) p.color = b.color;
  if (b.archived !== undefined) p.archived = !!b.archived;
  await db.saveProject(c.env.DB, p);
  return c.json({ project: p });
});

app.delete("/projects/:id", async (c) => {
  await db.deleteProject(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

/* ---------------- timer ---------------- */

app.get("/timer", async (c) => {
  const timer = await db.getTimer(c.env.DB);
  if (!timer) return c.json({ timer: null });
  const task = await db.getTask(c.env.DB, timer.taskId);
  if (!task) {
    await db.delKV(c.env.DB, "timer");
    return c.json({ timer: null });
  }
  return c.json({ timer: { ...timer, title: task.title } });
});

app.post("/timer/start", async (c) => {
  const { taskId } = await c.req.json<{ taskId?: string }>().catch(() => ({ taskId: "" }));
  const task = taskId ? await db.getTask(c.env.DB, taskId) : null;
  if (!task) return bad(c, "Task not found.", 404);
  await db.stopTimer(c.env.DB);
  if (task.status === "plan" || task.status === "done") {
    task.status = "prog";
    await db.saveTask(c.env.DB, task);
  }
  const timer = { taskId: task.id, startedAt: Date.now() };
  await db.setKV(c.env.DB, "timer", timer);
  return c.json({ timer: { ...timer, title: task.title } });
});

app.post("/timer/stop", async (c) => c.json({ task: await db.stopTimer(c.env.DB) }));

/* ---------------- settings ---------------- */

app.get("/settings", async (c) => c.json({ settings: await db.getSettings(c.env.DB), categories: CATEGORIES }));

function settingsFrom(b: Partial<Settings>, cur: Settings): Settings {
  return {
    name: b.name !== undefined ? clean(b.name, 80) : cur.name,
    to: b.to !== undefined ? clean(b.to, 300) : cur.to,
    cc: b.cc !== undefined ? clean(b.cc, 300) : cur.cc,
    greet: b.greet !== undefined ? clean(b.greet, 80) : cur.greet,
    client: b.client && ["gmail", "outlook", "app"].includes(b.client) ? b.client : (cur.client ?? DEFAULT_SETTINGS.client),
    saturday: b.saturday !== undefined ? !!b.saturday : cur.saturday,
    role: b.role !== undefined ? clean(b.role, 200) : cur.role,
  };
}

app.put("/settings", async (c) => {
  const b = await c.req.json<Partial<Settings>>().catch(() => null);
  if (!b) return bad(c, "Send a JSON body.");
  const next = settingsFrom(b, await db.getSettings(c.env.DB));
  await db.setKV(c.env.DB, "email", next);
  return c.json({ settings: next });
});

/* ---------------- export (for any AI, Excel, backups) ---------------- */

app.get("/export", async (c) => {
  const r = readRange(c);
  if (!r) return bad(c, "Give a valid from/to date range (max 400 days).");
  const [tasks, projects] = await Promise.all([db.listTasks(c.env.DB, r[0], r[1]), db.listProjects(c.env.DB)]);
  const format = c.req.query("format") ?? "md";
  if (format === "json") return c.json({ from: r[0], to: r[1], projects, tasks });
  if (format === "csv")
    return c.text(exportCsv(r[0], r[1], tasks, projects), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="worklog-${r[0]}-to-${r[1]}.csv"`,
    });
  return c.text(exportMarkdown(r[0], r[1], tasks, projects), 200, { "content-type": "text/markdown; charset=utf-8" });
});

app.get("/export/token", async (c) => c.json({ token: await db.getKV<string>(c.env.DB, "export_token") }));

app.post("/export/token", async (c) => {
  const token = randomId();
  await db.setKV(c.env.DB, "export_token", token);
  return c.json({ token });
});

app.delete("/export/token", async (c) => {
  await db.delKV(c.env.DB, "export_token");
  return c.json({ ok: true });
});

/** Full backup: settings, projects and every task. */
app.get("/backup", async (c) => {
  const [settings, projects, tasks] = await Promise.all([db.getSettings(c.env.DB), db.listProjects(c.env.DB), db.listAllTasks(c.env.DB)]);
  return c.json({ version: 2, exportedAt: new Date().toISOString(), settings, projects, tasks }, 200, {
    "content-disposition": `attachment; filename="worklog-backup.json"`,
  });
});

/** Restore a backup. Valid rows are written in one all-or-nothing batch; invalid rows are counted and reported. */
app.post("/import", async (c) => {
  const b = await c.req.json<{ tasks?: Record<string, unknown>[]; projects?: Partial<Project>[]; settings?: Partial<Settings> }>().catch(() => null);
  if (!b || !Array.isArray(b.tasks)) return bad(c, "Send a backup with a tasks array.");
  if (b.tasks.length > 20000) return bad(c, "That backup is too large (over 20,000 tasks).");
  const stmts: D1PreparedStatement[] = [];
  const projectIds = new Set((await db.listProjects(c.env.DB)).map((p) => p.id));
  let projects = 0;
  for (const p of b.projects ?? []) {
    const name = clean(p.name, 60);
    if (typeof p.id !== "string" || !name) continue;
    projectIds.add(p.id);
    projects++;
    stmts.push(
      c.env.DB.prepare("INSERT OR REPLACE INTO projects (id,name,color,archived,created_at) VALUES (?1,?2,?3,?4,?5)").bind(
        p.id,
        name,
        isColor(p.color) ? p.color : PROJECT_COLORS[0],
        p.archived ? 1 : 0,
        typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      ),
    );
  }
  let skipped = 0;
  let tasks = 0;
  for (const raw of b.tasks) {
    const t = taskFromBody(raw);
    if (typeof t === "string") {
      skipped++;
      continue;
    }
    if (t.projectId && !projectIds.has(t.projectId)) t.projectId = null;
    stmts.push(db.upsertTaskStmt(c.env.DB, t));
    tasks++;
  }
  if (b.settings) stmts.push(c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email', ?1)").bind(JSON.stringify(settingsFrom(b.settings, DEFAULT_SETTINGS))));
  if (stmts.length) await c.env.DB.batch(stmts); // D1 runs a batch as a single transaction
  return c.json({ imported: tasks, projects, skipped, settings: !!b.settings });
});

/* ---------------- AI (Gemini) ---------------- */

const model = (c: Context<Env>) => c.env.GEMINI_MODEL || "gemini-flash-latest";

app.post("/ai/polish", async (c) => {
  const { text, kind } = await c.req.json<{ text?: string; kind?: "day" | "week" | "month" }>().catch(() => ({ text: "", kind: "day" as const }));
  const body = clean(text, 20000);
  if (!body) return bad(c, "Nothing to polish yet.");
  const { role } = await db.getSettings(c.env.DB);
  const out = await gemini(c.env.GEMINI_API_KEY, model(c), polishPrompt(kind ?? "day", body, role));
  return c.json({ text: out.replace(/^subject:.*\n+/i, "").trim() });
});

app.post("/ai/report", async (c) => {
  const { from, to, ask } = await c.req.json<{ from?: string; to?: string; ask?: string }>().catch(() => ({}) as Record<string, string>);
  if (!isDateKey(from) || !isDateKey(to) || from > to) return bad(c, "Give a valid date range.");
  const [tasks, projects, settings] = await Promise.all([db.listTasks(c.env.DB, from, to), db.listProjects(c.env.DB), db.getSettings(c.env.DB)]);
  if (!tasks.length) return bad(c, "No tasks in this period yet.");
  const out = await gemini(c.env.GEMINI_API_KEY, model(c), reportPrompt(exportMarkdown(from, to, tasks, projects), clean(ask, 500), settings.role));
  return c.json({ text: out });
});

app.onError((err, c) => {
  if (err instanceof AIError) return c.json({ error: err.message }, err.status as 429);
  console.error(err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
