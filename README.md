# kamash-backend

Node/Express + TypeScript backend replacing the n8n workflows behind **עורכת לשונית של מכון קמ"ש**
(`https://n8n.link-up.co.il/webhook/kamash/*`). See the migration plan this repo was scaffolded from
for full background on the n8n workflows being ported and the endpoint-by-endpoint cutover strategy.

All 6 in-scope endpoints have now been migrated (see below); everything not yet cut over in nginx
still runs on n8n in the meantime.

## Endpoints

- `POST /kamash/editmanually` — saves manually edited report HTML into the patient's Drive folder and
  updates the "אבחונים" sheet row's `גרסא אחרונה html` column.
- `POST /kamash/updateTestToFix` — marks a "שאלוני הורים" row (matched by patient name, same fragile
  key n8n used) as `הושלם` and refreshes its patient-detail columns.
- `GET /kamash/pendingdiagnostics` — returns "שאלוני הורים" rows where `סטטוס == בהמתנה`, raw.
- `GET /kamash/prevdiagnostics` — returns every row in "אבחונים", raw.
- `POST /kamash/sendEmailWithDiagnosis` — sends the diagnosis PDF (already rendered client-side) to
  `?mail=`. **Bug fixed vs. n8n**: the original workflow unconditionally also CC'd a hardcoded test
  address on every send — that branch is dropped, so this now only ever sends to the real recipient.
  A request with no `mail` now fails with 400 instead of silently no-op'ing while the frontend shows a
  false success toast. Subject/body text is still placeholder copy carried over from n8n — real wording
  needs to come from the clinic (see `emailService.ts`).
- `POST /kamash/step1` — accepts the patient form + audio recording (`audioFile` or `transcriptFile` —
  both are always raw audio, the latter is a legacy/misleading field name), rejects formats Whisper
  doesn't accept up front, creates the patient's Drive folder (named `patientName (jobId prefix)` —
  fixes the n8n collision risk of naming folders from patient name alone), uploads the recording, and
  appends the "אבחונים" row with `status: processing` before responding immediately with `{ jobid,
  status }`. The rest of the pipeline (transcription cleanup → segmentation → per-section rewrite via
  Claude → per-section HTML via GPT-4.1 → deterministic document assembly) runs in the background — see
  `services/pipeline/step1Pipeline.ts`. Any thrown error at any stage flips the row to `status: failed`
  (`services/pipeline/errorHandler.ts`), replacing n8n's error-trigger workflow.
- `POST /kamash/checkstatus` — looks up the row by `jobid`; once `status === 'done'`, downloads and
  returns the final report HTML; otherwise returns just the status (covers `processing`/`processing2`/
  `failed` — the frontend already treats anything non-`done`/non-`failed` as "keep polling").

A boot-time sweep (`services/pipeline/staleJobSweep.ts`, wired into `index.ts`) flips any job stuck in
`processing`/`processing2` for more than 30 minutes to `failed` — a self-healing improvement n8n never
had, covering the case where the process itself dies mid-pipeline.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — path to a service-account JSON key, shared as **Editor** on:
     - Spreadsheet "מכון קמש" (`1i52aS_uM8prV6ODSx8PkzO3tUMEnZbo1I1a1azoQe8s`)
     - Spreadsheet "מכון קמש הוראות" (`1EwcZ-GGSWM3EOyXaFSAHA07UC7-dm-CSCiFTLVWsW-c`)
     - Drive root folder `1McvYAEu97nBufa4po3gxfx6eiOdjmUzH`
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

Runs via `pm2` on the same server as the frontend's static build:

```sh
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## Cutting an endpoint over from n8n

Each endpoint is exposed at `POST /kamash/<name>` here, mirroring n8n's `kamash/<name>` webhook path.
Point the corresponding nginx `location = /webhook/kamash/<name>` block (in the vhost that serves
`n8n.link-up.co.il`) at this app's port instead of n8n's, then `nginx -s reload`. Re-comment and reload
to roll back instantly — the frontend's hardcoded webhook URLs never change.

`step1` and `checkstatus` should be cut over **together** in the same window — `checkstatus` reads
exactly what `step1`'s background pipeline writes, so splitting them across n8n and this backend would
mean checking status on a job that was created by the other system.
