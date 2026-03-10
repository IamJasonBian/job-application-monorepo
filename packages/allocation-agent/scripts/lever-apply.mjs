#!/usr/bin/env node

/**
 * Lever Auto-Apply (Headful with hCaptcha)
 *
 * Lever forms use hCaptcha (invisible mode). In headful Chrome, hCaptcha often
 * auto-solves for real browser sessions. If a challenge appears, pause for manual solve.
 *
 * Usage:
 *   node scripts/lever-apply.mjs <company> [postingId]
 *   node scripts/lever-apply.mjs voleon           # apply to all relevant Voleon jobs
 *   node scripts/lever-apply.mjs voleon <id>       # apply to a single job
 *
 * Env vars:
 *   REDIS_PASSWORD (optional - stores results in Redis)
 *   SLACK_WEBHOOK_URL (optional - alerts on unhandled fields)
 */

import puppeteer from "puppeteer-core";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import Redis from "ioredis";

// ── Config ──

const company = process.argv[2] || "voleon";
const singlePostingId = process.argv[3] || null;
const RESUME_PDF_PATH = process.env.RESUME_PATH || resolve(import.meta.dirname, "../.context/attachments/resume_jasonzb_oct10 (2).pdf");

const candidate = {
  name: "Jason Bian",
  email: "jason.bian64@gmail.com",
  phone: "+1-734-730-6569",
  location: "New York, NY",
  org: "Amazon",
  urls: {
    LinkedIn: "https://www.linkedin.com/in/jason-bian-7b9027a5/",
    GitHub: "https://github.com/IamJasonBian",
  },
};

// ── Redis ──

let redisClient = null;

function getRedis() {
  if (redisClient) return redisClient;
  const host = process.env.REDIS_HOST || "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com";
  const port = parseInt(process.env.REDIS_PORT || "17054", 10);
  const password = process.env.REDIS_PASSWORD || "";
  if (!password) {
    console.log("   No REDIS_PASSWORD set, skipping Redis storage");
    return null;
  }
  redisClient = new Redis({ host, port, password, connectTimeout: 5000, commandTimeout: 10000, maxRetriesPerRequest: 3 });
  return redisClient;
}

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

async function storeResultInRedis(company, postingId, jobTitle, result) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = `lever_applications:${company}:${postingId}`;
    const record = {
      company,
      postingId,
      jobTitle,
      appliedAt: new Date().toISOString(),
      ...result,
    };
    await redis.set(key, JSON.stringify(record));
    await redis.expire(key, 60 * 60 * 24 * 90);
    await redis.zadd("lever_applications:index", Date.now(), `${company}:${postingId}`);
    console.log(`   Redis: stored ${key}`);
  } catch (err) {
    console.error(`   Redis error: ${err.message}`);
  }
}

// ── Slack ──

async function sendSlackAlert(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch {}
}

// ── Answer helpers ──

function getCardAnswer(questionText) {
  const t = questionText.toLowerCase();
  if (t.includes("authorized to work") || t.includes("legally authorized")) return "Yes";
  if (t.includes("sponsorship") || t.includes("sponsor a visa") || t.includes("require.*visa")) return "No";
  if (t.includes("non-compete") || t.includes("notice period")) return "No";
  if (t.includes("18 years") || t.includes("of age")) return "Yes";
  if (t.includes("consent") || t.includes("agree") || t.includes("acknowledge")) return "Yes";
  return null;
}

function getCardTextAnswer(questionText) {
  const t = questionText.toLowerCase();
  if (t.includes("detail") || t.includes("explain") || t.includes("more info")) return "";
  if (t.includes("salary") || t.includes("compensation")) return "Open to discussion";
  if (t.includes("start date") || t.includes("available to start")) return "Immediately";
  if (t.includes("how did you hear") || t.includes("referral")) return "Company website";
  if (t.includes("years of experience")) return "5";
  if (t.includes("programming language")) return "Python, Java, SQL, Spark, Scala, TypeScript, C++, R";
  if (t.includes("visa status")) return "N/A - US work authorized";
  return "";
}

// ── Lever job fetcher ──

async function fetchLeverJobs(company) {
  const res = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json`);
  if (!res.ok) throw new Error(`Lever API ${res.status}`);
  return res.json();
}

function isRelevantJob(job) {
  const t = (job.text || "").toLowerCase();
  const team = (job.categories?.team || "").toLowerCase();
  // Include data/eng/quant/ML/infra roles
  const keywords = ["data", "engineer", "software", "quant", "developer", "analyst", "machine learning", "infrastructure", "reliability", "sre"];
  // Exclude recruiting, HR, finance ops, compliance, admin
  const excludeKeywords = ["recruiter", "recruiting", "human resources", "executive assistant", "compliance", "treasury", "fp&a"];
  if (excludeKeywords.some(k => t.includes(k) || team.includes(k))) return false;
  return keywords.some(k => t.includes(k) || team.includes(k));
}

// ── Apply to a single Lever posting ──

async function applyToPosting(browser, company, posting) {
  const { id, text: jobTitle, categories } = posting;
  const location = categories?.location || "Unknown";
  const team = categories?.team || "";
  const applyUrl = `https://jobs.lever.co/${company}/${id}/apply`;

  console.log(`\n━━━ ${jobTitle} (${location}) ━━━`);
  console.log(`   Team: ${team}`);
  console.log(`   URL: ${applyUrl}`);

  // Check if already applied (Redis)
  const redis = getRedis();
  if (redis) {
    const existing = await redis.get(`lever_applications:${company}:${id}`);
    if (existing) {
      const data = JSON.parse(existing);
      console.log(`   SKIP: Already applied on ${data.appliedAt}`);
      return { status: "skipped", reason: "already_applied" };
    }
  }

  const page = await browser.newPage();
  try {
    // Stealth: remove webdriver flag before any page JS runs
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Remove automation-related properties
      delete navigator.__proto__.webdriver;
      // Override chrome.runtime to look like a normal Chrome extension
      window.chrome = { runtime: {} };
    });

    await page.goto(applyUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Check page loaded correctly
    const pageTitle = await page.title();
    if (pageTitle.includes("404") || pageTitle.includes("Not Found")) {
      console.log("   SKIP: Job posting not found (404)");
      return { status: "skipped", reason: "not_found" };
    }

    // 1) Focus location input to trigger hCaptcha invisible execution early
    const locationInput = await page.$('#location-input');
    if (locationInput) {
      await locationInput.focus();
      await new Promise(r => setTimeout(r, 500));
    }

    // 2) Upload resume FIRST — Lever POSTs to /parseResume (takes 4-8s)
    //    which auto-fills name/email/phone/location from parsed resume.
    //    We fill basic fields AFTER to override any incorrect parsed values.
    let resumeUploaded = false;
    if (!process.env.SKIP_RESUME && existsSync(RESUME_PDF_PATH)) {
      const fileInput = await page.$("#resume-upload-input");
      if (fileInput) {
        await fileInput.uploadFile(RESUME_PDF_PATH);
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const storageId = await page.evaluate(() => {
            return document.querySelector('[name="resumeStorageId"]')?.value || "";
          });
          if (storageId) {
            resumeUploaded = true;
            console.log(`   Resume uploaded & parsed (storageId: ${storageId.substring(0, 12)}...)`);
            break;
          }
        }
        if (!resumeUploaded) console.log("   Resume upload/parse timed out (20s)");
      }
    }
    if (!resumeUploaded) {
      console.log("   WARNING: No resume uploaded");
    }

    // 3) Fill basic fields — clear and set to override any parsed values
    await page.evaluate((c) => {
      const fields = { name: c.name, email: c.email, phone: c.phone };
      for (const [name, val] of Object.entries(fields)) {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      const locInput = document.getElementById("location-input");
      if (locInput) {
        locInput.value = c.location;
        locInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, candidate);
    console.log("   Basic info filled");

    // Fill org
    await page.evaluate(() => { const el = document.querySelector('[name="org"]'); if (el) el.value = ""; });
    const orgInput = await page.$('[name="org"]');
    if (orgInput) await orgInput.type(candidate.org, { delay: 30 });

    // Fill URLs
    for (const [label, url] of Object.entries(candidate.urls)) {
      await page.evaluate((l) => { const el = document.querySelector(`[name="urls[${l}]"]`); if (el) el.value = ""; }, label);
      const urlInput = await page.$(`[name="urls[${label}]"]`);
      if (urlInput) await urlInput.type(url, { delay: 20 });
    }
    console.log("   URLs + org filled");

    // Fill opportunity location dropdown if present
    const hasOpportunityLocation = await page.$('select[name="opportunityLocationId"]');
    if (hasOpportunityLocation) {
      const locationSet = await page.evaluate(() => {
        const sel = document.querySelector('select[name="opportunityLocationId"]');
        if (!sel) return null;
        const opts = Array.from(sel.options).filter(o => o.value);
        // Prefer New York, then Remote, then first option
        let pick = opts.find(o => o.textContent.toLowerCase().includes("new york"));
        if (!pick) pick = opts.find(o => o.textContent.toLowerCase().includes("remote"));
        if (!pick && opts.length > 0) pick = opts[0];
        if (pick) {
          sel.value = pick.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return pick.textContent.trim();
        }
        return null;
      });
      if (locationSet) console.log(`   Opportunity location: ${locationSet}`);
    }

    // Fill card questions (custom questions embedded in form)
    const cardResults = await page.evaluate(() => {
      const results = [];

      // Helper: get radio answer for a question
      function getRadioAnswer(t) {
        t = t.toLowerCase();
        if (t.includes("authorized to work") || t.includes("legally authorized") || t.includes("lawfully authorized")) return "Yes";
        if (t.includes("sponsorship") || t.includes("sponsor a visa") || (t.includes("require") && t.includes("visa")) || t.includes("need sponsorship")) return "No";
        if (t.includes("non-compete") || t.includes("notice period")) return "No";
        if (t.includes("18 years") || t.includes("of age")) return "Yes";
        if (t.includes("consent") || t.includes("agree") || t.includes("acknowledge")) return "Yes";
        if (t.includes("able to work out of the office") || t.includes("willing to relocat") || t.includes("able to perform")) return "Yes";
        if (t.includes("ever interviewed") || t.includes("previously applied") || t.includes("have you ever worked")) return "No";
        if (t.includes("currently employed")) return "Yes";
        if (t.includes("finra") || t.includes("registration") || t.includes("hold any")) return "No";
        if (t.includes("convicted") || t.includes("criminal") || t.includes("felony") || t.includes("misdemeanor")) return "No";
        if (t.includes("investigation") || t.includes("disciplinary") || t.includes("civil action")) return "No";
        if (t.includes("how did you learn") || t.includes("how did you hear") || t.includes("how did you find")) {
          // Look for "Online/Website" option, fallback to "Other"
          return null; // handled separately below
        }
        if (t.includes("type of employment") || t.includes("employment desired")) return "Full-time";
        if (t.includes("school year") || t.includes("current year")) return null; // skip university questions
        return "Yes"; // default
      }

      // Helper: get text answer for a question
      function getTextAnswer(t) {
        t = t.toLowerCase();
        if (t.includes("street address")) return "123 Main Street";
        if (t.includes("city") && !t.includes("new york")) return "New York";
        if (t.includes("state") && t.length < 40) return "NY";
        if (t.includes("zip code") || t.includes("postal code")) return "10001";
        if (t.includes("salary") || t.includes("compensation")) return "Open to discussion";
        if (t.includes("available to begin") || t.includes("start date") || t.includes("available to start") || t.includes("earliest start")) return "Immediately";
        if (t.includes("years of experience") || t.includes("how many years")) return "5";
        if (t.includes("graduation date")) return "04/2020";
        if (t.includes("sponsorship") && (t.includes("type") || t.includes("what"))) return "N/A - US citizen/permanent resident";
        // Conditional "if yes/no" text fields: provide N/A
        if (t.includes("if yes") || t.includes("if no") || t.includes("please provide detail") || t.includes("please explain") || t.includes("please list")) return "N/A";
        if (t.includes("if other")) return "Company website";
        return "";
      }

      // Parse card definitions from hidden baseTemplate inputs
      const baseTemplates = document.querySelectorAll('input[name*="baseTemplate"]');
      const cardDefs = [];
      baseTemplates.forEach(bt => {
        try {
          const data = JSON.parse(bt.value);
          cardDefs.push(data);
        } catch {}
      });

      for (const cardDef of cardDefs) {
        const cardId = cardDef.id;
        if (!cardDef.fields) continue;

        cardDef.fields.forEach((field, idx) => {
          const fieldName = `cards[${cardId}][field${idx}]`;
          const questionText = field.text || "";
          const t = questionText.toLowerCase();

          if (field.type === "multiple-choice") {
            const radios = document.querySelectorAll(`input[type="radio"][name="${fieldName}"]`);
            if (radios.length === 0) return;

            let answer = getRadioAnswer(questionText);

            // Special handling for "how did you learn/hear" — pick best option
            if (answer === null && (t.includes("how did you learn") || t.includes("how did you hear"))) {
              const radioValues = Array.from(radios).map(r => r.value.toLowerCase());
              if (radioValues.includes("online")) answer = "Online";
              else if (radioValues.some(v => v.includes("website"))) answer = Array.from(radios).find(r => r.value.toLowerCase().includes("website")).value;
              else if (radioValues.some(v => v.includes("other"))) answer = Array.from(radios).find(r => r.value.toLowerCase().includes("other")).value;
              else answer = Array.from(radios)[0]?.value || "Yes";
            }

            if (answer === null) return; // skip unknown questions

            // Case-insensitive match for radio values
            const answerLower = answer.toLowerCase();
            for (const radio of radios) {
              if (radio.value === answer || radio.value.toLowerCase() === answerLower) {
                radio.click();
                results.push({ question: questionText, answer: radio.value, type: "radio" });
                break;
              }
            }
          } else if (field.type === "textarea" || field.type === "text") {
            // Try both textarea and input elements
            let el = document.querySelector(`textarea[name="${fieldName}"]`);
            if (!el) el = document.querySelector(`input[name="${fieldName}"]`);
            if (!el) el = document.querySelector(`input[type="text"][name="${fieldName}"]`);
            if (!el || el.value) return;

            const answer = getTextAnswer(questionText);
            if (answer) {
              el.value = answer;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              results.push({ question: questionText, answer, type: el.tagName === "TEXTAREA" ? "textarea" : "text" });
            }
          } else if (field.type === "dropdown") {
            const select = document.querySelector(`select[name="${fieldName}"]`);
            if (!select || select.value) return;
            const opts = Array.from(select.options).filter(o => o.value);
            if (opts.length > 0) {
              select.value = opts[0].value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              results.push({ question: questionText, answer: opts[0].textContent.trim(), type: "dropdown" });
            }
          }
        });
      }

      return results;
    });

    for (const r of cardResults) {
      console.log(`   Q(${r.type.padEnd(8)}): ${r.question.substring(0, 50).padEnd(50)} -> ${r.answer}`);
    }

    // Check for unfilled REQUIRED fields only
    const unhandledFields = await page.evaluate(() => {
      const unhandled = [];
      document.querySelectorAll('.application-question').forEach(q => {
        const label = q.querySelector('.application-label')?.textContent?.trim() || "";
        const isRequired = !!q.querySelector('.required, .consent-required');
        if (!isRequired) return; // skip optional fields
        const inputs = q.querySelectorAll('input:not([type="hidden"]):not([type="file"]), select, textarea');
        for (const input of inputs) {
          // Skip URL fields (optional by nature)
          if (input.name?.startsWith("urls[")) continue;
          if (input.type === "radio" && !document.querySelector(`input[name="${input.name}"]:checked`)) {
            unhandled.push({ label, type: "radio", name: input.name });
            break;
          }
          if ((input.tagName === "SELECT" || input.tagName === "INPUT" || input.tagName === "TEXTAREA") && input.type !== "radio" && !input.value) {
            unhandled.push({ label, type: input.tagName.toLowerCase(), name: input.name });
          }
        }
      });
      return unhandled;
    });

    if (unhandledFields.length > 0) {
      console.log(`   WARNING: ${unhandledFields.length} potentially unfilled field(s):`);
      for (const f of unhandledFields) {
        console.log(`     - ${f.label.substring(0, 80)} (${f.type} ${f.name})`);
      }
    }

    // Wait a moment for hCaptcha to auto-execute (it triggers on location input focus)
    console.log("   Waiting for hCaptcha auto-solve...");
    await new Promise(r => setTimeout(r, 3000));

    // Check if hCaptcha token was auto-populated
    let captchaSolved = await page.evaluate(() => {
      const input = document.getElementById("hcaptchaResponseInput");
      return input?.value ? true : false;
    });

    if (!captchaSolved) {
      // Try triggering hCaptcha by focusing location input (Lever's own trigger)
      const locInput = await page.$("#location-input");
      if (locInput) {
        await locInput.focus();
        await new Promise(r => setTimeout(r, 5000));
      }

      captchaSolved = await page.evaluate(() => {
        const input = document.getElementById("hcaptchaResponseInput");
        return input?.value ? true : false;
      });
    }

    if (!captchaSolved) {
      // Wait for manual captcha solving (up to 60 seconds)
      console.log("   hCaptcha not auto-solved. Waiting for manual solve (60s)...");
      const captchaDeadline = Date.now() + 60_000;
      while (Date.now() < captchaDeadline) {
        captchaSolved = await page.evaluate(() => {
          const input = document.getElementById("hcaptchaResponseInput");
          return input?.value ? true : false;
        });
        if (captchaSolved) break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (captchaSolved) {
      console.log("   hCaptcha SOLVED");
    } else {
      console.log("   hCaptcha NOT solved - submitting anyway (will likely fail)");
    }

    // Click submit button
    console.log("   Submitting...");

    // Click submit and wait for either navigation or DOM change
    let result;
    try {
      const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
        page.evaluate(() => {
          const submitBtn = document.getElementById("btn-submit");
          if (submitBtn) submitBtn.click();
        }),
      ]);

      // Page navigated - check the new URL/content
      await new Promise(r => setTimeout(r, 2000));
      const currentUrl = page.url();
      const pageContent = await page.evaluate(() => document.body?.textContent?.substring(0, 500) || "").catch(() => "");

      if (currentUrl.includes("/thanks") || pageContent.toLowerCase().includes("thank") || pageContent.toLowerCase().includes("received your application")) {
        result = { success: true, message: `Confirmed: ${currentUrl}` };
      } else {
        // Check for error message on same page
        const errorMsg = await page.evaluate(() => {
          const error = document.querySelector(".error-message");
          return error ? error.textContent.trim().substring(0, 200) : null;
        }).catch(() => null);
        if (errorMsg) {
          result = { success: false, message: errorMsg };
        } else {
          // Navigation happened but unclear result - likely success
          result = { success: true, message: `Page navigated: ${currentUrl}` };
        }
      }
    } catch (err) {
      // "Execution context destroyed" = page navigated (success)
      if (err.message.includes("Execution context") || err.message.includes("destroyed") || err.message.includes("detached")) {
        await new Promise(r => setTimeout(r, 2000));
        const currentUrl = page.url();
        result = { success: true, message: `Submitted (navigation detected): ${currentUrl}` };
      } else {
        result = { success: false, message: err.message };
      }
    }

    const status = result.success ? "PASS" : "FAIL";
    console.log(`   Result: ${status} - ${result.message}`);

    // Store in Redis
    await storeResultInRedis(company, id, jobTitle, {
      status,
      location,
      team,
      captchaSolved,
      message: result.message,
    });

    return { status, ...result };
  } catch (err) {
    console.error(`   ERROR: ${err.message}`);
    await storeResultInRedis(company, id, jobTitle, { status: "ERROR", error: err.message });
    return { status: "ERROR", message: err.message };
  } finally {
    try { await page.close(); } catch {}
  }
}

// ── Main ──

async function main() {
  console.log(`\nLever Auto-Apply: ${company}`);
  console.log("=".repeat(50));

  // Fetch jobs
  const allJobs = await fetchLeverJobs(company);
  console.log(`Total postings: ${allJobs.length}`);

  let jobs;
  if (singlePostingId) {
    jobs = allJobs.filter(j => j.id === singlePostingId);
    if (jobs.length === 0) {
      console.log(`Posting ${singlePostingId} not found`);
      process.exit(1);
    }
  } else {
    jobs = allJobs.filter(isRelevantJob);
    console.log(`Relevant postings: ${jobs.length}`);
  }

  // Launch headful Chrome with stealth flags to pass hCaptcha
  const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: [
      "--no-sandbox",
      "--window-size=1200,900",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const results = { pass: 0, fail: 0, skip: 0, error: 0 };

  for (const job of jobs) {
    const result = await applyToPosting(browser, company, job);
    if (result.status === "PASS") results.pass++;
    else if (result.status === "FAIL") results.fail++;
    else if (result.status === "skipped") results.skip++;
    else results.error++;

    // Brief pause between applications
    if (jobs.indexOf(job) < jobs.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${results.pass} pass, ${results.fail} fail, ${results.skip} skip, ${results.error} error`);

  await browser.close();
  await disconnectRedis();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
