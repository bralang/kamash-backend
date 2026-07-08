# kamash-backend

Node/Express + TypeScript backend replacing the n8n workflows behind **עורכת לשונית של מכון קמ"ש**
(`https://n8n.link-up.co.il/webhook/kamash/*`). See the migration plan this repo was scaffolded from
for full background on the n8n workflows being ported and the endpoint-by-endpoint cutover strategy.

Endpoints are migrated one at a time; everything not yet listed below still runs on n8n.

## Migrated so far

- `POST /kamash/editmanually` — saves manually edited report HTML into the patient's Drive folder and
  updates the "אבחונים" sheet row's `גרסא אחרונה html` column.
- `POST /kamash/updateTestToFix` — marks a "שאלוני הורים" row (matched by patient name, same fragile
  key n8n used) as `הושלם` and refreshes its patient-detail columns.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — path to a service-account JSON key, shared as **Editor** on:
     - Spreadsheet "מכון קמש" (`1i52aS_uM8prV6ODSx8PkzO3tUMEnZbo1I1a1azoQe8s`)
     - Spreadsheet "מכון קמש הוראות" (`1EwcZ-GGSWM3EOyXaFSAHA07UC7-dm-CSCiFTLVWsW-c`) — needed once the
       rewrite/HTML-conversion pipeline is migrated
     - Drive root folder `1McvYAEu97nBufa4po3gxfx6eiOdjmUzH`
   - Remaining keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Gmail OAuth creds) are only required once
     the corresponding later endpoints are migrated — leave blank for now.
3. `npm run dev` (watches + runs via `tsx`), or `npm run build && npm start` for a production-style run.
4. `npm test` runs the vitest suite (all Google API calls are mocked at the service boundary — no real
   credentials needed to run tests).

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
