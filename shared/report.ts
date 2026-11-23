import { CATEGORIES, STATUS_LABEL, type Project, type Settings, type Task } from "./types";
import { addDays, daysBetween, fmtDate, fmtMins, nextWorkDay, rangeLabel, type RangeKind } from "./dates";

/** Minutes including a running timer, if any. */
export type MinutesFn = (t: Task) => number;
export const plainMinutes: MinutesFn = (t) => t.minutes || 0;

/** Everything the email/report builders need besides the tasks. */
export interface ReportCtx {
  settings: Settings;
  projects?: Map<string, Project> | Project[];
  minutes?: MinutesFn;
}

const toMap = (p: ReportCtx["projects"]) => (p instanceof Map ? p : new Map((p ?? []).map((x) => [x.id, x])));

/** "Barcode API / DevOps" when the task has a project, otherwise just "DevOps". */
export const taskLabel = (t: Task, projects: Map<string, Project>) => {
  const p = t.projectId ? projects.get(t.projectId) : undefined;
  return p ? `${p.name} / ${t.category}` : t.category;
};

const section = (heading: string, items: Task[], f: (t: Task) => string) =>
  items.length ? `${heading}:\n${items.map(f).join("\n")}\n\n` : "";
const greeting = (s: Settings) => `Hi${s.greet ? ` ${s.greet}` : ""},\n\n`;
const signOff = (s: Settings) => `Regards,${s.name ? `\n${s.name}` : ""}`;

function formatters(ctx: ReportCtx) {
  const projects = toMap(ctx.projects);
  const m = ctx.minutes ?? plainMinutes;
  const label = (t: Task) => taskLabel(t, projects);
  return {
    projects,
    m,
    full: (t: Task) => `• [${label(t)}] ${t.title}${m(t) >= 1 ? ` (${fmtMins(m(t))})` : ""}${t.note ? ` — ${t.note}` : ""}`,
    short: (t: Task) => `• [${label(t)}] ${t.title}`,
  };
}

export interface Draft {
  subject: string;
  body: string;
}

/** Daily update email. `tasks` must contain the day's tasks and the next working day's tasks. */
export function dailyEmail(day: string, tasks: Task[], ctx: ReportCtx): Draft {
  const s = ctx.settings;
  const f = formatters(ctx);
  const own = tasks.filter((t) => t.date === day);
  const by = (st: Task["status"]) => own.filter((t) => t.status === st);
  const next = nextWorkDay(day, s.saturday);
  const seen = new Set<string>();
  const plan = [
    ...tasks.filter((t) => t.date === next && t.status !== "done"),
    ...by("prog"),
    ...by("block"),
    ...by("plan"),
  ].filter((t) => !seen.has(t.title) && !!seen.add(t.title));
  const total = own.reduce((a, t) => a + f.m(t), 0);
  const subject = `Daily Update – ${s.name ? `${s.name} – ` : ""}${fmtDate(day, { day: "numeric", month: "short", year: "numeric" })}`;
  if (!own.length) return { subject, body: "" };
  const nextLabel = next === addDays(day, 1) ? "tomorrow" : fmtDate(next, { weekday: "long" });
  const body =
    greeting(s) +
    `Here is my work update for ${fmtDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.\n\n` +
    section("Completed", by("done"), f.full) +
    section("In progress", by("prog"), f.full) +
    section("Blocked / need help", by("block"), f.full) +
    section(`Plan for ${nextLabel}`, plan, f.short) +
    (total >= 1 ? `Total time logged: ${fmtMins(total)}\n\n` : "") +
    signOff(s);
  return { subject, body };
}

export interface RangeStats {
  tasks: Task[];
  total: number;
  done: Task[];
  open: Task[];
  byCategory: [string, number][];
  /** [projectId or "" for no project, minutes] */
  byProject: [string, number][];
  days: string[];
  perDay: Record<string, number>;
  workedDays: number;
}

export function rangeStats(from: string, to: string, all: Task[], m: MinutesFn = plainMinutes): RangeStats {
  const tasks = all.filter((t) => t.date >= from && t.date <= to);
  const total = tasks.reduce((a, t) => a + m(t), 0);
  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => !t.carried && (t.status === "prog" || t.status === "block"));
  const sum = (key: (t: Task) => string) => {
    const acc = new Map<string, number>();
    for (const t of tasks) acc.set(key(t), (acc.get(key(t)) ?? 0) + m(t));
    return [...acc.entries()].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  };
  const days = daysBetween(from, to);
  const perDay: Record<string, number> = {};
  for (const d of days) perDay[d] = 0;
  for (const t of tasks) perDay[t.date] = (perDay[t.date] ?? 0) + m(t);
  const workedDays = new Set(tasks.filter((t) => m(t) >= 1 || t.status === "done").map((t) => t.date)).size;
  return { tasks, total, done, open, byCategory: sum((t) => t.category), byProject: sum((t) => t.projectId ?? ""), days, perDay, workedDays };
}

export function rangeEmail(kind: RangeKind, from: string, to: string, all: Task[], ctx: ReportCtx): Draft {
  const s = ctx.settings;
  const f = formatters(ctx);
  const st = rangeStats(from, to, all, f.m);
  const label = rangeLabel(kind, from, to);
  const word = kind === "week" ? "Weekly" : "Monthly";
  const subject = `${word} Update – ${s.name ? `${s.name} – ` : ""}${label}`;
  if (!st.tasks.length) return { subject, body: "" };
  const projLine = st.byProject.filter(([id]) => id && f.projects.has(id));
  const body =
    greeting(s) +
    `Here is my ${kind === "week" ? "summary for the week of" : "summary for"} ${label}.\n\n` +
    `Time logged: ${fmtMins(st.total) || "0h"} across ${st.workedDays} day${st.workedDays === 1 ? "" : "s"}\n` +
    (projLine.length ? `By project: ${projLine.map(([id, v]) => `${f.projects.get(id)!.name} ${fmtMins(v)}`).join(" · ")}\n` : "") +
    (st.byCategory.length ? `By area: ${st.byCategory.map(([c, v]) => `${c} ${fmtMins(v)}`).join(" · ")}\n` : "") +
    "\n" +
    section(`Completed (${st.done.length})`, st.done, f.short) +
    section("Still in progress", st.open.filter((t) => t.status === "prog"), f.short) +
    section("Blocked / need help", st.open.filter((t) => t.status === "block"), f.full) +
    signOff(s);
  return { subject, body };
}

/** Readable Markdown for pasting into any AI (Gemini, ChatGPT and others). */
export function exportMarkdown(from: string, to: string, all: Task[], projectList: Project[] = []): string {
  const projects = toMap(projectList);
  const st = rangeStats(from, to, all);
  const name = (id: string) => (id ? (projects.get(id)?.name ?? "Unknown project") : "No project");
  const out: string[] = [];
  out.push(`# Work log: ${fmtDate(from)} – ${fmtDate(to)}`, "");
  out.push(`- Total time logged: ${fmtMins(st.total) || "0m"} across ${st.workedDays} working days`);
  out.push(`- Tasks: ${st.tasks.length} (${st.done.length} done, ${st.open.length} still open)`);
  if (st.byProject.length) out.push(`- Time by project: ${st.byProject.map(([id, v]) => `${name(id)} ${fmtMins(v)}`).join(", ")}`);
  if (st.byCategory.length) out.push(`- Time by area: ${st.byCategory.map(([c, v]) => `${c} ${fmtMins(v)}`).join(", ")}`);
  out.push("");
  for (const d of st.days) {
    const ts = st.tasks.filter((t) => t.date === d);
    if (!ts.length) continue;
    out.push(`## ${fmtDate(d, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}`);
    for (const t of ts)
      out.push(
        `- [${STATUS_LABEL[t.status]}] (${taskLabel(t, projects)}) ${t.title}${t.minutes >= 1 ? ` — ${fmtMins(t.minutes)}` : ""}${t.note ? ` — note: ${t.note}` : ""}`,
      );
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

export function exportCsv(from: string, to: string, all: Task[], projectList: Project[] = []): string {
  const projects = toMap(projectList);
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = all
    .filter((t) => t.date >= from && t.date <= to)
    .map((t) =>
      [t.date, (t.projectId && projects.get(t.projectId)?.name) || "", t.category, STATUS_LABEL[t.status], t.title, Math.round(t.minutes), t.note]
        .map(q)
        .join(","),
    );
  return ["date,project,area,status,task,minutes,note", ...rows].join("\n") + "\n";
}

export const categoryOrder = (c: string) => {
  const i = (CATEGORIES as readonly string[]).indexOf(c);
  return i === -1 ? 99 : i;
};
