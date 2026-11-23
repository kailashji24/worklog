import type { Project } from "./types";

export interface QuickParse {
  title: string;
  category: string | null;
  projectId: string | null;
  minutes: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Quick entry: "#devops @barcode fixed nginx config 1h30m"
 *   #word  → area (first area whose name starts with the word)
 *   @word  → project (first active project whose name, ignoring spaces, starts with the word)
 *   a duration at the end (45m, 2h, 1.5h, 1h30m) → minutes
 * Unknown #/@ words are left in the title.
 */
export function parseQuick(input: string, categories: readonly string[], projects: readonly Project[] = []): QuickParse {
  let category: string | null = null;
  let projectId: string | null = null;
  let minutes: number | null = null;

  let s = input.replace(/(^|\s)#([\w-]+)/g, (m, pre: string, w: string) => {
    const c = categories.find((c) => c.toLowerCase().startsWith(w.toLowerCase()));
    if (c && !category) {
      category = c;
      return pre;
    }
    return m;
  });

  s = s.replace(/(^|\s)@([\w-]+)/g, (m, pre: string, w: string) => {
    const key = norm(w);
    const p = key && projects.find((p) => !p.archived && norm(p.name).startsWith(key));
    if (p && !projectId) {
      projectId = p.id;
      return pre;
    }
    return m;
  });

  s = s.replace(/(?:^|\s)(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?(?:\s*(\d+)\s*m(?:ins?)?)?|(\d+)\s*m(?:ins?)?)\s*$/i, (_m, h, hm, mm) => {
    minutes = h ? Math.round(parseFloat(h) * 60) + (hm ? +hm : 0) : +mm;
    return "";
  });

  return { title: s.replace(/\s+/g, " ").trim(), category, projectId, minutes };
}
