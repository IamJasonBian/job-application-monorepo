#!/usr/bin/env node
/**
 * Batch Greenhouse Apply - applies to multiple jobs sequentially
 * Uses Redis to track which jobs have been applied to.
 *
 * Usage:
 *   node scripts/batch-greenhouse.mjs [company]
 *   node scripts/batch-greenhouse.mjs point72
 *   node scripts/batch-greenhouse.mjs all
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, REDIS_PASSWORD
 */
import { execSync, spawn } from "child_process";
import Redis from "ioredis";

const REDIS_URL = "redis://default:" + (process.env.REDIS_PASSWORD || "") + "@redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com:17054";

// Resume variants - rotated per job application
const RESUME_VARIANTS = [
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb (1).pdf",
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb (2).pdf",
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb (3).pdf",
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb (4).pdf",
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb_oct10.pdf",
  "/Users/jasonzb/Desktop/apollo/allocation-agent/blob/resume_jasonzb_oct15_m.pdf",
];

// Focused job list: Data/Software/ML/Quant roles at US locations
// Board token = company key in Redis
const JOBS = {
  point72: [
    // Data Engineer roles
    { id: "8303740002", title: "Data Engineer [New York]" },
    { id: "7829230002", title: "Data Engineer [New York]" },
    { id: "8352153002", title: "Data Engineer [United States]" },
    { id: "7667745002", title: "Data Engineer, Proprietary Research [New York, NY]" },
    { id: "7992718002", title: "Data Engineer, Technology [New York | Stamford]" },
    { id: "7769261002", title: "Senior Data Engineer, Proprietary Research [New York]" },
    // Data Scientist roles
    { id: "7045938002", title: "Cubist Data Scientist [New York]" },
    { id: "7045979002", title: "Cubist Senior Data Scientist [New York]" },
    { id: "8372544002", title: "Data Scientist [Chicago, New York]" },
    { id: "7695570002", title: "Data Scientist, Proprietary Research [New York, NY]" },
    // ML / AI Engineer
    { id: "8170176002", title: "Machine Learning Engineer [New York]" },
    { id: "8342478002", title: "Machine Learning Engineer, GenAI Technology [United States]" },
    { id: "8351985002", title: "AI Engineer – Investment Research & Workflows [New York]" },
    { id: "8041302002", title: "AI Engineer, IS [United States]" },
    { id: "7661997002", title: "NLP / AI Engineer [New York]" },
    { id: "7825077002", title: "NLP Engineer [New York]" },
    { id: "8018850002", title: "NLP Engineer [New York]" },
    // Software Engineer roles
    { id: "8109650002", title: "Cloud Engineer [New York, NY]" },
    { id: "8402418002", title: "Software Engineer [United States]" },
    { id: "8180667002", title: "Software Engineer, Commodities Technology [New York, NY]" },
    { id: "8377040002", title: "Software Engineer, Execution Services [New York, NY]" },
    { id: "8377045002", title: "Software Engineer, Fundamental Research Tools [New York]" },
    { id: "8236933002", title: "Software Engineer, Macro Data Technology [New York, NY]" },
    { id: "8060321002", title: "Software Engineer, Macro Quant Analytics [United States]" },
    { id: "8161729002", title: "Software Engineer, Risk Technology [New York]" },
    { id: "8428202002", title: "Software Engineer, Infrastructure Automation [United States]" },
    // Quant Developer
    { id: "8389369002", title: "Fund Flow Quantitative Developer [New York, Stamford]" },
    { id: "8036928002", title: "Quantitative Software Developer [New York]" },
    { id: "8032153002", title: "Quantitative Software Developer [New York]" },
    { id: "7825863002", title: "Quantitative Software Developer [New York]" },
    { id: "7297622002", title: "Quantitative Analyst / Software Developer [New York]" },
  ],

  clearstreet: [
    { id: "6675504", title: "Backend Software Engineer - Reference Data Services [New York, NY]" },
    { id: "7361221", title: "Senior Software Engineer [New York, NY]" },
    { id: "7481358", title: "Senior Software Engineer - Broker-Dealer Clearing (BDC) [New York, NY]" },
    { id: "7125241", title: "Senior Software Engineer - Java Full Stack - Futures Engineering [Chicago, IL]" },
    { id: "7365857", title: "Senior Software Engineer - Portfolio Management [New York, NY]" },
    { id: "7387150", title: "Senior Software Engineer - Studio - Java, AI [New York, NY]" },
    { id: "7250918", title: "Senior Software Engineer - Trade Processing Middle Office Platform [New York, NY]" },
    { id: "7535167", title: "Software Engineer - Infrastructure [New York, NY]" },
    { id: "7435714", title: "Software Engineer - Institutional Relationship Management [New York, NY]" },
    { id: "7466159", title: "Software Engineer - Low Touch Desk [New York, NY]" },
    { id: "7466108", title: "Software Engineer - Low Touch Desk [New York, NY]" },
    { id: "7120660", title: "Software Engineer - Market Data [New York, NY]" },
    { id: "7258580", title: "Software Engineer, Full Stack - Risk Engineering [New York, NY]" },
    { id: "6921626", title: "Staff Software Engineer - Trading Systems [New York, NY]" },
    { id: "7616915", title: "Vice President, DevOps [New York, NY]" },
  ],

  oldmissioncapital: [
    { id: "5607344003", title: "C++ Software Engineer [New York, NY]" },
    { id: "5607340003", title: "C++ Software Engineer [Chicago, IL]" },
    { id: "7598388003", title: "ETF Pricing Engineer [Chicago, IL]" },
    { id: "5594469003", title: "Python Software Engineer [Chicago, IL]" },
    { id: "4461365003", title: "Quantitative Researcher [New York, NY]" },
    { id: "7608814003", title: "Quantitative Researcher (Systematic Equities) [New York, NY]" },
    { id: "6549687003", title: "Senior Front End Software Engineer [Chicago/New York]" },
  ],

  jumptrading: [
    { id: "7294191", title: "Quantitative Researcher | Trading Team [Chicago or NYC]" },
    { id: "6451571", title: "Software Engineer | Core Development [Chicago, New York, Austin]" },
    { id: "6032511", title: "Research Scientist/Research Engineer | Deep Learning [Chicago, NYC, London]" },
    { id: "4982814", title: "AI Research Scientist | R&D [New York, London]" },
  ],

  drweng: [
    { id: "6586001", title: "AI Engineer [Chicago]" },
    { id: "7421010", title: "Data Engineer, Cumberland/FICCO [Chicago]" },
    { id: "7184385", title: "Data Engineer, Unified Platform [Chicago]" },
    { id: "7290446", title: "Python Engineer - GD1 [New York, Chicago]" },
    { id: "7545859", title: "Python Software Engineer, Trading Platform [Chicago, New York]" },
    { id: "7544086", title: "Quantitative Researcher - Machine Learning [New York]" },
    { id: "6973885", title: "Research Engineer [New York City]" },
    { id: "7097016", title: "Research Engineer (FICCO) [Greenwich]" },
    { id: "7377915", title: "Research Engineer (FICCO) [Chicago]" },
    { id: "7517378", title: "Senior Software Engineer - Analytics Front Office [Chicago, Greenwich, NYC]" },
    { id: "7160597", title: "Senior Software Engineer, C/FICCO Data [Chicago]" },
    { id: "7176348", title: "Senior Software Engineer, C/FICCO Data [New York City]" },
    { id: "7288315", title: "Software Engineer, Cumberland/FICCO Tools [Greenwich]" },
    { id: "7392396", title: "Software Engineer, Cumberland/FICCO Tools [New York City]" },
    { id: "7561710", title: "Software Engineer, Market Data - Cumberland [Chicago]" },
    { id: "7563830", title: "Software Engineer, Market Data - Cumberland [New York City]" },
    { id: "7283668", title: "Software Engineer, Research – Cumberland Systematic [Chicago]" },
    { id: "7553031", title: "Software Engineer, Unified Platform [Chicago]" },
    { id: "7456481", title: "Full Stack Engineer, Blockchain Product [Austin, Chicago, Houston, NYC, London]" },
  ],

  imc: [
    { id: "4439297101", title: "Data Engineer [Chicago]" },
    { id: "4673650101", title: "C++ Software Engineer [Chicago]" },
    { id: "4570309101", title: "Machine Learning Engineer [Chicago]" },
    { id: "4573906101", title: "Machine Learning Research Lead [Chicago, NYC]" },
    { id: "4699252101", title: "Machine Learning Researcher [Chicago, NYC]" },
    { id: "4778139101", title: "Quantitative Developer [New York]" },
    { id: "4653321101", title: "Research Engineer [Chicago, NYC]" },
    { id: "4577504101", title: "Software Engineer, Early Career [Chicago]" },
    { id: "4704856101", title: "Trading Engineer - Execution [Chicago]" },
    { id: "4439286101", title: "Trading Engineer - Strategy [Chicago]" },
    { id: "4683475101", title: "Developer Productivity Engineer [Chicago]" },
  ],

  gravitonresearchcapital: [
    // All India-based, skip for now
  ],
};

async function main() {
  const targetCompany = process.argv[2] || "all";
  const redis = new Redis(REDIS_URL);

  const companies = targetCompany === "all"
    ? Object.keys(JOBS).filter(c => JOBS[c].length > 0)
    : [targetCompany];

  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let variantCounter = 0;
  const results = [];

  for (const company of companies) {
    const jobs = JOBS[company];
    if (!jobs || jobs.length === 0) {
      console.log(`\nSkipping ${company} (no jobs)`);
      continue;
    }
    console.log(`\n${"=".repeat(60)}`);
    console.log(`COMPANY: ${company} (${jobs.length} jobs)`);
    console.log("=".repeat(60));

    for (const job of jobs) {
      const redisKey = `gh_applied:${company}:${job.id}`;
      const existing = await redis.get(redisKey);

      if (existing) {
        const data = JSON.parse(existing);
        console.log(`  SKIP ${job.id} - ${job.title} (already ${data.status})`);
        totalSkipped++;
        results.push({ company, id: job.id, title: job.title, status: "SKIP" });
        continue;
      }

      // Pick resume variant (round-robin)
      const variant = RESUME_VARIANTS[variantCounter % RESUME_VARIANTS.length];
      const variantName = variant.split("/").pop();
      variantCounter++;

      console.log(`\n  APPLYING: ${job.id} - ${job.title}`);
      console.log(`  RESUME: ${variantName}`);

      // Mark as in-progress in Redis
      await redis.set(redisKey, JSON.stringify({ status: "in_progress", title: job.title, resumeVariant: variantName, startedAt: new Date().toISOString() }), "EX", 86400 * 90);

      try {
        // Run test-apply.mjs as a child process with resume variant
        const output = execSync(
          `node scripts/test-apply.mjs ${company} ${job.id}`,
          {
            cwd: "/Users/jasonzb/conductor/workspaces/allocation-notification-service-v1/asuncion",
            env: { ...process.env, PATH: process.env.PATH, RESUME_PATH: variant },
            timeout: 300_000, // 5 min per job
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        // Check output for PASS/FAIL
        const lastLines = output.split("\n").slice(-10).join("\n");
        const isPASS = lastLines.includes("PASS") || output.includes("Application submitted");
        const status = isPASS ? "PASS" : "FAIL";

        await redis.set(redisKey, JSON.stringify({
          status,
          title: job.title,
          resumeVariant: variantName,
          appliedAt: new Date().toISOString(),
          output: lastLines.substring(0, 500),
        }), "EX", 86400 * 90);

        console.log(`  RESULT: ${status}`);
        if (isPASS) totalApplied++;
        else totalFailed++;
        results.push({ company, id: job.id, title: job.title, status });

      } catch (err) {
        const errOutput = (err.stdout || "") + "\n" + (err.stderr || "");
        const lastLines = errOutput.split("\n").slice(-10).join("\n");
        console.log(`  ERROR: ${err.message.substring(0, 100)}`);

        await redis.set(redisKey, JSON.stringify({
          status: "ERROR",
          title: job.title,
          resumeVariant: variantName,
          error: err.message.substring(0, 200),
          appliedAt: new Date().toISOString(),
          output: lastLines.substring(0, 500),
        }), "EX", 86400 * 90);

        totalFailed++;
        results.push({ company, id: job.id, title: job.title, status: "ERROR" });
      }

      // Wait between applications (avoid Gmail picking up wrong security codes)
      console.log("  Waiting 5s before next application...");
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("BATCH RESULTS SUMMARY");
  console.log("=".repeat(60));
  console.log(`Applied: ${totalApplied} | Skipped: ${totalSkipped} | Failed: ${totalFailed}`);
  for (const r of results) {
    console.log(`  ${r.status.padEnd(6)} ${r.company}/${r.id} - ${r.title}`);
  }

  await redis.quit();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
