#!/usr/bin/env node
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto("https://jobs.lever.co/voleon/e47d5699-5c1a-4b17-bbf4-c948efc0151d/apply", { waitUntil: "networkidle2", timeout: 30000 });

// Check for captcha
const captchaCheck = await p.evaluate(() => {
  return {
    hasGrecaptcha: typeof window.grecaptcha !== "undefined",
    hasRecaptchaFrame: !!document.querySelector("iframe[src*='recaptcha']"),
    hasRecaptchaDiv: !!document.querySelector(".g-recaptcha, [data-sitekey]"),
    hasHcaptcha: !!document.querySelector(".h-captcha, iframe[src*='hcaptcha']"),
  };
});
console.log("CAPTCHA:", JSON.stringify(captchaCheck));

// Check form structure
const formInfo = await p.evaluate(() => {
  const fields = [];
  document.querySelectorAll("input:not([type='hidden']), select, textarea, [contenteditable]").forEach(el => {
    const container = el.closest(".application-field, .application-question, .field") || el.parentElement;
    const label = container?.querySelector("label, .field-label, .application-label")?.textContent?.trim() || "";
    fields.push({
      tag: el.tagName,
      type: el.type || el.getAttribute("contenteditable") || "",
      name: el.name || "",
      id: el.id || "",
      label: label.substring(0, 80),
      required: el.required || el.hasAttribute("required"),
      placeholder: (el.placeholder || "").substring(0, 50),
      className: (el.className || "").substring(0, 40),
    });
  });
  const form = document.querySelector("form");
  const submitBtn = document.querySelector("button[type='submit'], input[type='submit'], .postings-btn");
  return {
    formAction: form?.action?.substring(0, 100) || "no form",
    formMethod: form?.method || "",
    formEnctype: form?.enctype || "",
    submitText: submitBtn?.textContent?.trim() || "no submit found",
    fieldCount: fields.length,
    fields,
    pageTitle: document.title,
  };
});
console.log("\nForm info:");
console.log("  Action:", formInfo.formAction);
console.log("  Method:", formInfo.formMethod);
console.log("  Enctype:", formInfo.formEnctype);
console.log("  Submit:", formInfo.submitText);
console.log("  Fields:", formInfo.fieldCount);
console.log("");
for (const f of formInfo.fields) {
  const req = f.required ? " *REQUIRED*" : "";
  console.log(`  ${f.tag.padEnd(10)} name=${(f.name || "").padEnd(30)} label="${f.label.substring(0, 50)}"${req} placeholder="${f.placeholder}"`);
}
await b.close();
