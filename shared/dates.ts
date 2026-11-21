const z = (n: number) => String(n).padStart(2, "0");

export const toKey = (d: Date) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

export const parseKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (k: string, n: number) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

export const todayKey = () => toKey(new Date());

export const isDateKey = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseKey(s).getTime());

export const fmtDate = (k: string, o?: Intl.DateTimeFormatOptions) =>
  parseKey(k).toLocaleDateString("en-IN", o ?? { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const fmtMins = (m: number) => {
  m = Math.round(m || 0);
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return [h ? `${h}h` : "", r ? `${r}m` : ""].filter(Boolean).join(" ");
};

/** Next working day: skips Sunday, and Saturday too when it isn't a working day. */
export const nextWorkDay = (k: string, saturday: boolean) => {
  let n = addDays(k, 1);
  if (parseKey(n).getDay() === 0) n = addDays(n, 1);
  if (!saturday && parseKey(n).getDay() === 6) n = addDays(n, 2);
  return n;
};

export type RangeKind = "week" | "month";

export const rangeFor = (kind: RangeKind, k: string): [string, string] => {
  const d = parseKey(k);
  if (kind === "week") {
    const start = addDays(k, -((d.getDay() + 6) % 7)); // Monday
    return [start, addDays(start, 6)];
  }
  return [toKey(new Date(d.getFullYear(), d.getMonth(), 1)), toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
};

export const rangeLabel = (kind: RangeKind, a: string, b: string) =>
  kind === "week"
    ? `${fmtDate(a, { day: "numeric", month: "short" })} – ${fmtDate(b, { day: "numeric", month: "short", year: "numeric" })}`
    : parseKey(a).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export const daysBetween = (a: string, b: string) => {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
};
