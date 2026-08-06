import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Replicate exactly what browser-like.js does
const numericMid = "5328860125073555";
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
  "    if (resp.status === 200 && data.attitude) {",
  "      return JSON.stringify({ code: 0, message: 'success', channel: 'browser', data: { liked: true, attitude: data.attitude, attitude_id: data.idStr || data.id } });",
  "    }",
  "    if (data.ok === 0) {",
  "      const msg = data.message || 'like failed';",
  "      const isRateLimited = /frequent|busy|try later|too fast/i.test(msg);",
  "      const alreadyLiked = /already|already liked/i.test(msg);",
  "      return JSON.stringify({ code: alreadyLiked ? 0 : -1, message: alreadyLiked ? 'already liked' : msg, data: { rate_limited: isRateLimited, already_liked: alreadyLiked } });",
  "    }",
  "    return JSON.stringify({ code: 0, message: 'success', channel: 'browser', data: { liked: true, raw: text.slice(0, 200) } });",
  "  } catch(e) {",
  "    return JSON.stringify({ code: -1, message: 'browser exec error: ' + e.message });",
  "  }",
  "})()",
].join(" ");

function browserExec(cmd, timeout = 15000, input) {
  try {
    const r = execSync(cmd, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"], input: input || undefined }).trim();
    return r;
  } catch (e) {
    console.error("browserExec ERROR:", e.message.slice(0, 200));
    if (e.stderr) console.error("STDERR:", e.stderr.toString().slice(0, 200));
    return "";
  }
}

function browserEval(jsCode, timeout = 30000) {
  const b64 = Buffer.from(jsCode).toString("base64");
  const result = browserExec("agent-browser eval -b " + b64, timeout);
  console.error("browserEval raw result:", JSON.stringify(result).slice(0, 100));
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return result;
}

// open the page first
browserExec("agent-browser open https://weibo.com/1890876605/Rc6MAlhRx");
browserExec("agent-browser wait 3000");

const result = browserEval(likeJs, 30000);
console.error("final result:", result);
let parsed;
try { parsed = JSON.parse(result); }
catch (e) { parsed = { code: -1, message: "result parse failed", data: { raw: result.slice(0, 200) } }; }
console.log(JSON.stringify(parsed, null, 2));
