# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Worker that syncs transaction emails into Google Sheets, **routed per sender**.
On `POST /api/sync` it: finds new matching Gmail messages → for each, matches a **rule** (by exact
`from` + `subject`) → reads the source (decrypts the password-protected **PDF** attachment, or reads
the **email body**) → runs the rule's parser → inserts a row at the **top** of that rule's
destination sheet → labels the email `PR-Processed` so it is never reprocessed. Emails matching no
rule are not processed.

The original INDmoney "Purchase Request Processed" → MF Transactions flow is now just the first
rule in the registry.

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
- `POST /api/extract` (multipart `parser` + either `file`[+`password`] for PDF rules or `text` for body rules) — run one parser over a sample, no Gmail/Sheets writes. **This is the primary way to debug extraction**; it returns `{ parser, rows, textPreview }` where each row in `rows` is aligned to that rule's `columns`.
- `POST /api/sync` — the full live pipeline (needs valid OAuth token + real email).

## Architecture

Request flow (all in `src/`):

```
index.ts (Hono router)
  /api/sync → google/oauth.ts  getAccessToken (refresh_token → 1h access token)
            → rules.ts         buildQuery (OR of every rule's from+subject, -label, newer_than)
            → google/gmail.ts  listMessages → getMessage → getFrom/getSubject
            → rules.ts         matchRule (exact from + subject) → Rule
            → source: pdf  → google/gmail.ts findPdfPart/getAttachmentData → pdf/decrypt.ts extractPdfText
                     body → google/gmail.ts getBodyText
            → rules.ts         parsers[rule.parser](text) → string[] aligned to rule.columns
            → google/sheets.ts getSheetLayout(dest, headerMatch, width) → isDuplicate → insertRowBelowHeader
            → google/gmail.ts  ensureLabel → addLabel
```

Key design facts a new contributor must know:

- **The rule registry (`src/rules.json` + `src/rules.ts`) drives everything.** Each rule = `{ from, to?, subject, source, passwordEnv?, parser, destination{spreadsheetId,tab,gid}, columns, headerMatch, dedupColumns }`. `from` is matched **exactly** (lowercased) and `subject` exactly; the optional `to` (when set) must appear in the email's To/Cc/Delivered-To headers (`getRecipients`), so the same `from`+`subject` can route to different sheets per recipient. Auth is still a **single** Google identity — that account must have edit access to **every** destination spreadsheet. Add a sender = add a rule + a parser (+ a `passwordEnv` secret for encrypted PDFs) + grant the account access to its sheet.
- **The Gmail query is built from the rules** (`buildQuery`), so only emails matching some rule are ever fetched. Unknown senders are never returned, so they are never labeled. An email that Gmail fuzzy-matched but that does not match a rule **exactly** is skipped without labeling.
- **No `googleapis` SDK.** All Google access is plain `fetch` against the Gmail v1 and Sheets v4 REST endpoints, because the Node SDK does not run well on Workers. OAuth is just a refresh-token → access-token POST in `google/oauth.ts`.
- **PDF decryption runs inside the Workers runtime** via `unpdf`'s `getResolvedPDFJS()` (pdf.js `getDocument({ data, password })`). This is the highest-risk dependency — if you change it, re-verify with `/api/extract` against a real encrypted PDF, not just a typecheck. pikepdf/Python is not an option here. The password comes from the Env secret named by the rule's `passwordEnv`.
- **Parsers live in the `parsers` registry in `src/rules.ts`, keyed by name.** A parser takes the source text (PDF text or email body) and returns **`string[][]`** — zero or more rows, each aligned to that rule's `columns` — or `null`/empty for a parse failure (→ email skipped, not labeled, so it retries). One email can yield many rows (e.g. a multi-trade contract note); `/api/sync` dedups + inserts each row, then labels the email **once**. These are layout-dependent and the most fragile code — tune regexes using the `textPreview` from `/api/extract` against a real sample; do not change the pipeline. `indmoney-cas` wraps `pdf/parse.ts:parseTransaction` (returns one row); `nse-contract-note` is `pdf/parse-nse.ts:parseNseTrades` (PDF, multi-row, derives Date from the 17-digit Trade No prefix, maps B/S→Buy/Sell, Status always "Success").
- **`/api/extract` returns `{ parser, rows, textPreview }`** (`rows` is `string[][]`).
- **Sheet write = insert directly below the header, not append.** Sheets keep intentional blank/note rows on top and the header is **not** at a fixed row — `getSheetLayout(token, dest, headerMatch, width)` finds the header row (first row whose leading cells equal the rule's lowercased `headerMatch`) and returns its 0-based index + the data rows below it. `insertRowBelowHeader` then does a `batchUpdate` `InsertDimensionRequest` at `headerRowIndex+1` and a `values.update` on that row (end column derived from the row width). Never assume row 1 = header. Column order is per-rule (`rule.columns`). For the INDmoney rule it is `[Order Date, Scheme Name, Amount, Units, NAV]`; date is `DD-MM-YYYY`, amount is `₹NNK` (see `src/format.ts`).
- **The INDmoney PDF is a full Invesco account statement (CAS), not a single-transaction confirmation.** `src/pdf/parse.ts` collects all `Net Additional Purchase` rows, picks the most recent, prefers the matching `Gross Additional Purchase` amount, and maps the scheme name to the sheet's convention via `src/scheme-map.json` (add new funds there). Units are rounded to 2dp to match existing rows.
- **Idempotency is twofold:** the Gmail query excludes `-label:PR-Processed`, and `isDuplicate` (key = the rule's `dedupColumns`) guards the sheet. A processed email is labeled **even when skipped as a duplicate** so it is not re-fetched.
- **INDmoney field mapping is deliberately counterintuitive:** "purchased NAV" → `NAV` (price/unit), "total NAV" → `Units` (count). Don't swap these.

## Config

- Secrets via `.dev.vars` (local) / `wrangler secret put` (prod): `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and one PDF password per distinct `passwordEnv` used in `rules.json` (currently `PDF_PASSWORD_NIT` for INDmoney and `PDF_PASSWORD_AR` for NSE). The `Env` interface in `src/config.ts` is the source of truth — keep it in sync with both.
- Non-secret vars live in `wrangler.jsonc`: just `GMAIL_LABEL`. Per-sender routing and destinations (spreadsheet id / tab / gid / columns) live in `src/rules.json`; spreadsheet IDs are not secrets so they belong there, but PDF passwords stay in Env and are referenced by `passwordEnv` name.
- `GMAIL_REFRESH_TOKEN` is obtained once via `npm run get-token` (reads client id/secret from `.dev.vars`, redirect URI `http://localhost:5555/callback`). Authorization is one-time; publish the OAuth consent screen to **production** or test-mode tokens expire after 7 days.
- A Google **API key cannot** read Gmail or write the sheet — OAuth user auth is required for both.
