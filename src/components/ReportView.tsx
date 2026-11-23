import { useEffect, useMemo, useState } from "react";
import { STATUS_LABEL, type Task } from "../../shared/types";
import { fmtDate, fmtMins, parseKey, rangeFor, rangeLabel, toKey, addDays, type RangeKind } from "../../shared/dates";
import { categoryOrder, rangeEmail, rangeStats } from "../../shared/report";
import { api } from "../api";
import { copyText, useApp } from "../context";
import { Icon } from "../icons";
import { catColor } from "../colors";
import MailPanel from "./MailPanel";

export default function ReportView({ kind }: { kind: RangeKind }) {
  const { today, settings, minutes, projectMap, version, toast } = useApp();
  const [anchor, setAnchor] = useState(today);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [ask, setAsk] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [from, to] = rangeFor(kind, anchor);

  useEffect(() => {
    let live = true;
    api
      .tasks(from, to)
      .then((t) => live && setTasks(t))
      .catch((e) => toast((e as Error).message));
    return () => {
      live = false;
    };
  }, [from, to, version, toast]);

  useEffect(() => setAiText(""), [from]);

  const st = useMemo(() => rangeStats(from, to, tasks ?? [], minutes), [from, to, tasks, minutes]);
  const draft = useMemo(() => rangeEmail(kind, from, to, tasks ?? [], { settings, projects: projectMap, minutes }), [kind, from, to, tasks, settings, projectMap, minutes]);
  const maxCat = Math.max(1, ...st.byCategory.map(([, v]) => v));
  const maxProj = Math.max(1, ...st.byProject.map(([, v]) => v));
  const maxDay = Math.max(60, ...Object.values(st.perDay));
  const label = rangeLabel(kind, from, to);
  const shift = (n: number) => {
    if (kind === "week") setAnchor(addDays(anchor, 7 * n));
    else {
      const d = parseKey(anchor);
      setAnchor(toKey(new Date(d.getFullYear(), d.getMonth() + n, 1)));
    }
  };
  const dayLabel = (d: string) => {
    if (kind === "week") return fmtDate(d, { weekday: "short" });
    const n = parseKey(d).getDate();
    return n === 1 || n % 5 === 0 ? String(n) : "";
  };
  const doneCats = [...new Set(st.done.map((t) => t.category))].sort((a, b) => categoryOrder(a) - categoryOrder(b));

  const runAi = async () => {
    setAiBusy(true);
    try {
      setAiText(await api.aiReport(from, to, ask));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <>
      <div className="head">
        <div>
          <h2>{kind === "week" ? "Week" : "Month"} report</h2>
          <p>{label}</p>
        </div>
        <div className="pager">
          <button className="ib" aria-label={`Previous ${kind}`} onClick={() => shift(-1)}>
            <Icon name="left" />
          </button>
          <button className="ib" aria-label={`Next ${kind}`} onClick={() => shift(1)}>
            <Icon name="right" />
          </button>
        </div>
      </div>

      <div className="strip nobar">
        <div className="sv">
          <span>Logged</span>
          <b className="acc">{fmtMins(st.total) || "0h"}</b>
        </div>
        <div className="sv">
          <span>Done</span>
          <b>{st.done.length}</b>
        </div>
        <div className="sv">
          <span>Days worked</span>
          <b>{st.workedDays}</b>
        </div>
        <div className="sv">
          <span>Still open</span>
          <b className={st.open.some((t) => t.status === "block") ? "red" : ""}>{st.open.length}</b>
        </div>
      </div>

      <div className="grid">
        <div>
          {st.byProject.some(([id]) => id) && (
            <section className="card">
              <h3>Time by project</h3>
              <div className="bars">
                {st.byProject.map(([id, v]) => {
                  const p = id ? projectMap.get(id) : undefined;
                  return (
                    <div className="bar" key={id || "none"}>
                      <span className="bl" title={p?.name ?? "No project"}>{p?.name ?? "No project"}</span>
                      <span className="bt">
                        <i style={{ width: `${(v / maxProj) * 100}%`, background: p?.color ?? "#8a919c" }} />
                      </span>
                      <span className="bv">
                        {fmtMins(v)} <small>{Math.round((v / st.total) * 100)}%</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card">
            <h3>Time by area</h3>
            {st.byCategory.length ? (
              <div className="bars">
                {st.byCategory.map(([c, v]) => (
                  <div className="bar" key={c}>
                    <span>{c}</span>
                    <span className="bt">
                      <i style={{ width: `${(v / maxCat) * 100}%`, background: catColor(c) }} />
                    </span>
                    <span className="bv">
                      {fmtMins(v)} <small>{Math.round((v / st.total) * 100)}%</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mute">No time logged in this period. Use the timer or add minutes to tasks.</p>
            )}
          </section>

          <section className="card">
            <h3>Hours per day</h3>
            <div className="cols" style={{ ["--n" as string]: st.days.length }}>
              {st.days.map((d) => (
                <div key={d} className={`col${d === today ? " now" : ""}`} title={`${fmtDate(d)}: ${fmtMins(st.perDay[d]) || "nothing logged"}`}>
                  <span className="cb">
                    <i style={{ height: `${(st.perDay[d] / maxDay) * 100}%` }} />
                  </span>
                  <small>{dayLabel(d)}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>
              Completed<span>{st.done.length}</span>
            </h3>
            {st.done.length ? (
              doneCats.map((c) => {
                const list = st.done.filter((t) => t.category === c);
                return (
                  <div className="grp" key={c}>
                    <h4>
                      <span className="tag" style={{ ["--c" as string]: catColor(c) }}>
                        {c}
                      </span>
                      <span>{list.length}</span>
                    </h4>
                    <ul className="plain">
                      {list.map((t) => (
                        <li key={t.id}>
                          {t.title}{" "}
                          <span className="mute">
                            {t.projectId && projectMap.get(t.projectId) ? `· ${projectMap.get(t.projectId)!.name} ` : ""}· {fmtDate(t.date, { weekday: "short", day: "numeric", month: "short" })}
                            {minutes(t) >= 1 && ` · ${fmtMins(minutes(t))}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            ) : (
              <p className="mute">Nothing marked done yet.</p>
            )}
          </section>

          {st.open.length > 0 && (
            <section className="card">
              <h3>
                Still open<span>{st.open.length}</span>
              </h3>
              <ul className="plain">
                {st.open.map((t) => (
                  <li key={t.id}>
                    {t.title}{" "}
                    <span className={t.status === "block" ? "red" : "mute"}>
                      · {STATUS_LABEL[t.status]}
                      {t.note && ` — ${t.note}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h3>AI report</h3>
            <p className="mute" style={{ marginTop: 0 }}>
              Gemini writes a report from this {kind}'s log. Say what it's for, or leave it empty for a manager summary.
            </p>
            <div className="row">
              <input className="wide" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. For my appraisal, focus on DevOps impact" aria-label="What the report is for" />
              <button className="btn pri" onClick={runAi} disabled={aiBusy || !st.tasks.length}>
                <Icon name="spark" size={16} />
                {aiBusy ? "Writing…" : "Write report"}
              </button>
            </div>
            {aiText && (
              <>
                <div className="aiout">{aiText}</div>
                <button className="btn sm" onClick={async () => toast((await copyText(aiText)) ? "Report copied" : "Couldn't copy")}>
                  <Icon name="copy" size={14} />
                  Copy report
                </button>
              </>
            )}
          </section>

          <section className="card">
            <h3>Use in another AI or Excel</h3>
            <div className="mb">
              <button
                className="btn"
                onClick={async () => toast((await copyText(await api.exportText(from, to, "md"))) ? "Log copied — paste it into Gemini, ChatGPT or any AI" : "Couldn't copy")}
              >
                <Icon name="copy" size={16} />
                Copy log for AI
              </button>
              <a className="btn" href={`/api/export?from=${from}&to=${to}&format=csv`}>
                <Icon name="download" size={16} />
                Download CSV
              </a>
            </div>
          </section>
        </div>
        <MailPanel title={`${kind === "week" ? "Weekly" : "Monthly"} email`} sub={label} draft={draft} draftKey={kind + from} kind={kind} />
      </div>
    </>
  );
}
