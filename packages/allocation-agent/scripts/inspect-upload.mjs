#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://boards.greenhouse.io/embed/job_app?for=imc&token=4439297101", { waitUntil: "networkidle2", timeout: 30000 });

// Inspect file upload / resume section
const resumeInfo = await page.evaluate(() => {
  const results = [];
  // File inputs
  document.querySelectorAll("input[type='file']").forEach(el => {
    results.push({
      tag: "INPUT[file]",
      id: el.id,
      name: el.name,
      accept: el.accept,
      visible: el.offsetParent !== null,
      parentClass: el.parentElement?.className?.substring(0, 50),
      parentId: el.parentElement?.id,
    });
  });
  // Data source buttons
  document.querySelectorAll("button[data-source]").forEach(el => {
    results.push({
      tag: "BUTTON",
      dataSource: el.getAttribute("data-source"),
      text: el.textContent.trim().substring(0, 40),
      visible: el.offsetParent !== null,
    });
  });
  // Resume-related containers
  document.querySelectorAll("[id*='resume'], [class*='resume'], [name*='resume']").forEach(el => {
    results.push({
      tag: el.tagName,
      id: el.id,
      name: el.name || "",
      className: el.className?.substring(0, 50) || "",
      visible: el.offsetParent !== null,
    });
  });
  return results;
});

console.log("Resume/Upload fields:");
for (const f of resumeInfo) {
  console.log(JSON.stringify(f));
}

// Also check the same on DRW
const page2 = await browser.newPage();
await page2.goto("https://boards.greenhouse.io/embed/job_app?for=drweng&token=7421010", { waitUntil: "networkidle2", timeout: 30000 });

const drwResume = await page2.evaluate(() => {
  const results = [];
  document.querySelectorAll("input[type='file']").forEach(el => {
    results.push({
      tag: "INPUT[file]",
      id: el.id,
      name: el.name,
      accept: el.accept,
      visible: el.offsetParent !== null,
    });
  });
  document.querySelectorAll("button[data-source]").forEach(el => {
    results.push({
      tag: "BUTTON",
      dataSource: el.getAttribute("data-source"),
      text: el.textContent.trim().substring(0, 40),
      visible: el.offsetParent !== null,
    });
  });
  return results;
});

console.log("\nDRW Resume/Upload fields:");
for (const f of drwResume) {
  console.log(JSON.stringify(f));
}

await browser.close();
