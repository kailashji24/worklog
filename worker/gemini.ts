export class AIError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Models to try in order when Gemini is busy (503) or rate-limited (429). */
const FALLBACKS = ["gemini-flash-lite-latest"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One-shot text generation with the Gemini API (REST, no SDK needed). Retries and falls back when Gemini is busy. */
export async function gemini(apiKey: string | undefined, model: string, prompt: string): Promise<string> {
  if (!apiKey) throw new AIError("GEMINI_API_KEY is not set on the server.", 503);
  const models = [model, ...FALLBACKS.filter((m) => m !== model)];
  let last: AIError = new AIError("Gemini is busy right now. Try again in a minute.", 503);
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(apiKey, m, prompt);
      } catch (e) {
        if (!(e instanceof AIError)) throw e;
        last = e;
        if (e.status !== 503 && e.status !== 429) throw e; // a real error: don't retry
        if (attempt === 0) await sleep(1200);
      }
    }
  }
  throw last;
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new AIError("Gemini took too long or couldn't be reached. Try again in a minute.", 503);
  }
  if (res.status === 429) throw new AIError("Gemini rate limit reached. Try again in a minute.", 429);
  if (res.status === 503 || res.status === 500) throw new AIError("Gemini is busy right now. Try again in a minute.", 503);
  if (res.status === 400 || res.status === 403) throw new AIError("Gemini rejected the request. Check that GEMINI_API_KEY is correct.", 502);
  if (!res.ok) throw new AIError(`Gemini request failed (${res.status}). Try again in a minute.`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AIError("Gemini returned an empty answer. Try again.");
  return text;
}

const RULES =
  "Keep every task, the section headings, the times, the greeting and the sign-off. " +
  "Tighten the wording and fix grammar, but never invent work, numbers or outcomes. " +
  "Plain text only: no markdown, no asterisks, use '• ' for bullets. Return only the email body, no subject line.";

const who = (role: string) => (role.trim() ? `The sender is: ${role.trim().slice(0, 200)}. ` : "The sender is a software/DevOps professional. ");

export const polishPrompt = (kind: "day" | "week" | "month", body: string, role = "") =>
  (kind === "day"
    ? "Rewrite this daily work update email so it reads clear, professional and concise for a senior manager. "
    : "Rewrite this work summary email for a senior manager. Open with two or three sentences on the main highlights, then keep the lists. ") +
  who(role) +
  RULES +
  "\n\nEMAIL:\n" +
  body;

export const reportPrompt = (log: string, ask: string, role = "") =>
  "You are helping someone turn their own work log into a report. " +
  who(role) +
  "Use only facts from the log; do not invent tasks, numbers or outcomes. Group related work by project and theme, call out impact, " +
  "time spent by project and area, and open blockers. Use short headings and bullet points (Markdown is fine).\n\n" +
  `WHAT THEY WANT: ${ask || "A clear summary of the period for their manager, with highlights first."}\n\nWORK LOG:\n${log}`;
