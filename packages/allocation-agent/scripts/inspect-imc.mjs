#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://boards.greenhouse.io/embed/job_app?for=imc&token=4439297101", { waitUntil: "networkidle2", timeout: 30000 });

// Inspect ALL form elements including hidden ones
const allFields = await page.evaluate(() => {
  const results = [];
  // All inputs, selects, textareas in the form
  document.querySelectorAll("#application_form input, #application_form select, #application_form textarea").forEach(el => {
    if (el.type === "hidden" && !el.name?.includes("school") && !el.name?.includes("education") && !el.name?.includes("date")) return;
    const container = el.closest(".field") || el.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim()?.substring(0, 60) || "";
    results.push({
      tag: el.tagName, type: el.type, name: el.name?.substring(0, 60) || "",
      id: el.id?.substring(0, 40) || "", label,
      visible: el.offsetParent !== null, value: el.value?.substring(0, 20) || "",
    });
  });
  // Also look for Select2 containers
  document.querySelectorAll("[id^='s2id_']").forEach(el => {
    results.push({
      tag: "SELECT2", type: "widget", name: "", id: el.id,
      label: el.closest(".field")?.querySelector("label")?.textContent?.trim()?.substring(0, 60) || "",
      visible: el.offsetParent !== null, value: "",
    });
  });
  return results;
});

console.log("\nIMC Form Fields:\n");
for (const f of allFields) {
  if (!f.visible && f.tag !== "INPUT") continue;
  console.log(`${f.tag.padEnd(8)} ${f.type?.padEnd(8) || ""} ${f.id?.padEnd(35) || ""} name=${f.name?.padEnd(50) || ""} "${f.label?.substring(0, 40) || ""}"`);
}

// Specifically check school/education structure
const eduInfo = await page.evaluate(() => {
  const schoolFields = [];
  document.querySelectorAll("[id*='school'], [name*='school'], [id*='education'], [name*='education']").forEach(el => {
    schoolFields.push({
      tag: el.tagName, id: el.id, name: el.name,
      type: el.type, className: el.className?.substring(0, 50),
      visible: el.offsetParent !== null,
    });
  });
  // Check employment date fields
  const dateFields = [];
  document.querySelectorAll("[name*='start_date'], [name*='end_date'], [id*='start_date'], [id*='end_date']").forEach(el => {
    dateFields.push({
      tag: el.tagName, id: el.id, name: el.name, type: el.type,
      visible: el.offsetParent !== null, placeholder: el.placeholder,
    });
  });
  return { schoolFields, dateFields };
});

console.log("\n\nSchool/Education fields:");
for (const f of eduInfo.schoolFields) {
  console.log(`  ${f.tag} id=${f.id} name=${f.name} type=${f.type} visible=${f.visible} class=${f.className}`);
}
console.log("\nDate fields:");
for (const f of eduInfo.dateFields) {
  console.log(`  ${f.tag} id=${f.id} name=${f.name} type=${f.type} visible=${f.visible} placeholder=${f.placeholder}`);
}

await browser.close();
