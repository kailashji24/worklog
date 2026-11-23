# Work Log

A personal work tracker: log what you work on during the day, time it, and send a ready-made daily update email in one click. Weekly and monthly reports show where your time went, and Gemini can polish emails or write a full report (for example, for an appraisal).

Built to be fast, free to host, and simple to run: the whole app (frontend, API and database) runs on Cloudflare's free plan, with nothing else to connect.

## Features

- **Projects**: create projects (e.g. "Barcode API", "AWS Infra") with a colour. Every task gets a project and an area, and reports show time per project.
- **Daily log**: add tasks with an area (Data, DevOps, Backend, Server, Meeting, Support, Other), status, minutes and notes. Tap chips for project, area, status and time, or type shortcuts: `@barcode #devops nginx config for API 1h30m`.
- **Timer**: start/stop on any task; it keeps running on the server, even if you close the tab.
- **Daily update email**: Completed / In progress / Blocked / Plan for tomorrow, built from your tasks. Opens in Gmail, Outlook or your mail app (To and Cc filled in).
- **Carry over**: unfinished tasks from earlier days move to today in one click, and the history is kept.
- **Week and month reports**: time by area, hours per day, completed work and open items, plus a weekly or monthly email.
- **AI (Gemini)**: "Polish with AI" for emails and "Write report" for a period, with your own instructions.
- **Use with any AI**: copy your log as Markdown, download a CSV, or create a private read-only link that any AI able to open links can read.
- **Backup and restore** as JSON. It installs on your phone like an app (PWA).
- Single-user password login with real server-side sessions (logout ends the session, "log out on all devices" too), and a per-IP lockout after 8 wrong passwords.
- Installable on phone and desktop (PWA with offline app shell; your data itself is never cached).

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript, Vite | Small, fast, typed |
| API | [Hono](https://hono.dev) on Cloudflare Workers | Tiny, runs at the edge, no cold starts |
| Database | Cloudflare D1 (SQLite) | Free, built into Workers, no connection strings |
| AI | Gemini API (REST) | Free tier, no SDK needed |
| Hosting | One Cloudflare Worker serves both the app and the API | One deploy, one URL |

```
worker/   Hono API (auth, tasks, timer, settings, export, AI)
shared/   Types, date helpers and report/email builders used by both sides
src/      React app
migrations/  D1 SQL schema
```

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars        # set APP_PASSWORD and GEMINI_API_KEY
npm run db:migrate:local
npm run dev                            # http://localhost:5173
```

## Deploy (free, about 10 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and a free [Gemini API key](https://aistudio.google.com/apikey).

```bash
npx wrangler login
npx wrangler d1 create worklog-db      # copy the database_id it prints into wrangler.jsonc
npx wrangler secret put APP_PASSWORD   # the password you'll log in with
npx wrangler secret put GEMINI_API_KEY
npm run deploy                         # builds, runs DB migrations, deploys
```

Wrangler prints your URL (`https://worklog.<your-subdomain>.workers.dev`). Open it, log in, and add it to your phone's home screen.

### Auto-deploy from GitHub (optional)

In the Cloudflare dashboard, go to **Workers & Pages → worklog → Settings → Build** and connect this repo. Use these settings:

- Build command: `npm run build`
- Deploy command: `npm run deploy:ci`

Every push to `main` then deploys automatically. Secrets stay in Cloudflare and are never stored in the repo.

## Tests

```bash
npm test
```

Unit tests cover dates, quick entry, emails and exports. Integration tests run the real API against a fresh in-memory D1 database: login/logout, lockout, projects, validation, carry-over races, the timer, the export token, and backup/restore.

## Updating

Pull or edit the code, then run `npm run deploy`. It applies any new database migrations (in `migrations/`) before deploying, so existing data is kept.

## Free plan limits

D1's free plan allows 5 million row reads and 100,000 row writes per day, with 500 MB per database. Workers' free plan allows 100,000 requests per day. A personal log uses a tiny fraction of this.

## API

All routes are under `/api` and need the login cookie, except `/api/export` with a valid `?token=`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/login`, `/logout`, `/logout-all` | Server-side session (30 days) |
| GET | `/tasks?from&to` | Tasks in a date range |
| GET | `/tasks/open?before` | Unfinished tasks before a day |
| POST / PATCH / DELETE | `/tasks`, `/tasks/:id` | Create, update, delete |
| POST | `/tasks/carry` | Bring open tasks to today (atomic, each task once) |
| GET / POST / PATCH / DELETE | `/projects`, `/projects/:id` | Projects (deleting keeps the tasks) |
| GET / POST | `/timer`, `/timer/start`, `/timer/stop` | Server-side timer |
| GET / PUT | `/settings` | Email settings |
| GET | `/export?from&to&format=md\|csv\|json[&token]` | Export for AI or Excel |
| GET / POST / DELETE | `/export/token` | Manage the private AI link |
| GET / POST | `/backup`, `/import` | Full backup (settings, projects, tasks) and all-or-nothing restore |
| POST | `/ai/polish`, `/ai/report` | Gemini |

## Configuration

| Name | Where | Notes |
|---|---|---|
| `APP_PASSWORD` | secret | Your login password. Changing it logs out all sessions. |
| `GEMINI_API_KEY` | secret | From Google AI Studio |
| `GEMINI_MODEL` | `wrangler.jsonc` vars | Defaults to `gemini-flash-latest` |
