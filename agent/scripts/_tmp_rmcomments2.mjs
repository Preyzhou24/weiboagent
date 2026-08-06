import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-like.js";
let text = readFileSync(path, "utf-8");
// The likeJs has comment strings that start with //  inside the JS string array.
// When joined with spaces, they become inline comments that eat the rest of the line.
// Remove any array element that is a comment line (starts with "    "//).
const lines = text.split("\n");
const newLines = [];
let inLikeJs = false;
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("const likeJs = [")) inLikeJs = true;
  if (inLikeJs && line.includes("// ") && line.includes('",') && !line.includes("const likeJs")) {
    // This is a comment string element like: "    // Success: ...",
    removed++;
    continue;
  }
  newLines.push(line);
  if (inLikeJs && line.includes("].join(")) inLikeJs = false;
}
writeFileSync(path, newLines.join("\n"), "utf-8");
console.log("Removed " + removed + " comment lines from likeJs");
