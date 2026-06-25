import { Hono } from "hono";
import type { Env } from "./config";
import { getAccessToken } from "./google/oauth";
import {
  addLabel,
  base64urlToBytes,
  ensureLabel,
  findPdfPart,
  getAttachmentData,
  getMessage,
  getSubject,
  listMessages,
} from "./google/gmail";
import { getSheetLayout, insertRowBelowHeader, isDuplicate, type TxRow } from "./google/sheets";
import { extractPdfText } from "./pdf/decrypt";
import { parseTransaction } from "./pdf/parse";
import { UI_HTML } from "./ui";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(UI_HTML));

app.get("/healthz", (c) => {
  const e = c.env;
  return c.json({
    ok: true,
    config: {
      GMAIL_CLIENT_ID: !!e.GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: !!e.GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: !!e.GMAIL_REFRESH_TOKEN,
      PDF_PASSWORD: !!e.PDF_PASSWORD,
      SPREADSHEET_ID: e.SPREADSHEET_ID,
      SHEET_TAB: e.SHEET_TAB,
      EMAIL_SUBJECT: e.EMAIL_SUBJECT,
      GMAIL_LABEL: e.GMAIL_LABEL,
    },
  });
});

/** Test-only: decrypt + parse an uploaded PDF without touching Gmail/Sheets. */
app.post("/api/extract", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "Upload a PDF in the 'file' field" }, 400);
  }
  const password = (body["password"] as string) || c.env.PDF_PASSWORD;
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const text = await extractPdfText(bytes, password);
    const parsed = parseTransaction(text);
    return c.json({ parsed, textPreview: text.slice(0, 2000) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/** Main pipeline: process new matching emails into the sheet. */
app.post("/api/sync", async (c) => {
  const env = c.env;
  const result = {
    processed: [] as { id: string; row: TxRow }[],
    skipped: [] as { id: string; reason: string }[],
    errors: [] as { id: string; error: string; textPreview?: string }[],
  };

  let token: string;
  try {
    token = await getAccessToken(env);
  } catch (err) {
    return c.json({ error: `Auth failed: ${String(err)}` }, 500);
  }

  const query = `subject:"${env.EMAIL_SUBJECT}" has:attachment -label:${env.GMAIL_LABEL} newer_than:60d`;
  const messages = await listMessages(token, query);

  if (messages.length === 0) {
    return c.json({ message: "No new matching emails.", ...result });
  }

  const labelId = await ensureLabel(token, env.GMAIL_LABEL);
  const { headerRowIndex, dataRows: existing } = await getSheetLayout(token, env);

  for (const ref of messages) {
    try {
      const msg = await getMessage(token, ref.id);
      const part = findPdfPart(msg.payload);
      if (!part?.body?.attachmentId) {
        result.errors.push({ id: ref.id, error: "no PDF attachment found" });
        continue;
      }

      const b64 = await getAttachmentData(token, ref.id, part.body.attachmentId);
      const bytes = base64urlToBytes(b64);
      const text = await extractPdfText(bytes, env.PDF_PASSWORD);
      const tx = parseTransaction(text);

      if (!tx.date || !tx.scheme || !tx.amount || tx.units == null || tx.nav == null) {
        result.errors.push({
          id: ref.id,
          error: `incomplete parse: ${JSON.stringify(tx)} (subject: ${getSubject(msg)})`,
          textPreview: text.slice(0, 1500),
        });
        continue;
      }

      const row: TxRow = [tx.date, tx.scheme, tx.amount, String(tx.units), String(tx.nav)];

      if (isDuplicate(existing, tx.date, tx.scheme, String(tx.units))) {
        result.skipped.push({ id: ref.id, reason: "duplicate row already in sheet" });
      } else {
        await insertRowBelowHeader(token, env, headerRowIndex, row);
        existing.unshift(row);
        result.processed.push({ id: ref.id, row });
      }

      // Label even when skipped so it is not re-fetched next run.
      await addLabel(token, ref.id, labelId);
    } catch (err) {
      result.errors.push({ id: ref.id, error: String(err) });
    }
  }

  return c.json(result);
});

export default app;
