# Email Reader → Transaction Sync

Cloudflare Worker that turns transaction emails in one Gmail mailbox into rows in
Google Sheets, **routed by who sent the email**. Each sender/subject maps to its own
destination sheet and its own parser via a rule registry (`src/rules.json`). Rules include
PDF parsing (INDmoney, NSE) and email body parsing (Invesco).

## How it works

```
POST /api/sync
  → build query from rules: OR of (from:… subject:"…") + -label:PR-Processed + newer_than:60d
  → find new matching emails  (unknown senders are never fetched)
  → for each: match rule by exact From + Subject
       source=pdf  → download attachment, decrypt with the rule's passwordEnv, extract text
       source=body → read the plain-text email body
  → run rule's parser → row aligned to the rule's columns
  → dedup (rule.dedupColumns), insert row at top of the rule's destination sheet
  → label email PR-Processed (so it is never reprocessed)
```

A rule (one object in `src/rules.json`):

```jsonc
{
  "from": "sender@example.com",          // exact match
  "subject": "Purchase Request Processed",
  "source": "pdf",                        // "pdf" | "body"
  "passwordEnv": "PDF_PASSWORD_NIT",      // (pdf) name of the Env secret with the password
  "parser": "indmoney-cas",               // key into the parsers registry in src/rules.ts
  "destination": { "spreadsheetId": "…", "tab": "Sheet1", "gid": 0 },
  "columns": ["Order Date", "Scheme Name", "Amount", "Units", "NAV"],
  "headerMatch": ["order date", "scheme name"],
  "dedupColumns": [0, 1, 3]
}
```

Auth is a single Google identity — that account must have edit access to **every**
destination spreadsheet.

The Worker runs this sync **automatically every 24 hours** (Cloudflare Cron Trigger
`0 0 * * *` → `scheduled()` handler). Change the cadence by editing `triggers.crons` in
`wrangler.jsonc` and `npm run deploy`. The `SYNC_INTERVAL_MINUTES` var is a KV-gated floor
that blocks runs closer together than its value. `POST /api/sync` stays available for manual
runs (it ignores the gate). Watch a cron run live with `wrangler tail`.

### Field Mappings

#### 1. INDmoney rule (PDF → sheet columns `A:E`):

| PDF field        | Column        |
| ---------------- | ------------- |
| Fund / scheme    | `Scheme Name` |
| transaction date | `Order Date` (DD-MM-YYYY) |
| Amount           | `Amount` (₹NNK) |
| total NAV        | `Units`       |
| purchased NAV    | `NAV`         |

#### 2. Invesco body rule (Body → sheet columns `A:F`):

| Body field              | Column             |
| ----------------------- | ------------------ |
| Scheme Details          | `Mutual Fund Name` (normalized, e.g. "Invesco India Mid Cap Fund Direct Growth") |
| Trade Date / NAV Date   | `Date` (formatted to `D MMM 'YY`, e.g. "3 Jun '26") |
| Amount (Rs.)            | `Amount` (formatted with commas, e.g. "₹49,997.50") |
| Static "Buy"            | `Type`             |
| Units (Nos.) Allotted   | `Units`            |
| Static "Completed"      | `Status`           |

#### 3. NSE rule (PDF → sheet columns `A:F` for Arti, `A:E` for Nit):

| PDF field                                | Column                     |
| ---------------------------------------- | -------------------------- |
| Trade Date (Prefix of 17-digit Trade No) | `Date` (DD-MM-YYYY)        |
| Security Name (Standardized/Cleaned)     | `Stock Name`               |
| Quantity                                 | `Quantity`                 |
| B / S                                    | `Order Type` ("Buy" / "Sell") |
| Price                                    | `Requested Price` (₹NN.NN) |
| Static "Success"                         | `Status` (Arti's sheet only) |


## Endpoints

| Method | Path           | Purpose |
| ------ | -------------- | ------- |
| GET    | `/`            | Test UI |
| GET    | `/healthz`     | Which secrets/vars are configured |
| POST   | `/api/sync`    | Run the full pipeline |
| POST   | `/api/extract` | Run a `parser` over a PDF `file` (+ optional `password`) or raw `text` → `{ parser, rows }` only (no writes) |

## Setup

### 1. Google Cloud
- Create an OAuth **Desktop app** client → download `credentials.json` into this folder.
- Enable **Gmail API** and **Google Sheets API**.
- On the OAuth consent screen add `nit4infy2@gmail.com` as a **test user**.

### 2. Install & get a refresh token
```bash
npm install
npm run get-token          # opens consent, prints GMAIL_REFRESH_TOKEN
```

### 3. Local secrets
```bash
cp .dev.vars.example .dev.vars
# fill GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, PDF_PASSWORD_NIT, PDF_PASSWORD_AR
```

### 4. Run locally
```bash
npm run dev                # http://localhost:8787
```
Open the page → **Test extraction**: pick the rule's `parser`, upload a real sample
PDF (or paste the body text), confirm the row parses, then **Run sync**.

> Parsers live in the `parsers` registry in `src/rules.ts` (the INDmoney one wraps
> `src/pdf/parse.ts`). They are layout-dependent. If a cell comes back `null`, adjust
> the regex using the `textPreview` returned by `/api/extract`.

### Add a new sender
1. Add a rule to `src/rules.json` (from, subject, source, destination, columns, …).
2. Add a parser function under that rule's `parser` key in `src/rules.ts`.
3. Grant the authorized Google account edit access to the destination sheet.
4. For an encrypted PDF with a non-default password, add the secret named by `passwordEnv`
   to `.dev.vars` / `wrangler secret put` and to the `Env` interface in `src/config.ts`.

## Deploy
```bash
wrangler deploy
wrangler secret put GMAIL_CLIENT_ID
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put GMAIL_REFRESH_TOKEN
wrangler secret put PDF_PASSWORD_NIT      # INDmoney
wrangler secret put PDF_PASSWORD_AR       # NSE contract notes (+ any other passwordEnv)
```

Routing and destinations live in `src/rules.json`; only `GMAIL_LABEL` remains in `wrangler.jsonc`.
