import { useEffect, useState } from "react";
import { api } from "./api";
import { AppProvider, useApp } from "./context";
import { Icon, type IconName } from "./icons";
import Login from "./components/Login";
import DayView from "./components/DayView";
import ReportView from "./components/ReportView";
import SettingsView from "./components/SettingsView";

type Tab = "day" | "week" | "month" | "settings";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "day", label: "Today", icon: "day" },
  { id: "week", label: "Week report", icon: "week" },
  { id: "month", label: "Month report", icon: "month" },
  { id: "settings", label: "Settings", icon: "settings" },
];
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : "day";
};

export default function App() {
  const [auth, setAuth] = useState<"loading" | "in" | "out">("loading");
  const [passwordSet, setPasswordSet] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setPasswordSet(r.passwordSet);
        setAuth(r.loggedIn ? "in" : "out");
      })
      .catch(() => setAuth("out"));
  }, []);

  if (auth === "loading") return <div className="splash">Loading…</div>;
  if (auth === "out") return <Login passwordSet={passwordSet} onIn={() => setAuth("in")} />;
  return (
    <AppProvider>
      <Shell onLogout={() => setAuth("out")} />
    </AppProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const { settings, timer, now, refreshTimer, changed } = useApp();

  useEffect(() => {
    const on = () => setTab(tabFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = (t: Tab) => {
    location.hash = t;
    setTab(t);
  };
  const secs = timer ? Math.floor((now - timer.startedAt) / 1000) : 0;
  const clock = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((n) => String(n).padStart(2, "0")).join(":");

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">
          <span className="mk">
            <Icon name="check" size={20} />
          </span>
          <div>
            <b>Work Log</b>
            <small>{settings.name || "Daily work tracker"}</small>
          </div>
        </div>
        <nav className="nav" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          {timer && (
            <div className="runcard">
              <span className="live">
                <span className="dot" />
                Timer running
              </span>
              <b>{clock}</b>
              <p>{timer.title}</p>
              <button
                className="btn sm"
                onClick={async () => {
                  await api.stopTimer();
                  await refreshTimer();
                  changed();
                }}
              >
                <Icon name="stop" size={14} />
                Stop
              </button>
            </div>
          )}
          <button
            className="navlink"
            onClick={async () => {
              await api.logout();
              onLogout();
            }}
          >
            <Icon name="logout" size={16} />
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        {tab === "day" && <DayView />}
        {(tab === "week" || tab === "month") && <ReportView key={tab} kind={tab} />}
        {tab === "settings" && <SettingsView />}
        <p className="savenote">All changes are saved automatically.</p>
      </main>
    </div>
  );
}
