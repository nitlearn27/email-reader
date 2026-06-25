import rulesJson from "./rules.json";
import { parseTransaction } from "./pdf/parse";
import { parseNseTrades } from "./pdf/parse-nse";
import { parseInvescoBody } from "./parse-invesco-body";

export interface Destination {
  spreadsheetId: string;
  tab: string;
  gid: number;
}

export interface Rule {
  // Matching is by CONTENT PRESENCE, not envelope headers, so it survives forwarding:
  // these emails arrive as "Fwd: …" where the original sender/recipient live in the body.
  from: string; // original sender address that must appear in the message (header or body)
  to?: string; // if set, this recipient must also appear in the message (header or body)
  subject: string; // phrase that must appear in the Subject (substring, case-insensitive)
  source: "pdf" | "body";
  passwordEnv?: string; // (pdf) name of the Env secret holding the decryption password
  parser: string; // key into the parsers registry below
  destination: Destination;
  columns: string[]; // sheet column order; parser output is aligned to this
  headerMatch: string[]; // lowercased cells that identify the header row
  dedupColumns: number[]; // column indices forming the duplicate key
}

export const rules: Rule[] = rulesJson as Rule[];

/**
 * Per-rule extractors. Each takes the source text (PDF text or email body) and
 * returns zero or more rows, each aligned to the rule's `columns`. Return `null`
 * (or an empty array) for a parse failure: the email is then skipped without being
 * labeled, so it retries. One email can yield many rows (e.g. a multi-trade note).
 *
 * Add a new function here and reference it by key from rules.json as samples arrive.
 */
export const parsers: Record<string, (text: string) => string[][] | null> = {
  "indmoney-cas": (text) => {
    const tx = parseTransaction(text);
    if (!tx.date || !tx.scheme || !tx.amount || tx.units == null || tx.nav == null) {
      return null;
    }
    return [[tx.date, tx.scheme, tx.amount, String(tx.units), String(tx.nav)]];
  },
  "nse-contract-note": (text) => parseNseTrades(text),
  "invesco-processed-body": (text) => parseInvescoBody(text),
};

/**
 * Build a Gmail query that fetches only emails matching some rule. Uses full-text
 * terms for the addresses (not the from:/to: operators) so it also catches forwarded
 * mail where those addresses are in the body, and a subject phrase (matches within
 * "Fwd: … : …" subjects).
 */
export function buildQuery(label: string): string {
  const clauses = rules.map((r) => {
    const parts = [`subject:"${r.subject}"`, `"${r.from}"`];
    if (r.to) parts.push(`"${r.to}"`);
    return `(${parts.join(" ")})`;
  });
  const or = clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  return `${or} -label:${label} newer_than:60d`;
}

/**
 * Find the rule matching an email, or null. `subject` is the Subject header;
 * `haystack` is the lowercased subject + headers + body. Match = subject contains
 * the rule's phrase and the rule's from (and to, if set) appear anywhere in the email.
 */
export function matchRule(subject: string, haystack: string): Rule | null {
  const subj = subject.toLowerCase();
  return (
    rules.find(
      (r) =>
        subj.includes(r.subject.toLowerCase()) &&
        haystack.includes(r.from.toLowerCase()) &&
        (!r.to || haystack.includes(r.to.toLowerCase())),
    ) ?? null
  );
}
