import { Hono } from "hono";
import type { Env } from "./config";
import { getAccessToken } from "./google/oauth";
import {
  addLabel,
  base64urlToBytes,
  ensureLabel,
  findPdfPart,
  getAttachmentData,
  getBodyText,
  getFrom,
  getMessage,
  getRecipients,
  getSubject,
  listMessages,
} from "./google/gmail";
import { getSheetLayout, insertRowBelowHeader, isDuplicate } from "./google/sheets";
import { extractPdfText } from "./pdf/decrypt";
import { buildQuery, matchRule, parsers, rules, type Rule } from "./rules";
import { UI_HTML } from "./ui";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(UI_HTML));

app.get("/healthz", (c) => {
  const e = c.env;
  const passwordEnvs = [...new Set(rules.map((r) => r.passwordEnv).filter(Boolean))] as string[];
  return c.json({
    ok: true,
    config: {
      GMAIL_CLIENT_ID: !!e.GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: !!e.GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: !!e.GMAIL_REFRESH_TOKEN,
      GMAIL_LABEL: e.GMAIL_LABEL,
      rules: rules.length,
      passwordEnvs: Object.fromEntries(
        passwordEnvs.map((k) => [k, !!(e as unknown as Record<string, unknown>)[k]]),
      ),
    },
  });
});

/** Test-only: run a parser over an uploaded PDF or raw body text, no Gmail/Sheets writes. */
app.post("/api/extract", async (c) => {
  const body = await c.req.parseBody();
  const parserName = (body["parser"] as string) || "indmoney-cas";
  const parse = parsers[parserName];
  if (!parse) {
    return c.json({ error: `Unknown parser '${parserName}'. Known: ${Object.keys(parsers).join(", ")}` }, 400);
  }

  try {
    let text: string;
    const file = body["file"];
    if (file instanceof File) {
      const password = (body["password"] as string) || c.env.PDF_PASSWORD_NIT;
      text = await extractPdfText(new Uint8Array(await file.arrayBuffer()), password);
    } else if (typeof body["text"] === "string") {
      text = body["text"] as string;
    } else {
      return c.json({ error: "Provide a PDF in 'file' or raw body in 'text'" }, 400);
    }
    const rows = parse(text);
    return c.json({ parser: parserName, rows, textPreview: text.slice(0, 2000) });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/** Main pipeline: route new matching emails to their per-sender sheet. */
app.post("/api/sync", async (c) => {
  const r = await runSync(c.env);
  return c.json(r, "error" in r ? 500 : 200);
});

type SyncResult = {
  processed: { id: string; from: string; rows: string[][] }[];
  skipped: { id: string; reason: string }[];
  errors: { id: string; error: string; textPreview?: string }[];
  message?: string;
};

/** Run the full sync once. Shared by POST /api/sync and the cron handler. */
async function runSync(env: Env): Promise<SyncResult | { error: string }> {
  const result: SyncResult = { processed: [], skipped: [], errors: [] };

  let token: string;
  try {
    token = await getAccessToken(env);
  } catch (err) {
    return { error: `Auth failed: ${String(err)}` };
  }

  const messages = await listMessages(token, buildQuery(env.GMAIL_LABEL));
  if (messages.length === 0) {
    return { ...result, message: "No new matching emails." };
  }

  const labelId = await ensureLabel(token, env.GMAIL_LABEL);
  // Cache each destination's layout so multiple emails to one sheet share a read.
  const layouts = new Map<string, { headerRowIndex: number; dataRows: string[][] }>();

  for (const ref of messages) {
    try {
      const msg = await getMessage(token, ref.id);
      const subject = getSubject(msg);
      const body = getBodyText(msg);
      const haystack = [subject, getFrom(msg), getRecipients(msg), body].join(" ").toLowerCase();
      const rule = matchRule(subject, haystack);
      if (!rule) {
        // Fetched via Gmail's broad match but no rule's from/to/subject all present.
        result.skipped.push({ id: ref.id, reason: "no matching rule" });
        continue;
      }

      const text = await getSourceText(token, ref.id, msg, rule, env);
      if (text == null) {
        result.errors.push({ id: ref.id, error: "no PDF attachment found" });
        continue;
      }

      const rows = parsers[rule.parser]?.(text);
      if (!rows || rows.length === 0) {
        result.errors.push({
          id: ref.id,
          error: `incomplete parse via '${rule.parser}' (from: ${rule.from})`,
          textPreview: text.slice(0, 1500),
        });
        continue;
      }

      const layout = await getLayout(token, rule, layouts);
      const inserted: string[][] = [];
      let dupes = 0;
      for (const row of rows) {
        if (isDuplicate(layout.dataRows, row, rule.dedupColumns)) {
          dupes++;
        } else {
          await insertRowBelowHeader(token, rule.destination, layout.headerRowIndex, row);
          layout.dataRows.unshift(row);
          inserted.push(row);
        }
      }
      if (inserted.length) result.processed.push({ id: ref.id, from: rule.from, rows: inserted });
      if (dupes) result.skipped.push({ id: ref.id, reason: `${dupes} duplicate row(s) already in sheet` });

      // Label once after handling all rows (even if all were duplicates) so it is not re-fetched.
      await addLabel(token, ref.id, labelId);
    } catch (err) {
      result.errors.push({ id: ref.id, error: String(err) });
    }
  }

  return result;
}

async function getSourceText(
  token: string,
  msgId: string,
  msg: Awaited<ReturnType<typeof getMessage>>,
  rule: Rule,
  env: Env,
): Promise<string | null> {
  if (rule.source === "body") return getBodyText(msg);

  const part = findPdfPart(msg.payload);
  if (!part?.body?.attachmentId) return null;
  const b64 = await getAttachmentData(token, msgId, part.body.attachmentId);
  const password = rule.passwordEnv
    ? (env as unknown as Record<string, string>)[rule.passwordEnv]
    : "";
  return extractPdfText(base64urlToBytes(b64), password);
}

async function getLayout(
  token: string,
  rule: Rule,
  cache: Map<string, { headerRowIndex: number; dataRows: string[][] }>,
) {
  const key = `${rule.destination.spreadsheetId}|${rule.destination.tab}`;
  let layout = cache.get(key);
  if (!layout) {
    layout = await getSheetLayout(token, rule.destination, rule.headerMatch, rule.columns.length);
    cache.set(key, layout);
  }
  return layout;
}

export default {
  fetch: app.fetch,
  // Cron trigger (see wrangler.jsonc `triggers.crons`): gate on SYNC_INTERVAL_MINUTES, then sync.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(maybeSync(env));
  },
};

/** Run a sync only if SYNC_INTERVAL_MINUTES have elapsed since the last cron run. */
async function maybeSync(env: Env): Promise<void> {
  const intervalMs = (Number(env.SYNC_INTERVAL_MINUTES) || 5) * 60_000;
  const last = Number(await env.SYNC_STATE.get("lastRun")) || 0;
  const now = Date.now();
  if (now - last < intervalMs) {
    console.log(`cron skip: ${Math.round((now - last) / 60_000)}min since last run < ${intervalMs / 60_000}min`);
    return;
  }
  // Mark before running so an overlapping tick doesn't double-fire.
  await env.SYNC_STATE.put("lastRun", String(now));
  const r = await runSync(env);
  console.log("cron sync:", JSON.stringify(r));
}
