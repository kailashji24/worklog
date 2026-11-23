import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app, { type Bindings } from "../worker/index";

/** Integration tests: the real Hono app against a real (local, in-memory) D1 database. */

let dispose: () => Promise<void>;
let env: Bindings;
const PASSWORD = "test-password";

async function migrate(db: D1Database) {
  const dir = join(__dirname, "..", "migrations");
  for (const f of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
}

beforeAll(async () => {
  // A fresh in-memory D1 from wrangler.jsonc's binding (nothing is written to disk or to Cloudflare).
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
  dispose = proxy.dispose;
  const DB = proxy.env.DB;
  await migrate(DB);
  env = { DB, APP_PASSWORD: PASSWORD };
});

afterAll(() => dispose?.());

beforeEach(async () => {
  await env.DB.batch(["DELETE FROM tasks", "DELETE FROM projects", "DELETE FROM sessions", "DELETE FROM settings"].map((s) => env.DB.prepare(s)));
});

/** Calls the API like a browser would, keeping the session cookie. */
function client(ip = "1.1.1.1") {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      `/api${path}`,
      {
        method,
        headers: { "content-type": "application/json", cookie, "cf-connecting-ip": ip },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, data: type.includes("json") ? await res.json() : await res.text() } as { status: number; data: any };
  };
  return {
    call,
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      cookie = v;
    },
    login: (pw = PASSWORD) => call("POST", "/login", { password: pw }),
  };
}

describe("auth", () => {
  it("rejects requests without a session", async () => {
    expect((await client().call("GET", "/tasks?from=2026-11-01&to=2026-11-30")).status).toBe(401);
  });

  it("logs in, and logout really ends the session", async () => {
    const c = client();
    expect((await c.login()).status).toBe(200);
    const saved = c.cookie;
    expect((await c.call("GET", "/me")).data.loggedIn).toBe(true);
    await c.call("POST", "/logout");
    c.cookie = saved; // reuse the old cookie after logging out
    expect((await c.call("GET", "/me")).data.loggedIn).toBe(false);
  });

  it("locks out one IP after 8 wrong passwords without locking out others", async () => {
    const attacker = client("6.6.6.6");
    for (let i = 0; i < 8; i++) expect((await attacker.login("wrong")).status).toBe(401);
    expect((await attacker.login()).status).toBe(429);
    expect((await client("2.2.2.2").login()).status).toBe(200);
  });
});

describe("projects and tasks", () => {
  it("creates projects, rejects duplicates, and links tasks", async () => {
    const c = client();
    await c.login();
    const p = (await c.call("POST", "/projects", { name: "Barcode API" })).data.project;
    expect((await c.call("POST", "/projects", { name: "barcode api" })).status).toBe(409);

    const t = await c.call("POST", "/tasks", { date: "2026-11-23", title: "SSL", category: "DevOps", projectId: p.id, minutes: 45 });
    expect(t.status).toBe(201);
    expect(t.data.task.projectId).toBe(p.id);
    expect((await c.call("POST", "/tasks", { date: "2026-11-23", title: "x", projectId: "missing" })).status).toBe(400);

    const csv = (await c.call("GET", "/export?from=2026-11-23&to=2026-11-23&format=csv")).data as string;
    expect(csv).toContain('"Barcode API","DevOps","Done","SSL","45"');

    // Deleting a project keeps its tasks.
    await c.call("DELETE", `/projects/${p.id}`);
    const tasks = (await c.call("GET", "/tasks?from=2026-11-23&to=2026-11-23")).data.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].projectId).toBeNull();
  });

  it("validates task input", async () => {
    const c = client();
    await c.login();
    expect((await c.call("POST", "/tasks", { date: "2026-11-23", title: "" })).status).toBe(400);
    expect((await c.call("POST", "/tasks", { date: "23-11-2026", title: "x" })).status).toBe(400);
    expect((await c.call("POST", "/tasks", { date: "2026-11-23", title: "x", status: "nope" })).status).toBe(400);
    expect((await c.call("POST", "/tasks", { date: "2026-11-23", title: "x", minutes: -5 })).status).toBe(400);
  });
});

describe("carry-over and timer", () => {
  it("carries each open task only once, even with simultaneous requests", async () => {
    const c = client();
    await c.login();
    await c.call("POST", "/tasks", { date: "2026-11-20", title: "Open", status: "prog" });
    await c.call("POST", "/tasks", { date: "2026-11-20", title: "Blocked", status: "block" });
    await c.call("POST", "/tasks", { date: "2026-11-20", title: "Finished", status: "done" });

    const results = await Promise.all([1, 2, 3].map(() => c.call("POST", "/tasks/carry", { today: "2026-11-23" })));
    expect(results.reduce((a, r) => a + r.data.carried, 0)).toBe(2);

    const today = (await c.call("GET", "/tasks?from=2026-11-23&to=2026-11-23")).data.tasks;
    expect(today.map((t: any) => t.title).sort()).toEqual(["Blocked", "Open"]);
    expect(today.every((t: any) => t.fromDate === "2026-11-20")).toBe(true);
    expect((await c.call("GET", "/tasks/open?before=2026-11-23")).data.tasks).toHaveLength(0);
  });

  it("a double stop only adds the time once", async () => {
    const c = client();
    await c.login();
    const t = (await c.call("POST", "/tasks", { date: "2026-11-23", title: "Timed", status: "plan" })).data.task;
    await c.call("POST", "/timer/start", { taskId: t.id });
    // Pretend the timer started 30 minutes ago.
    await env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = 'timer'")
      .bind(JSON.stringify({ taskId: t.id, startedAt: Date.now() - 30 * 60_000 }))
      .run();
    await Promise.all([c.call("POST", "/timer/stop"), c.call("POST", "/timer/stop")]);
    const after = (await c.call("GET", "/tasks?from=2026-11-23&to=2026-11-23")).data.tasks[0];
    expect(Math.round(after.minutes)).toBe(30);
    expect(after.status).toBe("prog");
    expect((await c.call("GET", "/timer")).data.timer).toBeNull();
  });
});

describe("export token and backup", () => {
  it("export token opens only the export route", async () => {
    const c = client();
    await c.login();
    const token = (await c.call("POST", "/export/token")).data.token;
    const anon = client();
    expect((await anon.call("GET", `/export?from=2026-11-01&to=2026-11-30&token=${token}`)).status).toBe(200);
    expect((await anon.call("GET", `/export?from=2026-11-01&to=2026-11-30&token=bad`)).status).toBe(401);
    expect((await anon.call("GET", `/tasks?from=2026-11-01&to=2026-11-30&token=${token}`)).status).toBe(401);
  });

  it("backup includes settings and projects, and restore reports skipped rows", async () => {
    const c = client();
    await c.login();
    await c.call("PUT", "/settings", { name: "Kailash", role: "Data Specialist" });
    const p = (await c.call("POST", "/projects", { name: "Infra" })).data.project;
    await c.call("POST", "/tasks", { date: "2026-11-23", title: "Terraform", projectId: p.id });
    const backup = (await c.call("GET", "/backup")).data;
    expect(backup.settings.name).toBe("Kailash");
    expect(backup.projects).toHaveLength(1);

    await env.DB.batch(["DELETE FROM tasks", "DELETE FROM projects"].map((s) => env.DB.prepare(s)));
    const r = (await c.call("POST", "/import", { ...backup, tasks: [...backup.tasks, { title: "", date: "bad" }] })).data;
    expect(r).toMatchObject({ imported: 1, projects: 1, skipped: 1, settings: true });
    const tasks = (await c.call("GET", "/tasks?from=2026-11-23&to=2026-11-23")).data.tasks;
    expect(tasks[0].projectId).toBe(p.id);
  });
});
