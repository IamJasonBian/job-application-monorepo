#!/usr/bin/env node
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto("https://jobs.lever.co/voleon/e47d5699-5c1a-4b17-bbf4-c948efc0151d/apply", { waitUntil: "networkidle2", timeout: 30000 });

const captchaDetail = await p.evaluate(() => {
  const result = {};

  // Check grecaptcha details
  if (typeof window.grecaptcha !== "undefined") {
    result.grecaptchaType = "present";
    try {
      result.hasEnterprise = typeof window.grecaptcha.enterprise !== "undefined";
    } catch { result.hasEnterprise = false; }
  }

  // Check hCaptcha
  const hcDiv = document.querySelector(".h-captcha, [data-hcaptcha-widget-id]");
  if (hcDiv) {
    result.hcaptchaSitekey = hcDiv.getAttribute("data-sitekey") || "unknown";
    result.hcaptchaSize = hcDiv.getAttribute("data-size") || "normal";
    result.hcaptchaCallback = hcDiv.getAttribute("data-callback") || "";
  }

  // Check recaptcha div
  const rcDiv = document.querySelector(".g-recaptcha, [data-sitekey]");
  if (rcDiv) {
    result.recaptchaSitekey = rcDiv.getAttribute("data-sitekey") || "unknown";
    result.recaptchaSize = rcDiv.getAttribute("data-size") || "normal";
    result.recaptchaCallback = rcDiv.getAttribute("data-callback") || "";
  }

  // Check for hidden captcha inputs
  const captchaInputs = document.querySelectorAll("input[name*='captcha'], input[name*='recaptcha'], input[name*='hcaptcha'], input[name*='token']");
  result.captchaInputs = Array.from(captchaInputs).map(el => ({
    name: el.name,
    type: el.type,
    value: (el.value || "").substring(0, 30),
  }));

  // Check all hidden inputs
  const hiddenInputs = document.querySelectorAll("input[type='hidden']");
  result.hiddenInputs = Array.from(hiddenInputs).map(el => ({
    name: el.name,
    value: (el.value || "").substring(0, 50),
  }));

  // Check form submit button details
  const submitBtn = document.querySelector("button[type='submit'], .postings-btn-submit");
  result.submitButtonHTML = submitBtn?.outerHTML?.substring(0, 200) || "not found";

  // Check iframes
  result.iframes = Array.from(document.querySelectorAll("iframe")).map(f => ({
    src: (f.src || "").substring(0, 100),
    title: f.title || "",
    width: f.width,
    height: f.height,
  }));

  return result;
});

console.log(JSON.stringify(captchaDetail, null, 2));
await b.close();
