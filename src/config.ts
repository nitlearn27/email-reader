export interface Env {
  // Secrets (set via `wrangler secret put` / .dev.vars)
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  PDF_PASSWORD: string;

  // Vars (wrangler.jsonc)
  SPREADSHEET_ID: string;
  SHEET_TAB: string;
  SHEET_GID: string;
  EMAIL_SUBJECT: string;
  GMAIL_LABEL: string;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets",
];
