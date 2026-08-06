import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-like.js";
let text = readFileSync(path, "utf-8");
// The rate-limit regex has mojibake that breaks base64 encoding.
// Find and replace the whole regex with a clean ASCII version.
const oldRe = /const isRateLimited = \/frequent\|busy\|try later\|too fast\|[^/]*\/i\.test\(msg\);/;
const match = text.match(oldRe);
if (match) {
  text = text.replace(match[0], "const isRateLimited = /frequent|busy|try later|too fast/i.test(msg);");
  writeFileSync(path, text, "utf-8");
  console.log("Fixed mojibake regex in browser-like.js");
} else {
  console.log("Regex not found, dumping context...");
  const idx = text.indexOf("isRateLimited");
  console.log(text.slice(idx, idx + 80));
}
