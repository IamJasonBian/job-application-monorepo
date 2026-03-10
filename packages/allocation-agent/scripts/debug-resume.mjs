import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto("https://boards.greenhouse.io/embed/job_app?for=point72&token=7829230002", {
  waitUntil: "networkidle2",
  timeout: 30000,
});

// Find all links in resume section
const links = await page.evaluate(() => {
  const fs = document.querySelector("#resume_fieldset");
  if (!fs) return [];
  return Array.from(fs.querySelectorAll("a")).map((a) => ({
    text: a.textContent.trim(),
    href: a.href,
    class: a.className,
    id: a.id,
    dataAction: a.getAttribute("data-action") || "",
  }));
});
console.log("Links in resume section:", JSON.stringify(links, null, 2));

// Check textarea visibility BEFORE clicking
const taBefore = await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
  if (!ta) return { found: false };
  const style = getComputedStyle(ta);
  const parent = ta.closest(".paste-area, .text-area-container, div");
  return {
    found: true,
    display: style.display,
    visibility: style.visibility,
    parentDisplay: parent ? getComputedStyle(parent).display : "?",
    parentClass: parent ? parent.className : "?",
  };
});
console.log("\nTextarea BEFORE click:", JSON.stringify(taBefore, null, 2));

// Click the "enter manually" link
const clicked = await page.evaluate(() => {
  const fs = document.querySelector("#resume_fieldset");
  if (!fs) return "no fieldset";
  const links = fs.querySelectorAll("a");
  for (const a of links) {
    console.log("Link:", a.textContent, a.className);
    if (
      a.textContent.toLowerCase().includes("enter") ||
      a.textContent.toLowerCase().includes("manual") ||
      a.textContent.toLowerCase().includes("paste") ||
      a.textContent.toLowerCase().includes("text")
    ) {
      a.click();
      return `clicked: ${a.textContent.trim()}`;
    }
  }
  return "no matching link found";
});
console.log("\nClick result:", clicked);
await new Promise((r) => setTimeout(r, 1000));

// Check textarea visibility AFTER clicking
const taAfter = await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
  if (!ta) return { found: false };
  const style = getComputedStyle(ta);
  return {
    found: true,
    display: style.display,
    visibility: style.visibility,
    height: ta.offsetHeight,
    width: ta.offsetWidth,
  };
});
console.log("Textarea AFTER click:", JSON.stringify(taAfter, null, 2));

// Set value and verify
await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
  if (ta) {
    ta.value = "Test resume content";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

const taValue = await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
  return ta ? ta.value : "NOT FOUND";
});
console.log("Textarea value set:", taValue);

await page.screenshot({ path: "/tmp/gh_debug_resume.png", fullPage: true });
console.log("Screenshot: /tmp/gh_debug_resume.png");

await browser.close();
