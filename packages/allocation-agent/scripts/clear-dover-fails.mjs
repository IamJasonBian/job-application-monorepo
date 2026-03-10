#!/usr/bin/env node
import Redis from "ioredis";

const r = new Redis({
  host: "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com",
  port: 17054,
  password: process.env.REDIS_PASSWORD,
});

const keys = await r.keys("dover_applications:*");
let cleared = 0;
for (const k of keys) {
  const val = JSON.parse(await r.get(k));
  if (val.status === "FAIL" || val.status === "ERROR") {
    await r.del(k);
    console.log(`Deleted: ${k} (${val.status}: ${val.company} - ${val.jobTitle})`);
    cleared++;
  }
}
console.log(`\nCleared ${cleared} FAIL/ERROR entries`);
await r.quit();
