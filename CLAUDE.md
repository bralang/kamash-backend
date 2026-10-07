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
"שאלוני הורים" row by patient name, `transcriptFile` always being raw audio), it is
almost always faithful to n8n on purpose. Before "fixing" such a thing, confirm it isn't load-bearing for the
frontend or n8n parity. Intentional *departures* from n8n are the few places called out explicitly in code
comments and the README (folder naming, the dropped hardcoded email CC, 400-on-missing-mail, the stale-job
sweep, transcription moved out of the step1 request, the clinic's own RTL email wording), plus the output-quality work in "Tuning output against the clinic's hand-edits" below — preserve
those departures.

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

## Release stamp — a standing rule

`GET /webhook/kamash/version` reports what is actually running: `releaseId`, `commit`, `ref`, `deployedAt`
and `startedAt`. The frontend's footer shows it next to its own build time, so the clinic (and we) can see at
a glance whether a deploy really landed — a service that failed to restart keeps reporting an old
`deployedAt`, and a plain restart moves only `startedAt`.

**This must keep updating itself on every push. Never commit a version or a date into the source.** The
numbers come from `release.json`, which `.github/workflows/deploy.yml` writes into the release package right
before upload; it is gitignored, so a checkout has none and `src/lib/releaseInfo.ts` reports nulls rather
than inventing a date. That file resolves the stamp two levels up from its own module URL — true for both
`dist/lib/` and `src/lib/`, and unlike `process.cwd()` it does not depend on how the service was started.
If the release packaging or the workflow changes, check that the stamp still moves.

## Architecture

Request flow: `index.ts` (listen + boot-time stale-job sweep) → `app.ts` (pino-http logging, JSON body limit,
`errorMiddleware`) → `routes/index.ts` mounts each router under `/kamash`. Routes are thin: validate with a
zod `bodySchema`, call services, respond. Errors thrown anywhere in an async handler reach `errorMiddleware`
via the `asyncHandler` wrapper — throw `HttpError(status, msg)` for client-facing failures (an optional
third `code` argument is echoed to the client next to the message, for failures the frontend must tell
apart — only `rewritetext` uses it, and every other response is byte-identical to before); a `ZodError`
auto-maps to 400; anything else is a logged 500.

### Authentication — every new route is protected by default
`routes/index.ts` mounts `authRouter` and `versionRouter`, then `requireAuth`, then everything else. **Add
new routers below `requireAuth`.** `test/auth.test.ts` reads the router stack and fails for any route
mounted after the guard that answers without a session, so this is enforced, not just documented.

- Users: the "משתמשים" sheet (`USERS_COLUMNS`), read through `usersRepo` and cached 60s in
  `services/authService.ts`. Passwords are scrypt hashes from `npm run hash-password` (`lib/password.ts`,
  kept free of config imports so the script needs no `.env`). One permission level: signed in or not.
- Session: a stateless `payload.HMAC` token signed with `AUTH_SECRET`, in an HttpOnly `kamash_session`
  cookie scoped to `/webhook/kamash`. 12h, renewed past the halfway mark. A token is rejected once the user
  is gone, no longer `פעיל: כן`, or their `גרסת התחברות` changed — that column is the revocation switch.
- CSRF: the cookie is `SameSite=None` (local frontend dev on localhost is cross-site), so `requireAuth`
  and `auth/login` also demand an `X-Kamash-Client` header. A custom header forces a CORS preflight, and
  `app.ts` answers preflights only for allowed origins. Do not widen CORS back to `*`.
- `AUTH_ENFORCE=false` logs unauthenticated requests and lets them through — for a rollout only. The test
  config sets it so route tests need no session; `auth.test.ts` switches it on.
- pino redacts the cookie headers (`lib/logger.ts`); a failed login logs the email, never the password.

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
   the recording as-is, appends the "אבחונים" row with `status: processing`.
2. **Responds immediately** with `{ jobid, status }`, then fires `runStep1Pipeline(...)` fire-and-forget,
   handing it the recording itself. Nothing slow happens before the response: compression and Whisper both
   take minutes on a long session, and the diagnostician used to sit on the upload screen through them.

`services/pipeline/step1Pipeline.ts` is the background job (formerly a chain of n8n sub-workflows), run in the
same process — not a queue:
compression for Whisper's 25MB limit (`audioService.ensureTranscribable`, ffmpeg, oversized files only) →
transcription (Whisper) → transcript cleanup (GPT-4.1, spelling/punctuation *only*, plus the glossary described below) → segment into
the fixed JSON schema (`openaiService.segmentToJson`, `status → processing2`) → per-section rewrite (Claude,
`anthropicService`) → per-section HTML (GPT-4.1, `htmlConversionService.sectionToHtml`, whose LLM output then
passes through deterministic clean-up) → **deterministic** `assembleDocument` (no LLM — CSS is hardcoded to
match n8n) → `status: done` with the HTML link. Intermediate artifacts are written to the patient's Drive
folder at each stage.

Failure handling replaces n8n's error-trigger workflow: any throw in the pipeline lands in
`pipeline/errorHandler.markJobFailed` → `status: failed`. `checkstatus` reads exactly what this pipeline
writes — **step1 and checkstatus must be cut over from n8n together** (README). On boot,
`pipeline/staleJobSweep` flips jobs stuck in `processing`/`processing2` > 30 min to `failed`, covering a
mid-pipeline process crash.

`rewritetext` is the one other endpoint that calls an LLM, but it is not a pipeline: it rephrases a single
snippet the diagnostician selected in the editor and answers **synchronously** with `{ result }`, writing
nothing to Sheets or Drive. It is capped accordingly (25s SDK timeout with `maxRetries: 1`, 4,000-char
input limit, `lib/rateLimit.ts` per-jobId + per-process windows) and gated on the `jobId` resolving to a
real row — see README. The heavy/asynchronous split above still holds for everything else.

### Tuning output against the clinic's hand-edits
Several prompt rules and post-processing steps exist because we diffed real pipeline output against the same
document after the clinic edited it by hand, across two diagnoses, and encoded only what recurred in **both**.
These are deliberate departures from n8n parity — n8n produced the same problems:

- **Register** (`SYSTEM_PROMPT_TEMPLATE`): n8n asked for "שפה גבוהה" / "לשון גבוהה", and the model answered
  with "על מנת", "תוך", "לרבות", "דהיינו" and a comma before every ו' — which the clinic's language editor
  replaced by hand in all three diagnoses diffed. It also contradicted the config sheet's own rule ("קרוב לשפה
  הדבורה"), and the hardcoded prompt wins that contest. It now asks for plain, short standard Hebrew; the
  concrete word swaps live in the sheet's "כללי לשון" row, where the clinic can extend them without a deploy.
- **Dictation context** (`DICTATION_CONTEXT`): the diagnostician dictates, and Hebrew is not her first
  language. Told only to stick to the transcript and omit nothing, the model kept her non-idiomatic phrasing
  and fixed spelling ("ירגיש מוכשל" became "הרגיש מוכשל"). The block asks for a full language edit bounded by
  the clinical facts, with transcript/approved-wording pairs as examples. It sits *before* RULES so the sheet
  can still narrow the edit. The cleanup stage stays literal on purpose — the rewrite is where editing happens.
  The task prompt's OUTPUT line also forbids notes about the edit: a sheet rule that clashed with "אל תשמיט
  מידע!" once made the model explain an omission inside the report itself.
- **Transcript glossary** (`CLEANUP_SYSTEM_PROMPT`): Whisper mis-transcribed the same clinical terms in both
  diagnoses — "חי\"ת סופית", which is not a Hebrew letter at all, for "כ\"ף סופית", and "ביסוס חושי" for
  "ויסות חושי". The glossary is a correction list for the cleanup stage only; that stage is still forbidden
  from rewriting. A word it cannot resolve is marked `[לא ברור]` instead of being smoothed over, and that
  marker is meant to reach the editor.

  The list has two halves. The hardcoded one grew from those diffs plus terms the clinic reported outright
  ("סיכול אותיות" for "שיכול אותיות"). The other is the clinic's own "מונחים קבועים" row in the config sheet,
  pulled in by `getGeneralRule(FIXED_TERMS_RULE_TYPE)` — that row is part of `getGeneralRules()` too and so
  reaches the per-section rewrite regardless; feeding it to cleanup as well is what applies it *before*
  segmentation routes content it has already misread. **A wrong professional term is not a spelling error** —
  "סיכול" is a correctly spelled Hebrew word in a plausible context, and no amount of "תקן שגיאות כתיב" in any
  of the three prompts that carry it will catch one. Only a term list will, so a new term belongs in that
  sheet row (clinic-editable, no deploy), not in a new prompt rule.
- **Section ownership** (`SEGMENTATION_PROMPT` rules 9–10): parent/teacher reports belong to
  `referral_reason`, not `general_impression`; numeric targets belong to `goals`, not `home_practice`. Real
  output crossed both boundaries despite the generic "one section only" rule 6.
- **Deterministic clean-up inside `sectionToHtml`**: `stripRedundantSubheadings` drops a sub-heading the
  section's own h2 already contains word-for-word — both diagnoses emitted "המלצות" under
  "המלצות לטיפולים חיצוניים" and the clinic deleted it both times. It is conservative on purpose: a
  paraphrase such as "סיכום קשיים שנצפו באבחון" under "הקשיים שנצפו" is left for a human, because matching
  it needs fuzzy comparison and that is too blunt a tool to point at clinical headings.
- **`formatDiagnosisDate`**: the intake form posts ISO `YYYY-MM-DD`, the clinic writes `DD/MM/YYYY`. The
  conversion happens at render time only — the "אבחונים" sheet still stores ISO, because n8n and the
  frontend read that column back. Name order is deliberately *not* corrected: there is one `שם המאובחן`
  column, so swapping tokens would be guesswork on a clinical document.

Diff at least two real before/after pairs before adding to this list. A pattern seen once is noise: of
sixteen candidates from the first diagnosis two did not survive the second and were dropped rather than
coded, and one "finding" turned out to be an artefact of the comparison script rather than the pipeline.

### The `##` group-heading protocol
`lib/headingMarker.ts` holds one string that two pipeline stages must agree on. A section's closed
sub-heading list (the `כותרות משנה מותרות` config column) may prefix top-level group headings with `##`;
`rewriteSection` carries the prefix through into its plain-text output, and `sectionToHtml` maps a prefixed
heading to `h3`, an unprefixed one beneath it to `h4`, then strips the prefix.

It exists because heading *level* is decided a stage later than heading *text*. With no marker the HTML stage
has to infer the hierarchy, and it does so inconsistently: two real diagnoses ran the same
"תוכנית עבודה למורה" section through the same prompt, and one came back correctly nested while the other
flattened all eighteen headings to `h3`. A list containing no `##` line stays single-level and behaves exactly
as it did before, so config rows written earlier keep working untouched. `stripGroupHeadingMarkers` runs
unconditionally as a last-resort guard — the prompt asks the model to consume the prefix, but a leaked `##`
would surface inside a heading in the clinic's document.

Note the coupling this creates: a closed list is **closed**, so a heading missing from it cannot be produced
and its content gets forced under a neighbouring heading instead. Extend the list before relying on it for a
section whose full heading set has not been enumerated from real diagnoses.

### LLM services
`openaiService.ts` (Whisper transcription, GPT-4.1 chat + `json_schema` structured segmentation) and
`anthropicService.ts` (Claude — `rewriteSection` for the pipeline's per-section pass, `rewriteSnippet` for
`rewritetext`). Clients are lazily constructed and throw `HttpError(500)` if their API key is unset —
that's why the step1/email keys are optional in `config/env.ts` while the Google key is required. The
Hebrew prompts began as verbatim ports from n8n and still are, apart from the additions listed under "Tuning
output against the clinic's hand-edits"; changing them changes clinical output, so treat any part you did not
come to deliberately as load-bearing. `rewriteSnippet` is the
exception: it has no n8n ancestor, and it is deliberately *not* `rewriteSection` — that prompt opens with
"תמלול גולמי:" and edits a raw Whisper transcript, so feeding finished clinical prose into it produces
cleanup behavior rather than a rephrase.

The model id comes from `ANTHROPIC_MODEL`, defaulting to `claude-sonnet-5`. The n8n export's own id
(`claude-sonnet-4-6`) is not a valid model and failed every section rewrite in production until the default
was corrected — don't reinstate it. The `thinking` field is chosen per model by `thinkingFor`, never
written inline. On claude-sonnet-5 both calls send `{ type: "disabled" }`: that model runs adaptive thinking
when the field is omitted, thinking tokens come out of `ANTHROPIC_MAX_TOKENS`, and a long think can exhaust
the budget and return no text block at all. **claude-sonnet-5-5 rejects `disabled` with a 400**, so changing
`ANTHROPIC_MODEL` alone would fail every diagnosis; on it the section rewrite runs adaptive thinking at
`ANTHROPIC_EFFORT` with `ANTHROPIC_THINKING_MAX_TOKENS`, and the snippet rewrite sends `between_tools`
(its lowest setting; nothing else may sit inside `thinking`). `extractText` refuses a reply that was
declined (`stop_reason: "refusal"`, logged with its category) or cut off at `max_tokens`, rather than
persisting a section that stops mid-sentence.

## Testing conventions
Two shapes, both under `test/` (mirroring `src/`): **route tests** drive `createApp()` with `supertest` and
mock the service modules; **the pipeline test** imports `runStep1Pipeline` directly and mocks all downstream
services. New endpoints should follow the matching pattern and assert on the exact repo/service calls (e.g.
that only the intended column was patched), not just the HTTP status.
