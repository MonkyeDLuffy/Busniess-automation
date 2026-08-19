# Business Finder — Local Business Outreach Automation

Scrapes local businesses from Google Maps, finds their emails (from their websites),
writes everything to NocoDB (and optionally Google Sheets), and sends automated
outreach emails. Includes a password-protected admin web page to pick a location +
business type and run a job.

Runs either as a plain Node server (local), as a Vercel serverless app, or as a
persistent web service on Render.

## Deploying to Render (recommended — no 60s job limit)

Vercel's free plan kills functions after 60 seconds, which caps a scrape at a few
results. Render runs the app as a persistent process, so jobs can run for minutes.

1. **Push the project to GitHub.**
2. In Render: *New → Blueprint*, paste the GitHub repo, select
   `business-automation`, and create. The `render.yaml` configures everything
   (Node runtime, Playwright install, port, health check).
3. **Environment variables** (Render → your service → Environment): set the ones
   the blueprint left empty — `AUTH_SECRET`, `NOCODB_URL`, `NOCODB_TOKEN`,
   `NOCODB_BASE_ID`, `NOCODB_TABLE_ID`, `NOCODB_TABLE_NAME`, and optional
   `RESEND_*` / `GOOGLE_SERVICE_ACCOUNT_KEY` / `SPREADSHEET_ID` / `SHEET_TAB`.
   (`GOOGLE_SERVICE_ACCOUNT_KEY` must be the JSON itself, not a file path.)
4. **Deploy** — sign in with one of the fixed users and run a search. Jobs of
   20-50 results now finish normally.

## Folder layout
npm start        → runs the admin page at http://localhost:5050
npm run scrape   → CLI mode (below)

## Setup (local)

1. `npm install` (this also installs the Playwright Chromium browser).

2. Copy `.env.example` to `.env` and fill in:
   - `AUTH_SECRET` — required. Generate with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - **NocoDB** — the primary destination for found businesses
     (`NOCODB_URL`, `NOCODB_TOKEN`, `NOCODB_TABLE_ID`). Data is appended, never deleted.
   - **Google Sheets** (optional): `GOOGLE_SERVICE_ACCOUNT_KEY` can be a path to the
     service-account JSON *or* the JSON itself as a single-line value.
     Create the key in Google Cloud Console:
       1. Enable the **Google Sheets API** for a Cloud project.
       2. Create a **Service Account**, download the JSON.
       3. Open your spreadsheet → Share → invite the service-account email
          (shown inside the JSON as `client_email`) as **Editor**.
   - **Resend** (optional): `RESEND_FROM` must be on a domain verified at
     https://resend.com/domains — Resend's default `onboarding@resend.dev` only
     delivers to your own account email.

3. Start:
   ```
   npm start
   ```
   Open http://localhost:5050, sign in, enter a location + business type, and hit **Run search**.

## Deploying to Vercel

The app is converted to Vercel serverless functions (`api/index.js` + `src/app.js`).
Deploy with the **root directory set to `business-automation`**.

1. **Push the project to GitHub**, then in Vercel: *Add New Project → Import* it,
   set **Root Directory** to `business-automation`.
2. **Environment variables** (Vercel → Settings → Environment Variables): add
   `AUTH_SECRET`, `NOCODB_URL`, `NOCODB_TOKEN`, `NOCODB_TABLE_ID`, and the optional
   `GOOGLE_SERVICE_ACCOUNT_KEY`, `SPREADSHEET_ID`, `RESEND_API_KEY`, `RESEND_FROM`.
3. **Deploy.** Sign in with one of the fixed users.

### Vercel limits — read this
- The Playwright Chromium (headless shell) is installed into `node_modules` during
  `npm install` (`scripts/install-browsers.mjs`) and bundled into the serverless
  function via `vercel.json` (`includeFiles`). This makes scraping work on Vercel,
  but it adds ~100MB to the function: expect slower cold starts.
- `vercel.json` sets `maxDuration: 60s` (Hobby plan max). Larger searches that
  scrape + enrich many businesses can exceed this. On Pro you can raise it to
  `300` in `vercel.json`.
- Job state is persisted to a `JobRuns` tab in the same Google Spreadsheet used for
  results, so the dashboard can follow a job across any Vercel function instance
  (no Redis needed). Job state is best-effort if Google Sheets isn't configured;
  results always persist to NocoDB regardless of the UI.
- If Google Maps scraping from serverless is still too slow or flaky, keep
  `maxResults` modest and run big searches locally with `npm start` instead —
  results still land in NocoDB.

## CLI mode (no browser UI)

```
npm run scrape -- --location "Manchester" --type "coffee shops" --max 20
```
Options:
- `--location` / `--type`  required
- `--max N`                max results (default 10)
- `--concurrency N`        parallel detail pages / website fetches (default 5)
- `--fresh`                ignore previously-saved businesses (no dedup against past runs)
- `--send`                 also send outreach emails to found addresses
- `--no-sheet`             skip writing to Google Sheets
- `--headed`               run Chromium in headed mode (debugging)

Results are appended to NocoDB (append-only). A dedup index (Place ID, phone,
domain+name, name+address) remembers already-saved businesses so re-runs skip
duplicates instead of returning them again.

## What gets collected
Per business: name, category, address, phone, website, website status (Active / Error / Unreachable),
business status (Open/Closed), rating, found email, and sent state — appended to
the NocoDB `Business-automation` table (and optionally the Google Sheet).

## Compliance
Emails are found from the businesses' own public websites. The built-in message
includes an unsubscribe line. Only send to businesses in your target region/niche
and keep volume sensible — campaign-style blasting can get your Resend domain
flagged and may be illegal in some jurisdictions.