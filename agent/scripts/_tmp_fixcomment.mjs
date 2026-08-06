import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-comment.js";
let text = readFileSync(path, "utf-8");

// Remove comment-string lines from the commentJs array (same issue as likeJs)
const lines = text.split("\n");
const newLines = [];
let inCommentJs = false;
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("const commentJs = [")) inCommentJs = true;
  if (inCommentJs && line.includes("// ") && line.includes('",') && !line.includes("const commentJs")) {
    removed++;
    continue;
  }
  newLines.push(line);
  if (inCommentJs && line.includes("].join(")) inCommentJs = false;
}

let result = newLines.join("\n");

// Fix the rate-limit regex mojibake if present
const oldRe = /const isRateLimited = \/[^]*?\.test\(msg\);/;
const m = result.match(oldRe);
if (m && /[^\x00-\x7F]/.test(m[0])) {
  result = result.replace(m[0], "const isRateLimited = /frequent|busy|try later|too fast/i.test(msg);");
}

writeFileSync(path, result, "utf-8");
console.log("browser-comment.js: removed " + removed + " comment lines");
