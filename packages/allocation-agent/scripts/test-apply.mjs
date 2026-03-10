#!/usr/bin/env node

/**
 * Greenhouse Auto-Apply with Email Verification
 *
 * Full flow:
 *   1. Open application form in headless browser
 *   2. Fill all fields + trigger reCAPTCHA
 *   3. Submit → Greenhouse sends security code to email
 *   4. Poll Gmail API for the security code
 *   5. Enter code into the security_code field
 *   6. Resubmit the form
 *
 * Usage:
 *   node scripts/test-apply.mjs [boardToken] [jobId]
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   CHROME_PATH (optional)
 */

import puppeteer from "puppeteer-core";
import { getStore } from "@netlify/blobs";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import Redis from "ioredis";

// ── Slack notification helper ──

async function sendSlackAlert(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("   No SLACK_WEBHOOK_URL set, skipping Slack alert");
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(`   Slack webhook failed (${res.status}): ${await res.text()}`);
    } else {
      console.log("   Slack alert sent");
    }
  } catch (err) {
    console.error(`   Slack alert error: ${err.message}`);
  }
}

function buildUnhandledFieldsAlert(token, id, unfilledFields, validationErrors) {
  const jobUrl = `https://boards.greenhouse.io/embed/job_app?for=${token}&token=${id}`;
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: ":warning: Auto-Apply: Unhandled Fields" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Job:* <${jobUrl}|${token} / ${id}>`,
      },
    },
  ];

  if (unfilledFields.length > 0) {
    const fieldList = unfilledFields
      .slice(0, 15)
      .map((f) => `• ${f.label || f.name || f.id || "unknown"}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Required fields not filled (${unfilledFields.length}):*\n${fieldList}`,
      },
    });
  }

  if (validationErrors.length > 0) {
    const errorList = validationErrors
      .slice(0, 15)
      .map((e) => `• ${e.label || e.text || e.field || "unknown"}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Validation errors (${validationErrors.length}):*\n${errorList}`,
      },
    });
  }

  return { blocks };
}

// ── Redis helper ──

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

/**
 * Scan the page for ALL form fields and return structured metadata.
 * This captures every field entity the form contains.
 */
async function scanFormFields(page) {
  return page.evaluate(() => {
    const fields = [];

    // Scan all .field containers (Greenhouse wraps each question in .field)
    document.querySelectorAll(".field, fieldset").forEach(container => {
      const labelEl = container.querySelector("label");
      const label = labelEl?.textContent?.trim() || "";
      const isRequired = label.includes("*");

      container.querySelectorAll("input, select, textarea").forEach(el => {
        if (el.type === "hidden") return;
        const options = el.tagName === "SELECT"
          ? Array.from(el.options).map(o => o.textContent.trim()).filter(t => t)
          : undefined;
        fields.push({
          tag: el.tagName,
          type: el.type || "",
          id: el.id || "",
          name: el.name || "",
          label,
          required: isRequired,
          hasSelect2: !!document.querySelector(`#s2id_${el.id}`),
          optionCount: options?.length || 0,
          options: options?.slice(0, 20),
          value: el.value?.substring(0, 50) || "",
        });
      });
    });

    // Also capture sections: education, employment
    const sections = [];
    if (document.querySelector("#education_degree_0, #education_degree, [id*='s2id_'][id*='school']"))
      sections.push("education");
    if (document.querySelector('[name*="employments"]'))
      sections.push("employment");
    if (document.querySelector("#auto_complete_input"))
      sections.push("location_autocomplete");
    if (document.querySelector('[name="job_application[location]"]'))
      sections.push("location_text");
    if (document.querySelector("#s3_upload_for_resume input[type='file']"))
      sections.push("resume_upload");
    if (document.querySelector('button[data-source="paste"]'))
      sections.push("resume_paste");

    return { fields, sections };
  });
}

/**
 * Store form field metadata in Redis.
 * Keys:
 *   form_fields:{token}:{id}       → JSON with full field scan
 *   form_fields:index               → sorted set of all scanned forms (score = timestamp)
 *   form_fields:questions:{token}:{id} → hash of question labels → types
 */
async function storeFormFieldsInRedis(token, id, formScan, applicationResult) {
  const redis = getRedis();
  if (!redis) return;

  try {
    const key = `form_fields:${token}:${id}`;
    const now = Date.now();
    const record = {
      boardToken: token,
      jobId: id,
      scannedAt: new Date().toISOString(),
      success: applicationResult?.success ?? null,
      sections: formScan.sections,
      fieldCount: formScan.fields.length,
      fields: formScan.fields,
    };

    // Store full scan as JSON
    await redis.set(key, JSON.stringify(record));
    await redis.expire(key, 60 * 60 * 24 * 90); // 90 days

    // Add to index (sorted set by timestamp for easy listing)
    await redis.zadd("form_fields:index", now, `${token}:${id}`);

    // Store question labels as a hash for quick lookup
    const qKey = `form_fields:questions:${token}:${id}`;
    const questionFields = formScan.fields.filter(f => f.name.includes("answers_attributes"));
    if (questionFields.length > 0) {
      const hashData = [];
      for (const f of questionFields) {
        const shortLabel = f.label.replace(/\s*\*\s*$/, "").substring(0, 100);
        if (shortLabel) {
          hashData.push(shortLabel, JSON.stringify({
            type: f.tag === "SELECT" ? (f.hasSelect2 ? "select2" : "select") : f.tag === "TEXTAREA" ? "textarea" : "text",
            required: f.required,
            optionCount: f.optionCount,
            options: f.options,
          }));
        }
      }
      if (hashData.length > 0) {
        await redis.hset(qKey, ...hashData);
        await redis.expire(qKey, 60 * 60 * 24 * 90);
      }
    }

    console.log(`   Form fields stored in Redis: ${key} (${formScan.fields.length} fields, ${formScan.sections.join(", ")})`);
  } catch (err) {
    console.error(`   Redis store error: ${err.message}`);
  }
}

const boardToken = process.argv[2] || "clearstreet";
const jobId = process.argv[3] || "6675504";
const RESUME_PDF_PATH = process.env.RESUME_PATH || resolve(import.meta.dirname, "../.context/attachments/resume_jasonzb_oct10 (2).pdf");

// Google OAuth config (from env)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const candidate = {
  firstName: "Jason",
  lastName: "Bian",
  email: "jason.bian64@gmail.com",
  phone: "+1-734-730-6569",
  authorizedToWork: true,
  requiresSponsorship: false,
  veteranStatus: false,
  resumeText: `JASON BIAN
New York, New York | +1 734-730-6569 | jason.bian64@gmail.com

PROFESSIONAL EXPERIENCE

AMAZON.COM — Data Engineer II (2021 – Present)
• High Cardinality Forecast Generation in Java, Python and Spark
• Reduced latency of ~550 input signals, shortening pipeline runtime of 4 deep learning models to 6.4x
• Sev2 real-time support for 4 core forecasting models with 1120 weekly runs
• Reduced data ingestion pipeline audits from 48 hours to 5 hours
• Increased pipeline test coverage from 33% to 90%
• Extended CI/CD, logging, integration testing covering ~15.3B daily read/writes

AMAZON.COM — Business Intelligence Engineer II (2021 – 2022)
• Weekly Delivery Associate Hiring Targets via LP solves
• 10% forecast error reduction across 500+ delivery stations
• Automated scenario analysis reducing ~450 hours/month of lab work

MICROSOFT — Program Manager (2020 – 2021)
• Azure Decision Science - capacity management programs
• Managed ~$5M monthly infrastructure capex
• Scaled offer restriction from 30% to 65% of Azure services

OPTIMASON — Founder (2022 – Present)
• Consulting shop for azure cloud migrations and data estate development
• Migrated aging manual systems with 1800+ hours of man-hours saved

TECH SKILLS
Python, Java, SQL, Spark, Scala, TypeScript, C++, R
Apache (Presto, Beam, Flink), AWS (Glue, Sagemaker, Lambda, Redshift), Azure (Databricks)
ARIMA, PCA, Convex Optimization, Linear Programming, Markov Chains

EDUCATION
B.S.E Industrial and Operations Engineering, University of Michigan Ann Arbor — GPA 3.83`,
};

function getAnswerForQuestion(label) {
  label = label.toLowerCase();
  if (label.includes("previously applied") || label.includes("have you ever worked")) return "0";
  if (label.includes("authorized to work") || label.includes("legally authorized")) return candidate.authorizedToWork ? "1" : "0";
  if (label.includes("sponsorship") || label.includes("require sponsor") || label.includes("visa")) return candidate.requiresSponsorship ? "1" : "0";
  if (label.includes("military") || label.includes("veteran")) return candidate.veteranStatus ? "1" : "0";
  if (label.includes("privacy") || label.includes("consent") || label.includes("i accept")) return "1";
  return "1";
}

function getTextAnswerForQuestion(label) {
  label = label.toLowerCase();
  if (label.includes("linkedin")) return "https://www.linkedin.com/in/jason-bian-7b9027a5/";
  if (label.includes("non-compete") || label.includes("notice period") || label.includes("non compete"))
    return "No non-compete agreement. Available to start immediately.";
  if (label.includes("github")) return "https://github.com/IamJasonBian";
  if (label.includes("salary") || label.includes("compensation")) return "Open to discussion";
  if (label.includes("how did you hear") || label.includes("referral") || label.includes("how did you find"))
    return "Company website";
  if (label.includes("years of") || label.includes("experience")) return "5";
  if (label.includes("employer") || label.includes("current company")) return "Amazon";
  if (label.includes("current title") || label.includes("job title") || label.includes("current role")) return "Data Engineer II";
  if (label.includes("website") || label.includes("portfolio")) return "https://github.com/IamJasonBian";
  // Sponsorship / visa text fields
  if (label.includes("sponsorship") || label.includes("require sponsor") || label.includes("immigration sponsor")) return "No";
  if (label.includes("visa status") || label.includes("visa expir")) return "N/A - US work authorized, no sponsorship needed";
  // Relocation
  if (label.includes("relocat") || label.includes("open to mov")) return "Yes";
  // Start date / availability
  if (label.includes("start date") || label.includes("available to start") || label.includes("earliest start")) return "Immediately";
  // Additional detail / other
  if (label.includes("additional detail") || label.includes("anything else")) return "";
  if (label.includes("legal first name") || label.includes("legal last name")) return "";
  // Location question (text, not autocomplete)
  if (label.includes("where are you located") || label.includes("your location")) return "New York, NY";
  // Full legal name
  if (label.includes("full name") && (label.includes("government") || label.includes("identification") || label.includes("legal"))) return "Jason Bian";
  // Licenses / certifications
  if (label.includes("license") || label.includes("certification") || label.includes("finra") || label.includes("sec ")) return "N/A";
  // Programming languages
  if (label.includes("programming language")) return "Python, Java, SQL, Spark, Scala, TypeScript, C++, R";
  // Cover letter
  if (label.includes("cover letter")) return "";
  return "";
}

async function findChromePath() {
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  const { existsSync } = await import("fs");
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error("Chrome not found. Set CHROME_PATH env var.");
}

// ── Gmail API helpers ──

async function getGmailAccessToken() {
  if (!GOOGLE_REFRESH_TOKEN) {
    console.log("   No GOOGLE_REFRESH_TOKEN set - skipping email check");
    return null;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: GOOGLE_REFRESH_TOKEN,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`   Gmail token refresh failed: ${err}`);
    return null;
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchSecurityCodeFromGmail(accessToken, afterEpochMs) {
  // Use Gmail's after: filter with epoch seconds to only get emails after submission
  const afterSec = Math.floor(afterEpochMs / 1000);
  const query = encodeURIComponent(
    `from:greenhouse-mail.io subject:"security code" after:${afterSec}`
  );
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=3`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) return null;

  const listData = await listRes.json();
  if (!listData.messages || listData.messages.length === 0) return null;

  // Get most recent message
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${listData.messages[0].id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) return null;

  const msg = await msgRes.json();

  // Verify message is actually newer than our submission (internalDate is epoch ms)
  if (Number(msg.internalDate) < afterEpochMs) {
    return null;
  }

  // Extract body
  let bodyText = "";
  if (msg.payload.body?.data) {
    bodyText = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
  }
  if (!bodyText && msg.payload.parts) {
    for (const part of msg.payload.parts) {
      if ((part.mimeType === "text/plain" || part.mimeType === "text/html") && part.body.data) {
        bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
        if (part.mimeType === "text/plain") break;
      }
    }
  }

  // Strip HTML tags (Greenhouse sends HTML-only emails)
  const stripped = bodyText.replace(/<[^>]+>/g, " ").replace(/&\w+;/g, " ").replace(/\s+/g, " ").trim();

  // Primary: "application: M42moqCu After"
  const match = stripped.match(/application:\s+([A-Za-z0-9]{6,12})\s+After/i);
  if (match) return match[1];

  // Broad: any "security code" context followed by code
  const broad = stripped.match(/(?:security\s*code|verification\s*code|code\s*into)[^:]*:\s*([A-Za-z0-9]{6,12})/i);
  if (broad) return broad[1];

  // Fallback: standalone 8-char code on its own line
  const fallback = bodyText.match(/\n\s*([A-Za-z0-9]{8})\s*\n/);
  if (fallback) return fallback[1];

  console.log("   Could not parse code from email body:", stripped.substring(0, 200));
  return null;
}

async function pollForSecurityCode(accessToken, afterEpochMs, maxWaitMs = 180_000, intervalMs = 8_000) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    process.stdout.write(`   Polling Gmail (attempt ${attempt})...`);
    const code = await fetchSecurityCodeFromGmail(accessToken, afterEpochMs);
    if (code) {
      console.log(` FOUND: ${code}`);
      return code;
    }
    console.log(" not yet");
    if (Date.now() + intervalMs < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
    } else break;
  }
  return null;
}

// ── Form filling helper ──

async function fillFormAndSubmit(page, token, id) {
  // Fill basic info
  await page.type("#first_name", candidate.firstName, { delay: 30 });
  await page.type("#last_name", candidate.lastName, { delay: 30 });
  await page.type("#email", candidate.email, { delay: 30 });
  const phoneField = await page.$("#phone");
  if (phoneField) await phoneField.type(candidate.phone, { delay: 30 });
  console.log("   Basic info filled");

  // Upload resume PDF if available, otherwise paste text
  let resumeUploaded = false;
  if (existsSync(RESUME_PDF_PATH)) {
    const fileInput = await page.$("#s3_upload_for_resume input[type='file']");
    if (fileInput) {
      await fileInput.uploadFile(RESUME_PDF_PATH);
      // Wait for S3 upload to complete (filename appears in #resume_filename)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const filename = await page.evaluate(() => {
          const fn = document.querySelector("#resume_filename");
          return fn?.textContent?.trim() || "";
        });
        if (filename) {
          console.log(`   Resume PDF uploaded: ${filename}`);
          resumeUploaded = true;
          break;
        }
      }
      if (!resumeUploaded) console.log("   Resume PDF upload timed out, falling back to text");
    }
  }

  if (!resumeUploaded) {
    // Fallback: paste resume text
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-source="paste"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    await page.evaluate((text) => {
      const ta = document.querySelector('textarea[name="job_application[resume_text]"]');
      if (ta) {
        ta.focus();
        ta.value = text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        ta.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, candidate.resumeText);
    const resumeTextarea = await page.$('textarea[name="job_application[resume_text]"]');
    if (resumeTextarea) {
      await resumeTextarea.press("Space");
      await resumeTextarea.press("Backspace");
    }
    console.log("   Resume text filled (fallback)");
  }

  // Fill education section - detect by degree dropdown OR school Select2
  const hasEducation = await page.evaluate(() =>
    !!document.querySelector("#education_degree_0") || !!document.querySelector("#education_degree")
  );
  const hasSchoolSelect2 = await page.evaluate(() =>
    !!document.querySelector('[id*="s2id_"][id*="school"]')
  );

  if (hasEducation) {
    // Select degree by option text (fill BOTH visual and hidden submit selects)
    await page.evaluate(() => {
      const selectors = ["#education_degree_0", "#education_degree"];
      for (const sel of selectors) {
        const degreeSelect = document.querySelector(sel);
        if (degreeSelect) {
          for (const opt of degreeSelect.options) {
            if (opt.textContent.trim() === "Bachelor's Degree") {
              degreeSelect.value = opt.value;
              degreeSelect.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
        }
      }
    });

    // Select discipline by option text (fill BOTH visual and hidden submit selects)
    await page.evaluate(() => {
      const selectors = ["#education_discipline_0", "#education_discipline"];
      for (const sel of selectors) {
        const discSelect = document.querySelector(sel);
        if (discSelect) {
          for (const opt of discSelect.options) {
            const text = opt.textContent.trim().toLowerCase();
            if (text === "engineering" || text.includes("industrial engineering")) {
              discSelect.value = opt.value;
              discSelect.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
        }
      }
    });
    console.log("   Education: Degree=Bachelor's, Discipline=Engineering");
  }

  // Fill school Select2 (AJAX-based autocomplete for school name)
  if (hasSchoolSelect2) {
    // Open Select2 dropdown via jQuery API
    await page.evaluate(() => {
      jQuery("#education_school_name_0").select2("open");
    });
    await new Promise((r) => setTimeout(r, 500));

    // Type into the search input
    const searchInput = await page.$(".select2-drop-active .select2-input");
    if (searchInput) {
      await searchInput.type("University of Michigan", { delay: 40 });
      await new Promise((r) => setTimeout(r, 2500)); // Wait for AJAX results

      // Select the result via mouseup (Select2 v3 internal event)
      const selected = await page.evaluate(() => {
        const results = document.querySelectorAll(".select2-drop-active .select2-results li");
        for (const li of results) {
          if (li.textContent.includes("Michigan")) {
            li.classList.add("select2-highlighted");
            li.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return li.textContent.trim();
          }
        }
        return null;
      });
      await new Promise((r) => setTimeout(r, 500));

      if (selected) {
        // Verify the hidden input got populated
        const hiddenVal = await page.evaluate(() => {
          const h1 = document.querySelector("#education_school_name_0");
          const h2 = document.querySelector("#education_school_name");
          return { h1: h1?.value, h2: h2?.value };
        });
        console.log(`   School selected: ${selected.substring(0, 50)} (hidden: ${hiddenVal.h1 || hiddenVal.h2 || "EMPTY"})`);

        // If hidden input still empty, set data manually
        if (!hiddenVal.h1 && !hiddenVal.h2) {
          // Fetch the data Select2 stored internally
          const s2Data = await page.evaluate(() => {
            const data = jQuery("#education_school_name_0").select2("data");
            return data ? { id: data.id, text: data.text } : null;
          });
          if (s2Data?.id) {
            // Set both hidden inputs
            await page.evaluate((id) => {
              document.querySelector("#education_school_name_0").value = id;
              const h2 = document.querySelector("#education_school_name");
              if (h2) h2.value = id;
            }, s2Data.id);
            console.log(`   School set manually: ${s2Data.text} (id: ${s2Data.id})`);
          }
        }
      } else {
        // Fallback: use keyboard to select first result
        await page.keyboard.press("ArrowDown");
        await new Promise((r) => setTimeout(r, 200));
        await page.keyboard.press("Enter");
        await new Promise((r) => setTimeout(r, 500));
        const fallbackVal = await page.evaluate(() => document.querySelector("#education_school_name_0")?.value);
        console.log(`   School (keyboard fallback): hidden=${fallbackVal || "EMPTY"}`);
      }
    } else {
      console.log("   School: no search input found after select2 open");
    }

    // Close any remaining dropdown
    await page.evaluate(() => {
      try { jQuery("#education_school_name_0").select2("close"); } catch {}
    });
  }

  // Fill education start/end year/month if present
  await page.evaluate(() => {
    // Education start date
    const eduStartMonth = document.querySelector('[name*="education"][name*="start_date"][name*="month"]');
    if (eduStartMonth && !eduStartMonth.value) { eduStartMonth.value = '09'; eduStartMonth.dispatchEvent(new Event("change", { bubbles: true })); }
    const eduStartYear = document.querySelector('[name*="education"][name*="start_date"][name*="year"]');
    if (eduStartYear && !eduStartYear.value) { eduStartYear.value = '2016'; eduStartYear.dispatchEvent(new Event("change", { bubbles: true })); }
    // Education end date
    const eduEndMonth = document.querySelector('[name*="education"][name*="end_date"][name*="month"]');
    if (eduEndMonth && !eduEndMonth.value) { eduEndMonth.value = '04'; eduEndMonth.dispatchEvent(new Event("change", { bubbles: true })); }
    const eduEndYear = document.querySelector('[name*="education"][name*="end_date"][name*="year"]');
    if (eduEndYear && !eduEndYear.value) { eduEndYear.value = '2020'; eduEndYear.dispatchEvent(new Event("change", { bubbles: true })); }
  });

  // Fill employment section (if present, e.g. IMC)
  const hasEmployment = await page.evaluate(() => !!document.querySelector('[name*="employments"][name*="company_name"]'));
  if (hasEmployment) {
    // Fill ALL company_name and title fields (visible _0 and hidden submit variants)
    await page.evaluate(() => {
      document.querySelectorAll('[name*="employments"][name*="company_name"]').forEach(el => {
        if (!el.value) { el.value = 'Amazon'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      document.querySelectorAll('[name*="employments"][name*="title"]').forEach(el => {
        if (!el.value) { el.value = 'Data Engineer II'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
      });
    });

    // Employment dates - handle both single-field and separate month/year formats
    const hasSeparateDates = await page.evaluate(() =>
      !!document.querySelector('[name*="employments"][name*="start_date"][name*="month"]')
    );
    if (hasSeparateDates) {
      // Separate month/year fields (IMC-style): fill ALL instances (visible + hidden)
      await page.evaluate(() => {
        document.querySelectorAll('[name*="employments"][name*="start_date"][name*="month"]').forEach(el => {
          if (!el.value) { el.value = '03'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
        });
        document.querySelectorAll('[name*="employments"][name*="start_date"][name*="year"]').forEach(el => {
          if (!el.value) { el.value = '2021'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
        });
        document.querySelectorAll('[name*="employments"][name*="end_date"][name*="month"]').forEach(el => {
          if (!el.value) { el.value = '02'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
        });
        document.querySelectorAll('[name*="employments"][name*="end_date"][name*="year"]').forEach(el => {
          if (!el.value) { el.value = '2026'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
        });
      });
      console.log("   Employment: Amazon, Data Engineer II (03/2021 - 02/2026)");
    } else {
      // Single date field format
      await page.evaluate(() => {
        const sd = document.querySelector('[name="job_application[employments][][start_date]"]');
        if (sd) { sd.value = '03/2021'; sd.dispatchEvent(new Event("input", { bubbles: true })); sd.dispatchEvent(new Event("change", { bubbles: true })); }
        const ed = document.querySelector('[name="job_application[employments][][end_date]"]');
        if (ed) { ed.value = 'Present'; ed.dispatchEvent(new Event("input", { bubbles: true })); ed.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      console.log("   Employment: Amazon, Data Engineer II (03/2021 - Present)");
    }
  }

  // Fill plain location text field (e.g. IMC uses job_application[location] instead of autocomplete)
  const locationTextField = await page.$('[name="job_application[location]"]');
  if (locationTextField) {
    await page.evaluate(() => {
      const el = document.querySelector('[name="job_application[location]"]');
      if (el && !el.value) { el.value = 'New York, NY'; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    console.log("   Location (text): New York, NY");
  }

  // Fill location autocomplete
  console.log("   Filling location...");
  const locationInput = await page.$("#auto_complete_input");
  if (locationInput) {
    await locationInput.click();
    await locationInput.type("New York, NY", { delay: 60 });
    await new Promise((r) => setTimeout(r, 1500));
    const selected = await page.evaluate(() => {
      const items = document.querySelectorAll("[role='option'], .pelias-results li, .autocomplete-suggestions li");
      for (const item of items) {
        if (item.textContent.includes("New York")) {
          item.click();
          return item.textContent.trim();
        }
      }
      return null;
    });
    if (!selected) {
      await page.keyboard.press("ArrowDown");
      await new Promise((r) => setTimeout(r, 200));
      await page.keyboard.press("Enter");
    }
    console.log(`   Location: ${selected || "New York, NY (fallback)"}`);
  }

  // Answer dropdown (select) questions - these may be Select2 widgets
  // Match both standard (answers_attributes) and non-standard (question[N][]) naming
  console.log("   Filling select questions...");
  const questionData = await page.evaluate(() => {
    const results = [];
    const selects = document.querySelectorAll("select[name*='answers_attributes'], select[name^='question[']");
    for (const select of selects) {
      const container = select.closest(".field") || select.closest("fieldset") || select.parentElement;
      const labelEl = container ? container.querySelector("label") : null;
      const opts = Array.from(select.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
      const isYesNo = opts.some(o => o.text === "Yes") && opts.some(o => o.text === "No");
      const isSelect2 = !!document.querySelector(`#s2id_${select.id}`);
      results.push({ type: "select", name: select.name, id: select.id, label: labelEl?.textContent?.trim() || "", isYesNo, isSelect2, options: opts });
    }
    return results;
  });

  console.log(`   Found ${questionData.length} select questions`);
  for (const q of questionData) {
    let answerText;

    try {
    if (q.isYesNo) {
      const answer = getAnswerForQuestion(q.label);
      answerText = answer === "1" ? "Yes" : "No";
    } else {
      // Non-boolean: determine best option text
      const lbl = (q.label || "").toLowerCase();
      const validOpts = (q.options || []).filter(o => o && o.value && o.text !== "Please select" && o.text !== "");
      let pick = null;
      if (lbl.includes("location") || lbl.includes("work location") || lbl.includes("office")) {
        pick = validOpts.find(o => o.text.toLowerCase().includes("new york"));
      }
      if (!pick && (lbl.includes("how did you") || lbl.includes("learn about") || lbl.includes("hear about") || lbl.includes("source"))) {
        pick = validOpts.find(o => o.text.toLowerCase().includes("website") || o.text.toLowerCase().includes("online") || o.text.toLowerCase().includes("career"));
        if (!pick) pick = validOpts.find(o => o.text.toLowerCase().includes("other"));
      }
      if (!pick && (lbl.includes("language") || lbl.includes("fluent"))) {
        pick = validOpts.find(o => o.text.toLowerCase().includes("mandarin"));
        if (!pick) pick = validOpts.find(o => o.text.toLowerCase() === "none");
      }
      if (!pick && (lbl.includes("privacy") || lbl.includes("consent") || lbl.includes("acknowledge") || lbl.includes("confidential") || lbl.includes("agree") || lbl.includes("statement"))) {
        pick = validOpts.find(o => o.text.toLowerCase().includes("accept") || o.text.toLowerCase().includes("agree") || o.text.toLowerCase().includes("yes") || o.text.toLowerCase().includes("acknowledge"));
      }
      if (!pick && validOpts.length > 0) pick = validOpts[0];
      if (pick) answerText = pick.text;
    }

    if (answerText && q.id) {
      const answer = q.options.find(o => o.text === answerText)?.value;
      if (answer) {
        if (q.isSelect2) {
          // Use jQuery Select2 API - works reliably in headless mode
          await page.evaluate((selectId, val) => {
            jQuery(`#${selectId}`).select2("val", val);
          }, q.id, answer);
          console.log(`   Q(s2):     ${(q.label || "").substring(0, 50).padEnd(50)} -> ${answerText}`);
        } else {
          // Plain select: set value directly
          await page.evaluate((selectId, val) => {
            const select = document.querySelector(`#${selectId}`);
            if (!select) return;
            select.value = val;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }, q.id, answer);
          console.log(`   Q(select): ${(q.label || "").substring(0, 50).padEnd(50)} -> ${answerText}`);
        }
      }
    }
    } catch (err) {
      console.error(`   ERROR on select "${q.label?.substring(0, 40)}": ${err.message}`);
    }
  }

  // Answer text input questions (excluding basic fields already filled)
  const textQuestionData = await page.evaluate(() => {
    const results = [];
    const basicIds = ["first_name", "last_name", "email", "phone", "auto_complete_input", "security_code"];
    const inputs = document.querySelectorAll("input[type='text'][name*='answers_attributes'], input:not([type])[name*='answers_attributes'], textarea[name*='answers_attributes']:not([name*='resume_text']), input[type='text'][name^='question['], textarea[name^='question[']");
    for (const input of inputs) {
      if (basicIds.includes(input.id)) continue;
      const container = input.closest(".field") || input.closest("fieldset") || input.parentElement;
      const labelEl = container ? container.querySelector("label") : null;
      const label = labelEl?.textContent?.trim() || "";
      results.push({ type: input.tagName.toLowerCase() === "textarea" ? "textarea" : "text", name: input.name, label });
    }
    return results;
  });

  for (const q of textQuestionData) {
    const answer = getTextAnswerForQuestion(q.label);
    if (answer) {
      await page.evaluate((name, val) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) {
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, q.name, answer);
      console.log(`   Q(text):   ${q.label.substring(0, 50).padEnd(50)} -> ${answer.substring(0, 40)}`);
    }
  }

  // Check acknowledge/consent checkboxes
  const checkboxCount = await page.evaluate(() => {
    let count = 0;
    const checkboxes = document.querySelectorAll("input[type='checkbox'][name*='answers_attributes']");
    for (const cb of checkboxes) {
      if (!cb.checked) {
        cb.click();
        count++;
      }
    }
    return count;
  });
  if (checkboxCount > 0) console.log(`   Checked ${checkboxCount} acknowledge/consent checkbox(es)`);

  // Scan ALL form fields for Redis storage (after filling, before submit)
  const formScan = await scanFormFields(page);
  console.log(`   Form scan: ${formScan.fields.length} fields, sections: [${formScan.sections.join(", ")}]`);

  // Pre-submit check: detect required fields that are still empty
  const unfilledRequired = await page.evaluate((pdfUploaded) => {
    const results = [];
    const basicIds = ["first_name", "last_name", "email", "phone", "security_code"];
    document.querySelectorAll(".field").forEach(field => {
      const label = field.querySelector("label")?.textContent?.trim() || "";
      const isRequired = label.includes("*");
      if (!isRequired) return;
      const inputs = field.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='file']), select, textarea");
      for (const input of inputs) {
        if (basicIds.includes(input.id)) continue;
        // Skip Select2 internal search/display inputs (s2id_autogen*)
        if (input.id.startsWith("s2id_autogen")) continue;
        // Skip resume textarea if PDF was uploaded
        if (pdfUploaded && input.name?.includes("resume_text")) continue;
        if (!input.value) {
          results.push({ label: label.substring(0, 100), name: input.name || "", id: input.id || "", tag: input.tagName });
        }
      }
    });
    return results;
  }, resumeUploaded);

  if (unfilledRequired.length > 0) {
    console.log(`   WARNING: ${unfilledRequired.length} required field(s) still empty before submit:`);
    for (const f of unfilledRequired) {
      console.log(`     - ${f.label} (${f.tag} ${f.name || f.id})`);
    }
    // Send Slack alert about unfilled fields
    await sendSlackAlert(buildUnhandledFieldsAlert(token, id, unfilledRequired, []));
  }

  // Wait for reCAPTCHA Enterprise
  console.log("   Waiting for reCAPTCHA...");
  await new Promise((r) => setTimeout(r, 2000));

  // Trigger reCAPTCHA token generation
  const recaptchaToken = await page.evaluate(async () => {
    try {
      if (typeof grecaptcha === "undefined" || !JBEN?.Recaptcha?.publicKey) return null;
      const token = await grecaptcha.enterprise.execute(JBEN.Recaptcha.publicKey, { action: "apply_to_job" });
      let input = document.querySelector('input[name="g-recaptcha-enterprise-token"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "g-recaptcha-enterprise-token";
        document.querySelector("#application_form").appendChild(input);
      }
      input.value = token;
      return token ? token.substring(0, 20) + "..." : null;
    } catch (e) {
      return `error: ${e.message}`;
    }
  });
  console.log(`   reCAPTCHA token: ${recaptchaToken || "not available"}`);

  // Submit via page.evaluate (more reliable than puppeteer .click())
  console.log("   Submitting...");
  const hasSubmitBtn = await page.evaluate(() => !!document.querySelector("#submit_app"));
  if (!hasSubmitBtn) throw new Error("Submit button not found");

  await page.evaluate(() => document.querySelector("#submit_app").click());

  // Wait for AJAX response and DOM update (form submits via AJAX, not navigation)
  await new Promise((r) => setTimeout(r, 10_000));

  // Check for validation errors
  const validationErrors = await page.evaluate(() => {
    const errors = [];
    // Greenhouse marks invalid fields with field_with_errors class
    const errorFields = document.querySelectorAll(".field_with_errors");
    for (const f of errorFields) {
      const label = f.querySelector("label")?.textContent?.trim() || "";
      const input = f.querySelector("input, select, textarea");
      errors.push({ label, field: input?.name || input?.id || "unknown" });
    }
    // Also check for any error text
    const errorTexts = document.querySelectorAll(".error, [class*='error']");
    for (const e of errorTexts) {
      if (e.offsetParent && e.textContent.trim()) {
        errors.push({ text: e.textContent.trim().substring(0, 100) });
      }
    }
    return errors;
  });

  if (validationErrors.length > 0) {
    console.log("   VALIDATION ERRORS DETECTED:");
    for (const e of validationErrors) {
      if (e.label) console.log(`     - Field: ${e.label} (${e.field})`);
      if (e.text) console.log(`     - Error: ${e.text}`);
    }
  }

  // Check if security code is actually VISIBLE (not just exists in DOM)
  const secCodeDebug = await page.evaluate(() => {
    const field = document.querySelector("#security_code");
    if (!field) return { visible: false, reason: "field not found" };
    const info = [];
    let el = field;
    let depth = 0;
    while (el && depth < 10) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return { visible: false, reason: `hidden at depth ${depth}: ${el.tagName}#${el.id}.${el.className?.substring?.(0,30)} display=${style.display} vis=${style.visibility}` };
      }
      info.push(`${el.tagName}#${el.id} d=${style.display}`);
      el = el.parentElement;
      depth++;
    }
    return { visible: true, chain: info.join(" > ") };
  });
  const securityCodeVisible = secCodeDebug.visible;

  console.log(`   Submit complete. Security code visible: ${securityCodeVisible}, Validation errors: ${validationErrors.length}`);
  if (!securityCodeVisible) console.log(`   Reason: ${secCodeDebug.reason}`);
  return { questionData, textQuestionData, securityCodeVisible, validationErrors, formScan };
}

// ── Main application flow ──

async function applyToJob(chromePath, token, id) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`APPLYING: ${token} / ${id}`);
  console.log(`${"=".repeat(60)}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 900 });

    // Load application page
    const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${token}&token=${id}`;
    console.log(`   Loading: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    // Check form style
    const isOldStyle = await page.evaluate(() => !!document.querySelector("#application_form"));
    if (!isOldStyle) {
      return { success: false, message: "New-style React form - browser automation not supported" };
    }
    await page.waitForSelector("#first_name", { timeout: 5_000 });

    // Step 1: Fill form and submit (triggers security code email)
    console.log("\n[Step 1] Filling form and submitting...");
    const submitTimestamp = Date.now();
    const { questionData, textQuestionData, securityCodeVisible, validationErrors, formScan } = await fillFormAndSubmit(page, token, id);

    // Capture page state after submission
    const firstUrl = page.url();
    const firstBody = await page.evaluate(() => document.body.innerText);
    const pageHtml = await page.content();
    await page.screenshot({ path: `/tmp/gh_apply_${token}_${id}_step1.png`, fullPage: true });

    // Build field values record
    const fieldValues = {
      first_name: candidate.firstName,
      last_name: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      resume_text: "[provided]",
      location: "New York, NY",
    };
    for (const q of questionData) {
      fieldValues[q.label.substring(0, 80)] = getAnswerForQuestion(q.label) === "1" ? "Yes" : "No";
    }
    for (const q of textQuestionData) {
      const answer = getTextAnswerForQuestion(q.label);
      if (answer) fieldValues[q.label.substring(0, 80)] = answer;
    }

    let result;
    let securityCode = null;
    let stepReached = "submitted";

    if (firstUrl.includes("confirmation") || firstBody.toLowerCase().includes("thank you")) {
      console.log("\n   Application submitted (no security code needed)!");
      stepReached = "confirmed";
      result = { success: true, message: "Application submitted without security code" };
    } else if (validationErrors.length > 0 || !securityCodeVisible) {
      console.log("\n   Form submission FAILED - validation errors or security code not visible");
      console.log(`   URL: ${firstUrl}`);
      if (validationErrors.length > 0) {
        console.log(`   Errors: ${JSON.stringify(validationErrors.slice(0, 5))}`);
      }
      stepReached = "validation_failed";
      result = { success: false, message: `Validation failed: ${validationErrors.map(e => e.label || e.text).join(", ") || "unknown fields"}` };
      // Send Slack alert about validation failures
      await sendSlackAlert(buildUnhandledFieldsAlert(token, id, [], validationErrors));
    } else {
      // Step 2: Fetch security code from Gmail
      console.log("\n[Step 2] Checking Gmail for security code...");
      const accessToken = await getGmailAccessToken();
      if (!accessToken) {
        stepReached = "failed";
        result = { success: false, message: "Cannot check Gmail - no OAuth tokens" };
      } else {
        securityCode = await pollForSecurityCode(accessToken, submitTimestamp);
        if (!securityCode) {
          stepReached = "failed";
          result = { success: false, message: "Security code not received in time" };
        } else {
          // Step 3: Enter security code and resubmit
          console.log(`\n[Step 3] Entering security code: ${securityCode}`);
          stepReached = "security_code_entered";

          await page.evaluate((code) => {
            const field = document.querySelector('#security_code, input[name="security_code"]');
            if (field) {
              field.focus();
              field.value = code;
              field.dispatchEvent(new Event("input", { bubbles: true }));
              field.dispatchEvent(new Event("change", { bubbles: true }));
              field.dispatchEvent(new Event("blur", { bubbles: true }));
            }
          }, securityCode);

          await page.screenshot({ path: `/tmp/gh_apply_${token}_${id}_step3_code.png`, fullPage: true });

          // Re-trigger reCAPTCHA and resubmit
          console.log("   Re-triggering reCAPTCHA and resubmitting...");
          await page.evaluate(async () => {
            try {
              if (typeof grecaptcha !== "undefined" && JBEN?.Recaptcha?.publicKey) {
                const token = await grecaptcha.enterprise.execute(JBEN.Recaptcha.publicKey, { action: "apply_to_job" });
                let input = document.querySelector('input[name="g-recaptcha-enterprise-token"]');
                if (!input) {
                  input = document.createElement("input");
                  input.type = "hidden";
                  input.name = "g-recaptcha-enterprise-token";
                  document.querySelector("#application_form").appendChild(input);
                }
                input.value = token;
              }
            } catch {}
          });

          await page.evaluate(() => {
            const btn = document.querySelector("#submit_app");
            if (btn) btn.click();
          });

          await Promise.race([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null),
            new Promise((r) => setTimeout(r, 15_000)),
          ]);

          await new Promise((r) => setTimeout(r, 3000));

          const finalUrl = page.url();
          const finalBody = await page.evaluate(() => document.body.innerText);
          await page.screenshot({ path: `/tmp/gh_apply_${token}_${id}_final.png`, fullPage: true });

          const isSuccess =
            finalUrl.includes("confirmation") ||
            finalBody.toLowerCase().includes("thank you") ||
            finalBody.toLowerCase().includes("submitted") ||
            finalBody.toLowerCase().includes("we have received");

          stepReached = isSuccess ? "confirmed" : "failed";
          console.log(`\n   Final URL: ${finalUrl}`);
          console.log(`   Success: ${isSuccess}`);

          result = {
            success: isSuccess,
            finalUrl,
            message: isSuccess ? "Application submitted with security code!" : finalBody.substring(0, 200),
          };
        }
      }
    }

    // Store form fields in Redis
    await storeFormFieldsInRedis(token, id, formScan, result);

    // Store application state to Netlify Blobs
    const authToken = process.env.NETLIFY_AUTH_TOKEN;
    if (authToken) {
      try {
        const store = getStore({
          name: "applications",
          siteID: process.env.NETLIFY_SITE_ID || "f369d057-d9f8-43a6-9433-acf31d4b2751",
          token: authToken,
        });

        const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
        const prefix = `${token}/${id}/${ts}`;
        const screenshotKeys = [];

        // Store metadata
        await store.setJSON(`${prefix}/metadata.json`, {
          metadata: {
            boardToken: token,
            jobId: id,
            companyName: token,
            candidateEmail: candidate.email,
            timestamp: new Date().toISOString(),
            success: result.success,
            message: result.message,
            securityCodeUsed: securityCode,
            finalUrl: result.finalUrl,
            stepReached,
          },
          fieldValues,
          screenshotKeys,
        });

        // Store page HTML
        if (pageHtml) {
          await store.set(`${prefix}/page.html`, pageHtml);
        }

        // Store screenshots from /tmp/
        const ssFiles = [
          `/tmp/gh_apply_${token}_${id}_step1.png`,
          `/tmp/gh_apply_${token}_${id}_step3_code.png`,
          `/tmp/gh_apply_${token}_${id}_final.png`,
        ];
        for (const ssFile of ssFiles) {
          try {
            const buf = readFileSync(ssFile);
            const name = ssFile.split("/").pop();
            await store.set(`${prefix}/${name}`, new Blob([buf], { type: "image/png" }));
            screenshotKeys.push(`${prefix}/${name}`);
          } catch {}
        }

        console.log(`   State stored to Netlify Blobs: ${prefix}`);
      } catch (err) {
        console.error(`   Failed to store state: ${err.message}`);
      }
    } else {
      console.log("   Skipping blob storage (no NETLIFY_AUTH_TOKEN)");
    }

    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Greenhouse Auto-Apply with Email Verification");
  console.log(`Candidate: ${candidate.firstName} ${candidate.lastName}`);
  console.log(`Gmail configured: ${GOOGLE_REFRESH_TOKEN ? "YES" : "NO - set GOOGLE_REFRESH_TOKEN"}`);

  const chromePath = process.env.CHROME_PATH || (await findChromePath());

  const jobs = [
    { token: boardToken, id: jobId },
  ];

  const results = [];
  for (const { token, id } of jobs) {
    try {
      const result = await applyToJob(chromePath, token, id);
      results.push({ token, id, ...result });
    } catch (err) {
      results.push({ token, id, success: false, message: err.message });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`${r.success ? "PASS" : "FAIL"} ${r.token}/${r.id}: ${r.message?.substring(0, 100)}`);
  }

  await disconnectRedis();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
