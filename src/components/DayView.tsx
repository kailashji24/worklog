import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { STATUSES, STATUS_LABEL, type Status, type Task } from "../../shared/types";
import { addDays, fmtDate, fmtMins, nextWorkDay } from "../../shared/dates";
import { dailyEmail } from "../../shared/report";
import { parseQuick } from "../../shared/quick";
import { api } from "../api";
import { useApp } from "../context";
import { Icon } from "../icons";
import { catColor } from "../colors";
import TaskItem from "./TaskItem";
import MailPanel from "./MailPanel";

const GROUPS: Status[] = ["prog", "block", "done", "plan"];
const QUICK_MINS = [15, 30, 60, 120];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function DayView() {
  const { today, settings, minutes, categories, projects, projectMap, refreshProjects, version, changed, toast } = useApp();
  const [day, setDay] = useState(today);
  const prevToday = useRef(today);
  const [project, setProject] = useState<string>(() => localStorage.getItem("wl-project") || "");
  const [newProject, setNewProject] = useState<string | null>(null);
  const active = useMemo(() => projects.filter((p) => !p.archived), [projects]);

  // When the date rolls over (app left open overnight), follow it if you were looking at "today".
  useEffect(() => {
    if (prevToday.current !== today) {
      setDay((d) => (d === prevToday.current ? today : d));
      prevToday.current = today;
    }
  }, [today]);

  // Forget a remembered project that was archived or deleted.
  useEffect(() => {
    if (project && projects.length && !active.some((p) => p.id === project)) setProject("");
  }, [project, projects, active]);
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
  const draft = useMemo(() => dailyEmail(day, tasks ?? [], { settings, projects: projectMap, minutes }), [day, tasks, settings, projectMap, minutes]);
  const isToday = day === today;
  const firstName = settings.name.trim().split(/\s+/)[0];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = parseQuick(title, categories, projects);
    if (!p.title) return qRef.current?.focus();
    localStorage.setItem("wl-cat", cat);
    localStorage.setItem("wl-status", status);
    localStorage.setItem("wl-project", project);
    setSaving(true);
    try {
      await api.createTask({
        date: day,
        title: p.title,
        category: p.category ?? cat,
        projectId: p.projectId ?? (project || null),
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

            <div className="chips projchips" role="radiogroup" aria-label="Project">
              <span className="chiplabel">Project</span>
              <button type="button" role="radio" aria-checked={!project} className={`pick${!project ? " on" : ""}`} style={{ ["--c" as string]: "#8a919c" }} onClick={() => setProject("")}>
                None
              </button>
              {active.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="radio"
                  aria-checked={project === p.id}
                  className={`pick${project === p.id ? " on" : ""}`}
                  style={{ ["--c" as string]: p.color }}
                  onClick={() => setProject(p.id)}
                >
                  <i className="pdot" />
                  {p.name}
                </button>
              ))}
              {newProject === null ? (
                <button type="button" className="pick add-proj" onClick={() => setNewProject("")}>
                  <Icon name="plus" size={14} />
                  New
                </button>
              ) : (
                <span className="newproj">
                  <input
                    autoFocus
                    value={newProject}
                    maxLength={60}
                    placeholder="Project name"
                    aria-label="New project name"
                    onChange={(e) => setNewProject(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Escape") setNewProject(null);
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const name = newProject.trim();
                      if (!name) return setNewProject(null);
                      try {
                        const p = await api.createProject({ name });
                        await refreshProjects();
                        setProject(p.id);
                        setNewProject(null);
                        qRef.current?.focus();
                      } catch (x) {
                        toast((x as Error).message);
                      }
                    }}
                    onBlur={() => !newProject.trim() && setNewProject(null)}
                  />
                </span>
              )}
            </div>

            <div className="chips" role="radiogroup" aria-label="Area">
              <span className="chiplabel">Area</span>
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
              Tip: press <kbd>N</kbd> to start a task. Shortcuts: <b>@project</b>, <b>#area</b>, and end with <b>1h30m</b> for time.
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
