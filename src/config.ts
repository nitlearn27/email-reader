export interface Env {
  // Secrets (set via `wrangler secret put` / .dev.vars)
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  // PDF decryption passwords, referenced by name from each rule's `passwordEnv`.
  // Add more as new pdf rules need them.
  PDF_PASSWORD_NIT: string;
  PDF_PASSWORD_AR: string;

  // Vars (wrangler.jsonc). Per-sender routing + destinations live in src/rules.json.
  GMAIL_LABEL: string;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets",
];
