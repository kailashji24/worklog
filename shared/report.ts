import { CATEGORIES, STATUS_LABEL, type Settings, type Task } from "./types";
import { addDays, daysBetween, fmtDate, fmtMins, nextWorkDay, rangeLabel, type RangeKind } from "./dates";

/** Minutes including a running timer, if any. */
export type MinutesFn = (t: Task) => number;
export const plainMinutes: MinutesFn = (t) => t.minutes || 0;

const line = (m: MinutesFn) => (t: Task) =>
  `• [${t.category}] ${t.title}${m(t) >= 1 ? ` (${fmtMins(m(t))})` : ""}${t.note ? ` — ${t.note}` : ""}`;
const short = (t: Task) => `• [${t.category}] ${t.title}`;
const section = (heading: string, items: Task[], f: (t: Task) => string) =>
  items.length ? `${heading}:\n${items.map(f).join("\n")}\n\n` : "";
const greeting = (s: Settings) => `Hi${s.greet ? ` ${s.greet}` : ""},\n\n`;
const signOff = (s: Settings) => `Regards,${s.name ? `\n${s.name}` : ""}`;

export interface Draft {
  subject: string;
  body: string;
}

/** Daily update email. `tasks` must contain the day's tasks and the next working day's tasks. */
export function dailyEmail(day: string, tasks: Task[], s: Settings, m: MinutesFn = plainMinutes): Draft {
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
  const total = own.reduce((a, t) => a + m(t), 0);
  const subject = `Daily Update – ${s.name ? `${s.name} – ` : ""}${fmtDate(day, { day: "numeric", month: "short", year: "numeric" })}`;
  if (!own.length) return { subject, body: "" };
  const nextLabel = next === addDays(day, 1) ? "tomorrow" : fmtDate(next, { weekday: "long" });
  const body =
    greeting(s) +
    `Here is my work update for ${fmtDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.\n\n` +
    section("Completed", by("done"), line(m)) +
    section("In progress", by("prog"), line(m)) +
    section("Blocked / need help", by("block"), line(m)) +
    section(`Plan for ${nextLabel}`, plan, short) +
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
  days: string[];
  perDay: Record<string, number>;
  workedDays: number;
}

export function rangeStats(from: string, to: string, all: Task[], m: MinutesFn = plainMinutes): RangeStats {
  const tasks = all.filter((t) => t.date >= from && t.date <= to);
  const total = tasks.reduce((a, t) => a + m(t), 0);
  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => !t.carried && (t.status === "prog" || t.status === "block"));
  const cats = new Map<string, number>();
  for (const t of tasks) cats.set(t.category, (cats.get(t.category) ?? 0) + m(t));
  const byCategory = [...cats.entries()].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  const days = daysBetween(from, to);
  const perDay: Record<string, number> = {};
  for (const d of days) perDay[d] = 0;
  for (const t of tasks) perDay[t.date] = (perDay[t.date] ?? 0) + m(t);
  const workedDays = new Set(tasks.filter((t) => m(t) >= 1 || t.status === "done").map((t) => t.date)).size;
  return { tasks, total, done, open, byCategory, days, perDay, workedDays };
}

export function rangeEmail(kind: RangeKind, from: string, to: string, all: Task[], s: Settings, m: MinutesFn = plainMinutes): Draft {
  const st = rangeStats(from, to, all, m);
  const label = rangeLabel(kind, from, to);
  const word = kind === "week" ? "Weekly" : "Monthly";
  const subject = `${word} Update – ${s.name ? `${s.name} – ` : ""}${label}`;
  if (!st.tasks.length) return { subject, body: "" };
  const body =
    greeting(s) +
    `Here is my ${kind === "week" ? "summary for the week of" : "summary for"} ${label}.\n\n` +
    `Time logged: ${fmtMins(st.total) || "0h"} across ${st.workedDays} day${st.workedDays === 1 ? "" : "s"}\n` +
    (st.byCategory.length ? `By area: ${st.byCategory.map(([c, v]) => `${c} ${fmtMins(v)}`).join(" · ")}\n` : "") +
    "\n" +
    section(`Completed (${st.done.length})`, st.done, short) +
    section("Still in progress", st.open.filter((t) => t.status === "prog"), short) +
    section("Blocked / need help", st.open.filter((t) => t.status === "block"), line(m)) +
    signOff(s);
  return { subject, body };
}

/** Readable Markdown for pasting into any AI (Claude, Gemini, ChatGPT). */
export function exportMarkdown(from: string, to: string, all: Task[]): string {
  const st = rangeStats(from, to, all);
  const out: string[] = [];
  out.push(`# Work log: ${fmtDate(from)} – ${fmtDate(to)}`, "");
  out.push(`- Total time logged: ${fmtMins(st.total) || "0m"} across ${st.workedDays} working days`);
  out.push(`- Tasks: ${st.tasks.length} (${st.done.length} done, ${st.open.length} still open)`);
  if (st.byCategory.length) out.push(`- Time by area: ${st.byCategory.map(([c, v]) => `${c} ${fmtMins(v)}`).join(", ")}`);
  out.push("");
  for (const d of st.days) {
    const ts = st.tasks.filter((t) => t.date === d);
    if (!ts.length) continue;
    out.push(`## ${fmtDate(d, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}`);
    for (const t of ts)
      out.push(
        `- [${STATUS_LABEL[t.status]}] (${t.category}) ${t.title}${t.minutes >= 1 ? ` — ${fmtMins(t.minutes)}` : ""}${t.note ? ` — note: ${t.note}` : ""}`,
      );
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

export function exportCsv(from: string, to: string, all: Task[]): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = all
    .filter((t) => t.date >= from && t.date <= to)
    .map((t) => [t.date, t.category, STATUS_LABEL[t.status], t.title, Math.round(t.minutes), t.note].map(q).join(","));
  return ["date,area,status,task,minutes,note", ...rows].join("\n") + "\n";
}

export const categoryOrder = (c: string) => {
  const i = (CATEGORIES as readonly string[]).indexOf(c);
  return i === -1 ? 99 : i;
};
