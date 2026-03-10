#!/usr/bin/env node
/**
 * Pull fresh jobs from Greenhouse API for all tracked companies and update Redis.
 * Local equivalent of the fetch-jobs-worker-background Netlify function.
 *
 * Usage: REDIS_PASSWORD=... node scripts/refresh-jobs.mjs [company]
 */
import Redis from "ioredis";
import { createHash } from "crypto";

const REDIS_URL = "redis://default:" + (process.env.REDIS_PASSWORD || "") + "@redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com:17054";

const companies = [
  { boardToken: "clearstreet", displayName: "Clear Street" },
  { boardToken: "aquaticcapitalmanagement", displayName: "Aquatic Capital" },
  { boardToken: "gravitonresearchcapital", displayName: "Graviton Research" },
  { boardToken: "drweng", displayName: "DRW" },
  { boardToken: "oldmissioncapital", displayName: "Old Mission Capital" },
  { boardToken: "imc", displayName: "IMC Trading" },
  { boardToken: "jumptrading", displayName: "Jump Trading" },
  { boardToken: "point72", displayName: "Point72" },
  { boardToken: "janestreet", displayName: "Jane Street" },
  { boardToken: "twosigma", displayName: "Two Sigma" },
  { boardToken: "citabortsecurities", displayName: "Citadel Securities" },
  { boardToken: "deshaw", displayName: "D.E. Shaw" },
  { boardToken: "sig", displayName: "Susquehanna (SIG)" },
  { boardToken: "wolverine", displayName: "Wolverine Trading" },
  { boardToken: "radixtrading", displayName: "Radix Trading" },
  { boardToken: "aqr", displayName: "AQR Capital" },
  { boardToken: "millenniumadvisors", displayName: "Millennium" },
];

function contentHash(title, location, dept) {
  return createHash("sha256").update(`${title}|${location}|${dept}`).digest("hex").slice(0, 16);
}

function extractTags(title, dept) {
  const tags = new Set();
  const t = (title + " " + dept).toLowerCase();
  if (t.includes("quant")) tags.add("quantitative");
  if (t.includes("data")) tags.add("data");
  if (t.includes("software") || t.includes("engineer")) tags.add("engineering");
  if (t.includes("research")) tags.add("research");
  if (t.includes("machine learning") || t.includes("ml ") || t.includes("ai ")) tags.add("ml");
  if (t.includes("trad")) tags.add("trading");
  if (t.includes("infra")) tags.add("infrastructure");
  if (t.includes("devops") || t.includes("sre") || t.includes("reliability")) tags.add("devops");
  return tags;
}

function normalizeLocation(loc) {
  return loc.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function fetchGreenhouseJobs(boardToken) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs || [];
  } catch {
    return [];
  }
}

async function main() {
  const targetCompany = process.argv[2] || null;
  const redis = new Redis(REDIS_URL);
  await redis.ping();

  const toProcess = targetCompany
    ? companies.filter(c => c.boardToken === targetCompany)
    : companies;

  let totalNew = 0, totalUpdated = 0, totalUnchanged = 0;

  for (const company of toProcess) {
    const { boardToken, displayName } = company;
    process.stdout.write(`${displayName} (${boardToken})...`);

    const apiJobs = await fetchGreenhouseJobs(boardToken);
    if (apiJobs.length === 0) {
      console.log(" 0 jobs (skipped)");
      continue;
    }

    const now = new Date();
    const nowTs = now.getTime() / 1000;
    const nowIso = now.toISOString();
    const pipe = redis.pipeline();
    let newCount = 0, updatedCount = 0, unchangedCount = 0;

    for (const job of apiJobs) {
      const jobId = String(job.id);
      const compositeKey = `${boardToken}:${jobId}`;
      const hashKey = `jobs:${boardToken}:${jobId}`;
      const title = job.title;
      const locationRaw = job.location?.name || "Unknown";
      const dept = job.departments?.[0]?.name || "General";
      const updated = job.updated_at || nowIso;
      const hash = contentHash(title, locationRaw, dept);
      const tags = extractTags(title, dept);
      const normLoc = normalizeLocation(locationRaw);

      const existingHash = await redis.hget(hashKey, "content_hash");

      if (existingHash === null) {
        newCount++;
        pipe.hset(hashKey, {
          job_id: jobId, company: boardToken, company_name: displayName,
          title, url: job.absolute_url, department: dept, location: locationRaw,
          status: "active", first_seen_at: nowIso, last_seen_at: nowIso,
          updated_at: updated, content_hash: hash, tags: [...tags].sort().join(","),
        });
        pipe.sadd(`idx:company:${boardToken}`, compositeKey);
        pipe.sadd("idx:status:active", compositeKey);
        pipe.zadd("feed:new", nowTs.toString(), compositeKey);
        pipe.zadd(`feed:company:${boardToken}`, nowTs.toString(), compositeKey);
        for (const tag of tags) pipe.sadd(`idx:tag:${tag}`, compositeKey);
      } else if (existingHash !== hash) {
        updatedCount++;
        pipe.hset(hashKey, {
          title, url: job.absolute_url, department: dept, location: locationRaw,
          status: "active", last_seen_at: nowIso, updated_at: updated,
          content_hash: hash, tags: [...tags].sort().join(","),
        });
      } else {
        unchangedCount++;
        pipe.hset(hashKey, "last_seen_at", nowIso);
      }
    }

    await pipe.exec();
    await redis.set(`meta:last_fetch:${boardToken}`, nowIso);

    console.log(` ${apiJobs.length} jobs (new=${newCount} updated=${updatedCount} unchanged=${unchangedCount})`);
    totalNew += newCount;
    totalUpdated += updatedCount;
    totalUnchanged += unchangedCount;

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nTotal: new=${totalNew} updated=${totalUpdated} unchanged=${totalUnchanged}`);
  await redis.quit();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
