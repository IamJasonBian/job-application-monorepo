import type { GreenhouseJobDetail, GreenhouseQuestion, ApplicationResult } from "./types.js";
import type { CandidateProfile } from "../config/candidate.js";

const API_BASE = "https://boards-api.greenhouse.io/v1/boards";
const EMBED_BASE = "https://boards.greenhouse.io/embed";

/**
 * Fetch a single job with application questions via the public API.
 */
export async function fetchJobWithQuestions(
  boardToken: string,
  jobId: number
): Promise<GreenhouseJobDetail | null> {
  const url = `${API_BASE}/${boardToken}/jobs/${jobId}?questions=true`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`Greenhouse returned ${res.status} for job ${jobId} at ${boardToken}`);
      return null;
    }
    return (await res.json()) as GreenhouseJobDetail;
  } catch (err) {
    console.error(`Failed to fetch job ${jobId}:`, err);
    return null;
  }
}

/**
 * Fetch the embed page HTML and extract anti-fraud tokens.
 */
async function fetchEmbedTokens(
  boardToken: string,
  jobId: number
): Promise<{ fingerprint: string; renderDate: string; pageLoadTime: string } | null> {
  const url = `${EMBED_BASE}/job_app?for=${boardToken}&token=${jobId}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const fpMatch = html.match(/name="fingerprint"[^>]*value="([^"]+)"/);
    const rdMatch = html.match(/name="render_date"[^>]*value="([^"]+)"/);
    const pltMatch = html.match(/name="page_load_time"[^>]*value="([^"]+)"/);

    if (!fpMatch || !rdMatch || !pltMatch) {
      console.warn(`Could not extract embed tokens for ${boardToken}/${jobId} - may be new-style React form`);
      return null;
    }

    return {
      fingerprint: fpMatch[1],
      renderDate: rdMatch[1],
      pageLoadTime: pltMatch[1],
    };
  } catch (err) {
    console.error(`Failed to fetch embed page:`, err);
    return null;
  }
}

/**
 * Parse the embed HTML to extract question structure (field indices, question IDs, field types).
 */
async function parseEmbedQuestions(
  boardToken: string,
  jobId: number
): Promise<Array<{ index: number; questionId: string; fieldType: "boolean" | "text" }>> {
  const url = `${EMBED_BASE}/job_app?for=${boardToken}&token=${jobId}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();

    const questions: Array<{ index: number; questionId: string; fieldType: "boolean" | "text" }> = [];
    const qidPattern = /job_application\[answers_attributes\]\[(\d+)\]\[question_id\]"[^>]*value="(\d+)"/g;
    let match;
    while ((match = qidPattern.exec(html)) !== null) {
      const idx = parseInt(match[1], 10);
      const qid = match[2];
      // Check if this index has a boolean_value select or text_value textarea
      const hasBool = html.includes(`answers_attributes][${idx}][boolean_value]`);
      questions.push({ index: idx, questionId: qid, fieldType: hasBool ? "boolean" : "text" });
    }
    return questions;
  } catch {
    return [];
  }
}

/**
 * Map API question labels to embed form answer values.
 * Returns a map of { embed_field_name: value } entries.
 */
function mapQuestionsToEmbedFields(
  apiQuestions: GreenhouseQuestion[],
  embedQuestions: Array<{ index: number; questionId: string; fieldType: "boolean" | "text" }>,
  candidate: CandidateProfile
): Record<string, string> {
  const fields: Record<string, string> = {};

  // Match API questions to embed questions by question_id
  // API field names contain the question_id (e.g., "question_30496562002")
  for (const eq of embedQuestions) {
    // Find the matching API question
    const apiQ = apiQuestions.find((q) => {
      const field = q.fields[0];
      return field && field.name.includes(eq.questionId);
    });

    const prefix = `job_application[answers_attributes][${eq.index}]`;
    // Always include the hidden fields
    fields[`${prefix}[question_id]`] = eq.questionId;
    fields[`${prefix}[priority]`] = String(eq.index);

    if (!apiQ) {
      // Unknown question - use safe default
      if (eq.fieldType === "boolean") {
        fields[`${prefix}[boolean_value]`] = "1"; // Yes
      } else {
        fields[`${prefix}[text_value]`] = "N/A";
      }
      continue;
    }

    const label = apiQ.label.toLowerCase();
    const valueKey = eq.fieldType === "boolean" ? `${prefix}[boolean_value]` : `${prefix}[text_value]`;

    if (label.includes("previously applied") || label.includes("have you ever worked")) {
      fields[valueKey] = "0";
    } else if (label.includes("authorized to work") || label.includes("legally authorized")) {
      fields[valueKey] = candidate.authorizedToWork ? "1" : "0";
    } else if (label.includes("sponsorship") || label.includes("require sponsor") || label.includes("visa")) {
      fields[valueKey] = candidate.requiresSponsorship ? "1" : "0";
    } else if (label.includes("military") || label.includes("veteran") || label.includes("served")) {
      fields[valueKey] = candidate.veteranStatus ? "1" : "0";
    } else if (label.includes("privacy") || label.includes("consent") || label.includes("i accept")) {
      fields[valueKey] = "1";
    } else if (label.includes("note to hiring") || label.includes("anything else")) {
      fields[valueKey] = "";
    } else if (eq.fieldType === "boolean") {
      fields[valueKey] = "1"; // Default yes for required boolean questions
    } else {
      fields[valueKey] = "N/A";
    }
  }

  return fields;
}

/**
 * Submit an application via the Greenhouse embed form (old-style server-rendered forms).
 * This mimics a browser form submission.
 */
export async function submitApplication(
  boardToken: string,
  jobId: number,
  candidate: CandidateProfile,
  companyName: string
): Promise<ApplicationResult> {
  // 1. Fetch job details via API
  const job = await fetchJobWithQuestions(boardToken, jobId);
  if (!job) {
    return {
      success: false, jobId, boardToken, companyName,
      jobTitle: "Unknown", jobUrl: "",
      status: 0, message: "Failed to fetch job details",
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Fetch embed page tokens (anti-fraud)
  const tokens = await fetchEmbedTokens(boardToken, jobId);
  if (!tokens) {
    return {
      success: false, jobId, boardToken, companyName,
      jobTitle: job.title, jobUrl: job.absolute_url,
      status: 0, message: "Failed to fetch embed tokens - form may use reCAPTCHA (new-style React form)",
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Parse embed question structure
  const embedQuestions = await parseEmbedQuestions(boardToken, jobId);

  // 4. Build URLSearchParams for form submission
  const params = new URLSearchParams();

  // Anti-fraud / hidden fields
  params.append("utf8", "✓");
  params.append("fingerprint", tokens.fingerprint);
  params.append("render_date", tokens.renderDate);
  params.append("page_load_time", tokens.pageLoadTime);
  params.append("from_embed", "true");
  params.append("security_code", "");

  // Candidate info
  params.append("job_application[first_name]", candidate.firstName);
  params.append("job_application[last_name]", candidate.lastName);
  params.append("job_application[email]", candidate.email);
  params.append("job_application[phone]", candidate.phone);
  params.append("job_application[resume_text]", candidate.resumeText);

  // Custom question answers
  if (job.questions && embedQuestions.length > 0) {
    const questionFields = mapQuestionsToEmbedFields(job.questions, embedQuestions, candidate);
    for (const [key, value] of Object.entries(questionFields)) {
      params.append(key, value);
    }
  }

  // 5. Submit to embed endpoint
  const submitUrl = `${EMBED_BASE}/${boardToken}/jobs/${jobId}`;
  try {
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Origin: "https://boards.greenhouse.io",
        Referer: `${EMBED_BASE}/job_app?for=${boardToken}&token=${jobId}`,
      },
      body: params.toString(),
      redirect: "manual", // Don't follow redirects - a 302 means success
      signal: AbortSignal.timeout(30_000),
    });

    const status = res.status;
    const location = res.headers.get("location") || "";

    // Greenhouse redirects to a confirmation page on success (302)
    // or returns 200 with error messages on failure
    if (status === 302 || status === 301) {
      const isSuccess = location.includes("confirmation") || location.includes("thank");
      return {
        success: isSuccess,
        jobId, boardToken, companyName,
        jobTitle: job.title, jobUrl: job.absolute_url,
        status,
        message: isSuccess
          ? `Application submitted! Redirect: ${location}`
          : `Redirected to: ${location}`,
        timestamp: new Date().toISOString(),
      };
    }

    // 200 response - check if it's a success or error page
    const responseText = await res.text();
    const hasError = responseText.includes("error") || responseText.includes("invalid") || responseText.includes("required");
    const hasSuccess = responseText.includes("confirmation") || responseText.includes("thank you") || responseText.includes("submitted");

    // Extract error messages if any
    const errorMatches = responseText.match(/<li[^>]*class="[^"]*error[^"]*"[^>]*>(.*?)<\/li>/gi) || [];
    const errors = errorMatches.map(e => e.replace(/<[^>]+>/g, "").trim()).filter(Boolean);

    return {
      success: hasSuccess && !hasError,
      jobId, boardToken, companyName,
      jobTitle: job.title, jobUrl: job.absolute_url,
      status,
      message: errors.length > 0
        ? `Form errors: ${errors.join("; ")}`
        : hasSuccess ? "Application submitted successfully"
        : `HTTP ${status} response (${responseText.length} bytes)`,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false, jobId, boardToken, companyName,
      jobTitle: job.title, jobUrl: job.absolute_url,
      status: 0,
      message: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
