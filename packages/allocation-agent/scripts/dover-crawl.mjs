#!/usr/bin/env node
/**
 * Crawl Dover: visit each company's careers page, scrape rendered job links,
 * then intercept the API responses the React app makes to get full job data.
 *
 * Usage: node scripts/dover-crawl.mjs
 */

import puppeteer from "puppeteer-core";
import { writeFileSync } from "fs";

// Company slugs discovered from web search
const COMPANY_SLUGS = [
  // Wave 1 - original seeds
  "Dots", "chasi", "vial", "coreintels", "playground", "jona", "coverforce",
  "skusafe", "custral", "moda", "Activeloop", "farsight-ai", "wndrco",
  "grid-status", "kestra", "sodalis", "lume", "embercopilot", "attention",
  "joindebbie", "getcrate", "outcess", "vana", "blueridgeglobal",
  "ref-agency", "ergodic", "tikiai", "draftwise", "growthfactor",
  "pontoonglobalsolutions", "scorecodeapply",
  // Wave 2 - from additional searches
  "supademo", "marimo", "mandrel", "unsiloed-ai", "mixrank",
  "garage", "heydrew", "nilos", "goarno", "groveandgrey",
  "grtcorp", "mindfi", "elitetechnical", "ohrsc",
  "slidely", "Deccan%20AI", "school-of-sdr", "cred", "corvus-ai",
  "magnifire", "keye", "3i-infotech",
  // Wave 3 - confirmed on Dover
  "dover", "vanta", "helicone", "humanloop",
  // Wave 4 - from expanded web search
  "bardeen", "conveyor", "vapi", "workos", "together", "Kay.ai",
  "Overview", "corvus-robotics", "medra", "Backbone", "Anomaly",
  "Polygence", "turing-labs", "ease-health", "muralpay", "klarity",
  "juniper", "WorkWhile", "factor", "odyssean-ai", "weaverobotics",
  "digichem", "revpilots", "uma", "xmailo", "hirepluto", "coverd",
  "hellopatient", "reval", "i95dev", "lancey", "eliseai",
  "section4", "Paces", "bubblesortrecruiting", "adtalentinc",
  "salsa", "wake", "fairadify", "kintow", "worksmart",
  "pawprosper", "revwit", "Hue", "cuerpotalent",
];

async function scrapeCompanyJobs(page, slug) {
  const jobs = [];

  // Set up response interceptor to capture API data
  let apiJobs = null;
  const responseHandler = async (res) => {
    const url = res.url();
    if (url.includes("/careers-page/") && url.includes("/jobs")) {
      try {
        const data = await res.json();
        if (data && data.results) {
          apiJobs = data;
        }
      } catch {}
    }
  };
  page.on("response", responseHandler);

  try {
    await page.goto(`https://app.dover.com/jobs/${slug}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for Cloudflare + React render
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      if (!title.includes("moment") && !title.includes("Cloudflare")) break;
    }
    await new Promise((r) => setTimeout(r, 3000));

    // Check if page loaded (not 404)
    const title = await page.title();
    if (title.includes("404") || title.includes("Not Found")) {
      return { jobs: [], companyName: null };
    }

    // Try to get jobs from the intercepted API response
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

    // Fallback: scrape links from rendered DOM
    const scrapedJobs = await page.evaluate((s) => {
      const results = [];
      const links = document.querySelectorAll("a");
      for (const a of links) {
        const href = a.href || "";
        const match = href.match(/\/apply\/[^/]+\/([a-f0-9-]{36})/);
        if (match) {
          results.push({
            jobId: match[1],
            title: a.textContent?.trim()?.substring(0, 120) || "",
            url: href,
          });
        }
      }
      return results;
    }, slug);

    const companyName = title.replace(/ - .*$/, "").replace(/Jobs at /, "").replace(/ Careers/, "").trim();
    for (const j of scrapedJobs) {
      if (j.jobId && j.title) {
        jobs.push({
          company: companyName,
          companySlug: slug,
          jobId: j.jobId,
          title: j.title,
          locations: "",
          url: j.url,
        });
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
    args: [
      "--no-sandbox",
      "--window-size=1200,900",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = { runtime: {} };
  });

  const allJobs = [];

  console.log(`Crawling ${COMPANY_SLUGS.length} Dover company careers pages...\n`);

  for (let i = 0; i < COMPANY_SLUGS.length; i++) {
    const slug = COMPANY_SLUGS[i];
    process.stdout.write(`[${i + 1}/${COMPANY_SLUGS.length}] ${slug}... `);

    const result = await scrapeCompanyJobs(page, slug);

    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else if (result.jobs.length === 0) {
      console.log("no jobs / 404");
    } else {
      console.log(`${result.jobs.length} jobs (${result.companyName})`);
      allJobs.push(...result.jobs);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Total jobs discovered: ${allJobs.length}`);
  console.log(`${"=".repeat(60)}\n`);

  writeFileSync("scripts/dover-jobs.json", JSON.stringify(allJobs, null, 2));
  console.log("Saved to scripts/dover-jobs.json\n");

  const byCompany = {};
  for (const j of allJobs) {
    byCompany[j.company] = (byCompany[j.company] || 0) + 1;
  }
  const sorted = Object.entries(byCompany).sort((a, b) => b[1] - a[1]);
  for (const [co, count] of sorted) {
    console.log(`  ${co}: ${count} jobs`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
