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

// Intercept network requests related to file upload
p.on("request", req => {
  if (req.url().includes("upload") || req.url().includes("resume") || req.url().includes("file")) {
    console.log(`REQUEST: ${req.method()} ${req.url().substring(0, 120)}`);
    const headers = req.headers();
    if (headers["content-type"]) console.log(`  Content-Type: ${headers["content-type"]}`);
  }
});

p.on("response", async res => {
  if (res.url().includes("upload") || res.url().includes("resume") || res.url().includes("file")) {
    console.log(`RESPONSE: ${res.status()} ${res.url().substring(0, 120)}`);
    try {
      const body = await res.text();
      console.log(`  Body: ${body.substring(0, 300)}`);
    } catch {}
  }
});

await p.goto("https://jobs.lever.co/voleon/08a2b491-dc45-4845-8038-07d11f1dda60/apply", { waitUntil: "networkidle2", timeout: 30000 });

console.log("Page loaded. Uploading resume...");

const fileInput = await p.$("#resume-upload-input");
if (fileInput) {
  await fileInput.uploadFile(RESUME_PDF_PATH);
  console.log("uploadFile() called");

  // Wait and check state
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await p.evaluate(() => {
      const success = document.querySelector(".resume-upload-success");
      const working = document.querySelector(".resume-upload-working");
      const failure = document.querySelector(".resume-upload-failure");
      const fname = document.querySelector(".filename");
      const storageId = document.querySelector('[name="resumeStorageId"]');
      return {
        successVisible: success ? getComputedStyle(success).display : "N/A",
        workingVisible: working ? getComputedStyle(working).display : "N/A",
        failureVisible: failure ? getComputedStyle(failure).display : "N/A",
        filename: fname?.textContent?.trim() || "",
        resumeStorageId: storageId?.value || "",
      };
    });
    console.log(`  [${i + 1}s]`, JSON.stringify(state));
    if (state.filename || state.resumeStorageId) break;
  }
}

// Check all hidden inputs
const hiddens = await p.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='hidden']")).map(el => ({
    name: el.name,
    value: (el.value || "").substring(0, 80),
  }));
});
console.log("\nHidden inputs:");
for (const h of hiddens) {
  console.log(`  ${h.name} = ${h.value}`);
}

await new Promise(r => setTimeout(r, 3000));
await b.close();
