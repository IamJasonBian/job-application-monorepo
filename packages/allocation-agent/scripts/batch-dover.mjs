#!/usr/bin/env node
/**
 * Batch Dover Auto-Apply
 *
 * Reads dover-jobs.json, filters for relevant US tech roles, and applies in batch.
 * Uses headful Chrome with stealth to bypass Cloudflare Turnstile.
 *
 * Usage:
 *   node scripts/batch-dover.mjs                    # apply to all relevant jobs
 *   node scripts/batch-dover.mjs --dry-run           # just list what would be applied
 *   node scripts/batch-dover.mjs --limit 10          # apply to first 10 only
 *
 * Env vars:
 *   REDIS_PASSWORD  - stores results in Redis
 *   RESUME_PATH     - path to resume PDF
 */

import puppeteer from "puppeteer-core";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import Redis from "ioredis";

// ── Config ──

const RESUME_PDF_PATH =
  process.env.RESUME_PATH ||
  resolve(import.meta.dirname, "../.context/attachments/resume_jasonzb_oct10 (2).pdf");

const candidate = {
  firstName: "Jason",
  lastName: "Bian",
  email: "jason.bian64@gmail.com",
  phone: "+1-734-730-6569",
  linkedinUrl: "https://www.linkedin.com/in/jason-bian-7b9027a5/",
};

const DRY_RUN = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

// ── Redis ──

let redisClient = null;

function getRedis() {
  if (redisClient) return redisClient;
  const host = "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com";
  const port = 17054;
  const password = process.env.REDIS_PASSWORD || "";
  if (!password) return null;
  redisClient = new Redis({ host, port, password, connectTimeout: 5000, commandTimeout: 10000, maxRetriesPerRequest: 3 });
  return redisClient;
}

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// ── Filter logic ──

function isRelevantJob(job) {
  const t = job.title.toLowerCase();

  // Include: software, data, ML, platform, infra, backend, fullstack, devops, SRE, quant, etc.
  const includeKeywords = [
    "software", "engineer", "developer", "data", "machine learning", "ml ",
    "backend", "back-end", "full stack", "full-stack", "fullstack",
    "infrastructure", "platform", "devops", "sre", "reliability",
    "quantitative", "quant", "analyst", "scientist", "python", "java",
    "cloud", "systems", "founding",
    "frontend", "front-end", "mobile", "ios", "android",
    "architect", "tech lead", "technical lead", "head of engineering",
    "ai ", "robotics", "automation", "security", "cyber",
    "product engineer", "implementation engineer",
  ];

  // Exclude: intern, recruiter, HR, sales, marketing, design, product manager, clinical, nurse, medical
  const excludeKeywords = [
    "intern", "recruiter", "recruiting", "human resources", "sales",
    "marketing", "design", "product manager", "account manager",
    "account executive", "partnership manager",
    "clinical", "nurse", "medical", "pharmacist", "customer success",
    "customer support", "executive assistant", "office manager",
    "content", "copywriter", "pr ", "public relations",
    "legal", "paralegal", "attorney", "counsel",
    "accountant", "bookkeeper", "controller", "compliance",
    "solutions consultant", "gtm",
  ];

  if (excludeKeywords.some((k) => t.includes(k))) return false;
  if (!includeKeywords.some((k) => t.includes(k))) return false;

  // Exclude non-US locations (check both title and locations field)
  const nonUS = [
    "international", "brazil", "europe", "india", "nigeria",
    "australia", "london", "uk", "berlin", "germany", "toronto",
    "canada", "singapore", "hong kong", "japan", "korea",
    "south africa", "africa", "remote (international",
    "latin america", "latam", "mexico", "philippines",
    "pakistan", "bangladesh", "vietnam",
    "tel aviv", "israel", "dubai", "lithuania", "spain",
    "romania", "portugal", "poland", "armenia",
    "taiwan", "china", "france", "paris", "nantong", "xiamen",
    "guangzhou", "hangzhou", "taipei", "shanghai", "beijing",
    "netherlands", "amsterdam", "ireland", "dublin",
    "sweden", "stockholm", "denmark", "norway", "finland",
    "switzerland", "zurich", "austria", "vienna",
    "czech", "prague", "hungary", "budapest",
    "argentina", "buenos aires", "colombia", "bogota",
    "chile", "santiago", "peru", "lima",
  ];
  const loc = (job.locations || "").toLowerCase();
  if (nonUS.some((k) => t.includes(k) || loc.includes(k))) return false;

  return true;
}

// ── Apply to a single job ──

async function applyToJob(page, job) {
  console.log(`\n━━━ ${job.title.substring(0, 80)} ━━━`);
  console.log(`   Company: ${job.company}`);
  console.log(`   URL: ${job.url}`);

  // Check Redis for existing
  const redis = getRedis();
  if (redis) {
    const existing = await redis.get(`dover_applications:${job.companySlug}:${job.jobId}`);
    if (existing) {
      const data = JSON.parse(existing);
      console.log(`   SKIP: Already applied on ${data.appliedAt}`);
      return "skipped";
    }
  }

  try {
    // Strip any query params for clean navigation
    const cleanUrl = job.url.split("?")[0];
    console.log(`   Clean URL: ${cleanUrl}`);
    await page.goto(cleanUrl, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for Cloudflare
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      if (!title.includes("moment") && !title.includes("Cloudflare")) break;
      if (i === 19) throw new Error("Cloudflare timeout");
    }

    // Wait for form
    const formLoaded = await page.waitForSelector('input[name="firstName"]', { timeout: 15000 }).catch(() => null);
    if (!formLoaded) {
      // Maybe the job is closed
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
      if (bodyText.includes("no longer") || bodyText.includes("closed") || bodyText.includes("404")) {
        console.log("   SKIP: Job no longer available");
        return "skipped";
      }
      throw new Error("Form did not load");
    }

    // Fill fields using React-compatible native setter + synthetic events
    const fieldValues = {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      linkedinUrl: candidate.linkedinUrl,
      phoneNumber: candidate.phone,
    };

    for (const [name, value] of Object.entries(fieldValues)) {
      const input = await page.$(`input[name="${name}"]`);
      if (input) {
        // Focus, clear, and type slowly (works with React controlled inputs)
        await input.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await input.type(value, { delay: 30 });
        // Also trigger blur to finalize validation
        await page.evaluate((n) => {
          const el = document.querySelector(`input[name="${n}"]`);
          if (el) el.dispatchEvent(new Event("blur", { bubbles: true }));
        }, name);
      }
    }
    console.log("   Fields filled");

    // Upload resume
    if (existsSync(RESUME_PDF_PATH)) {
      const fileInput = await page.$('input[type="file"][accept=".pdf"]');
      if (!fileInput) {
        // Some forms have just input[type=file] without accept
        const altFileInput = await page.$('input[type="file"]');
        if (altFileInput) {
          await altFileInput.uploadFile(RESUME_PDF_PATH);
          console.log(`   Resume uploaded (alt selector)`);
        } else {
          console.log("   WARNING: No file input found");
        }
      } else {
        await fileInput.uploadFile(RESUME_PDF_PATH);
        console.log(`   Resume uploaded`);
      }
      // Wait for upload processing
      await new Promise((r) => setTimeout(r, 4000));

      // Verify file was accepted (look for filename in DOM)
      const fileAccepted = await page.evaluate(() => {
        const body = document.body?.innerText || "";
        return body.includes(".pdf") || body.includes("resume");
      });
      if (!fileAccepted) {
        console.log("   WARNING: Resume may not have been accepted");
      }
    } else {
      console.log(`   WARNING: Resume file not found at ${RESUME_PDF_PATH}`);
    }

    // Fill any application-specific custom questions
    const customFieldResults = await page.evaluate(() => {
      const results = [];
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      ).set;

      // Standard field names to skip
      const standardFields = new Set(["firstName", "lastName", "email", "linkedinUrl", "phoneNumber"]);

      // Fill unknown text inputs that are empty
      document.querySelectorAll("input[type=text], input:not([type])").forEach((input) => {
        if (standardFields.has(input.name)) return;
        if (input.type === "hidden" || input.type === "file") return;
        if (input.value) return; // already filled

        // Get the label text for context
        const parent = input.closest(".MuiBox-root");
        const label = parent?.querySelector('[class*="FormLabel"]')?.textContent?.trim() || input.name;

        // Generate an appropriate answer
        let answer = "";
        const l = label.toLowerCase();
        if (l.includes("project") || l.includes("cool")) answer = "Built an automated job application system using Puppeteer, Redis, and serverless functions that processes applications across multiple ATS platforms. Also developed a real-time allocation notification service with SMS alerts.";
        else if (l.includes("website") || l.includes("portfolio") || l.includes("github")) answer = "https://github.com/IamJasonBian";
        else if (l.includes("salary") || l.includes("compensation")) answer = "Open to discussion";
        else if (l.includes("start") || l.includes("available")) answer = "Immediately";
        else if (l.includes("hear") || l.includes("how did") || l.includes("source")) answer = "Company website";
        else if (l.includes("authorized") || l.includes("visa") || l.includes("sponsorship")) answer = "Yes, US work authorized";
        else if (l.includes("experience") || l.includes("years")) answer = "5+ years of professional software engineering experience across full-stack development, data engineering, and ML infrastructure.";
        else answer = "Happy to discuss further in an interview.";

        nativeSetter.call(input, answer);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({ label, answer: answer.substring(0, 50) });
      });

      // Fill unknown textareas that are empty
      document.querySelectorAll("textarea").forEach((ta) => {
        if (ta.value) return;
        const parent = ta.closest(".MuiBox-root");
        const label = parent?.querySelector('[class*="FormLabel"]')?.textContent?.trim() || ta.name;

        let answer = "";
        const l = label.toLowerCase();
        if (l.includes("project") || l.includes("cool") || l.includes("tell us")) answer = "Built an automated job application system using Puppeteer, Redis, and serverless functions. Also led development of real-time data pipelines at Amazon processing millions of events daily using Spark, Kafka, and AWS services.";
        else if (l.includes("why") || l.includes("interest")) answer = "I'm passionate about building high-impact engineering systems and am drawn to your team's mission and technical challenges. My experience in full-stack development, data engineering, and ML infrastructure aligns well with the role.";
        else if (l.includes("cover letter")) answer = "I'm excited to apply for this role. With 5+ years of experience in software engineering at companies like Amazon, I bring deep expertise in building scalable systems, data pipelines, and ML infrastructure. I'm passionate about solving complex technical challenges and would love to contribute to your team.";
        else answer = "Happy to discuss further in an interview.";

        nativeTextareaSetter.call(ta, answer);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({ label, answer: answer.substring(0, 50) });
      });

      // Fill select elements
      document.querySelectorAll("select").forEach((sel) => {
        if (sel.value) return;
        const opts = Array.from(sel.options).filter((o) => o.value);
        if (opts.length > 0) {
          sel.value = opts[0].value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          results.push({ label: sel.name, answer: opts[0].textContent?.trim() });
        }
      });

      // Handle radio button groups
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"]').forEach((radio) => {
        const name = radio.name;
        if (!name) return;
        if (!radioGroups[name]) radioGroups[name] = [];
        radioGroups[name].push(radio);
      });
      for (const [name, radios] of Object.entries(radioGroups)) {
        // Skip if already selected
        if (radios.some((r) => r.checked)) continue;

        // Get the question label for context
        const parent = radios[0].closest(".MuiBox-root") || radios[0].parentElement?.parentElement;
        const label = parent?.querySelector('[class*="FormLabel"]')?.textContent?.trim() || name;
        const l = label.toLowerCase();

        // Pick the best answer based on context
        let bestIdx = -1;
        const labels = radios.map((r) => {
          const lbl = r.parentElement?.textContent?.trim()?.toLowerCase() || r.value?.toLowerCase() || "";
          return lbl;
        });

        if (l.includes("gender") || l.includes("identity")) {
          // Prefer "decline" or "prefer not" or last option
          bestIdx = labels.findIndex((lb) => lb.includes("decline") || lb.includes("prefer not") || lb.includes("not to"));
          if (bestIdx === -1) bestIdx = labels.length - 1;
        } else if (l.includes("authorized") || l.includes("legally") || l.includes("eligible") || l.includes("work in")) {
          bestIdx = labels.findIndex((lb) => lb.includes("yes"));
          if (bestIdx === -1) bestIdx = 0;
        } else if (l.includes("sponsor")) {
          bestIdx = labels.findIndex((lb) => lb.includes("no") || lb.includes("not"));
          if (bestIdx === -1) bestIdx = 0;
        } else if (l.includes("veteran") || l.includes("disability") || l.includes("race") || l.includes("ethnicity")) {
          bestIdx = labels.findIndex((lb) => lb.includes("decline") || lb.includes("prefer not") || lb.includes("not to"));
          if (bestIdx === -1) bestIdx = labels.length - 1;
        } else {
          bestIdx = 0;
        }

        if (bestIdx >= 0 && bestIdx < radios.length) {
          radios[bestIdx].click();
          results.push({ label, answer: `Radio: ${labels[bestIdx]?.substring(0, 40)}` });
        }
      }

      // Handle checkbox groups (e.g., "Select all that apply")
      document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        // Only check if it seems required and unchecked
        if (cb.checked) return;
        const parent = cb.closest(".MuiBox-root") || cb.parentElement;
        const label = parent?.textContent?.trim()?.toLowerCase() || "";
        if (label.includes("agree") || label.includes("consent") || label.includes("acknowledge")) {
          cb.click();
          results.push({ label: label.substring(0, 50), answer: "Checkbox: checked" });
        }
      });

      return results;
    });

    if (customFieldResults.length > 0) {
      for (const f of customFieldResults) {
        console.log(`   Custom Q: ${f.label.substring(0, 50)} → ${f.answer}`);
      }
    }

    await new Promise((r) => setTimeout(r, 1000));

    // Log current field values for debugging
    const fieldState = await page.evaluate(() => {
      const fields = {};
      document.querySelectorAll("input:not([type=hidden]):not([type=file])").forEach((el) => {
        if (el.name) fields[el.name] = el.value || "(empty)";
      });
      return fields;
    });
    console.log("   Field state:", JSON.stringify(fieldState));

    // Submit
    const submitClicked = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!submitClicked) throw new Error("Submit button not found");

    // Wait for result
    await new Promise((r) => setTimeout(r, 5000));

    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || "").catch(() => "");
    const currentUrl = page.url();

    let status = "UNKNOWN";
    let message = "";

    if (
      bodyText.toLowerCase().includes("thank") ||
      bodyText.toLowerCase().includes("received") ||
      bodyText.toLowerCase().includes("submitted") ||
      bodyText.toLowerCase().includes("application has been") ||
      currentUrl.includes("success") ||
      currentUrl.includes("thank")
    ) {
      status = "PASS";
      message = "Application submitted";
    } else if (bodyText.toLowerCase().includes("error") || bodyText.toLowerCase().includes("failed")) {
      status = "FAIL";
      message = bodyText.substring(0, 150);
    } else {
      // Check for validation errors - get full context
      const errors = await page.evaluate(() => {
        const errs = document.querySelectorAll('[class*="error"], [class*="Error"], .Mui-error');
        return Array.from(errs).map((e) => {
          // Get the parent form label for context
          const parent = e.closest('.MuiBox-root') || e.parentElement;
          const label = parent?.querySelector('[class*="FormLabel"]')?.textContent?.trim() || "";
          return `${label}: ${e.textContent?.trim()}`;
        }).filter(Boolean).slice(0, 10);
      });
      if (errors.length > 0) {
        status = "FAIL";
        message = `Validation: ${errors.join(", ")}`;
      } else {
        status = "PASS";
        message = "Submitted (no errors detected)";
      }
    }

    console.log(`   Result: ${status} — ${message}`);

    // Store in Redis
    if (redis) {
      const key = `dover_applications:${job.companySlug}:${job.jobId}`;
      await redis.set(
        key,
        JSON.stringify({
          company: job.company,
          companySlug: job.companySlug,
          jobId: job.jobId,
          jobTitle: job.title,
          appliedAt: new Date().toISOString(),
          status,
          message,
        })
      );
      await redis.expire(key, 60 * 60 * 24 * 90);
    }

    return status === "PASS" ? "pass" : "fail";
  } catch (err) {
    console.log(`   ERROR: ${err.message}`);

    if (redis) {
      const key = `dover_applications:${job.companySlug}:${job.jobId}`;
      await redis.set(
        key,
        JSON.stringify({
          company: job.company,
          companySlug: job.companySlug,
          jobId: job.jobId,
          jobTitle: job.title,
          appliedAt: new Date().toISOString(),
          status: "ERROR",
          message: err.message,
        })
      );
      await redis.expire(key, 60 * 60 * 24 * 90);
    }

    return "error";
  }
}

// ── Main ──

async function main() {
  // Load jobs
  const jobsPath = resolve(import.meta.dirname, "dover-jobs.json");
  if (!existsSync(jobsPath)) {
    console.error("Run dover-crawl.mjs first to discover jobs");
    process.exit(1);
  }

  const allJobs = JSON.parse(readFileSync(jobsPath, "utf-8"));
  console.log(`Total jobs in dover-jobs.json: ${allJobs.length}`);

  // Filter for relevant roles
  const relevant = allJobs.filter(isRelevantJob);
  console.log(`Relevant US tech jobs: ${relevant.length}`);

  // Apply limit
  const toApply = relevant.slice(0, LIMIT);
  console.log(`Will apply to: ${toApply.length} jobs\n`);

  if (DRY_RUN) {
    for (const j of toApply) {
      console.log(`  ${j.company.padEnd(25)} ${j.title.substring(0, 70)}`);
    }
    console.log(`\nDry run complete. Use without --dry-run to apply.`);
    return;
  }

  // Launch browser
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

  const results = { pass: 0, fail: 0, skip: 0, error: 0 };

  for (let i = 0; i < toApply.length; i++) {
    const job = toApply[i];
    console.log(`\n[${i + 1}/${toApply.length}]`);
    const result = await applyToJob(page, job);
    results[result === "pass" ? "pass" : result === "skipped" ? "skip" : result === "fail" ? "fail" : "error"]++;

    // Pause between applications
    if (i < toApply.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${results.pass} PASS, ${results.fail} FAIL, ${results.skip} SKIP, ${results.error} ERROR`);
  console.log(`${"=".repeat(60)}`);

  await browser.close();
  await disconnectRedis();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
