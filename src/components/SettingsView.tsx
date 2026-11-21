import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../shared/types";
import { addDays } from "../../shared/dates";
import { api } from "../api";
import { copyText, useApp } from "../context";
import { Icon } from "../icons";

export default function SettingsView() {
  const { settings, setSettings, toast, today, changed } = useApp();
  const [form, setForm] = useState<Settings>(settings);
  const [token, setToken] = useState<string | null>(null);
  const saveT = useRef<number>(0);

  useEffect(() => setForm(settings), [settings]);
  useEffect(() => {
    api.exportToken().then(setToken);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...form, ...patch };
    setForm(next);
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(async () => {
      try {
        setSettings(await api.saveSettings(next));
      } catch (e) {
        toast((e as Error).message);
      }
    }, 500);
  };

  const from = addDays(today, -30);
  const aiLink = token ? `${location.origin}/api/export?from=${from}&to=${today}&format=md&token=${token}` : "";

  return (
    <>
      <div className="head">
        <div>
          <h2>Settings</h2>
          <p>Saved automatically.</p>
        </div>
      </div>
      <div className="set">
        <section className="card">
          <h3>Update emails</h3>
          <div className="setf">
            <label className="lb">
              Your name (signs your emails)
              <input value={form.name} onChange={(e) => update({ name: e.target.value })} />
            </label>
            <label className="lb">
              Send updates to
              <input value={form.to} inputMode="email" placeholder="senior@company.com" onChange={(e) => update({ to: e.target.value })} />
            </label>
            <label className="lb">
              Cc (optional, separate with commas)
              <input value={form.cc} inputMode="email" placeholder="director@company.com" onChange={(e) => update({ cc: e.target.value })} />
            </label>
            <label className="lb">
              Name after “Hi” (optional)
              <input value={form.greet} placeholder="Leave empty for just “Hi,”" onChange={(e) => update({ greet: e.target.value })} />
            </label>
            <label className="lb">
              Open drafts in
              <select value={form.client} onChange={(e) => update({ client: e.target.value as Settings["client"] })}>
                <option value="gmail">Gmail (web)</option>
                <option value="outlook">Outlook (web)</option>
                <option value="app">Default mail app</option>
              </select>
            </label>
            <label className="ck">
              <input type="checkbox" checked={form.saturday} onChange={(e) => update({ saturday: e.target.checked })} /> Saturday is a working day
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Link for AI</h3>
          <p className="mute" style={{ marginTop: 0 }}>
            A private, read-only link to your log as plain text. Give it to any AI that can open links and ask for a report. Change the
            dates in the link for other periods. Anyone with the link can read your log, so reset it if you've shared it by mistake.
          </p>
          {token ? (
            <>
              <input readOnly value={aiLink} onFocus={(e) => e.target.select()} aria-label="AI link" />
              <div className="mb" style={{ marginTop: 10 }}>
                <button className="btn" onClick={async () => toast((await copyText(aiLink)) ? "Link copied" : "Couldn't copy")}>
                  <Icon name="copy" size={16} />
                  Copy link
                </button>
                <button className="btn" onClick={async () => setToken(await api.newExportToken())}>
                  Reset link
                </button>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    await api.revokeExportToken();
                    setToken(null);
                  }}
                >
                  Turn off
                </button>
              </div>
            </>
          ) : (
            <button className="btn pri" onClick={async () => setToken(await api.newExportToken())}>
              <Icon name="link" size={16} />
              Create link
            </button>
          )}
        </section>

        <section className="card">
          <h3>Backup</h3>
          <p className="mute" style={{ marginTop: 0 }}>
            Your log lives in your Cloudflare D1 database. Download a full backup now and then.
          </p>
          <div className="mb">
            <a className="btn" href="/api/backup" download={`worklog-backup-${today}.json`}>
              <Icon name="download" size={16} />
              Download backup
            </a>
            <label className="btn">
              Restore backup
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const data = JSON.parse(await file.text());
                    const r = await api.importBackup(data.tasks ?? []);
                    toast(`Restored ${r.imported} tasks`);
                    changed();
                  } catch (x) {
                    toast((x as Error).message || "That file isn't a Work Log backup");
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </section>

        <section className="card">
          <h3>Account</h3>
          <button
            className="btn"
            onClick={async () => {
              await api.logout();
              location.reload();
            }}
          >
            <Icon name="logout" size={16} />
            Log out
          </button>
        </section>
      </div>
    </>
  );
}
