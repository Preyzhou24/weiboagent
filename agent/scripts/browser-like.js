#!/usr/bin/env node

/**
 * browser-like.js — 基于 agent-browser (Chrome CDP) 的微博点赞
 *
 * 复用 browser-comment.js 的架构：打开帖子详情页 → 在浏览器上下文用 fetch
 * 调用微博点赞 Ajax 接口。不依赖 OAuth API 或独立 cookie，使用浏览器自己的
 * cookie 和 XSRF token，抗封禁能力最强。
 *
 * 当 OAuth API 不可用（未配置、Token 过期、限流）时，作为点赞的降级通道。
 *
 * 用法:
 *   node scripts/browser-like.js like --id=<微博MID或base62>
 *
 * ID 格式: 数字 MID (5326346139994630) 或 base62 (NcU5a07Ib)
 */

import { execSync } from "node:child_process";

// ── Base62 → 数字 MID（与 browser-comment.js 保持一致）──────────────────────

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function decodeGroup(str) {
  let n = 0;
  for (const ch of str) n = n * 62 + BASE62.indexOf(ch);
  return n;
}

function decodeMid(b62) {
  const firstLen = b62.length % 4 || 4;
  const groups = [b62.slice(0, firstLen)];
  let i = firstLen;
  while (i < b62.length) { groups.push(b62.slice(i, i + 4)); i += 4; }
  const parts = groups.map((g) => decodeGroup(g).toString());
  let result = parts[0];
  for (let j = 1; j < parts.length; j++) result += parts[j].padStart(7, "0");
  return result;
}

function isBase62Id(id) { return /\D/.test(id); }

// ── agent-browser 辅助 ─────────────────────────────────────────────────────────

function browserExec(cmd, timeout = 15000, input) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      input: input || undefined,
    }).trim();
  } catch {
    return "";
  }
}
function browserEval(jsCode, timeout = 30000) {
  // Use base64 encoding to avoid all shell-quote escaping issues.
  const b64 = Buffer.from(jsCode).toString("base64");
  const result = browserExec("agent-browser eval -b " + b64, timeout);
  // Strip outer quotes if present.
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return result;
}// ── 参数解析 ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 0) args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    }
  }
  return args;
}

// ── 主点赞逻辑 ─────────────────────────────────────────────────────────────────

function likePost(id, postUrl) {
  if (!id) {
    console.log(JSON.stringify({ code: -1, message: "need --id or --url" }));
    process.exit(1);
  }

  // base62 -> numeric MID
  let numericMid = id;
  if (isBase62Id(id)) {
    numericMid = decodeMid(id);
    process.stderr.write("[info] base62 ID " + id + " -> numeric MID: " + numericMid + "\n");
  }

  // 1. Open the post detail page so the browser context is on weibo.com
  //    with valid cookies + XSRF. Prefer a full weibo.com/{uid}/{bid} URL
  //    (the /detail/{mid} form 404s for many posts).
  let openUrl = postUrl || ("https://weibo.com/detail/" + numericMid);
  process.stderr.write("[like] open post: " + openUrl + "\n");
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

  const result = browserEval(likeJs, 30000);
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = { code: -1, message: "result parse failed", data: { raw: result.slice(0, 200) } };
  }
  console.log(JSON.stringify(parsed, null, 2));
}

// ── 入口 ───────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

if (command === "like" || !command) {
  likePost(args.id, args.url);
} else if (command === "help" || command === "--help") {
  console.log(`
browser-like.js — 基于 agent-browser (Chrome CDP) 的微博点赞

用法:
  node scripts/browser-like.js like --id=<MID或base62>

流程: 打开帖子详情页 → 浏览器内 fetch 调用点赞 Ajax 接口 → 验证成功
不依赖 OAuth API 或独立 cookie，使用浏览器自身的 cookie 和 XSRF token。
作为 OAuth like-post 的降级通道。

ID 格式: 数字 MID (5326346139994630) 或 base62 (NcU5a07Ib)

返回:
  成功:     { code: 0, channel: "browser", data: { liked: true } }
  已赞过:   { code: 0, message: "already liked" }
  限流:     { code: -1, data: { rate_limited: true } }
  失败:     { code: -1, message: "..." }
  `);
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}
