#!/usr/bin/env node
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto("https://boards.greenhouse.io/embed/job_app?for=oldmissioncapital&token=5594469003", { waitUntil: "networkidle2", timeout: 30000 });
const selects = await p.evaluate(() => {
  const results = [];
  document.querySelectorAll("select").forEach(sel => {
    const container = sel.closest(".field") || sel.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim() || "";
    const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    const hasS2 = !!document.querySelector(`#s2id_${sel.id}`);
    results.push({ id: sel.id, name: sel.name, label: label.substring(0, 100), isS2: hasS2, opts: opts.slice(0, 10) });
  });
  return results.filter(s => !s.name.includes("education") && !s.name.includes("employment"));
});
for (const s of selects) console.log(JSON.stringify(s));
await b.close();
