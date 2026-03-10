#!/usr/bin/env node
/**
 * Crawl Dover Wave 5 companies, append to dover-jobs.json
 */

import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const WAVE5_SLUGS = [
  // Tech/AI companies (most promising for engineering roles)
  "roboflow", "regal-io", "cosine", "gushwork", "getjerry", "goldcast",
  "brellium", "geolava", "logiwa", "parade", "Elsewhere", "thatch",
  "greensky-games", "Netchex", "Savvy%20Wealth", "Long%20Angle",
  "Pila%20Energy", "WerQ%20AI", "Gigwell", "Loop%20AI", "move%20ai",
  "Pearmill", "playflowcloud", "Jina%20AI", "Aware",
  // Other companies
  "supersub", "connections-outsourcing", "poised", "archive-resale",
  "nuvocargo", "espark-learning", "invoice-simple", "alljoined",
  "spherepay", "numero", "renn-labs", "reunion", "joinsunfish",
  "turno", "cooperdynetech", "Scratch", "qvell",
  "onlineteammember", "kultremedia", "tb",
];

async function scrapeCompanyJobs(page, slug) {
  const jobs = [];
  let apiJobs = null;
  const responseHandler = async (res) => {
    const url = res.url();
    if (url.includes("/careers-page/") && url.includes("/jobs")) {
      try {
        const data = await res.json();
        if (data && data.results) apiJobs = data;
      } catch {}
    }
  };
  page.on("response", responseHandler);

  try {
    await page.goto(`https://app.dover.com/jobs/${slug}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      if (!title.includes("moment") && !title.includes("Cloudflare")) break;
    }
    await new Promise((r) => setTimeout(r, 3000));

    const title = await page.title();
    if (title.includes("404") || title.includes("Not Found")) {
      return { jobs: [], companyName: null };
    }

    if (apiJobs && apiJobs.results) {
      const companyName = title.replace(/ - .*$/, "").replace(/Jobs at /, "").replace(/ Careers/, "").trim();
      for (const j of apiJobs.results) {
        if (j.is_published) {
          jobs.push({
            company: companyName,
            companySlug: slug,
            jobId: j.id,
            title: j.title,
            locations: (j.locations || []).map((l) => l.name).join(", "),
            url: `https://app.dover.com/apply/${slug}/${j.id}`,
          });
        }
      }
      return { jobs, companyName };
    }

    // Fallback: scrape links from DOM
    const scrapedJobs = await page.evaluate(() => {
      const results = [];
      for (const a of document.querySelectorAll("a")) {
        const href = a.href || "";
        const match = href.match(/\/apply\/[^/]+\/([a-f0-9-]{36})/);
        if (match) {
          results.push({ jobId: match[1], title: a.textContent?.trim()?.substring(0, 120) || "", url: href });
        }
      }
      return results;
    });

    const companyName = title.replace(/ - .*$/, "").replace(/Jobs at /, "").replace(/ Careers/, "").trim();
    for (const j of scrapedJobs) {
      if (j.jobId && j.title) {
        jobs.push({ company: companyName, companySlug: slug, jobId: j.jobId, title: j.title, locations: "", url: j.url });
      }
    }
    return { jobs, companyName };
  } catch (err) {
    return { jobs: [], companyName: null, error: err.message };
  } finally {
    page.off("response", responseHandler);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: ["--no-sandbox", "--window-size=1200,900", "--disable-blink-features=AutomationControlled"],
    defaultViewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
  });

  const newJobs = [];
  console.log(`Crawling ${WAVE5_SLUGS.length} Wave 5 Dover companies...\n`);

  for (let i = 0; i < WAVE5_SLUGS.length; i++) {
    const slug = WAVE5_SLUGS[i];
    process.stdout.write(`[${i + 1}/${WAVE5_SLUGS.length}] ${slug}... `);
    const result = await scrapeCompanyJobs(page, slug);
    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else if (result.jobs.length === 0) {
      console.log("no jobs / 404");
    } else {
      console.log(`${result.jobs.length} jobs (${result.companyName})`);
      newJobs.push(...result.jobs);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Load existing jobs and append
  const jobsPath = resolve(import.meta.dirname, "dover-jobs.json");
  const existing = JSON.parse(readFileSync(jobsPath, "utf-8"));
  const existingIds = new Set(existing.map((j) => j.jobId));
  const deduped = newJobs.filter((j) => !existingIds.has(j.jobId));
  const combined = [...existing, ...deduped];

  writeFileSync(jobsPath, JSON.stringify(combined, null, 2));
  console.log(`\n${"=".repeat(60)}`);
  console.log(`New jobs found: ${newJobs.length} (${deduped.length} unique)`);
  console.log(`Total jobs in file: ${combined.length}`);
  console.log(`${"=".repeat(60)}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
