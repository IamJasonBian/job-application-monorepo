#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://boards.greenhouse.io/embed/job_app?for=imc&token=4439297101", { waitUntil: "networkidle2", timeout: 30000 });

// Dump ALL education-related elements
const eduFields = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll("[id*='education'], [name*='education'], [id*='school'], [name*='school'], [id*='degree'], [name*='degree'], [id*='discipline'], [name*='discipline']").forEach(el => {
    results.push({
      tag: el.tagName,
      id: el.id,
      name: el.name || "",
      type: el.type || "",
      className: el.className?.substring(0, 60) || "",
      visible: el.offsetParent !== null || el.offsetWidth > 0,
      value: el.value?.substring(0, 30) || "",
      optCount: el.options ? el.options.length : 0,
      placeholder: el.placeholder || "",
    });
  });
  return results;
});

console.log("=== Education/School/Degree/Discipline fields ===\n");
for (const f of eduFields) {
  console.log(`${f.tag.padEnd(8)} id=${(f.id || "").padEnd(40)} name=${(f.name || "").padEnd(60)} type=${f.type.padEnd(8)} vis=${f.visible} opts=${f.optCount} val="${f.value}" class=${f.className}`);
}

// Also check for ALL selects that are empty
const emptySelects = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll("select").forEach(sel => {
    const container = sel.closest(".field") || sel.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim() || "";
    const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    results.push({
      id: sel.id,
      name: sel.name,
      label: label.substring(0, 80),
      value: sel.value,
      optCount: opts.length,
      options: opts.slice(0, 6),
    });
  });
  return results;
});

console.log("\n=== ALL selects on form ===\n");
for (const s of emptySelects) {
  const status = s.value ? "FILLED" : "EMPTY";
  console.log(`${status.padEnd(6)} id=${(s.id || "").padEnd(40)} name=${(s.name || "").padEnd(50)} val="${s.value}" "${s.label.substring(0, 40)}"`);
  if (!s.value) {
    console.log(`       Options: ${JSON.stringify(s.options.map(o => o.text).slice(0, 5))}`);
  }
}

// Check for required fields that would fail
const requiredEmpty = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll(".field").forEach(field => {
    const label = field.querySelector("label")?.textContent?.trim() || "";
    const isRequired = label.includes("*");
    if (!isRequired) return;
    const inputs = field.querySelectorAll("input:not([type='hidden']):not([type='checkbox']), select, textarea");
    for (const input of inputs) {
      if (!input.value) {
        results.push({ label: label.substring(0, 80), name: input.name, id: input.id, tag: input.tagName });
      }
    }
  });
  return results;
});

console.log("\n=== Required empty fields ===\n");
for (const f of requiredEmpty) {
  console.log(`  ${f.tag} id=${f.id} name=${f.name} "${f.label}"`);
}

await browser.close();
