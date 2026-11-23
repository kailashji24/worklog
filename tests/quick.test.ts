import { describe, expect, it } from "vitest";
import { parseQuick } from "../shared/quick";
import { CATEGORIES, type Project } from "../shared/types";

const projects: Project[] = [
  { id: "p1", name: "Barcode API", color: "#000000", archived: false, createdAt: 0 },
  { id: "p2", name: "Traceability DB", color: "#000000", archived: false, createdAt: 0 },
  { id: "p3", name: "Old Thing", color: "#000000", archived: true, createdAt: 0 },
];

describe("parseQuick", () => {
  it("reads area, project and trailing time", () => {
    expect(parseQuick("#devops @barcode nginx config for API 1h30m", CATEGORIES, projects)).toEqual({
      title: "nginx config for API",
      category: "DevOps",
      projectId: "p1",
      minutes: 90,
    });
  });

  it("supports minutes, hours and decimals", () => {
    expect(parseQuick("standup 15m", CATEGORIES).minutes).toBe(15);
    expect(parseQuick("deploy 2h", CATEGORIES).minutes).toBe(120);
    expect(parseQuick("migration 1.5h", CATEGORIES).minutes).toBe(90);
  });

  it("only treats a duration at the end as time", () => {
    const r = parseQuick("migrated 5m rows to new table", CATEGORIES);
    expect(r.minutes).toBeNull();
    expect(r.title).toBe("migrated 5m rows to new table");
  });

  it("matches projects ignoring spaces and case, but not archived ones", () => {
    expect(parseQuick("@traceabilitydb schema", CATEGORIES, projects).projectId).toBe("p2");
    const r = parseQuick("@old cleanup", CATEGORIES, projects);
    expect(r.projectId).toBeNull();
    expect(r.title).toBe("@old cleanup");
  });

  it("leaves unknown tags and emails alone", () => {
    const r = parseQuick("reply to a@b.com about #42", CATEGORIES, projects);
    expect(r).toMatchObject({ title: "reply to a@b.com about #42", category: null, projectId: null });
  });
});
