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
}

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  to: "",
  cc: "",
  greet: "",
  client: "gmail",
  saturday: true,
};

export interface Timer {
  taskId: string;
  startedAt: number; // epoch ms
  title?: string;
}
