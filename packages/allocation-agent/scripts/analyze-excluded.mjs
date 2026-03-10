#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";

const jobs = JSON.parse(readFileSync(resolve(import.meta.dirname, "dover-jobs.json"), "utf-8"));

const includeKw = ["software","engineer","developer","data","machine learning","ml ","backend","back-end","full stack","full-stack","fullstack","infrastructure","platform","devops","sre","reliability","quantitative","quant","analyst","scientist","python","java","cloud","systems","founding","frontend","front-end","mobile","ios","android","architect","tech lead","technical lead","head of engineering","ai ","robotics","automation","security","cyber","product engineer","implementation engineer"];
const excludeKw = ["intern","recruiter","recruiting","human resources","sales","marketing","design","product manager","account manager","account executive","partnership manager","clinical","nurse","medical","pharmacist","customer success","customer support","executive assistant","office manager","content","copywriter","pr ","public relations","legal","paralegal","attorney","counsel","accountant","bookkeeper","controller","compliance","solutions consultant","gtm"];

const noMatch = [];
for (const j of jobs) {
  const t = j.title.toLowerCase();
  const hasInclude = includeKw.some(k => t.includes(k));
  const hasExclude = excludeKw.some(k => t.includes(k));
  if (!hasExclude && !hasInclude) {
    noMatch.push(`${j.company}: ${j.title}`);
  }
}

console.log(`Jobs excluded by NO KEYWORD MATCH (${noMatch.length} total):\n`);
noMatch.forEach(j => console.log("  " + j));
