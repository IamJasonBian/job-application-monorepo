#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const token = process.argv[2] || "drweng";
const jobId = process.argv[3] || "7421010";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
await page.goto(
  `https://boards.greenhouse.io/embed/job_app?for=${token}&token=${jobId}`,
  { waitUntil: "networkidle2", timeout: 30000 }
);

const fields = await page.evaluate(() => {
  const results = [];
  // All visible form fields
  document.querySelectorAll(".field").forEach(field => {
    const label = field.querySelector("label")?.textContent?.trim() || "";
    const isRequired = label.includes("*") || !!field.querySelector("[required]");
    const input = field.querySelector("input:not([type='hidden']):not([type='checkbox']), select, textarea");
    if (!input) return;
    const visible = input.offsetParent !== null || input.offsetWidth > 0;
    results.push({
      label: label.substring(0, 80),
      required: isRequired,
      tag: input.tagName,
      type: input.type || "",
      name: input.name || "",
      id: input.id || "",
      value: input.value?.substring(0, 30) || "",
      visible,
      isAnswerAttr: input.name?.includes("answers_attributes") || false,
    });
  });
  return results;
});

console.log(`\n${token}/${jobId} - Form Fields:\n`);
for (const f of fields) {
  const status = f.value ? "FILLED" : (f.required ? "EMPTY*" : "EMPTY");
  if (f.visible) {
    console.log(`${status.padEnd(7)} [${f.tag} ${f.type}] ${f.label.substring(0, 60).padEnd(60)} name=${f.name.substring(0, 40)}`);
  }
}

await browser.close();
