# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Worker that syncs INDmoney "Purchase Request Processed" emails into a Google Sheet.
On `POST /api/sync` it: finds new matching Gmail messages → downloads the password-protected PDF
attachment → decrypts + extracts 5 fields → inserts a row at the **top** of the **MF Transactions**
sheet → labels the email `PR-Processed` so it is never reprocessed.

## Commands

```bash
npm install
npm run dev            # wrangler dev → http://localhost:8787 (uses .dev.vars)
npm run typecheck      # tsc --noEmit (no test suite in this repo)
npm run get-token      # one-time OAuth consent → prints GMAIL_REFRESH_TOKEN
npm run types          # regenerate worker-configuration.d.ts after wrangler.jsonc changes
npm run deploy         # wrangler deploy
```

There are no automated tests. Verify changes manually against the running Worker:
- `GET /healthz` — shows which secrets/vars are present (booleans, not values).
- `POST /api/extract` (multipart `file` + optional `password`) — decrypt+parse a PDF only, no Gmail/Sheets writes. **This is the primary way to debug extraction**; it returns `{ parsed, textPreview }`.
- `POST /api/sync` — the full live pipeline (needs valid OAuth token + real email).

## Architecture

Request flow (all in `src/`):

```
index.ts (Hono router)
  /api/sync → google/oauth.ts  getAccessToken (refresh_token → 1h access token)
            → google/gmail.ts  listMessages → getMessage → findPdfPart → getAttachmentData
            → pdf/decrypt.ts   extractPdfText (unpdf/pdf.js, decrypts in-runtime)
            → pdf/parse.ts     parseTransaction → {scheme,date,amount,units,nav}
            → google/sheets.ts isDuplicate → insertRowAtTop
            → google/gmail.ts  ensureLabel → addLabel
```

Key design facts a new contributor must know:

- **No `googleapis` SDK.** All Google access is plain `fetch` against the Gmail v1 and Sheets v4 REST endpoints, because the Node SDK does not run well on Workers. OAuth is just a refresh-token → access-token POST in `google/oauth.ts`.
- **PDF decryption runs inside the Workers runtime** via `unpdf`'s `getResolvedPDFJS()` (pdf.js `getDocument({ data, password })`). This is the highest-risk dependency — if you change it, re-verify with `/api/extract` against a real encrypted PDF, not just a typecheck. pikepdf/Python is not an option here.
- **`src/pdf/parse.ts` is layout-dependent and the most fragile file.** Its regexes are tuned to the INDmoney order-confirmation text. When a field returns `null`, fix the regex using the `textPreview` from `/api/extract` — do not change the pipeline.
- **Sheet write = insert directly below the header, not append.** The sheet keeps intentional blank/note rows on top and the header is **not** at a fixed row — `getSheetLayout` finds the header row (first row whose A/B cells are `Order Date`/`Scheme Name`) and returns its 0-based index + the data rows below it. `insertRowBelowHeader` then does a `batchUpdate` `InsertDimensionRequest` at `headerRowIndex+1` and a `values.update` on that row. Never assume row 1 = header. Column order is fixed: `[Order Date, Scheme Name, Amount, Units, NAV]` (see `TxRow` in `google/sheets.ts`). Date is `DD-MM-YYYY`, amount is `₹NNK` (see `src/format.ts`).
- **The PDF is a full Invesco account statement (CAS), not a single-transaction confirmation.** `src/pdf/parse.ts` collects all `Net Additional Purchase` rows, picks the most recent, prefers the matching `Gross Additional Purchase` amount, and maps the scheme name to the sheet's convention via `src/scheme-map.json` (add new funds there). Units are rounded to 2dp to match existing rows.
- **Idempotency is twofold:** the Gmail query excludes `-label:PR-Processed`, and `isDuplicate` (key = date+scheme+units) guards the sheet. A processed email is labeled **even when skipped as a duplicate** so it is not re-fetched.
- **Field mapping is deliberately counterintuitive:** "purchased NAV" → `NAV` (price/unit), "total NAV" → `Units` (count). Don't swap these.

## Config

- Secrets via `.dev.vars` (local) / `wrangler secret put` (prod): `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `PDF_PASSWORD`. The `Env` interface in `src/config.ts` is the source of truth — keep it in sync with both.
- Non-secret vars live in `wrangler.jsonc`: `SPREADSHEET_ID`, `SHEET_TAB`, `SHEET_GID`, `EMAIL_SUBJECT`, `GMAIL_LABEL`.
- `GMAIL_REFRESH_TOKEN` is obtained once via `npm run get-token` (reads client id/secret from `.dev.vars`, redirect URI `http://localhost:5555/callback`). Authorization is one-time; publish the OAuth consent screen to **production** or test-mode tokens expire after 7 days.
- A Google **API key cannot** read Gmail or write the sheet — OAuth user auth is required for both.
