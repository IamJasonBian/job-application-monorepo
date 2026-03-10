#!/usr/bin/env node
import Redis from "ioredis";

const r = new Redis({
  host: "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com",
  port: 17054,
  password: process.env.REDIS_PASSWORD,
});

const keys = await r.keys("dover_applications:*");
console.log(`Total Dover application records: ${keys.length}\n`);

const results = {};
for (const k of keys.sort()) {
  const val = JSON.parse(await r.get(k));
  const status = val.status || "UNKNOWN";
  if (!results[status]) results[status] = [];
  results[status].push({ key: k, title: val.jobTitle, company: val.company });
}

for (const [status, items] of Object.entries(results)) {
  console.log(`${status}: ${items.length}`);
  for (const i of items) console.log(`  ${i.company} - ${i.title}`);
  console.log();
}

await r.quit();
