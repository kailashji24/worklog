import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { STATUSES, STATUS_LABEL, type Status, type Task } from "../../shared/types";
import { addDays, fmtDate, fmtMins, nextWorkDay } from "../../shared/dates";
import { dailyEmail } from "../../shared/report";
import { api } from "../api";
import { useApp } from "../context";
import { Icon } from "../icons";
import { catColor } from "../colors";
import TaskItem from "./TaskItem";
import MailPanel from "./MailPanel";

const GROUPS: Status[] = ["prog", "block", "done", "plan"];
const QUICK_MINS = [15, 30, 60, 120];

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

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function DayView() {
  const { today, settings, minutes, categories, version, changed, toast } = useApp();
  const [day, setDay] = useState(today);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [openEarlier, setOpenEarlier] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState(() => localStorage.getItem("wl-cat") || "Data");
  const [status, setStatus] = useState<Status>(() => (localStorage.getItem("wl-status") as Status) || "done");
  const [mins, setMins] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const mailRef = useRef<HTMLDivElement>(null);
  const [mailVisible, setMailVisible] = useState(false);

  // Hide the floating "Update email" button once the email panel is on screen.
  useEffect(() => {
    const el = mailRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setMailVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
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

  // Press "n" or "/" anywhere (outside a text field) to start typing a new task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "n" || e.key === "/") {
        e.preventDefault();
        qRef.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const own = useMemo(() => (tasks ?? []).filter((t) => t.date === day), [tasks, day]);
  const total = own.reduce((a, t) => a + minutes(t), 0);
  const count = (s: Status) => own.filter((t) => t.status === s).length;
  const done = count("done");
  const pct = own.length ? Math.round((done / own.length) * 100) : 0;
  const draft = useMemo(() => dailyEmail(day, tasks ?? [], settings, minutes), [day, tasks, settings, minutes]);
  const isToday = day === today;
  const firstName = settings.name.trim().split(/\s+/)[0];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = parseQuick(title, categories);
    if (!p.title) return qRef.current?.focus();
    localStorage.setItem("wl-cat", cat);
    localStorage.setItem("wl-status", status);
    setSaving(true);
    try {
      await api.createTask({
        date: day,
        title: p.title,
        category: p.category ?? cat,
        status,
        minutes: mins ? Number(mins) : (p.minutes ?? 0),
        note: note.trim(),
      });
      setTitle("");
      setMins("");
      setNote("");
      setShowNote(false);
      changed();
      qRef.current?.focus();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          {isToday && <p className="hello">{greeting()}{firstName ? `, ${firstName}` : ""}</p>}
          <h2>{isToday ? "Today" : fmtDate(day, { weekday: "long" })}</h2>
          <p>{fmtDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="pager">
          {!isToday && (
            <button className="btn sm" onClick={() => setDay(today)}>
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

      <div className="strip">
        <div className="sv">
          <span>Logged</span>
          <b className="acc">{fmtMins(total) || "0m"}</b>
        </div>
        <div className="sv">
          <span>Done</span>
          <b>
            {done}
            <small>/{own.length}</small>
          </b>
        </div>
        <div className="sv">
          <span>In progress</span>
          <b className={count("prog") ? "amb" : ""}>{count("prog")}</b>
        </div>
        <div className="sv">
          <span>Blocked</span>
          <b className={count("block") ? "red" : ""}>{count("block")}</b>
        </div>
        <div className="prog" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <form className="add" onSubmit={add} autoComplete="off">
            <div className="addline">
              <input ref={qRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you work on?" aria-label="Task" />
              <button className="btn pri" disabled={saving || !title.trim()} aria-label="Add task">
                <Icon name="plus" size={18} />
                <span className="hide-sm">Add</span>
              </button>
            </div>

            <div className="chips" role="radiogroup" aria-label="Area">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c}
                  role="radio"
                  aria-checked={cat === c}
                  className={`pick${cat === c ? " on" : ""}`}
                  style={{ ["--c" as string]: catColor(c) }}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="addopts">
              <div className="seg" role="radiogroup" aria-label="Status">
                {STATUSES.map((s) => (
                  <button type="button" key={s} role="radio" aria-checked={status === s} className={`s-${s}${status === s ? " on" : ""}`} onClick={() => setStatus(s)}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="times" role="group" aria-label="Time spent">
                {QUICK_MINS.map((m) => (
                  <button type="button" key={m} className={`pick${mins === String(m) ? " on" : ""}`} onClick={() => setMins(mins === String(m) ? "" : String(m))}>
                    {fmtMins(m)}
                  </button>
                ))}
                <input className="minbox" type="number" min={0} step={5} inputMode="numeric" placeholder="min" aria-label="Minutes spent" value={mins} onChange={(e) => setMins(e.target.value)} />
              </div>
            </div>

            {showNote ? (
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note or blocker reason" aria-label="Note" autoFocus />
            ) : (
              <button type="button" className="link" onClick={() => setShowNote(true)}>
                + Add a note
              </button>
            )}
            <p className="hint hide-sm">
              Tip: press <kbd>N</kbd> to start a task. Type <b>#devops</b> for the area or end with <b>1h30m</b> for time.
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
            GROUPS.map((g) => {
              const list = own.filter((t) => t.status === g);
              if (!list.length) return null;
              return (
                <div className="group" key={g}>
                  <h4 className={`gh g-${g}`}>
                    {STATUS_LABEL[g]}
                    <span>{list.length}</span>
                  </h4>
                  <ul className="tasks">
                    {list.map((t) => (
                      <TaskItem key={t.id} task={t} />
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <div className="empty">
              <span className="emptyicon">
                <Icon name="day" size={26} />
              </span>
              <p>
                <b>{isToday ? "Nothing logged yet today" : "No tasks on this day"}</b>
              </p>
              <p>Add what you worked on above. Your update email writes itself as you go.</p>
            </div>
          )}
        </section>
        <div ref={mailRef} className="mailwrap">
          <MailPanel title="Update email" sub={isToday ? "for today" : `for ${fmtDate(day, { day: "numeric", month: "short" })}`} draft={draft} draftKey={`d${day}`} kind="day" />
        </div>
      </div>

      {own.length > 0 && (
        <button className={`fab${mailVisible ? "" : " show"}`} onClick={() => mailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          <Icon name="mail" size={18} />
          Update email
        </button>
      )}
    </>
  );
}
