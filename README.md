# Email Reader → MF Transaction Sync

Cloudflare Worker that turns **"Purchase Request Processed"** emails (with a
password-protected PDF) in `nit4infy2@gmail.com` into rows in the
[**MF Transactions** sheet](https://docs.google.com/spreadsheets/d/1Bhm8j1PxHifBU4wEildcWo5y4pnBzqSZmKEQaVDVVLk/edit).

## How it works

```
POST /api/sync
  → find new emails  subject:"Purchase Request Processed" -label:PR-Processed
  → download PDF attachment
  → decrypt with PDF_PASSWORD, extract text (pdf.js / unpdf)
  → parse: Scheme · Order Date · Amount · Units · NAV
  → dedup (date+scheme+units), insert row at top of sheet
  → label email PR-Processed (so it is never reprocessed)
```

Field mapping (PDF → sheet columns `A:E`):

| PDF field        | Column        |
| ---------------- | ------------- |
| Fund / scheme    | `Scheme Name` |
| transaction date | `Order Date` (DD-MM-YYYY) |
| Amount           | `Amount` (₹NNK) |
| total NAV        | `Units`       |
| purchased NAV    | `NAV`         |

## Endpoints

| Method | Path           | Purpose |
| ------ | -------------- | ------- |
| GET    | `/`            | Test UI |
| GET    | `/healthz`     | Which secrets/vars are configured |
| POST   | `/api/sync`    | Run the full pipeline |
| POST   | `/api/extract` | Upload a PDF (+ optional `password`) → parsed fields only (no writes) |

## Setup

### 1. Google Cloud
- Create an OAuth **Desktop app** client → download `credentials.json` into this folder.
- Enable **Gmail API** and **Google Sheets API**.
- On the OAuth consent screen add `nit4infy2@gmail.com` as a **test user**.

### 2. Install & get a refresh token
```bash
npm install
npm run get-token          # opens consent, prints GOOGLE_REFRESH_TOKEN
```

### 3. Local secrets
```bash
cp .dev.vars.example .dev.vars
# fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, PDF_PASSWORD
```

### 4. Run locally
```bash
npm run dev                # http://localhost:8787
```
Open the page → **Test extraction** with a real sample PDF first to confirm the
five fields parse, then **Run sync**.

> The parser in `src/pdf/parse.ts` is tuned against the INDmoney layout but
> depends on the actual PDF text. If a field comes back `null`, adjust the
> regexes there using the `textPreview` returned by `/api/extract`.

## Deploy
```bash
wrangler deploy
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put PDF_PASSWORD
```

Non-secret config (spreadsheet id, tab, subject, label) lives in `wrangler.jsonc`.
