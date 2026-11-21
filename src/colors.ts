const COLORS: Record<string, string> = {
  Data: "#2457e6",
  DevOps: "#d92d20",
  Backend: "#7a4fd6",
  Server: "#c27803",
  Meeting: "#667085",
  Support: "#0e8a9e",
  Other: "#8a919c",
};

export const catColor = (c: string) => COLORS[c] ?? COLORS.Other;
