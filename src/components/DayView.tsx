import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { STATUSES, STATUS_LABEL, type Status, type Task } from "../../shared/types";
import { addDays, fmtDate, fmtMins, nextWorkDay } from "../../shared/dates";
import { dailyEmail } from "../../shared/report";
import { api } from "../api";
import { useApp } from "../context";
import { Icon } from "../icons";
import TaskItem from "./TaskItem";
import MailPanel from "./MailPanel";

const ORDER: Record<Status, number> = { prog: 0, block: 1, done: 2, plan: 3 };

/** "#devops fixed nginx 1h30m" → { title: "fixed nginx", category: "DevOps", minutes: 90 } */
function parseQuick(input: string, cats: string[]) {
  let category: string | null = null;
  let minutes: number | null = null;
  let s = input.replace(/#(\w+)/g, (m, w: string) => {
    const c = cats.find((c) => c.toLowerCase().startsWith(w.toLowerCase()));
    if (c && !category) {
      category = c;
      return "";
    }
    return m;
  });
  s = s.replace(/(?:^|\s)(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?(?:\s*(\d+)\s*m(?:ins?)?)?|(\d+)\s*m(?:ins?)?)\s*$/i, (_m, h, hm, mm) => {
    minutes = h ? Math.round(parseFloat(h) * 60) + (hm ? +hm : 0) : +mm;
    return "";
  });
  return { title: s.replace(/\s+/g, " ").trim(), category: category as string | null, minutes: minutes as number | null };
}

export default function DayView() {
  const { today, settings, minutes, categories, version, changed, toast } = useApp();
  const [day, setDay] = useState(today);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [openEarlier, setOpenEarlier] = useState<Task[]>([]);
  const [cat, setCat] = useState(() => localStorage.getItem("wl-cat") || "Data");
  const [status, setStatus] = useState<Status>(() => (localStorage.getItem("wl-status") as Status) || "done");
  const qRef = useRef<HTMLInputElement>(null);
  const next = nextWorkDay(day, settings.saturday);

  useEffect(() => {
    let live = true;
    Promise.all([api.tasks(day, next), day === today ? api.openBefore(today) : Promise.resolve([])])
      .then(([t, o]) => {
        if (!live) return;
        setTasks(t);
        setOpenEarlier(o);
      })
      .catch((e) => toast((e as Error).message));
    return () => {
      live = false;
    };
  }, [day, next, today, version, toast]);

  const own = useMemo(() => (tasks ?? []).filter((t) => t.date === day).sort((a, b) => ORDER[a.status] - ORDER[b.status]), [tasks, day]);
  const total = own.reduce((a, t) => a + minutes(t), 0);
  const count = (s: Status) => own.filter((t) => t.status === s).length;
  const draft = useMemo(() => dailyEmail(day, tasks ?? [], settings, minutes), [day, tasks, settings, minutes]);
  const isToday = day === today;

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const p = parseQuick(String(f.get("q") || ""), categories);
    if (!p.title) return qRef.current?.focus();
    const mins = String(f.get("minutes") || "");
    localStorage.setItem("wl-cat", cat);
    localStorage.setItem("wl-status", status);
    try {
      await api.createTask({
        date: day,
        title: p.title,
        category: p.category ?? cat,
        status,
        minutes: mins ? Number(mins) : (p.minutes ?? 0),
        note: String(f.get("note") || ""),
      });
      form.reset();
      changed();
      qRef.current?.focus();
    } catch (x) {
      toast((x as Error).message);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h2>{isToday ? "Today" : fmtDate(day, { weekday: "long" })}</h2>
          <p>{fmtDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="pager">
          {!isToday && (
            <button className="btn" onClick={() => setDay(today)}>
              Today
            </button>
          )}
          <button className="ib" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>
            <Icon name="left" />
          </button>
          <button className="ib" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>
            <Icon name="right" />
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span>Time logged</span>
          <b className="acc">{fmtMins(total) || "0m"}</b>
        </div>
        <div className="stat">
          <span>Done</span>
          <b>
            {count("done")}
            <small> / {own.length}</small>
          </b>
        </div>
        <div className="stat">
          <span>In progress</span>
          <b>{count("prog")}</b>
        </div>
        <div className="stat">
          <span>Blocked</span>
          <b className={count("block") ? "red" : ""}>{count("block")}</b>
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <h3>
            Tasks<span>{own.length} {own.length === 1 ? "item" : "items"}</span>
          </h3>
          <form className="add" onSubmit={add} autoComplete="off">
            <input ref={qRef} name="q" placeholder="What did you work on?" aria-label="Task" />
            <div className="row">
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Area">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input name="minutes" type="number" min={0} step={5} inputMode="numeric" placeholder="Minutes" aria-label="Minutes spent" />
              <input name="note" className="wide" placeholder="Note or blocker reason (optional)" aria-label="Note" />
              <button className="btn pri">Add task</button>
            </div>
            <p className="hint">
              Shortcut: type <b>#devops</b> for the area and end with <b>45m</b> or <b>1h30m</b> for time.
            </p>
          </form>

          {isToday && openEarlier.length > 0 && (
            <div className="note">
              <span>
                {openEarlier.length} unfinished task{openEarlier.length > 1 ? "s" : ""} from earlier days
              </span>
              <button
                className="btn sm"
                onClick={async () => {
                  const r = await api.carry(today);
                  toast(`${r.carried} task${r.carried === 1 ? "" : "s"} brought to today`);
                  changed();
                }}
              >
                Bring to today
              </button>
            </div>
          )}

          {tasks === null ? (
            <p className="empty">Loading…</p>
          ) : own.length ? (
            <ul className="tasks">
              {own.map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
            </ul>
          ) : (
            <div className="empty">
              <p>
                <b>No tasks for this day yet</b>
              </p>
              <p>Add what you worked on above. Your update email builds itself on the right.</p>
            </div>
          )}
        </section>
        <MailPanel title="Update email" sub={isToday ? "for today" : `for ${fmtDate(day, { day: "numeric", month: "short" })}`} draft={draft} draftKey={`d${day}`} kind="day" />
      </div>
    </>
  );
}
