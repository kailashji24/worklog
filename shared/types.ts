export const CATEGORIES = ["Data", "DevOps", "Backend", "Server", "Meeting", "Support", "Other"] as const;
export type Category = (typeof CATEGORIES)[number] | string;

export const STATUSES = ["plan", "prog", "done", "block"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  plan: "Planned",
  prog: "In progress",
  done: "Done",
  block: "Blocked",
};

export interface Task {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  category: Category;
  status: Status;
  minutes: number;
  note: string;
  projectId: string | null;
  carried: boolean;
  fromDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  name: string;
  to: string;
  cc: string;
  greet: string;
  client: "gmail" | "outlook" | "app";
  saturday: boolean;
  /** Your job title, used to give the AI context (e.g. "Data Specialist working on DevOps and backend"). */
  role: string;
}

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  to: "",
  cc: "",
  greet: "",
  client: "gmail",
  saturday: true,
  role: "",
};

export interface Project {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  createdAt: number;
}

export const PROJECT_COLORS = ["#2457e6", "#d92d20", "#7a4fd6", "#c27803", "#0e8a9e", "#16a34a", "#db2777", "#475569"];

export interface Timer {
  taskId: string;
  startedAt: number; // epoch ms
  title?: string;
}
