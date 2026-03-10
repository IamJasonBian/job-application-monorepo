#!/usr/bin/env node
import Redis from "ioredis";
const client = new Redis("redis://default:64n39uHOB0KEYZsfNbOdaGboWPZ0tOy4@redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com:17054");

const companies = ["point72", "clearstreet", "oldmissioncapital", "jumptrading", "drweng", "imc", "gravitonresearchcapital", "janestreet", "aqr"];
const keywords = ["data", "engineer", "quant", "developer", "software", "analyst", "scientist", "machine learning", "ml ", "research", "infrastructure", "platform", "backend", "full stack", "full-stack", "devops", "sre", "reliability"];
const usLocations = ["new york", "chicago", "stamford", "united states", "austin", "greenwich", "florida", "del mar", "tampa", "ct", "ny", "il"];
const skipWords = ["intern", "campus", "2026 summer", "2027", "summer 2026", "2026/27", "fall 2025", "spring 2026", "2026 quant academy"];

for (const company of companies) {
  const jobKeys = await client.keys("jobs:" + company + ":*");
  const relevant = [];
  for (const k of jobKeys) {
    const data = await client.hgetall(k);
    const title = (data.title || "").toLowerCase();
    const loc = (data.location || "").toLowerCase();
    const isRelevant = keywords.some(kw => title.includes(kw));
    const isUS = usLocations.some(l => loc.includes(l));
    const isIntern = skipWords.some(w => title.toLowerCase().includes(w));
    if (isRelevant && isUS && !isIntern) {
      relevant.push({ id: data.job_id, title: data.title, location: (data.location || "").trim(), boardToken: data.board_token || "" });
    }
  }
  if (relevant.length > 0) {
    console.log(`\n${company} (${relevant.length} US non-intern roles):`);
    if (relevant[0].boardToken) console.log(`  board_token: ${relevant[0].boardToken}`);
    for (const j of relevant.sort((a, b) => a.title.localeCompare(b.title))) {
      console.log(`  ${j.id} - ${j.title} [${j.location}]`);
    }
  }
}

await client.quit();
