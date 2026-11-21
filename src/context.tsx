import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Settings, Task, Timer } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { todayKey } from "../shared/dates";
import { api } from "./api";

interface ToastState {
  msg: string;
  undo?: () => void;
}

interface AppState {
  settings: Settings;
  setSettings: (s: Settings) => void;
  categories: string[];
  timer: Timer | null;
  refreshTimer: () => Promise<void>;
  setTimer: (t: Timer | null) => void;
  /** Minutes on a task including the running timer. */
  minutes: (t: Task) => number;
  now: number;
  today: string;
  toast: (msg: string, undo?: () => void) => void;
  /** Bumped after any change so views reload their data. */
  version: number;
  changed: () => void;
}

const Ctx = createContext<AppState | null>(null);

export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<string[]>([]);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toastState, setToast] = useState<ToastState | null>(null);
  const [version, setVersion] = useState(0);
  const toastTimer = useRef<number>(0);

  useEffect(() => {
    api.settings().then((r) => {
      setSettings(r.settings);
      setCategories(r.categories);
    });
    api.timer().then(setTimer);
  }, []);

  // Tick every second only while a timer runs; otherwise once a minute (keeps "today" fresh).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), timer ? 1000 : 60000);
    return () => window.clearInterval(id);
  }, [timer]);

  const refreshTimer = useCallback(async () => setTimer(await api.timer()), []);
  const minutes = useCallback(
    (t: Task) => (t.minutes || 0) + (timer && timer.taskId === t.id ? Math.max(0, (now - timer.startedAt) / 60000) : 0),
    [timer, now],
  );
  const toast = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <Ctx.Provider
      value={{ settings, setSettings, categories, timer, refreshTimer, setTimer, minutes, now, today: todayKey(), toast, version, changed }}
    >
      {children}
      {toastState && (
        <div className="toast" role="status">
          <span>{toastState.msg}</span>
          {toastState.undo && (
            <button
              onClick={() => {
                toastState.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
