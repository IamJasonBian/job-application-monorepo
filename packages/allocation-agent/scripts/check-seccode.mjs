#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://boards.greenhouse.io/embed/job_app?for=point72&token=7667745002", { waitUntil: "networkidle2", timeout: 30000 });

// Check if security_code field exists BEFORE any submission
const secCodeInfo = await page.evaluate(() => {
  const field = document.querySelector('#security_code, input[name="security_code"]');
  if (!field) return { exists: false };
  return {
    exists: true,
    id: field.id,
    name: field.name,
    type: field.type,
    visible: field.offsetParent !== null,
    display: getComputedStyle(field).display,
    parentVisible: field.parentElement?.offsetParent !== null,
    parentDisplay: getComputedStyle(field.parentElement).display,
    grandparentClass: field.parentElement?.parentElement?.className,
    grandparentDisplay: getComputedStyle(field.parentElement?.parentElement).display,
    containerClass: field.closest(".field")?.className || "none",
    containerDisplay: field.closest(".field") ? getComputedStyle(field.closest(".field")).display : "no-container",
  };
});
console.log("Security code field pre-submit:", JSON.stringify(secCodeInfo, null, 2));

await browser.close();
