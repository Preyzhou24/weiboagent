import { readFileSync } from "node:fs";
const text = readFileSync("scripts/browser-like.js", "utf-8");
// Find likeJs array and check for non-ASCII
const start = text.indexOf("const likeJs = [");
const end = text.indexOf("].join(\" \");", start);
const likeJsSection = text.slice(start, end);
console.log("likeJs section length:", likeJsSection.length);
let nonAsciiCount = 0;
for (let i = 0; i < likeJsSection.length; i++) {
  const code = likeJsSection.charCodeAt(i);
  if (code > 127) {
    nonAsciiCount++;
    if (nonAsciiCount <= 5) console.log("non-ASCII at", i, "charCode:", code, "char:", likeJsSection[i]);
  }
}
console.log("total non-ASCII chars in likeJs:", nonAsciiCount);
