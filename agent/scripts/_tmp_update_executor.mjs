import { readFileSync, writeFileSync } from "node:fs";

const path = "workflows/executors/weibo-feed-monitor.ts";
let text = readFileSync(path, "utf-8");

// 1. browserLike: accept postUrl param and pass --url
text = text.replace(
  "function browserLike(postId: string): any {",
  "function browserLike(postId: string, postUrl?: string): any {"
);
text = text.replace(
  '    const out = execSync(`node "${BROWSER_LIKE}" like --id=${postId}`, {',
  '    const urlArg = postUrl ? ` --url=${JSON.stringify(postUrl)}` : ``;\n    const out = execSync(`node "${BROWSER_LIKE}" like --id=${postId}${urlArg}`, {'
);

// 2. commentOnPost: accept postUrl param and pass --url
text = text.replace(
  "function commentOnPost(postId: string, text: string): { ok: boolean; restriction?: boolean; rateLimited?: boolean; message?: string } {",
  "function commentOnPost(postId: string, text: string, postUrl?: string): { ok: boolean; restriction?: boolean; rateLimited?: boolean; message?: string } {"
);
text = text.replace(
  '    const out = execSync(`node "${BROWSER_COMMENT}" comment --id=${postId} --comment=${JSON.stringify(text)}`, {',
  '    const urlArg = postUrl ? ` --url=${JSON.stringify(postUrl)}` : ``;\n    const out = execSync(`node "${BROWSER_COMMENT}" comment --id=${postId} --comment=${JSON.stringify(text)}${urlArg}`, {'
);

// 3. Update call sites to pass url
text = text.replace(
  "        const result = browserLike(postId);",
  "        const result = browserLike(postId, url);"
);
text = text.replace(
  "        const result = commentOnPost(postId, text);",
  "        const result = commentOnPost(postId, text, url);"
);

writeFileSync(path, text, "utf-8");
console.log("weibo-feed-monitor.ts: updated to pass --url");
