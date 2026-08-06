import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-like.js";
let text = readFileSync(path, "utf-8");
// Remove the comment-string lines from likeJs array - they cause syntax errors when joined
const comments = [
  '    "// Success: HTTP 200 + response has an \'attitude\' field (e.g. \'heart\').",\n',
  '    "// setLike is idempotent: liking an already-liked post returns 200 + attitude record.",\n',
  '    "// Error shape: { ok: 0, message: \'...\' }",\n',
  '    "// Unknown success-ish shape.",\n',
];
let removed = 0;
for (const c of comments) {
  if (text.includes(c)) {
    text = text.replace(c, "");
    removed++;
  }
}
writeFileSync(path, text, "utf-8");
console.log("Removed " + removed + " comment lines from likeJs");
