#!/usr/bin/env node
import puppeteer from "puppeteer-core";

const token = process.argv[2] || "point72";
const jobId = process.argv[3] || "8303740002";

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

// Inspect everything around the school field
const schoolInfo = await page.evaluate(() => {
  const hidden = document.querySelector("#education_school_name_0");
  if (!hidden) return { found: false };

  // Walk up to find the field container
  let container = hidden.parentElement;
  for (let i = 0; i < 5 && container; i++) {
    if (container.classList.contains("field") || container.id?.includes("education")) break;
    container = container.parentElement;
  }

  // Get all elements in the container
  const elements = container ? Array.from(container.querySelectorAll("*")).map(el => ({
    tag: el.tagName,
    id: el.id,
    className: el.className,
    type: el.type || "",
    name: el.name || "",
    role: el.getAttribute("role") || "",
    placeholder: el.placeholder || "",
    contentEditable: el.contentEditable,
    visible: el.offsetParent !== null || el.offsetWidth > 0,
    text: el.textContent?.trim().substring(0, 50),
  })).filter(e => e.visible || e.id || e.role || e.name) : [];

  return {
    found: true,
    containerTag: container?.tagName,
    containerId: container?.id,
    containerClass: container?.className,
    containerHTML: container?.innerHTML?.substring(0, 2000),
    elements,
  };
});

console.log(JSON.stringify(schoolInfo, null, 2));
await browser.close();
