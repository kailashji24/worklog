import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Icon } from "../icons";

export default function Login({ passwordSet, onIn }: { passwordSet: boolean; onIn: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.login(pw);
      onIn();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card loginbox" onSubmit={submit}>
        <span className="mk big">
          <Icon name="check" size={26} />
        </span>
        <h1>Work Log</h1>
        <p className="mute">Your daily tasks, time and update emails in one place.</p>
        {!passwordSet && (
          <p className="err">
            No password is set on the server yet. Run <code>npx wrangler secret put APP_PASSWORD</code> and reload.
          </p>
        )}
        <label className="lb">
          Password
          <input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn pri" disabled={busy || !pw}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
