const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface MessageRef {
  id: string;
  threadId: string;
}

interface MessagePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: MessagePart[];
}

export interface GmailMessage {
  id: string;
  payload: MessagePart;
}

async function gfetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Gmail ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function listMessages(token: string, query: string): Promise<MessageRef[]> {
  const data = await gfetch<{ messages?: MessageRef[] }>(
    token,
    `/messages?q=${encodeURIComponent(query)}`,
  );
  return data.messages ?? [];
}

export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  return gfetch<GmailMessage>(token, `/messages/${id}?format=full`);
}

export async function getAttachmentData(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<string> {
  const data = await gfetch<{ data: string }>(
    token,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  return data.data; // base64url
}

/** Resolve a label id by name, creating the label if it does not exist. */
export async function ensureLabel(token: string, name: string): Promise<string> {
  const data = await gfetch<{ labels?: { id: string; name: string }[] }>(token, `/labels`);
  const existing = data.labels?.find((l) => l.name === name);
  if (existing) return existing.id;

  const created = await gfetch<{ id: string }>(token, `/labels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

export async function addLabel(token: string, messageId: string, labelId: string): Promise<void> {
  await gfetch(token, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export function getSubject(msg: GmailMessage): string {
  return getHeader(msg, "subject");
}

export function getFrom(msg: GmailMessage): string {
  return getHeader(msg, "from");
}

/** Combined recipient text (all To + Cc + Delivered-To headers) for rule matching. */
export function getRecipients(msg: GmailMessage): string {
  const wanted = new Set(["to", "cc", "delivered-to"]);
  return (msg.payload.headers ?? [])
    .filter((h) => wanted.has(h.name.toLowerCase()))
    .map((h) => h.value)
    .join(" ");
}

function getHeader(msg: GmailMessage, name: string): string {
  const h = msg.payload.headers?.find((x) => x.name.toLowerCase() === name);
  return h?.value ?? "";
}

/** Plain-text email body: prefers text/plain, falls back to tag-stripped text/html. */
export function getBodyText(msg: GmailMessage): string {
  const plain = findBodyPart(msg.payload, "text/plain");
  if (plain) return decodeBody(plain);
  const html = findBodyPart(msg.payload, "text/html");
  if (html) return stripHtml(decodeBody(html));
  return "";
}

function findBodyPart(part: MessagePart | undefined, mimeType: string): MessagePart | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findBodyPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeBody(part: MessagePart): string {
  return new TextDecoder().decode(base64urlToBytes(part.body!.data!));
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Depth-first search for the first PDF attachment part. */
export function findPdfPart(part: MessagePart | undefined): MessagePart | null {
  if (!part) return null;
  const isPdf =
    part.mimeType === "application/pdf" ||
    (part.filename ?? "").toLowerCase().endsWith(".pdf");
  if (isPdf && part.body?.attachmentId) return part;
  for (const child of part.parts ?? []) {
    const found = findPdfPart(child);
    if (found) return found;
  }
  return null;
}

export function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
