import type { ApplicationResult } from "./types.js";
import type { CandidateProfile } from "../config/candidate.js";
import { fetchJobWithQuestions } from "./greenhouse-apply.js";

/**
 * Submit a Greenhouse application using a headless browser.
 * This handles reCAPTCHA Enterprise by executing it in a real browser context.
 */
export async function submitApplicationViaBrowser(
  boardToken: string,
  jobId: number,
  candidate: CandidateProfile,
  companyName: string
): Promise<ApplicationResult> {
  // 1. Get job details first via API
  const job = await fetchJobWithQuestions(boardToken, jobId);
  if (!job) {
    return {
      success: false, jobId, boardToken, companyName,
      jobTitle: "Unknown", jobUrl: "",
      status: 0, message: "Failed to fetch job details",
      timestamp: new Date().toISOString(),
    };
  }

  let browser;
  try {
    // Dynamic imports for Lambda/Netlify compatibility
    const chromium = await import("@sparticuz/chromium");
    const puppeteer = await import("puppeteer-core");

    browser = await puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: chromium.default.defaultViewport,
      executablePath: await chromium.default.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate to the application page
    const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${boardToken}&token=${jobId}`;
    console.log(`Navigating to: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    // Wait for the form to be ready
    await page.waitForSelector("#application_form", { timeout: 10_000 });

    // Fill in candidate info
    await page.type("#first_name", candidate.firstName, { delay: 30 });
    await page.type("#last_name", candidate.lastName, { delay: 30 });
    await page.type("#email", candidate.email, { delay: 30 });

    // Phone field
    const phoneField = await page.$("#phone");
    if (phoneField) {
      await phoneField.type(candidate.phone, { delay: 30 });
    }

    // Paste resume text
    const resumeTextarea = await page.$('textarea[name="job_application[resume_text]"]');
    if (resumeTextarea) {
      // Click the "paste" option first if available
      const pasteLink = await page.$('a.paste-resume, a[data-action="paste"]');
      if (pasteLink) {
        await pasteLink.click();
        await page.waitForTimeout(500);
      }
      await resumeTextarea.type(candidate.resumeText, { delay: 5 });
    }

    // Answer custom questions
    if (job.questions) {
      for (let i = 0; i < job.questions.length; i++) {
        const q = job.questions[i];
        const label = q.label.toLowerCase();
        const field = q.fields[0];
        if (!field) continue;

        // Skip standard fields
        if (["first_name", "last_name", "email", "phone", "resume", "resume_text"].includes(field.name)) {
          continue;
        }

        const prefix = `job_application[answers_attributes][${i}]`;

        if (field.type === "multi_value_single_select") {
          const selectName = `${prefix}[boolean_value]`;
          const selectEl = await page.$(`select[name="${selectName}"]`);
          if (selectEl) {
            let value = "1"; // Default yes
            if (label.includes("previously applied") || label.includes("have you ever worked")) {
              value = "0";
            } else if (label.includes("sponsorship") || label.includes("require sponsor")) {
              value = candidate.requiresSponsorship ? "1" : "0";
            } else if (label.includes("military") || label.includes("veteran")) {
              value = candidate.veteranStatus ? "1" : "0";
            } else if (label.includes("authorized")) {
              value = candidate.authorizedToWork ? "1" : "0";
            } else if (label.includes("privacy") || label.includes("consent")) {
              value = "1";
            }
            await selectEl.select(value);
          }
        } else if (field.type === "textarea" || field.type === "input_text") {
          const textName = `${prefix}[text_value]`;
          const textEl = await page.$(`textarea[name="${textName}"], input[name="${textName}"]`);
          if (textEl) {
            // Only fill required fields or ones we have specific answers for
            if (!q.required) continue;
            await textEl.type("", { delay: 10 });
          }
        }
      }
    }

    // Wait a moment for reCAPTCHA to process
    await page.waitForTimeout(2000);

    // Submit the form
    console.log("Submitting application form...");

    // Click submit button
    const submitButton = await page.$('#submit_app, button[type="submit"], input[type="submit"]');
    if (!submitButton) {
      throw new Error("Could not find submit button");
    }

    // Wait for navigation after submit
    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => null),
      submitButton.click(),
    ]);

    // Check result
    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText);

    const isSuccess = finalUrl.includes("confirmation") ||
      bodyText.toLowerCase().includes("thank you") ||
      bodyText.toLowerCase().includes("application has been submitted") ||
      bodyText.toLowerCase().includes("we have received");

    const hasError = bodyText.toLowerCase().includes("error") ||
      bodyText.toLowerCase().includes("required") ||
      bodyText.toLowerCase().includes("please fill");

    return {
      success: isSuccess && !hasError,
      jobId, boardToken, companyName,
      jobTitle: job.title, jobUrl: job.absolute_url,
      status: response?.status() ?? (isSuccess ? 200 : 422),
      message: isSuccess
        ? "Application submitted successfully via browser"
        : hasError
          ? `Form validation errors. Page text: ${bodyText.substring(0, 300)}`
          : `Submission result unclear. Final URL: ${finalUrl}`,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false, jobId, boardToken, companyName,
      jobTitle: job?.title || "Unknown", jobUrl: job?.absolute_url || "",
      status: 0,
      message: `Browser submission failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
