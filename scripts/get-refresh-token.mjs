// One-time helper: runs the OAuth consent flow for nit4infy2@gmail.com and prints
// a refresh token to store as GMAIL_REFRESH_TOKEN in .dev.vars.
//
// Usage:  node scripts/get-refresh-token.mjs
// Reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .dev.vars (or the environment).
// The OAuth client must allow redirect URI http://localhost:5555/callback
// (Desktop-app clients allow loopback automatically; for a Web client, add it).

import http from "node:http";
import { readFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets",
];
const PORT = 5555;
const REDIRECT = `http://localhost:${PORT}/callback`;

function loadDevVars() {
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* fall back to process.env */
  }
}

loadDevVars();
const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .dev.vars first.");
  process.exit(1);
}

const client = new OAuth2Client(clientId, clientSecret, REDIRECT);
const authUrl = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n1) Open this URL and sign in as nit4infy2@gmail.com:\n");
console.log(authUrl, "\n");

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing code");
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.end("Success. You can close this tab and return to the terminal.");
    if (tokens.refresh_token) {
      console.log("REFRESH_TOKEN_BEGIN");
      console.log(tokens.refresh_token);
      console.log("REFRESH_TOKEN_END");
      console.log("\nAdd to .dev.vars:  GMAIL_REFRESH_TOKEN=<the token above>");
    } else {
      console.log("No refresh_token returned. Revoke prior access and retry (prompt=consent).");
    }
  } catch (err) {
    res.writeHead(500).end(String(err));
    console.error(err);
  } finally {
    setTimeout(() => server.close(), 500);
  }
});

server.listen(PORT, () => console.log(`Waiting for the OAuth redirect on ${REDIRECT} …`));
