import type { Project, Settings, Task, Timer } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    credentials: "same-origin",
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((isJson && (data as { error?: string }).error) || `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  me: () => call<{ loggedIn: boolean; passwordSet: boolean }>("/me"),
  login: (password: string) => call<{ ok: true }>("/login", { method: "POST", json: { password } }),
  logout: () => call<{ ok: true }>("/logout", { method: "POST" }),
  logoutAll: () => call<{ ok: true }>("/logout-all", { method: "POST" }),

  projects: () => call<{ projects: Project[] }>("/projects").then((r) => r.projects),
  createProject: (p: { name: string; color?: string }) => call<{ project: Project }>("/projects", { method: "POST", json: p }).then((r) => r.project),
  updateProject: (id: string, p: Partial<Project>) => call<{ project: Project }>(`/projects/${id}`, { method: "PATCH", json: p }).then((r) => r.project),
  deleteProject: (id: string) => call<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),

  tasks: (from: string, to: string) => call<{ tasks: Task[] }>(`/tasks?from=${from}&to=${to}`).then((r) => r.tasks),
  openBefore: (day: string) => call<{ tasks: Task[] }>(`/tasks/open?before=${day}`).then((r) => r.tasks),
  createTask: (t: Partial<Task>) => call<{ task: Task }>("/tasks", { method: "POST", json: t }).then((r) => r.task),
  updateTask: (id: string, t: Partial<Task>) => call<{ task: Task }>(`/tasks/${id}`, { method: "PATCH", json: t }).then((r) => r.task),
  deleteTask: (id: string) => call<{ ok: true }>(`/tasks/${id}`, { method: "DELETE" }),
  carry: (today: string) => call<{ carried: number }>("/tasks/carry", { method: "POST", json: { today } }),

  timer: () => call<{ timer: Timer | null }>("/timer").then((r) => r.timer),
  startTimer: (taskId: string) => call<{ timer: Timer }>("/timer/start", { method: "POST", json: { taskId } }).then((r) => r.timer),
  stopTimer: () => call<{ task: Task | null }>("/timer/stop", { method: "POST" }),

  settings: () => call<{ settings: Settings; categories: string[] }>("/settings"),
  saveSettings: (s: Partial<Settings>) => call<{ settings: Settings }>("/settings", { method: "PUT", json: s }).then((r) => r.settings),

  exportText: (from: string, to: string, format: "md" | "csv") => call<string>(`/export?from=${from}&to=${to}&format=${format}`),
  exportToken: () => call<{ token: string | null }>("/export/token").then((r) => r.token),
  newExportToken: () => call<{ token: string }>("/export/token", { method: "POST" }).then((r) => r.token),
  revokeExportToken: () => call<{ ok: true }>("/export/token", { method: "DELETE" }),
  importBackup: (backup: unknown) => call<{ imported: number; projects: number; skipped: number; settings: boolean }>("/import", { method: "POST", json: backup }),

  polish: (text: string, kind: "day" | "week" | "month") =>
    call<{ text: string }>("/ai/polish", { method: "POST", json: { text, kind } }).then((r) => r.text),
  aiReport: (from: string, to: string, ask: string) =>
    call<{ text: string }>("/ai/report", { method: "POST", json: { from, to, ask } }).then((r) => r.text),
};
