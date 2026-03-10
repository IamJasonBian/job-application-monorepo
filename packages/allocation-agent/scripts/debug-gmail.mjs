#!/usr/bin/env node

/**
 * Debug script - fetch and print last 4 Greenhouse emails from Gmail
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN");
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function main() {
  console.log("Refreshing access token...");
  const accessToken = await getAccessToken();
  console.log("Access token obtained.\n");

  // Search for Greenhouse emails - broad query
  const queries = [
    "from:greenhouse.io",
    "from:greenhouse subject:security",
    "subject:security code",
    "from:no-reply subject:code",
  ];

  for (const q of queries) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`QUERY: ${q}`);
    console.log("=".repeat(70));

    const query = encodeURIComponent(q);
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=4`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listRes.ok) {
      console.log(`  List failed: ${listRes.status} ${await listRes.text()}`);
      continue;
    }

    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      console.log("  No messages found.");
      continue;
    }

    console.log(`  Found ${listData.messages.length} message(s)\n`);

    for (let i = 0; i < listData.messages.length; i++) {
      const msgId = listData.messages[i].id;
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!msgRes.ok) {
        console.log(`  Message ${msgId} fetch failed: ${msgRes.status}`);
        continue;
      }

      const msg = await msgRes.json();

      // Extract headers
      const headers = msg.payload.headers || [];
      const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "(no subject)";
      const from = headers.find(h => h.name.toLowerCase() === "from")?.value || "(unknown)";
      const date = headers.find(h => h.name.toLowerCase() === "date")?.value || "(no date)";
      const to = headers.find(h => h.name.toLowerCase() === "to")?.value || "(unknown)";

      console.log(`  --- Email ${i + 1} (id: ${msgId}) ---`);
      console.log(`  From:    ${from}`);
      console.log(`  To:      ${to}`);
      console.log(`  Date:    ${date}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Snippet: ${msg.snippet}`);

      // Extract body
      let bodyText = "";
      let bodyHtml = "";

      function extractParts(payload) {
        if (payload.body?.data) {
          const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
          if (payload.mimeType === "text/plain") bodyText = decoded;
          else if (payload.mimeType === "text/html") bodyHtml = decoded;
        }
        if (payload.parts) {
          for (const part of payload.parts) {
            extractParts(part);
          }
        }
      }

      extractParts(msg.payload);

      if (bodyText) {
        console.log(`\n  BODY (text/plain):`);
        console.log(`  ${bodyText.substring(0, 500).replace(/\n/g, "\n  ")}`);
      } else if (bodyHtml) {
        // Strip HTML tags for readability
        const stripped = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        console.log(`\n  BODY (text/html, stripped):`);
        console.log(`  ${stripped.substring(0, 500)}`);
      } else {
        console.log(`\n  BODY: (empty)`);
      }

      // Try to extract security code
      const fullBody = bodyText || bodyHtml;
      const codeMatch = fullBody.match(
        /(?:security\s*code|verification\s*code|code\s*into)[^:]*:\s*\n?\s*([A-Za-z0-9]{6,12})/i
      );
      const fallbackMatch = fullBody.match(/\n\s*([A-Za-z0-9]{8})\s*\n/);

      if (codeMatch) {
        console.log(`\n  >>> EXTRACTED CODE (primary regex): ${codeMatch[1]}`);
      } else if (fallbackMatch) {
        console.log(`\n  >>> EXTRACTED CODE (fallback regex): ${fallbackMatch[1]}`);
      } else {
        console.log(`\n  >>> NO CODE EXTRACTED`);
      }

      console.log("");
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
