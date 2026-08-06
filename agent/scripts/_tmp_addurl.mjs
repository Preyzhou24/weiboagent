import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/browser-comment.js";
let text = readFileSync(path, "utf-8");

// 1. Add postUrl param to commentOnPost
text = text.replace("function commentOnPost(id, commentText) {", "function commentOnPost(id, commentText, postUrl) {");

// 2. Use postUrl if provided, else fall back to detail URL
const oldLine = "  const detailUrl = `https://weibo.com/detail/${numericMid}`;";
const newLine = "  const detailUrl = postUrl || `https://weibo.com/detail/${numericMid}`;";
if (text.includes(oldLine)) {
  text = text.replace(oldLine, newLine);
} else {
  throw new Error("detailUrl line not found");
}

// 3. Update entry point to pass args.url
text = text.replace("  commentOnPost(args.id, args.comment);", "  commentOnPost(args.id, args.comment, args.url);");

writeFileSync(path, text, "utf-8");
console.log("browser-comment.js: added --url support");
