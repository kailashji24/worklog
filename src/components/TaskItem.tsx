import { useState, type FormEvent } from "react";
import { STATUSES, STATUS_LABEL, type Task } from "../../shared/types";
import { fmtDate, fmtMins } from "../../shared/dates";
import { api } from "../api";
import { useApp } from "../context";
import { Icon } from "../icons";
import { catColor } from "../colors";

export default function TaskItem({ task }: { task: Task }) {
  const { timer, minutes, refreshTimer, changed, toast, categories } = useApp();
  const [editing, setEditing] = useState(false);
  const running = timer?.taskId === task.id;
  const m = minutes(task);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    }
    changed();
  };

  const nextStatus = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length];

  if (editing) {
    const save = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      act(async () => {
        await api.updateTask(task.id, {
          title: String(f.get("title")),
          category: String(f.get("category")),
          status: f.get("status") as Task["status"],
          minutes: Number(f.get("minutes") || 0),
          date: String(f.get("date")),
          note: String(f.get("note")),
        });
        setEditing(false);
      });
    };
    return (
      <li className="task">
        <form className="ef" onSubmit={save}>
          <input name="title" defaultValue={task.title} aria-label="Task" required />
          <div className="row">
            <select name="category" defaultValue={task.category} aria-label="Area">
              {[...new Set([...categories, task.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select name="status" defaultValue={task.status} aria-label="Status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <input name="minutes" type="number" min={0} defaultValue={Math.round(task.minutes)} aria-label="Minutes" />
            <input name="date" type="date" defaultValue={task.date} aria-label="Date" />
          </div>
          <input name="note" defaultValue={task.note} placeholder="Note or blocker reason" aria-label="Note" />
          <div className="row">
            <button className="btn pri">Save</button>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`task s-${task.status}${running ? " run" : ""}`} data-task={task.id}>
      <button
        className="tick"
        aria-label={task.status === "done" ? "Mark not done" : "Mark done"}
        onClick={() =>
          act(async () => {
            await api.updateTask(task.id, { status: task.status === "done" ? "prog" : "done" });
            if (running) await refreshTimer();
          })
        }
      >
        {task.status === "done" && <Icon name="check" size={15} />}
      </button>
      <div>
        <p className="tt">{task.title}</p>
        <p className="meta">
          <span className="tag" style={{ ["--c" as string]: catColor(task.category) }}>
            {task.category}
          </span>
          <button className={`chip c-${task.status}`} title="Click to change status" onClick={() => act(() => api.updateTask(task.id, { status: nextStatus }))}>
            {STATUS_LABEL[task.status]}
          </button>
          {(m >= 1 || running) && (
            <span className="tm">
              <Icon name="clock" size={13} />
              {fmtMins(m) || "0m"}
            </span>
          )}
          {task.fromDate && <span>from {fmtDate(task.fromDate, { day: "numeric", month: "short" })}</span>}
        </p>
        {task.note && <p className="tn">{task.note}</p>}
      </div>
      <div className="ta">
        <button
          className={`ab${running ? " on" : ""}`}
          aria-label={running ? "Stop timer" : "Start timer"}
          title={running ? "Stop timer" : "Start timer"}
          onClick={() =>
            act(async () => {
              if (running) await api.stopTimer();
              else await api.startTimer(task.id);
              await refreshTimer();
            })
          }
        >
          <Icon name={running ? "stop" : "play"} size={16} />
        </button>
        <button className="ab" aria-label="Edit" title="Edit" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} />
        </button>
        <button
          className="ab"
          aria-label="Delete"
          title="Delete"
          onClick={() =>
            act(async () => {
              await api.deleteTask(task.id);
              if (running) await refreshTimer();
              toast("Task deleted", () => act(() => api.createTask(task)));
            })
          }
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </li>
  );
}
