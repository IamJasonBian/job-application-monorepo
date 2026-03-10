#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";

const jobs = JSON.parse(readFileSync(resolve(import.meta.dirname, "dover-jobs.json"), "utf-8"));

const includeKw = ["software","engineer","developer","data","machine learning","ml ","backend","back-end","full stack","full-stack","fullstack","infrastructure","platform","devops","sre","reliability","quantitative","quant","analyst","scientist","python","java","cloud","systems","founding"];
const excludeKw = ["intern","recruiter","recruiting","human resources","sales","marketing","design","product manager","account manager","account executive","partnership manager","clinical","nurse","medical","pharmacist","customer success","customer support","executive assistant","office manager","content","copywriter","pr ","public relations","legal","paralegal","attorney","counsel","accountant","bookkeeper","controller","compliance","solutions consultant","gtm"];
const nonUS = ["international","brazil","europe","india","nigeria","australia","london","uk","berlin","germany","toronto","canada","singapore","hong kong","japan","korea","south africa","africa","remote (international","latin america","latam","mexico","philippines","pakistan","bangladesh","vietnam","tel aviv","israel","dubai","lithuania","spain","romania","portugal","poland","armenia"];

let passTitle = 0, failTitle = 0, failLocation = 0, passAll = 0;
const titlePassLocFail = [];
const titleFail = [];

for (const j of jobs) {
  const t = j.title.toLowerCase();
  const loc = (j.locations || "").toLowerCase();
  const hasInclude = includeKw.some(k => t.includes(k));
  const hasExclude = excludeKw.some(k => t.includes(k));
  const hasNonUS = nonUS.some(k => loc.includes(k));

  if (hasExclude) { failTitle++; titleFail.push(`[EXCLUDE] ${j.company}: ${j.title}`); continue; }
  if (hasInclude === false) { failTitle++; titleFail.push(`[NO MATCH] ${j.company}: ${j.title}`); continue; }
  passTitle++;
  if (hasNonUS) { failLocation++; titlePassLocFail.push(`${j.company}: ${j.title} [${j.locations}]`); continue; }
  passAll++;
}

console.log(`Title filter: ${passTitle} pass, ${failTitle} fail`);
console.log(`Location filter: ${failLocation} excluded from title-pass`);
console.log(`Final: ${passAll} pass all filters\n`);

console.log("Jobs excluded by LOCATION (title-relevant):");
titlePassLocFail.forEach(j => console.log("  " + j));

console.log("\nSample title-excluded jobs (first 30):");
titleFail.slice(0, 30).forEach(j => console.log("  " + j));
