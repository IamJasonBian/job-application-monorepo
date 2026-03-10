#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const token = process.argv[2] || "point72";
const jobId = process.argv[3] || "7667745002";

const candidate = {
  firstName: "Jason", lastName: "Bian",
  email: "jason.bian64@gmail.com", phone: "+1-734-730-6569",
};

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// Track network requests
const requests = [];
page.on("request", (req) => {
  if (req.method() === "POST") {
    requests.push({ url: req.url(), method: req.method(), type: req.resourceType() });
  }
});
page.on("response", (res) => {
  if (res.request().method() === "POST") {
    console.log(`   [NET] POST ${res.url()} -> ${res.status()}`);
  }
});

// Track console messages
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.text().includes("error") || msg.text().includes("Error")) {
    console.log(`   [CONSOLE] ${msg.type()}: ${msg.text().substring(0, 200)}`);
  }
});

await page.goto(`https://boards.greenhouse.io/embed/job_app?for=${token}&token=${jobId}`, { waitUntil: "networkidle2", timeout: 30000 });

// Fill basic fields
await page.type("#first_name", candidate.firstName, { delay: 20 });
await page.type("#last_name", candidate.lastName, { delay: 20 });
await page.type("#email", candidate.email, { delay: 20 });
const phoneField = await page.$("#phone");
if (phoneField) await phoneField.type(candidate.phone, { delay: 20 });

// Resume
await page.evaluate(() => {
  const btn = document.querySelector('button[data-source="paste"]');
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
  if (ta) { ta.value = "JASON BIAN - Data Engineer II at Amazon. University of Michigan BSE."; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true })); }
});
const resumeTextarea = await page.$('textarea[name="job_application[resume_text]"]');
if (resumeTextarea) { await resumeTextarea.press("Space"); await resumeTextarea.press("Backspace"); }

// Education
const hasEdu = await page.evaluate(() => !!document.querySelector("#education_degree_0"));
if (hasEdu) {
  await page.evaluate(() => {
    const deg = document.querySelector("#education_degree_0");
    if (deg) { for (const o of deg.options) { if (o.textContent.trim() === "Bachelor's Degree") { deg.value = o.value; deg.dispatchEvent(new Event("change", { bubbles: true })); break; } } }
    const disc = document.querySelector("#education_discipline_0");
    if (disc) { for (const o of disc.options) { if (o.textContent.trim().toLowerCase().includes("engineering")) { disc.value = o.value; disc.dispatchEvent(new Event("change", { bubbles: true })); break; } } }
  });
  // School via Select2
  const s2 = await page.$("#s2id_education_school_name_0");
  if (s2) {
    await s2.click();
    await new Promise((r) => setTimeout(r, 500));
    const searchInput = await page.$(".select2-drop-active .select2-input");
    if (searchInput) {
      await searchInput.type("University of Michigan", { delay: 40 });
      await new Promise((r) => setTimeout(r, 2000));
      await page.evaluate(() => {
        const results = document.querySelectorAll(".select2-drop-active .select2-results li");
        for (const li of results) { if (li.textContent.includes("Michigan")) { li.click(); break; } }
      });
    }
  }
  console.log("   Education filled");
}

// Location
const locationInput = await page.$("#auto_complete_input");
if (locationInput) {
  await locationInput.click();
  await locationInput.type("New York, NY", { delay: 60 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => {
    const items = document.querySelectorAll("[role='option'], .pelias-results li, .autocomplete-suggestions li");
    for (const item of items) { if (item.textContent.includes("New York")) { item.click(); return; } }
  });
  await page.keyboard.press("ArrowDown");
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("Enter");
  console.log("   Location filled");
}

// Fill ALL selects (both answers_attributes AND any other selects)
const allSelects = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll("select").forEach(sel => {
    if (sel.name === "" || sel.id === "") return;
    const container = sel.closest(".field") || sel.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim() || "";
    const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    const currentValue = sel.value;
    results.push({ name: sel.name, id: sel.id, label: label.substring(0, 80), currentValue, optCount: opts.length, options: opts.slice(0, 5) });
  });
  return results;
});
console.log("\n   ALL SELECT FIELDS:");
for (const s of allSelects) {
  const status = s.currentValue ? "FILLED" : "EMPTY";
  console.log(`   ${status.padEnd(6)} ${s.id.padEnd(40)} val=${s.currentValue.padEnd(15)} "${s.label.substring(0, 50)}"`);
}

// Fill answer selects properly
const questionData = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll("select[name*='answers_attributes']").forEach(sel => {
    const container = sel.closest(".field") || sel.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim() || "";
    const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    const isYesNo = opts.some(o => o.text === "Yes") && opts.some(o => o.text === "No");
    results.push({ name: sel.name, label, isYesNo, options: opts });
  });
  return results;
});

for (const q of questionData) {
  if (q.isYesNo) {
    const lbl = q.label.toLowerCase();
    let val = "1"; // default yes
    if (lbl.includes("previously applied") || lbl.includes("have you ever worked")) val = "0";
    if (lbl.includes("sponsorship") || lbl.includes("require sponsor")) val = "0";
    if (lbl.includes("military") || lbl.includes("veteran")) val = "0";
    await page.select(`select[name="${q.name}"]`, val);
  } else {
    await page.evaluate((name, label, opts) => {
      const select = document.querySelector(`select[name="${name}"]`);
      if (!select) return;
      const lbl = label.toLowerCase();
      const validOpts = opts.filter(o => o.value && o.text !== "Please select" && o.text !== "");
      let pick = null;
      if (lbl.includes("location") || lbl.includes("work location")) pick = validOpts.find(o => o.text.toLowerCase().includes("new york"));
      if (!pick && (lbl.includes("how did you") || lbl.includes("learn about"))) { pick = validOpts.find(o => o.text.toLowerCase().includes("website") || o.text.toLowerCase().includes("online")); if (!pick) pick = validOpts.find(o => o.text.toLowerCase().includes("other")); }
      if (!pick && (lbl.includes("language") || lbl.includes("fluent"))) { pick = validOpts.find(o => o.text.toLowerCase().includes("mandarin")); if (!pick) pick = validOpts.find(o => o.text.toLowerCase() === "none"); }
      if (!pick && validOpts.length > 0) pick = validOpts[0];
      if (pick) { select.value = pick.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
    }, q.name, q.label, q.options);
  }
}

// Fill text questions
const textInputs = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll("input[type='text'][name*='answers_attributes'], textarea[name*='answers_attributes']").forEach(el => {
    const container = el.closest(".field") || el.parentElement;
    const label = container?.querySelector("label")?.textContent?.trim() || "";
    results.push({ name: el.name, label, value: el.value });
  });
  return results;
});
for (const q of textInputs) {
  const lbl = q.label.toLowerCase();
  let answer = "";
  if (lbl.includes("linkedin")) answer = "https://www.linkedin.com/in/jasonzbian/";
  else if (lbl.includes("current company") || lbl.includes("employer")) answer = "Amazon";
  else if (lbl.includes("years of") || lbl.includes("experience")) answer = "5";
  else if (lbl.includes("current title") || lbl.includes("job title")) answer = "Data Engineer II";
  else if (lbl.includes("github")) answer = "https://github.com/IamJasonBian";
  if (answer) {
    await page.evaluate((name, val) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    }, q.name, answer);
  }
}

// Check checkboxes
await page.evaluate(() => {
  document.querySelectorAll("input[type='checkbox'][name*='answers_attributes']").forEach(cb => { if (!cb.checked) cb.click(); });
});

// Check for any REQUIRED fields that are still empty
const emptyRequired = await page.evaluate(() => {
  const empty = [];
  document.querySelectorAll(".field").forEach(field => {
    const label = field.querySelector("label")?.textContent?.trim() || "";
    const isRequired = label.includes("*") || field.querySelector("[required]");
    if (!isRequired) return;
    const input = field.querySelector("input:not([type='hidden']):not([type='checkbox']), select, textarea");
    if (input && !input.value) {
      empty.push({ label: label.substring(0, 80), name: input.name || input.id, tag: input.tagName, type: input.type || "" });
    }
  });
  return empty;
});
if (emptyRequired.length > 0) {
  console.log("\n   EMPTY REQUIRED FIELDS:");
  for (const f of emptyRequired) {
    console.log(`     - ${f.label} (${f.name}, ${f.tag} ${f.type})`);
  }
}

// Check all selects again after filling
const selectsAfter = await page.evaluate(() => {
  const empty = [];
  document.querySelectorAll("select").forEach(sel => {
    if (!sel.value || sel.value === "") {
      const container = sel.closest(".field") || sel.parentElement;
      const label = container?.querySelector("label")?.textContent?.trim() || "";
      if (label) empty.push({ name: sel.name, id: sel.id, label: label.substring(0, 80) });
    }
  });
  return empty;
});
if (selectsAfter.length > 0) {
  console.log("\n   STILL-EMPTY SELECTS:");
  for (const s of selectsAfter) console.log(`     - ${s.label} (${s.name || s.id})`);
}

// Try reCAPTCHA
console.log("\n   Triggering reCAPTCHA...");
const recaptcha = await page.evaluate(async () => {
  try {
    if (typeof grecaptcha === "undefined" || !JBEN?.Recaptcha?.publicKey) return "no grecaptcha or JBEN";
    const token = await grecaptcha.enterprise.execute(JBEN.Recaptcha.publicKey, { action: "apply_to_job" });
    let input = document.querySelector('input[name="g-recaptcha-enterprise-token"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "g-recaptcha-enterprise-token";
      document.querySelector("#application_form").appendChild(input);
    }
    input.value = token;
    return token ? token.substring(0, 30) + "..." : "empty token";
  } catch (e) { return `error: ${e.message}`; }
});
console.log(`   reCAPTCHA: ${recaptcha}`);

// NOW SUBMIT and watch what happens
console.log("\n   SUBMITTING (watching network)...");
const preSubmitRequests = requests.length;

await page.evaluate(() => {
  document.querySelector("#submit_app").click();
});

// Wait and observe
await new Promise((r) => setTimeout(r, 5000));

const postSubmitRequests = requests.slice(preSubmitRequests);
console.log(`\n   POST requests after submit: ${postSubmitRequests.length}`);
for (const r of postSubmitRequests) {
  console.log(`     ${r.method} ${r.url.substring(0, 100)}`);
}

// Check for errors that appeared
const errorsAfter = await page.evaluate(() => {
  const errors = [];
  // Check field_with_errors
  document.querySelectorAll(".field_with_errors").forEach(f => {
    const label = f.querySelector("label")?.textContent?.trim() || "";
    errors.push({ type: "field_with_errors", label: label.substring(0, 80) });
  });
  // Check for any error messages visible
  document.querySelectorAll("[class*='error'], [class*='invalid'], .help-inline").forEach(el => {
    if (el.offsetParent && el.textContent?.trim()) {
      errors.push({ type: el.className.substring(0, 40), text: el.textContent.trim().substring(0, 100) });
    }
  });
  // Check HTML5 validation
  document.querySelectorAll(":invalid").forEach(el => {
    if (el.tagName !== "FORM") {
      const container = el.closest(".field") || el.parentElement;
      errors.push({ type: "html5_invalid", name: el.name || el.id, label: container?.querySelector("label")?.textContent?.trim()?.substring(0, 80) || "" });
    }
  });
  return errors;
});

if (errorsAfter.length > 0) {
  console.log("\n   ERRORS AFTER SUBMIT:");
  for (const e of errorsAfter) {
    console.log(`     [${e.type}] ${e.label || e.text || e.name}`);
  }
} else {
  console.log("   No visible errors detected");
}

// Check security code visibility
const secCodeVisible = await page.evaluate(() => {
  const field = document.querySelector("#security_code");
  if (!field) return "not found";
  let el = field;
  while (el) {
    const style = getComputedStyle(el);
    if (style.display === "none") return `hidden at ${el.tagName}#${el.id}.${el.className}`;
    el = el.parentElement;
  }
  return "VISIBLE";
});
console.log(`\n   Security code field: ${secCodeVisible}`);

// Take screenshot of just the form section
await page.screenshot({ path: "/tmp/gh_diagnose_full.png", fullPage: true });

// Also take a zoomed screenshot of just the bottom/submit area
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "/tmp/gh_diagnose_bottom.png" });

console.log("\n   Screenshots: /tmp/gh_diagnose_full.png, /tmp/gh_diagnose_bottom.png");

await browser.close();
