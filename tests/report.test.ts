import { describe, expect, it } from "vitest";
import { dailyEmail, exportCsv, exportMarkdown, rangeEmail, rangeStats } from "../shared/report";
import { addDays, nextWorkDay, rangeFor } from "../shared/dates";
import { DEFAULT_SETTINGS, type Project, type Task } from "../shared/types";

const project: Project = { id: "p1", name: "Barcode API", color: "#2457e6", archived: false, createdAt: 0 };
let n = 0;
const task = (over: Partial<Task>): Task => ({
  id: `t${++n}`,
  date: "2026-11-23",
  title: "Task",
  category: "DevOps",
  status: "done",
  minutes: 0,
  note: "",
  projectId: null,
  carried: false,
  fromDate: null,
  createdAt: n,
  updatedAt: n,
  ...over,
});
const settings = { ...DEFAULT_SETTINGS, name: "Kailash", greet: "sir" };

describe("dates", () => {
  it("skips Sunday, and Saturday when it is not a working day", () => {
    expect(nextWorkDay("2026-11-21", true)).toBe("2026-11-23"); // Sat → Mon
    expect(nextWorkDay("2026-11-20", true)).toBe("2026-11-21"); // Fri → Sat
    expect(nextWorkDay("2026-11-20", false)).toBe("2026-11-23"); // Fri → Mon
  });
  it("weeks start on Monday and months cover the whole month", () => {
    expect(rangeFor("week", "2026-11-26")).toEqual(["2026-11-23", "2026-11-29"]);
    expect(rangeFor("month", "2026-02-10")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("dailyEmail", () => {
  const tasks = [
    task({ title: "SSL setup", minutes: 45, projectId: "p1" }),
    task({ title: "Lookup timeout", status: "prog", category: "Backend", minutes: 30 }),
    task({ title: "Backup cron", status: "block", category: "Server", note: "need disk access" }),
    task({ date: "2026-11-24", title: "Load test", status: "plan", category: "Backend" }),
  ];
  const { subject, body } = dailyEmail("2026-11-23", tasks, { settings, projects: [project] });

  it("builds subject and sections", () => {
    expect(subject).toBe("Daily Update – Kailash – 23 Nov 2026");
    expect(body).toContain("Hi sir,");
    expect(body).toContain("Completed:\n• [Barcode API / DevOps] SSL setup (45m)");
    expect(body).toContain("In progress:\n• [Backend] Lookup timeout (30m)");
    expect(body).toContain("Blocked / need help:\n• [Server] Backup cron — need disk access");
    expect(body).toContain("Plan for tomorrow:\n• [Backend] Load test");
    expect(body).toContain("Total time logged: 1h 15m");
    expect(body.endsWith("Regards,\nKailash")).toBe(true);
  });

  it("is empty when nothing was logged", () => {
    expect(dailyEmail("2026-11-22", tasks, { settings }).body).toBe("");
  });
});

describe("ranges and exports", () => {
  const tasks = [
    task({ date: "2026-11-23", minutes: 60, projectId: "p1" }),
    task({ date: "2026-11-24", minutes: 30, category: "Data" }),
    task({ date: "2026-11-24", status: "prog", carried: true, minutes: 10 }), // carried copies don't count as open
    task({ date: "2026-11-30", minutes: 999 }), // outside the week
  ];
  it("sums time by project and area", () => {
    const st = rangeStats("2026-11-23", "2026-11-29", tasks);
    expect(st.total).toBe(100);
    expect(st.byProject).toEqual([
      ["p1", 60],
      ["", 40],
    ]);
    expect(st.byCategory[0]).toEqual(["DevOps", 70]);
    expect(st.open).toHaveLength(0);
    expect(st.workedDays).toBe(2);
  });
  it("weekly email lists time by project", () => {
    const { body } = rangeEmail("week", "2026-11-23", "2026-11-29", tasks, { settings, projects: [project] });
    expect(body).toContain("By project: Barcode API 1h");
  });
  it("CSV quotes values and includes the project", () => {
    const csv = exportCsv("2026-11-23", "2026-11-23", [task({ title: 'Say "hi", ok', projectId: "p1" })], [project]);
    expect(csv.split("\n")[1]).toBe('"2026-11-23","Barcode API","DevOps","Done","Say ""hi"", ok","0",""');
  });
  it("Markdown export names the project", () => {
    expect(exportMarkdown("2026-11-23", "2026-11-23", tasks, [project])).toContain("(Barcode API / DevOps)");
  });
});
