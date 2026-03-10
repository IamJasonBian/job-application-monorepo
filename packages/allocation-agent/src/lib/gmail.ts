/**
 * Gmail API integration for retrieving Greenhouse security codes.
 *
 * Flow:
 * 1. OAuth: /api/auth/google → Google consent → /api/auth/callback → stores tokens
 * 2. Check: Polls Gmail for recent Greenhouse emails containing security codes
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Generate the Google OAuth authorization URL.
 */
export function getAuthUrl(redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access/refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }

  return res.json() as Promise<OAuthTokens>;
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as OAuthTokens;
  return data.access_token;
}

/**
 * Search Gmail for recent Greenhouse security code emails.
 * Returns the security code if found, null otherwise.
 */
export async function fetchGreenhouseSecurityCode(
  accessToken: string,
  maxAgeMinutes: number = 10
): Promise<string | null> {
  // Search for recent Greenhouse emails with "security code"
  // Note: Greenhouse sends from no-reply@us.greenhouse-mail.io
  const query = encodeURIComponent(
    `from:greenhouse-mail.io subject:"security code" newer_than:${maxAgeMinutes}m`
  );

  const listRes = await fetch(
    `${GMAIL_API}/messages?q=${query}&maxResults=5`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) {
    console.error(`Gmail list failed: ${listRes.status}`);
    return null;
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string }>;
  };

  if (!listData.messages || listData.messages.length === 0) {
    console.log("No Greenhouse security code emails found");
    return null;
  }

  // Get the most recent message
  const msgId = listData.messages[0].id;
  const msgRes = await fetch(`${GMAIL_API}/messages/${msgId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!msgRes.ok) {
    console.error(`Gmail message fetch failed: ${msgRes.status}`);
    return null;
  }

  const msg = (await msgRes.json()) as {
    payload: {
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body: { data?: string } }>;
    };
  };

  // Extract body text (could be in body.data or parts[].body.data)
  let bodyText = "";

  if (msg.payload.body?.data) {
    bodyText = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
  }

  if (!bodyText && msg.payload.parts) {
    for (const part of msg.payload.parts) {
      if (part.mimeType === "text/plain" && part.body.data) {
        bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
        break;
      }
      if (part.mimeType === "text/html" && part.body.data) {
        bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
  }

  if (!bodyText) {
    console.log("Email body is empty");
    return null;
  }

  // Strip HTML tags if present (Greenhouse sends HTML-only emails)
  const stripped = bodyText.replace(/<[^>]+>/g, " ").replace(/&\w+;/g, " ").replace(/\s+/g, " ").trim();

  // Extract security code - typically 8 alphanumeric characters
  // Greenhouse format: "...application: M42moqCu After you enter..."
  const codeMatch = stripped.match(
    /application:\s+([A-Za-z0-9]{6,12})\s+After/i
  );

  if (codeMatch) {
    console.log(`Found security code: ${codeMatch[1]}`);
    return codeMatch[1];
  }

  // Broader pattern: "security code" context followed by code
  const broadMatch = stripped.match(
    /(?:security\s*code|verification\s*code|code\s*into)[^:]*:\s*([A-Za-z0-9]{6,12})/i
  );
  if (broadMatch) {
    console.log(`Found security code (broad): ${broadMatch[1]}`);
    return broadMatch[1];
  }

  // Fallback: look for standalone alphanumeric code on its own line
  const fallbackMatch = bodyText.match(/\n\s*([A-Za-z0-9]{8})\s*\n/);
  if (fallbackMatch) {
    console.log(`Found code (fallback): ${fallbackMatch[1]}`);
    return fallbackMatch[1];
  }

  console.log("Could not extract security code from email");
  console.log("Email body preview:", stripped.substring(0, 300));
  return null;
}

/**
 * Poll Gmail for a security code, retrying over a period.
 */
export async function waitForSecurityCode(
  accessToken: string,
  maxWaitMs: number = 60_000,
  pollIntervalMs: number = 5_000
): Promise<string | null> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    console.log(`Polling for security code (attempt ${attempt})...`);

    const code = await fetchGreenhouseSecurityCode(accessToken);
    if (code) return code;

    if (Date.now() + pollIntervalMs < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    } else {
      break;
    }
  }

  console.log("Timed out waiting for security code");
  return null;
}
