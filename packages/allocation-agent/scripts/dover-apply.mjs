#!/usr/bin/env node
/**
 * Dover Auto-Apply (Headful Puppeteer)
 *
 * Dover forms use Cloudflare Turnstile (auto-passes in headful Chrome).
 * Simple MUI form: firstName, lastName, email, linkedinUrl, phoneNumber, resume PDF.
 *
 * Usage:
 *   node scripts/dover-apply.mjs <url>
 *   node scripts/dover-apply.mjs https://app.dover.com/apply/Dots/565eb06a-...
 *
 * Env vars:
 *   RESUME_PATH (optional - path to PDF resume)
 *   REDIS_PASSWORD (optional - stores results in Redis)
 */

import puppeteer from "puppeteer-core";
import { existsSync } from "fs";
import { resolve } from "path";
import Redis from "ioredis";

// ── Config ──

const applyUrl = process.argv[2];
if (!applyUrl) {
  console.error("Usage: node scripts/dover-apply.mjs <dover-apply-url>");
  process.exit(1);
}

const RESUME_PDF_PATH =
  process.env.RESUME_PATH ||
  resolve(import.meta.dirname, "../.context/attachments/resume_jasonzb_oct10 (2).pdf");

const candidate = {
  firstName: "Jason",
  lastName: "Bian",
  email: "jason.bian64@gmail.com",
  phone: "+1-734-730-6569",
  linkedinUrl: "https://www.linkedin.com/in/jason-bian-7b9027a5/",
};

// ── Redis ──

let redisClient = null;

function getRedis() {
  if (redisClient) return redisClient;
  const host = process.env.REDIS_HOST || "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com";
  const port = parseInt(process.env.REDIS_PORT || "17054", 10);
  const password = process.env.REDIS_PASSWORD || "";
  if (!password) return null;
  redisClient = new Redis({ host, port, password, connectTimeout: 5000, commandTimeout: 10000, maxRetriesPerRequest: 3 });
  return redisClient;
}

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// ── Main ──

async function main() {
  // Extract job ID from URL
  const urlMatch = applyUrl.match(/\/apply\/([^/]+)\/([a-f0-9-]+)/);
  const companySlug = urlMatch ? urlMatch[1] : "unknown";
  const jobId = urlMatch ? urlMatch[2] : "unknown";

  console.log(`\nDover Auto-Apply`);
  console.log(`Company: ${companySlug}`);
  console.log(`Job ID:  ${jobId}`);
  console.log(`URL:     ${applyUrl}`);
  console.log("=".repeat(60));

  // Check Redis for existing application
  const redis = getRedis();
  if (redis) {
    const existing = await redis.get(`dover_applications:${companySlug}:${jobId}`);
    if (existing) {
      const data = JSON.parse(existing);
      console.log(`SKIP: Already applied on ${data.appliedAt} (${data.status})`);
      await disconnectRedis();
      return;
    }
  }

  // Launch headful Chrome
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: [
      "--no-sandbox",
      "--window-size=1200,900",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();

  // Stealth
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    delete navigator.__proto__.webdriver;
    window.chrome = { runtime: {} };
  });

  let jobTitle = "Unknown";
  let result;

  try {
    console.log("Navigating...");
    await page.goto(applyUrl, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for Cloudflare Turnstile to pass
    console.log("Waiting for Cloudflare...");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      if (!title.includes("moment") && !title.includes("Cloudflare")) {
        jobTitle = title.replace(/^Apply for /, "").replace(/ at .+$/, "").trim() || title;
        console.log(`Cloudflare passed (${(i + 1) * 1.5}s) — ${title}`);
        break;
      }
      if (i === 19) {
        throw new Error("Cloudflare challenge timed out (30s)");
      }
    }

    // Wait for form to render
    await page.waitForSelector('input[name="firstName"]', { timeout: 15000 });
    console.log("Form loaded");

    // Fill fields using React-compatible input simulation
    for (const [name, value] of Object.entries({
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      linkedinUrl: candidate.linkedinUrl,
      phoneNumber: candidate.phone,
    })) {
      const input = await page.$(`input[name="${name}"]`);
      if (input) {
        await input.click({ clickCount: 3 }); // select all
        await input.type(value, { delay: 20 });
        console.log(`  ${name}: ${value}`);
      } else {
        console.log(`  ${name}: FIELD NOT FOUND`);
      }
    }

    // Upload resume
    if (existsSync(RESUME_PDF_PATH)) {
      const fileInput = await page.$('input[type="file"][accept=".pdf"]');
      if (fileInput) {
        await fileInput.uploadFile(RESUME_PDF_PATH);
        console.log(`  Resume: ${RESUME_PDF_PATH.split("/").pop()}`);
        // Wait for upload to complete
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.log("  Resume: FILE INPUT NOT FOUND");
      }
    } else {
      console.log(`  Resume: FILE NOT FOUND at ${RESUME_PDF_PATH}`);
    }

    // Brief pause before submit
    await new Promise((r) => setTimeout(r, 1000));

    // Submit
    console.log("Submitting...");

    // Capture API response
    const responsePromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 20000);
      page.on("response", (res) => {
        const url = res.url();
        if (url.includes("dover.com/api") && (url.includes("inbound") || url.includes("apply") || url.includes("candidate"))) {
          clearTimeout(timeout);
          res.text().then((body) => resolve({ url, status: res.status(), body: body.substring(0, 500) })).catch(() => resolve({ url, status: res.status(), body: "" }));
        }
      });
    });

    // Click submit
    const submitClicked = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!submitClicked) {
      throw new Error("Submit button not found");
    }

    // Wait for navigation or API response
    await new Promise((r) => setTimeout(r, 5000));

    // Check result
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "").catch(() => "");
    const currentUrl = page.url();

    if (
      bodyText.toLowerCase().includes("thank") ||
      bodyText.toLowerCase().includes("received") ||
      bodyText.toLowerCase().includes("submitted") ||
      bodyText.toLowerCase().includes("application has been") ||
      currentUrl.includes("success") ||
      currentUrl.includes("thank")
    ) {
      result = { status: "PASS", message: "Application submitted successfully" };
    } else if (bodyText.toLowerCase().includes("error") || bodyText.toLowerCase().includes("failed")) {
      result = { status: "FAIL", message: bodyText.substring(0, 200) };
    } else {
      // Check the API response
      const apiRes = await responsePromise;
      if (apiRes && apiRes.status >= 200 && apiRes.status < 300) {
        result = { status: "PASS", message: `API ${apiRes.status}: ${apiRes.body.substring(0, 100)}` };
      } else if (apiRes) {
        result = { status: "FAIL", message: `API ${apiRes.status}: ${apiRes.body.substring(0, 200)}` };
      } else {
        // Take a screenshot of final state for debugging
        result = { status: "UNKNOWN", message: `Page text: ${bodyText.substring(0, 200)}` };
      }
    }

    console.log(`\nResult: ${result.status} — ${result.message}`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    result = { status: "ERROR", message: err.message };
  }

  // Store in Redis
  if (redis) {
    try {
      const key = `dover_applications:${companySlug}:${jobId}`;
      const record = {
        company: companySlug,
        jobId,
        jobTitle,
        appliedAt: new Date().toISOString(),
        ...result,
      };
      await redis.set(key, JSON.stringify(record));
      await redis.expire(key, 60 * 60 * 24 * 90);
      console.log(`Redis: stored ${key}`);
    } catch (err) {
      console.error(`Redis error: ${err.message}`);
    }
  }

  await browser.close();
  await disconnectRedis();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
