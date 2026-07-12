# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node/Express + TypeScript backend that replaces the n8n workflows behind **עורכת לשונית של מכון קמ"ש**
(a Hebrew reading-diagnosis editing tool). Every endpoint here mirrors an n8n webhook at the same path
(`/kamash/<name>` here ↔ `kamash/<name>` on n8n). All 6 in-scope endpoints are migrated; cutover from n8n
is done per-endpoint at the nginx layer (see README "Cutting an endpoint over").

**The n8n workflows are the spec.** Behavior — prompts, the segmentation JSON schema, the assembled-HTML
CSS, link shapes written into Sheets, the frontend's polling contract — was reverse-engineered from n8n
exports and is reproduced deliberately, often with a comment saying so. When something looks odd (matching a
"שאלוני הורים" row by patient name, `transcriptFile` always being raw audio, placeholder email copy), it is
almost always faithful to n8n on purpose. Before "fixing" such a thing, confirm it isn't load-bearing for the
frontend or n8n parity. Intentional *departures* from n8n are the few places called out explicitly in code
comments and the README (folder naming, the dropped hardcoded email CC, 400-on-missing-mail, the stale-job
sweep) — preserve those departures.

## Commands

```sh
npm run dev            # tsx watch on src/index.ts (loads .env)
npm run build          # tsc → dist/
npm start              # node dist/index.js (production)
npm run lint           # tsc --noEmit (type-check only; there is no ESLint despite the eslint-disable comment)
npm test               # vitest run (one-shot)
npm run test:watch     # vitest watch
npx vitest run test/step1.test.ts   # a single test file
```

Tests need **no real credentials**: every external boundary (Google, OpenAI, Anthropic) is mocked with
`vi.mock` at the service-module level, and `vitest.config.ts` injects a fake `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
`npm run dev`/`start` do need a real `.env` (copy `.env.example`). Deploy is `npm run build` then `pm2 start
ecosystem.config.js` (pm2 loads secrets from `.env` in the cwd).

Note the **ESM + NodeNext** setup: relative imports must carry the `.js` extension even in `.ts` source
(e.g. `import { config } from "./config/env.js"`). Match this in every new file.

## Architecture

Request flow: `index.ts` (listen + boot-time stale-job sweep) → `app.ts` (pino-http logging, JSON body limit,
`errorMiddleware`) → `routes/index.ts` mounts each router under `/kamash`. Routes are thin: validate with a
zod `bodySchema`, call services, respond. Errors thrown anywhere in an async handler reach `errorMiddleware`
via the `asyncHandler` wrapper — throw `HttpError(status, msg)` for client-facing failures; a `ZodError`
auto-maps to 400; anything else is a logged 500.

**Layering, strictly one-directional:** routes → services → (`config`, `lib`). Routes never touch Google/LLM
SDKs directly; that lives in `services/`. Keep it that way — it is what makes the mock-at-the-service-boundary
test strategy work.

### The data store is Google Sheets, not a database
- `config/sheets.ts` is the single source of truth for spreadsheet IDs, sheet (tab) names, column headers,
  and status enums — all as **literal Hebrew strings** matching the actual header cells. A typo here silently
  fails to match at runtime rather than erroring, so treat this file as schema and change it carefully.
- `services/sheetsService.ts` wraps the raw Sheets API and exposes **typed repos** (`diagnosesRepo`,
  `versionsRepo`, `parentQuestionnairesRepo`). Reads return `Record<string,string>` keyed by header;
  `rowNumber` is the 1-indexed spreadsheet row (header is row 1). Updates patch only named columns, leaving
  other cells untouched. **Use the repos**, don't call the Sheets API from routes/pipeline.
- `services/driveService.ts` handles Drive uploads/downloads and patient-folder creation. Links stored in
  Sheets use the exact URL shapes n8n wrote (`lib/driveLinks.ts`), and `downloadFileText` parses ids back out
  of those shapes — so link format is a compatibility contract, not cosmetic.
- `services/configRepo.ts` reads the *second* spreadsheet (editing rules + per-section instructions) and
  caches it for 5 minutes. This is clinic-editable config that steers the LLM prompts.

### step1 is the whole pipeline; everything else is CRUD-on-Sheets
`POST /kamash/step1` ([routes/step1.ts](src/routes/step1.ts)) is the only heavy endpoint. It:
1. Validates the form + audio (rejects non-Whisper MIME types up front), creates the Drive folder, uploads
   the recording and transcribes (Whisper) in parallel, appends the "אבחונים" row with `status: processing`.
2. **Responds immediately** with `{ jobid, status }`, then fires `runStep1Pipeline(...)` fire-and-forget.

`services/pipeline/step1Pipeline.ts` is the background job (formerly a chain of n8n sub-workflows), run in the
same process — not a queue:
transcript cleanup (GPT-4.1, spelling/punctuation *only*) → segment into the fixed JSON schema
(`openaiService.segmentToJson`, `status → processing2`) → per-section rewrite (Claude, `anthropicService`) →
per-section HTML (GPT-4.1, `htmlConversionService.sectionToHtml`) → **deterministic** `assembleDocument`
(no LLM — CSS is hardcoded to match n8n) → `status: done` with the HTML link. Intermediate artifacts are
written to the patient's Drive folder at each stage.

Failure handling replaces n8n's error-trigger workflow: any throw in the pipeline lands in
`pipeline/errorHandler.markJobFailed` → `status: failed`. `checkstatus` reads exactly what this pipeline
writes — **step1 and checkstatus must be cut over from n8n together** (README). On boot,
`pipeline/staleJobSweep` flips jobs stuck in `processing`/`processing2` > 30 min to `failed`, covering a
mid-pipeline process crash.

### LLM services
`openaiService.ts` (Whisper transcription, GPT-4.1 chat + `json_schema` structured segmentation) and
`anthropicService.ts` (Claude section rewrite). Clients are lazily constructed and throw `HttpError(500)` if
their API key is unset — that's why the step1/email keys are optional in `config/env.ts` while the Google key
is required. The Hebrew prompts are ported verbatim from n8n; changing them changes clinical output. The
Anthropic model id (`claude-sonnet-4-6`) was copied from the n8n export and is flagged in-code as needing
verification before production reliance.

## Testing conventions
Two shapes, both under `test/` (mirroring `src/`): **route tests** drive `createApp()` with `supertest` and
mock the service modules; **the pipeline test** imports `runStep1Pipeline` directly and mocks all downstream
services. New endpoints should follow the matching pattern and assert on the exact repo/service calls (e.g.
that only the intended column was patched), not just the HTTP status.
