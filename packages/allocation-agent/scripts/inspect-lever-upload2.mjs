#!/usr/bin/env node
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";
import { resolve } from "path";

const RESUME_PDF_PATH = resolve(import.meta.dirname, "../.context/attachments/resume_jasonzb_oct10 (2).pdf");

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
const p = await b.newPage();

await p.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.chrome = { runtime: {} };
});

// Intercept ALL XHR/fetch requests (not just URL-filtered)
p.on("request", req => {
  const type = req.resourceType();
  if (type === "xhr" || type === "fetch") {
    console.log(`XHR/FETCH: ${req.method()} ${req.url().substring(0, 150)}`);
  }
});

p.on("response", async res => {
  const req = res.request();
  const type = req.resourceType();
  if (type === "xhr" || type === "fetch") {
    console.log(`RESPONSE: ${res.status()} ${res.url().substring(0, 150)}`);
    try {
      const body = await res.text();
      console.log(`  Body: ${body.substring(0, 500)}`);
    } catch (e) {
      console.log(`  Body read error: ${e.message}`);
    }
  }
});

// Also capture console errors
p.on("console", msg => {
  if (msg.type() === "error" || msg.type() === "warn") {
    console.log(`CONSOLE.${msg.type()}: ${msg.text().substring(0, 200)}`);
  }
});

p.on("pageerror", err => {
  console.log(`PAGE ERROR: ${err.message.substring(0, 200)}`);
});

await p.goto("https://jobs.lever.co/voleon/08a2b491-dc45-4845-8038-07d11f1dda60/apply", { waitUntil: "networkidle2", timeout: 30000 });

console.log("Page loaded. Uploading resume...");

const fileInput = await p.$("#resume-upload-input");
if (fileInput) {
  await fileInput.uploadFile(RESUME_PDF_PATH);
  console.log("uploadFile() called, waiting 20s for upload...");

  // Wait longer
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await p.evaluate(() => {
      const success = document.querySelector(".resume-upload-success");
      const working = document.querySelector(".resume-upload-working");
      const fname = document.querySelector(".filename");
      const storageId = document.querySelector('[name="resumeStorageId"]');
      return {
        successDisplay: success ? getComputedStyle(success).display : "N/A",
        workingDisplay: working ? getComputedStyle(working).display : "N/A",
        filename: fname?.textContent?.trim() || "",
        resumeStorageId: storageId?.value || "",
      };
    });
    if (i % 3 === 0) console.log(`  [${i + 1}s]`, JSON.stringify(state));
    if (state.resumeStorageId) {
      console.log(`  RESUME STORAGE ID FOUND: ${state.resumeStorageId}`);
      break;
    }
    if (state.successDisplay !== "none") {
      console.log(`  Upload success visible at ${i + 1}s`);
      break;
    }
  }
}

await new Promise(r => setTimeout(r, 2000));
await b.close();
