import { readFileSync } from "fs";
const html = readFileSync("/dev/stdin", "utf8");
const re = /name="cards\[([^\]]+)\]\[baseTemplate\]"\s+value="((?:[^"\\]|\\.|&[^;]+;)*)"/g;
let m;
while ((m = re.exec(html)) !== null) {
  const val = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  try {
    const data = JSON.parse(val);
    console.log("Card:", data.text);
    data.fields?.forEach((f, i) =>
      console.log(" ", i, f.type.padEnd(16), f.required ? "*" : " ", f.text.substring(0, 100))
    );
  } catch (e) {
    console.log("Parse error:", e.message.substring(0, 80));
  }
}
