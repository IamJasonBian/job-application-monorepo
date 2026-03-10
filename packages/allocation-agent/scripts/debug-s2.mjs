#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://boards.greenhouse.io/embed/job_app?for=imc&token=4439297101", { waitUntil: "networkidle2", timeout: 30000 });

// 1. Check Select2 version and structure
const s2Info = await page.evaluate(() => {
  const results = {
    jQueryVersion: typeof jQuery !== "undefined" ? jQuery.fn.jquery : "no jQuery",
    select2Version: typeof jQuery !== "undefined" && jQuery.fn.select2 ? (jQuery.fn.select2.defaults?.locale || "v3?") : "no select2",
    s2Containers: [],
  };
  document.querySelectorAll("[id^='s2id_']").forEach(el => {
    const children = Array.from(el.children).map(c => `${c.tagName}.${c.className.substring(0, 30)}`);
    results.s2Containers.push({
      id: el.id,
      tag: el.tagName,
      className: el.className.substring(0, 50),
      children,
      innerHTML: el.innerHTML.substring(0, 200),
    });
  });
  return results;
});
console.log("Select2 info:", JSON.stringify(s2Info, null, 2));

// 2. Try the first answer select (How did you hear about us?)
const selectId = "job_application_answers_attributes_0_answer_selected_options_attributes_0_question_option_id";
const s2ContainerId = `s2id_${selectId}`;

console.log("\n--- Testing Select2 interaction on first answer select ---");

// Check the container structure
const containerInfo = await page.evaluate((id) => {
  const container = document.querySelector(`#${id}`);
  if (!container) return "NOT FOUND";
  return {
    exists: true,
    tag: container.tagName,
    className: container.className,
    childrenHTML: container.innerHTML.substring(0, 300),
    hasChoiceLink: !!container.querySelector("a.select2-choice"),
    hasChoicesDiv: !!container.querySelector(".select2-choices"),
  };
}, s2ContainerId);
console.log("Container:", JSON.stringify(containerInfo, null, 2));

// Try clicking the container
console.log("\nClicking container...");
await page.evaluate((id) => {
  const container = document.querySelector(`#${id}`);
  const anchor = container.querySelector("a.select2-choice") || container.querySelector("a") || container;
  console.log("Clicking:", anchor.tagName, anchor.className);
  anchor.click();
}, s2ContainerId);
await new Promise(r => setTimeout(r, 500));

// Check if dropdown appeared
const dropdownInfo = await page.evaluate(() => {
  const drops = document.querySelectorAll(".select2-drop");
  const results = [];
  for (const d of drops) {
    results.push({
      id: d.id,
      className: d.className.substring(0, 60),
      display: getComputedStyle(d).display,
      visibility: getComputedStyle(d).visibility,
      hasResults: !!d.querySelector(".select2-results"),
      resultsCount: d.querySelectorAll(".select2-results li").length,
      resultsText: Array.from(d.querySelectorAll(".select2-results li")).map(li => li.textContent.trim()).slice(0, 5),
    });
  }
  return results;
});
console.log("Dropdowns after click:", JSON.stringify(dropdownInfo, null, 2));

// Try jQuery approach
console.log("\nTrying jQuery Select2 API...");
const jqueryResult = await page.evaluate((selId) => {
  try {
    if (!window.jQuery) return "no jQuery";
    const $sel = jQuery(`#${selId}`);
    if (!$sel.length) return "select not found";

    // Get options
    const opts = Array.from($sel[0].options).map(o => ({ value: o.value, text: o.textContent.trim() }));

    // Try select2 val
    try {
      $sel.select2("val", opts[1]?.value); // Pick first real option
      return { method: "select2_val", value: $sel.val(), text: opts[1]?.text, success: true };
    } catch(e1) {
      // Try val + trigger
      try {
        $sel.val(opts[1]?.value).trigger("change");
        return { method: "val_trigger", value: $sel.val(), text: opts[1]?.text, success: true };
      } catch(e2) {
        return { error1: e1.message, error2: e2.message };
      }
    }
  } catch(e) {
    return { error: e.message };
  }
}, selectId);
console.log("jQuery result:", JSON.stringify(jqueryResult, null, 2));

// Check the value after jQuery approach
const afterVal = await page.evaluate((selId) => {
  const sel = document.querySelector(`#${selId}`);
  return { value: sel?.value, display: document.querySelector(`#s2id_${selId} .select2-chosen`)?.textContent?.trim() };
}, selectId);
console.log("After jQuery:", JSON.stringify(afterVal));

// 3. Now test school Select2
console.log("\n--- Testing School Select2 ---");
const schoolInfo = await page.evaluate(() => {
  const container = document.querySelector("#s2id_education_school_name_0");
  if (!container) return "NOT FOUND";
  return {
    tag: container.tagName,
    className: container.className,
    innerHTML: container.innerHTML.substring(0, 200),
    hasChoice: !!container.querySelector("a.select2-choice"),
    hiddenInputVal: document.querySelector("#education_school_name_0")?.value,
  };
});
console.log("School container:", JSON.stringify(schoolInfo, null, 2));

// Click school Select2
await page.evaluate(() => {
  const container = document.querySelector("#s2id_education_school_name_0");
  const anchor = container.querySelector("a.select2-choice") || container;
  anchor.click();
});
await new Promise(r => setTimeout(r, 500));

// Type into school search
const searchInput = await page.$(".select2-drop-active .select2-input");
if (searchInput) {
  console.log("School search input found, typing...");
  await searchInput.type("University of Michigan", { delay: 30 });
  await new Promise(r => setTimeout(r, 2500));

  const schoolResults = await page.evaluate(() => {
    const items = document.querySelectorAll(".select2-drop-active .select2-results li");
    return Array.from(items).map(li => ({
      text: li.textContent.trim().substring(0, 60),
      className: li.className,
      id: li.id,
    }));
  });
  console.log("School results:", JSON.stringify(schoolResults, null, 2));

  // Try mouseup
  if (schoolResults.length > 0) {
    const clickResult = await page.evaluate(() => {
      const li = document.querySelector(".select2-drop-active .select2-results li");
      if (!li) return "no li";
      // Try mouseup (Select2 v3)
      li.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return "mouseup dispatched on: " + li.textContent.trim().substring(0, 40);
    });
    console.log("Click result:", clickResult);
    await new Promise(r => setTimeout(r, 500));

    const schoolVal = await page.evaluate(() => ({
      hiddenVal: document.querySelector("#education_school_name_0")?.value,
      hiddenVal2: document.querySelector("#education_school_name")?.value,
      displayText: document.querySelector("#s2id_education_school_name_0 .select2-chosen")?.textContent?.trim(),
    }));
    console.log("After school mouseup:", JSON.stringify(schoolVal));
  }
} else {
  console.log("No search input found!");
}

await browser.close();
