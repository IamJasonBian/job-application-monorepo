#!/usr/bin/env node

/**
 * Local OAuth helper - starts a local server to complete Google OAuth flow.
 * Opens browser → user grants consent → receives refresh token.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-oauth-token.mjs
 */

import http from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h1>OAuth Error</h1><p>${error}</p>`);
      console.error(`OAuth error: ${error}`);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>No authorization code received</h1>");
      return;
    }

    // Exchange code for tokens
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }).toString(),
      });

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
        console.error("Token exchange failed:", tokenData);
        server.close();
        process.exit(1);
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <h1>OAuth Success!</h1>
        <p>Refresh token obtained. You can close this window.</p>
        <p>Check your terminal for the token.</p>
      `);

      console.log("\n\nOAuth tokens received!");
      console.log("=".repeat(60));
      console.log(`REFRESH_TOKEN: ${tokenData.refresh_token}`);
      console.log("=".repeat(60));
      console.log(`\nTo set in Netlify:\n  netlify env:set GOOGLE_REFRESH_TOKEN "${tokenData.refresh_token}"\n`);
      console.log(`To use locally:\n  export GOOGLE_REFRESH_TOKEN="${tokenData.refresh_token}"\n`);

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
      console.error("Error:", err);
      server.close();
      process.exit(1);
    }
  } else {
    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`OAuth server listening on http://localhost:${PORT}`);
  console.log(`Opening browser...`);
  console.log(`\nIf browser doesn't open, visit:\n${authUrl.toString()}\n`);

  // Open browser
  const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${openCmd} "http://localhost:${PORT}"`);
});
