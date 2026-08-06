// Simulate what likePost builds
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
  "      const isRateLimited = /frequent|busy|try later|too fast|文本内容相同/i.test(msg);",
  "      const alreadyLiked = /already|already liked/i.test(msg);",
  "      return JSON.stringify({ code: alreadyLiked ? 0 : -1, message: alreadyLiked ? 'already liked' : msg, data: { rate_limited: isRateLimited, already_liked: alreadyLiked } });",
  "    }",
  "    return JSON.stringify({ code: 0, message: 'success', channel: 'browser', data: { liked: true, raw: text.slice(0, 200) } });",
  "  } catch(e) {",
  "    return JSON.stringify({ code: -1, message: 'browser exec error: ' + e.message });",
  "  }",
  "})()",
].join(" ");
const b64 = Buffer.from(likeJs).toString("base64");
console.log("likeJs length:", likeJs.length);
console.log("b64 length:", b64.length);
console.log("cmd length:", ("agent-browser eval -b " + b64).length);
const { execSync } = require("node:child_process");
try {
  const out = execSync("agent-browser eval -b " + b64, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  console.log("OUTPUT:", out);
} catch (e) {
  console.log("ERROR:", e.message.slice(0, 200));
}
