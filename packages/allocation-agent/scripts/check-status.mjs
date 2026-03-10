import Redis from "ioredis";
const client = new Redis("redis://default:64n39uHOB0KEYZsfNbOdaGboWPZ0tOy4@redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com:17054");
const keys = await client.keys("gh_applied:*");
const byCompany = {};
for (const k of keys.sort()) {
  const val = await client.get(k);
  const parts = k.split(":");
  const company = parts[1];
  const obj = JSON.parse(val);
  if (!(company in byCompany)) byCompany[company] = { PASS: 0, FAIL: 0, ERROR: 0, in_progress: 0 };
  byCompany[company][obj.status] = (byCompany[company][obj.status] || 0) + 1;
}
console.log("Greenhouse applications by company:");
for (const [c, s] of Object.entries(byCompany).sort()) {
  console.log(`  ${c}: PASS=${s.PASS} FAIL=${s.FAIL} ERROR=${s.ERROR} in_progress=${s.in_progress}`);
}
console.log("\nTotal keys:", keys.length);

for (const prefix of ["clearstreet", "imc"]) {
  const filtered = keys.filter(k => k.includes(":" + prefix + ":"));
  if (filtered.length > 0) {
    console.log(`\n${prefix} detail:`);
    for (const k of filtered.sort()) {
      const val = await client.get(k);
      const obj = JSON.parse(val);
      console.log(`  ${k.split(":").pop()} - ${obj.status} - ${(obj.title || "").substring(0, 50)}`);
    }
  }
}
await client.quit();
