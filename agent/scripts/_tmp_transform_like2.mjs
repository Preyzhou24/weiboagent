import { readFileSync, writeFileSync } from "node:fs";

const filePath = "E:/program/weiboagent/agent/scripts/browser-like.js";
let text = readFileSync(filePath, "utf-8");

// Find the likePost function and replace it entirely.
const startMarker = "function likePost(id, postUrl) {";
const startIdx = text.indexOf(startMarker);
if (startIdx < 0) throw new Error("likePost start not found");

// Find the entry point that follows the function.
const entryIdx = text.indexOf("const args = parseArgs", startIdx);
if (entryIdx < 0) throw new Error("entry not found");

// The function body ends with console.log(...) then }. Find the last console.log before entry.
let endIdx = text.lastIndexOf("console.log(JSON.stringify(parsed", entryIdx);
if (endIdx < 0) throw new Error("likePost end (console.log) not found");
endIdx = text.indexOf("}", endIdx) + 1; // closing brace of the function

const newFn = `function likePost(id, postUrl) {
  if (!id) {
    console.log(JSON.stringify({ code: -1, message: "need --id or --url" }));
    process.exit(1);
  }

  // base62 -> numeric MID
  let numericMid = id;
  if (isBase62Id(id)) {
    numericMid = decodeMid(id);
    process.stderr.write("[info] base62 ID " + id + " -> numeric MID: " + numericMid + "\\n");
  }

  // 1. Open the post detail page so the browser context is on weibo.com
  //    with valid cookies + XSRF. Prefer a full weibo.com/{uid}/{bid} URL
  //    (the /detail/{mid} form 404s for many posts).
  let openUrl = postUrl || ("https://weibo.com/detail/" + numericMid);
  process.stderr.write("[like] open post: " + openUrl + "\\n");
  browserExec("agent-browser open " + openUrl);
  browserExec("agent-browser wait 3000");

  // 2. Call the like API in the browser context. The current Weibo web
  //    endpoint is /ajax/statuses/setLike (NOT /ajax/favorites/create,
  //    which 404s now). Body is just id={mid}; the 'fp' fingerprint param
  //    is optional and omitted.
  const likeJs = [
    "(async () => {",
    "  try {",
    "    const mid = '" + numericMid + "';",
    "    const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);",
    "    if (!xsrfMatch) return JSON.stringify({ code: -1, message: 'no XSRF-TOKEN found, make sure you are logged in to weibo.com' });",
    "    const xsrf = decodeURIComponent(xsrfMatch[1]);",
    "    const formData = new URLSearchParams();",
    "    formData.append('id', mid);",
    "    const resp = await fetch('/ajax/statuses/setLike', {",
    "      method: 'POST',",
    "      headers: {",
    "        'Content-Type': 'application/x-www-form-urlencoded',",
    "        'X-XSRF-TOKEN': xsrf,",
    "        'Accept': 'application/json, text/plain, */*',",
    "      },",
    "      body: formData.toString(),",
    "      credentials: 'include',",
    "    });",
    "    const text = await resp.text();",
    "    let data;",
    "    try { data = JSON.parse(text); } catch { return JSON.stringify({ code: -1, message: 'response parse failed', data: { raw: text.slice(0, 200) } }); }",
    "    // Success: HTTP 200 + response has an 'attitude' field (e.g. 'heart').",
    "    // setLike is idempotent: liking an already-liked post returns 200 + attitude record.",
    "    if (resp.status === 200 && data.attitude) {",
    "      return JSON.stringify({ code: 0, message: 'success', channel: 'browser', data: { liked: true, attitude: data.attitude, attitude_id: data.idStr || data.id } });",
    "    }",
    "    // Error shape: { ok: 0, message: '...' }",
    "    if (data.ok === 0) {",
    "      const msg = data.message || 'like failed';",
    "      const isRateLimited = /frequent|busy|try later|too fast|文本内容相同/i.test(msg);",
    "      const alreadyLiked = /already|already liked/i.test(msg);",
    "      return JSON.stringify({ code: alreadyLiked ? 0 : -1, message: alreadyLiked ? 'already liked' : msg, data: { rate_limited: isRateLimited, already_liked: alreadyLiked } });",
    "    }",
    "    // Unknown success-ish shape.",
    "    return JSON.stringify({ code: 0, message: 'success', channel: 'browser', data: { liked: true, raw: text.slice(0, 200) } });",
    "  } catch(e) {",
    "    return JSON.stringify({ code: -1, message: 'browser exec error: ' + e.message });",
    "  }",
    "})()",
  ].join(" ");

  const result = browserEval(likeJs, 30000);
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = { code: -1, message: "result parse failed", data: { raw: result.slice(0, 200) } };
  }
  console.log(JSON.stringify(parsed, null, 2));
}`;

text = text.slice(0, startIdx) + newFn + text.slice(endIdx);
writeFileSync(filePath, text, "utf-8");
console.log("browser-like.js rewritten with setLike endpoint OK");
