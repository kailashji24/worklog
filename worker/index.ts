import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { CATEGORIES, DEFAULT_SETTINGS, type Settings, type Task } from "../shared/types";
import { addDays, isDateKey } from "../shared/dates";
import { exportCsv, exportMarkdown } from "../shared/report";
import * as db from "./db";
import { AIError, gemini, polishPrompt, reportPrompt } from "./gemini";

type Bindings = {
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

const secretOf = (c: Context<Env>) => `${c.env.APP_PASSWORD}::worklog-session`;
const bad = (c: Context<Env>, msg: string, status: 400 | 401 | 404 | 409 | 429 = 400) => c.json({ error: msg }, status);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Constant-time string comparison. */
function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/* ---------------- auth ---------------- */

app.post("/login", async (c) => {
  if (!c.env.APP_PASSWORD) return c.json({ error: "APP_PASSWORD is not set on the server." }, 503);
  const lock = await db.getKV<{ fails: number; until: number }>(c.env.DB, "login_lock");
  if (lock && lock.until > Date.now()) return bad(c, "Too many wrong attempts. Try again in a few minutes.", 429);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  if (!safeEqual(String(password ?? ""), c.env.APP_PASSWORD)) {
    const fails = (lock?.fails ?? 0) + 1;
    await db.setKV(c.env.DB, "login_lock", { fails, until: fails >= 8 ? Date.now() + 10 * 60_000 : 0 });
    await new Promise((r) => setTimeout(r, 600));
    return bad(c, "Wrong password.", 401);
  }
  if (lock) await db.delKV(c.env.DB, "login_lock");
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await sign({ sub: "owner", exp }, secretOf(c));
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
  return c.json({ ok: true });
});

app.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

async function isLoggedIn(c: Context<Env>) {
  const token = getCookie(c, COOKIE);
  if (!token || !c.env.APP_PASSWORD) return false;
  try {
    await verify(token, secretOf(c), "HS256");
    return true;
  } catch {
    return false;
  }
}

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

function taskFromBody(b: Record<string, unknown>, base?: Task): Task | string {
  const now = Date.now();
  const title = b.title !== undefined ? clean(b.title, 500) : (base?.title ?? "");
  if (!title) return "Task title is required.";
  const date = b.date !== undefined ? b.date : base?.date;
  if (!isDateKey(date)) return "A valid date (YYYY-MM-DD) is required.";
  const status = b.status !== undefined ? b.status : (base?.status ?? "done");
  if (!db.isStatus(status)) return "Status must be plan, prog, done or block.";
  const minutes = b.minutes !== undefined ? Number(b.minutes) : (base?.minutes ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60 * 7) return "Minutes must be a positive number.";
  return {
    id: base?.id ?? (typeof b.id === "string" && /^[\w-]{6,64}$/.test(b.id) ? b.id : crypto.randomUUID()),
    date,
    title,
    category: b.category !== undefined ? clean(b.category, 40) || "Other" : (base?.category ?? "Other"),
    status,
    minutes,
    note: b.note !== undefined ? clean(b.note, 1000) : (base?.note ?? ""),
    carried: b.carried !== undefined ? !!b.carried : (base?.carried ?? false),
    fromDate: b.fromDate !== undefined ? (isDateKey(b.fromDate) ? b.fromDate : null) : (base?.fromDate ?? null),
    createdAt: base?.createdAt ?? (typeof b.createdAt === "number" ? b.createdAt : now),
    updatedAt: now,
  };
}

app.post("/tasks", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return bad(c, "Send a JSON body.");
  const t = taskFromBody(body);
  if (typeof t === "string") return bad(c, t);
  if (await db.getTask(c.env.DB, t.id)) return bad(c, "A task with this id already exists.", 409);
  await db.insertTask(c.env.DB, t);
  return c.json({ task: t }, 201);
});

app.patch("/tasks/:id", async (c) => {
  const base = await db.getTask(c.env.DB, c.req.param("id"));
  if (!base) return bad(c, "Task not found.", 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return bad(c, "Send a JSON body.");
  const t = taskFromBody(body, base);
  if (typeof t === "string") return bad(c, t);
  // Marking a timed task done stops its timer first so the time is kept.
  const timer = await db.getTimer(c.env.DB);
  if (timer?.taskId === t.id && t.status === "done") {
    const stopped = await db.stopTimer(c.env.DB);
    if (stopped && body.minutes === undefined) t.minutes = stopped.minutes;
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
  const open = await db.listOpenBefore(c.env.DB, today);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const o of open) {
    stmts.push(c.env.DB.prepare("UPDATE tasks SET carried = 1, updated_at = ?2 WHERE id = ?1").bind(o.id, now));
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO tasks (id,date,title,category,status,minutes,note,carried,from_date,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,0,?6,0,?7,?8,?8)",
      ).bind(crypto.randomUUID(), today, o.title, o.category, o.status, o.note, o.date, now),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ carried: open.length });
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

app.put("/settings", async (c) => {
  const b = await c.req.json<Partial<Settings>>().catch(() => null);
  if (!b) return bad(c, "Send a JSON body.");
  const cur = await db.getSettings(c.env.DB);
  const next: Settings = {
    name: b.name !== undefined ? clean(b.name, 80) : cur.name,
    to: b.to !== undefined ? clean(b.to, 300) : cur.to,
    cc: b.cc !== undefined ? clean(b.cc, 300) : cur.cc,
    greet: b.greet !== undefined ? clean(b.greet, 80) : cur.greet,
    client: b.client && ["gmail", "outlook", "app"].includes(b.client) ? b.client : cur.client ?? DEFAULT_SETTINGS.client,
    saturday: b.saturday !== undefined ? !!b.saturday : cur.saturday,
  };
  await db.setKV(c.env.DB, "email", next);
  return c.json({ settings: next });
});

/* ---------------- export (for any AI, Excel, backups) ---------------- */

app.get("/export", async (c) => {
  const r = readRange(c);
  if (!r) return bad(c, "Give a valid from/to date range (max 400 days).");
  const tasks = await db.listTasks(c.env.DB, r[0], r[1]);
  const format = c.req.query("format") ?? "md";
  if (format === "json") return c.json({ from: r[0], to: r[1], tasks });
  if (format === "csv")
    return c.text(exportCsv(r[0], r[1], tasks), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="worklog-${r[0]}-to-${r[1]}.csv"`,
    });
  return c.text(exportMarkdown(r[0], r[1], tasks), 200, { "content-type": "text/markdown; charset=utf-8" });
});

app.get("/export/token", async (c) => c.json({ token: await db.getKV<string>(c.env.DB, "export_token") }));

app.post("/export/token", async (c) => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.setKV(c.env.DB, "export_token", token);
  return c.json({ token });
});

app.delete("/export/token", async (c) => {
  await db.delKV(c.env.DB, "export_token");
  return c.json({ ok: true });
});

/** Full backup of every task. */
app.get("/backup", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT MIN(date) AS a, MAX(date) AS b FROM tasks").all<{ a: string | null; b: string | null }>();
  const r = results[0];
  const tasks = r?.a && r.b ? await db.listTasks(c.env.DB, r.a, r.b) : [];
  return c.json({ exportedAt: new Date().toISOString(), tasks }, 200, {
    "content-disposition": `attachment; filename="worklog-backup.json"`,
  });
});

/** Restore a JSON backup (from /api/export?format=json). Existing ids are overwritten. */
app.post("/import", async (c) => {
  const b = await c.req.json<{ tasks?: Record<string, unknown>[] }>().catch(() => null);
  if (!b || !Array.isArray(b.tasks)) return bad(c, "Send a backup with a tasks array.");
  const stmts: D1PreparedStatement[] = [];
  for (const raw of b.tasks.slice(0, 20000)) {
    const t = taskFromBody(raw);
    if (typeof t === "string") continue;
    stmts.push(
      c.env.DB.prepare(
        "INSERT OR REPLACE INTO tasks (id,date,title,category,status,minutes,note,carried,from_date,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
      ).bind(t.id, t.date, t.title, t.category, t.status, t.minutes, t.note, t.carried ? 1 : 0, t.fromDate, t.createdAt, t.updatedAt),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ imported: stmts.length });
});

/* ---------------- AI (Gemini) ---------------- */

app.post("/ai/polish", async (c) => {
  const { text, kind } = await c.req.json<{ text?: string; kind?: "day" | "week" | "month" }>().catch(() => ({ text: "", kind: "day" as const }));
  const body = clean(text, 20000);
  if (!body) return bad(c, "Nothing to polish yet.");
  const out = await gemini(c.env.GEMINI_API_KEY, c.env.GEMINI_MODEL || "gemini-flash-latest", polishPrompt(kind ?? "day", body));
  return c.json({ text: out.replace(/^subject:.*\n+/i, "").trim() });
});

app.post("/ai/report", async (c) => {
  const { from, to, ask } = await c.req.json<{ from?: string; to?: string; ask?: string }>().catch(() => ({}) as Record<string, string>);
  if (!isDateKey(from) || !isDateKey(to) || from > to) return bad(c, "Give a valid date range.");
  const tasks = await db.listTasks(c.env.DB, from, to);
  if (!tasks.length) return bad(c, "No tasks in this period yet.");
  const out = await gemini(c.env.GEMINI_API_KEY, c.env.GEMINI_MODEL || "gemini-flash-latest", reportPrompt(exportMarkdown(from, to, tasks), clean(ask, 500)));
  return c.json({ text: out });
});

app.onError((err, c) => {
  if (err instanceof AIError) return c.json({ error: err.message }, err.status as 429);
  console.error(err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
