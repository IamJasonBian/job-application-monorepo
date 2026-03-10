#!/usr/bin/env node
/**
 * Inspect a Dover application form to understand its structure.
 * Usage: node scripts/dover-inspect.mjs [url]
 */

import puppeteer from "puppeteer-core";

const url = process.argv[2] || "https://app.dover.com/apply/Dots/565eb06a-6ffa-42a3-98ab-cb0f08c5d771?rs=42706078";

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

// Capture API calls
const apiCalls = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("dover.com") && !u.includes("nr-data") && !u.includes(".js") && !u.includes(".css") && !u.includes(".png") && !u.includes(".svg")) {
    const method = req.method();
    if (method === "POST" || method === "PUT" || method === "PATCH" || u.includes("/api/") || u.includes("/graphql")) {
      apiCalls.push({
        method,
        url: u.substring(0, 250),
        postData: req.postData()?.substring(0, 500) || null,
      });
    }
  }
});

// Capture API responses
const apiResponses = [];
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("dover.com") && (u.includes("/api/") || u.includes("/graphql")) && !u.includes("nr-data")) {
    try {
      const body = await res.text();
      apiResponses.push({
        url: u.substring(0, 250),
        status: res.status(),
        body: body.substring(0, 1000),
      });
    } catch {}
  }
});

console.log("Navigating to:", url);
await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

// Wait for Cloudflare + React
console.log("Waiting for Cloudflare challenge + React render...");
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const title = await page.title();
  if (!title.includes("moment") && !title.includes("Cloudflare")) {
    console.log(`Cloudflare passed after ${(i + 1) * 2}s (title: ${title})`);
    break;
  }
}

// Extra wait for React
await new Promise((r) => setTimeout(r, 3000));

const title = await page.title();
const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 4000) || "");
const formHTML = await page.evaluate(() => {
  const form = document.querySelector("form");
  return form ? form.outerHTML.substring(0, 5000) : "NO FORM FOUND";
});
const formFields = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll("input, select, textarea, button"));
  return inputs.map((el) => ({
    tag: el.tagName,
    type: el.type || "",
    name: el.name || "",
    id: el.id || "",
    placeholder: el.placeholder || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    required: el.required,
    text: el.textContent?.trim()?.substring(0, 60) || "",
  }));
});

console.log("\n=== Title ===");
console.log(title);
console.log("\n=== Body Text ===");
console.log(bodyText);
console.log("\n=== Form HTML (first 5000 chars) ===");
console.log(formHTML);
console.log("\n=== Form Fields ===");
console.log(JSON.stringify(formFields, null, 2));
console.log("\n=== API Calls ===");
console.log(JSON.stringify(apiCalls, null, 2));
console.log("\n=== API Responses ===");
console.log(JSON.stringify(apiResponses, null, 2));

await browser.close();
