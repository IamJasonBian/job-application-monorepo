import type { GreenhouseJob, JobMatch } from "./types.js";
import type { CandidateProfile } from "../config/candidate.js";

/**
 * Score a job against the candidate profile.
 * Higher score = better match.
 */
function scoreJob(
  job: GreenhouseJob,
  candidate: CandidateProfile
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const titleLower = job.title.toLowerCase();
  const locationLower = job.location.name.toLowerCase();

  // Title match against target roles
  for (const role of candidate.targetRoles) {
    if (titleLower.includes(role)) {
      score += 30;
      reasons.push(`Title matches target role: "${role}"`);
    }
  }

  // Location match
  for (const loc of candidate.targetLocations) {
    if (locationLower.includes(loc)) {
      score += 20;
      reasons.push(`Location match: "${loc}"`);
      break;
    }
  }

  // Penalize intern roles
  if (titleLower.includes("intern")) {
    score -= 50;
    reasons.push("Internship role (penalized)");
  }

  // Penalize senior/staff/principal/lead (might still be relevant)
  if (titleLower.includes("senior") || titleLower.includes("staff") || titleLower.includes("principal")) {
    score += 5;
    reasons.push("Senior-level role");
  }

  // Boost for exact "data engineer" match
  if (titleLower.includes("data engineer")) {
    score += 25;
    reasons.push("Exact data engineer match");
  }

  // Boost for python-related roles
  if (titleLower.includes("python")) {
    score += 15;
    reasons.push("Python in title");
  }

  return { score, reasons };
}

/**
 * Find the best matching jobs across all companies.
 */
export function findMatchingJobs(
  allJobs: Array<{ boardToken: string; companyName: string; jobs: GreenhouseJob[] }>,
  candidate: CandidateProfile,
  limit: number = 10,
  minScore: number = 40
): JobMatch[] {
  const matches: JobMatch[] = [];

  for (const { boardToken, companyName, jobs } of allJobs) {
    for (const job of jobs) {
      const { score, reasons } = scoreJob(job, candidate);
      if (score >= minScore) {
        matches.push({
          job,
          boardToken,
          companyName,
          score,
          matchReasons: reasons,
        });
      }
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}
