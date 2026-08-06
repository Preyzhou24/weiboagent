import { readFileSync, writeFileSync } from "node:fs";

// Helper to write ASCII-safe file content (no mojibake from the original)
const files = {
  like: "E:/program/weiboagent/agent/scripts/browser-like.js",
  comment: "E:/program/weiboagent/agent/scripts/browser-comment.js",
};

// ---- browser-like.js: replace likePost function body ----
{
  let text = readFileSync(files.like, "utf-8");

  // Replace the URL-opening line and the whole likePost body.
  // Find from "function likePost(id, postUrl) {" to the closing "console.log(JSON.stringify(parsed, null, 2));\n}"
  const startMarker = "function likePost(id, postUrl) {";
  const startIdx = text.indexOf(startMarker);
  if (startIdx < 0) throw new Error("likePost start not found");

  // The function ends right before the "// -- entry" divider comment.
  // We look for the divider that precedes parseArgs/entry.
  const dividerIdx = text.indexOf("const args = parseArgs", startIdx);
  if (dividerIdx < 0) throw new Error("entry not found");
  // back up to the comment line before const args
  let endIdx = text.lastIndexOf("console.log(JSON.stringify(parsed, null, 2));", dividerIdx);
  if (endIdx < 0) throw new Error("likePost end not found");
  endIdx = text.indexOf("}", endIdx) + 1;

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

  // 1. Open the post detail page. Prefer a full weibo.com/{uid}/{bid} URL
  //    (the /detail/{mid} form 404s for many posts). Fall back to detail URL.
  let openUrl = postUrl || ("https://weibo.com/detail/" + numericMid);
  process.stderr.write("[like] open post: " + openUrl + "\\n");
  browserExec("agent-browser open " + openUrl);
  browserExec("agent-browser wait 3000");

  // 2. Try the real-human path first: click the woo-like-main button on the page.
  //    The /ajax/favorites/create API returns "address not found" for many posts,
  //    but clicking the actual like button works reliably.
  const clickJs = [
    "(async () => {",
    "  try {",
    "    const btn = document.querySelector('article button.woo-like-main') || document.querySelector('button.woo-like-main');",
    "    if (!btn) return JSON.stringify({ code: -1, message: 'like button not found on page', data: { hint: 'post may be deleted or not loaded' } });",
    "    const countEl = btn.querySelector('.woo-like-count');",
    "    const before = countEl ? countEl.textContent.trim() : '';",
    "    btn.click();",
    "    await new Promise(r => setTimeout(r, 2000));",
    "    const after = countEl ? countEl.textContent.trim() : '';",
    "    const changed = before !== '' && after !== '' && after !== before;",
    "    return JSON.stringify({ code: 0, message: 'success', channel: 'browser-dom', data: { liked: true, before, after, count_changed: changed } });",
    "  } catch(e) {",
    "    return JSON.stringify({ code: -1, message: 'browser click error: ' + e.message });",
    "  }",
    "})()",
  ].join(" ");

  const clickResult = browserEval(clickJs, 30000);
  let parsed;
  try { parsed = JSON.parse(clickResult); }
  catch { parsed = { code: -1, message: "click result parse failed", data: { raw: clickResult.slice(0, 200) } }; }

  // If the DOM click worked, return it.
  if (parsed.code === 0) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  // 3. Fallback: the /ajax/favorites/create API (uses browser cookie + XSRF).
  process.stderr.write("[like] DOM click failed (" + (parsed.message || '') + "), trying API fallback\\n");
  const likeJs = [
    "(async () => {",
    "  try {",
    "    const mid = '" + numericMid + "';",
    "    const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);",
    "    if (!xsrfMatch) return JSON.stringify({ code: -1, message: 'no XSRF-TOKEN found, make sure you are logged in to weibo.com' });",
    "    const xsrf = decodeURIComponent(xsrfMatch[1]);",
    "    const formData = new URLSearchParams();",
    "    formData.append('id', mid);",
    "    formData.append('location', 'page_100505_home');",
    "    const resp = await fetch('/ajax/favorites/create', {",
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
    "    if (data.ok === 1) {",
    "      return JSON.stringify({ code: 0, message: 'success', channel: 'browser-api', data: { liked: true } });",
    "    } else {",
    "      const msg = data.message || data.msg || 'like failed';",
    "      const isRateLimited = /frequent|busy|try later|update weibo too fast/i.test(msg);",
    "      const alreadyLiked = /already liked|already favorited/i.test(msg);",
    "      return JSON.stringify({ code: alreadyLiked ? 0 : -1, message: alreadyLiked ? 'already liked' : msg, data: { rate_limited: isRateLimited, already_liked: alreadyLiked } });",
    "    }",
    "  } catch(e) {",
    "    return JSON.stringify({ code: -1, message: 'browser api error: ' + e.message });",
    "  }",
    "})()",
  ].join(" ");

  const result = browserEval(likeJs, 30000);
  let parsed2;
  try { parsed2 = JSON.parse(result); }
  catch { parsed2 = { code: -1, message: "api result parse failed", data: { raw: result.slice(0, 200) } }; }
  console.log(JSON.stringify(parsed2, null, 2));
}`;

  text = text.slice(0, startIdx) + newFn + text.slice(endIdx);
  writeFileSync(files.like, text, "utf-8");
  console.log("browser-like.js patched OK");
}

// ---- Update the entry point in browser-like.js to pass url ----
{
  let text = readFileSync(files.like, "utf-8");
  text = text.replace("  likePost(args.id);", "  likePost(args.id, args.url);");
  writeFileSync(files.like, text, "utf-8");
  console.log("browser-like.js entry patched OK");
}
