# kamash-backend

Node/Express + TypeScript backend replacing the n8n workflows behind **עורכת לשונית של מכון קמ"ש**
(`https://n8n.link-up.co.il/webhook/kamash/*`). See the migration plan this repo was scaffolded from
for full background on the n8n workflows being ported.

All 6 in-scope endpoints have been migrated and are served from a dedicated API subdomain,
**`https://kamash-api.link-up.co.il`**, cutting over from n8n all at once rather than gradually — the
path after the domain is kept identical to the old n8n webhook path (`/webhook/kamash/<name>`), so
switching the frontend over is purely a hostname swap.

> **Deploys** run via GitHub Actions on push to the `main` branch — see
> [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Endpoints

All mounted under `/webhook/kamash` (e.g. `POST https://kamash-api.link-up.co.il/webhook/kamash/editmanually`):

- `POST .../editmanually` — saves manually edited report HTML into the patient's Drive folder and
  updates the "אבחונים" sheet row's `גרסא אחרונה html` column.
- `POST .../updateTestToFix` — marks a "שאלוני הורים" row (matched by patient name, same fragile key
  n8n used) as `הושלם` and refreshes its patient-detail columns.
- `GET .../pendingdiagnostics` — returns "שאלוני הורים" rows where `סטטוס == בהמתנה`, raw.
- `GET .../prevdiagnostics` — returns every row in "אבחונים", raw.
- `POST .../sendEmailWithDiagnosis` — sends the diagnosis PDF (already rendered client-side) to
  `?mail=`. **Bug fixed vs. n8n**: the original workflow unconditionally also CC'd a hardcoded test
  address on every send — that branch is dropped, so this now only ever sends to the real recipient.
  A request with no `mail` now fails with 400 instead of silently no-op'ing while the frontend shows a
  false success toast. Subject/body text is still placeholder copy carried over from n8n — real wording
  needs to come from the clinic (see `emailService.ts`).
- `POST .../step1` — accepts the patient form + audio recording (`audioFile` or `transcriptFile` — both
  are always raw audio, the latter is a legacy/misleading field name), rejects formats Whisper doesn't
  accept up front, creates the patient's Drive folder (named `patientName (jobId prefix)` — fixes the
  n8n collision risk of naming folders from patient name alone), uploads the recording, and appends the
  "אבחונים" row with `status: processing` before responding immediately with `{ jobid, status }`. The
  rest of the pipeline (transcription cleanup → segmentation → per-section rewrite via Claude →
  per-section HTML via GPT-4.1 → deterministic document assembly) runs in the background — see
  `services/pipeline/step1Pipeline.ts`. Any thrown error at any stage flips the row to `status: failed`
  (`services/pipeline/errorHandler.ts`), replacing n8n's error-trigger workflow.
- `POST .../checkstatus` — looks up the row by `jobid`; once `status === 'done'`, downloads and returns
  the final report HTML; otherwise returns just the status (covers `processing`/`processing2`/`failed`
  — the frontend already treats anything non-`done`/non-`failed` as "keep polling").

A boot-time sweep (`services/pipeline/staleJobSweep.ts`, wired into `index.ts`) flips any job stuck in
`processing`/`processing2` for more than 30 minutes to `failed` — a self-healing improvement n8n never
had, covering the case where the process itself dies mid-pipeline.

CORS is wide open (`cors()` with no origin restriction) since the frontend is served from a different
domain than this API — matching the n8n webhook nodes' own `"allowedOrigins": "*"` setting, not a new,
looser policy introduced by this port.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — path to a service-account JSON key, shared as **Editor** on:
     - Spreadsheet "מכון קמש" (`1i52aS_uM8prV6ODSx8PkzO3tUMEnZbo1I1a1azoQe8s`)
     - Spreadsheet "מכון קמש הוראות" (`1EwcZ-GGSWM3EOyXaFSAHA07UC7-dm-CSCiFTLVWsW-c`)
     - Drive root folder `1McvYAEu97nBufa4po3gxfx6eiOdjmUzH`
   - `GOOGLE_IMPERSONATED_USER_EMAIL` — a real Workspace mailbox (e.g. `bracha@link-up.co.il`) that
     this service account impersonates via **domain-wide delegation**. Required because service
     accounts have zero Drive storage quota of their own — without impersonation, any Drive write
     (`createPatientFolder`, `uploadBinary`, `uploadText`, `createDoc`) fails with `"Service Accounts
     do not have storage quota"`. A Workspace **Super Admin** must authorize this service account's
     numeric Client ID (found in its Google Cloud Console details) at
     admin.google.com → Security → API Controls → Domain-wide Delegation, with scopes
     `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/spreadsheets`.
   - `OPENAI_API_KEY` — needs Whisper (audio transcription) + chat completions with `json_schema`
     structured output.
   - `ANTHROPIC_API_KEY` — needs access to the model in `services/anthropicService.ts`
     (`claude-sonnet-4-6` per the n8n export — **verify this is still a valid model id** before relying
     on it in production).
   - `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REFRESH_TOKEN` — only needed
     for `sendEmailWithDiagnosis`.
3. `npm run dev` (watches + runs via `tsx`), or `npm run build && npm start` for a production-style run.
4. `npm test` runs the vitest suite (all Google/OpenAI/Anthropic calls are mocked at the service
   boundary — no real credentials needed to run tests).

## Deploying

Runs via `pm2` on the same server as the frontend's static build, listening on an internal port
(`4000` by default) that's never exposed directly to the internet — only nginx reaches it:

```sh
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## Going live on kamash-api.link-up.co.il

1. Point a DNS record for `kamash-api.link-up.co.il` at this server.
2. Install `deploy/nginx-kamash-api.conf` (see the comments in that file for the exact steps, including
   running `certbot` to add TLS).
3. Update the frontend's hardcoded webhook URLs (`src/lib/api.ts`, `src/pages/Dashboard.tsx`,
   `src/pages/DiagnosisEditor.tsx`, `src/pages/NewDiagnosis.tsx` in the `machon_kamash` repo) from
   `https://n8n.link-up.co.il/webhook/kamash/...` to `https://kamash-api.link-up.co.il/webhook/kamash/...`
   — a pure hostname swap, since the path is identical.
4. Deploy the frontend (push to `main` — see that repo's `deploy.yml`).

n8n's own `kamash/*` workflows can stay in place afterwards as a rollback path (point the frontend's
hostname back at `n8n.link-up.co.il` and redeploy) until confidence is established, then be retired.
