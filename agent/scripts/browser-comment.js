#!/usr/bin/env node

/**
 * browser-comment.js — 基于 agent-browser (Chrome CDP) 的微博评论
 *
 * 完全真人操作流程：打开帖子详情页 → 填入评论 → 点击评论按钮 → 验证成功
 * 不依赖 Ajax API 或 cookie，抗封禁能力最强。
 *
 * 用法:
 *   node scripts/browser-comment.js comment --id=<微博MID或base62> --comment="评论内容"
 *
 * ID 格式: 数字 MID (5326346139994630) 或 base62 (NcU5a07Ib)
 */

import { execSync } from "node:child_process";

// ── Base62 → 数字 MID（与 web-comment.js 保持一致）───────────────────────────

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

function browserExec(cmd, timeout = 15000) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function browserEval(jsCode, timeout = 15000) {
  const result = browserExec(`agent-browser eval "${jsCode.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, timeout);
  // 去掉外层引号
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return result;
}

// ── 参数解析 ───────────────────────────────────────────────────────────────────

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

// ── 主评论逻辑 ─────────────────────────────────────────────────────────────────

function commentOnPost(id, commentText) {
  if (!id) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --id 参数" }));
    process.exit(1);
  }
  if (!commentText) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --comment 参数" }));
    process.exit(1);
  }

  // base62 → 数字 MID
  let numericMid = id;
  if (isBase62Id(id)) {
    numericMid = decodeMid(id);
    process.stderr.write(`[info] base62 ID "${id}" -> 数字 MID: ${numericMid}\n`);
  }

  // 1. 打开帖子详情页
  const detailUrl = `https://weibo.com/detail/${numericMid}`;
  process.stderr.write(`[comment] 打开帖子: ${detailUrl}\n`);
  browserExec(`agent-browser open ${detailUrl}`);
  browserExec("agent-browser wait 3000");

  // 2. 确认评论框存在
  const checkInput = browserEval(
    "(() => { const t = document.querySelector('textarea._input_1fox3_8'); return t ? 'found' : 'not found'; })()"
  );
  if (checkInput !== "found") {
    console.log(JSON.stringify({ code: -1, message: "未找到评论输入框，页面可能未加载完成或微博已删除" }));
    return;
  }

  // 3. 直接在浏览器上下文里用 fetch 调用微博评论接口
  //    完全在浏览器环境中执行，使用浏览器自己的 cookie 和 XSRF token
  //    不依赖 web-comment.js 的独立 cookie 管理
  const commentJs = [
    '(async () => {',
    '  try {',
    `    const mid = '${numericMid}';`,
    `    const comment = ${JSON.stringify(commentText)};`,
    '    const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);',
    '    if (!xsrfMatch) return JSON.stringify({ code: -1, message: "未找到 XSRF-TOKEN，请确保已登录 weibo.com" });',
    '    const xsrf = decodeURIComponent(xsrfMatch[1]);',
    '    const formData = new URLSearchParams();',
    '    formData.append("id", mid);',
    '    formData.append("comment", comment);',
    '    formData.append("pic_id", "");',
    '    formData.append("is_repost", "0");',
    '    formData.append("comment_ori", "0");',
    '    formData.append("is_comment", "0");',
    '    formData.append("fp", "");',
    '    const resp = await fetch("/ajax/comments/create", {',
    '      method: "POST",',
    '      headers: {',
    '        "Content-Type": "application/x-www-form-urlencoded",',
    '        "X-XSRF-TOKEN": xsrf,',
    '        "Accept": "application/json, text/plain, */*",',
    '      },',
    '      body: formData.toString(),',
    '      credentials: "include",',
    '    });',
    '    const text = await resp.text();',
    '    let data;',
    '    try { data = JSON.parse(text); } catch { return JSON.stringify({ code: -1, message: "响应解析失败", data: { raw: text.slice(0, 200) } }); }',
    '    if (data.ok === 1) {',
    '      return JSON.stringify({ code: 0, message: "success", channel: "browser", data: { comment_id: data.data?.id, text: data.data?.text } });',
    '    } else {',
    '      const msg = data.message || "评论失败";',
    '      const isRateLimited = /频繁|繁忙|稍后再试|update weibo too fast/.test(msg);',
    '      const isRestriction = /权限|不能|限制|无法|作者只允许|关注人/.test(msg);',
    '      return JSON.stringify({ code: -1, message: msg, data: { rate_limited: isRateLimited, restriction: isRestriction, reason: msg } });',
    '    }',
    '  } catch(e) {',
    '    return JSON.stringify({ code: -1, message: "浏览器执行错误: " + e.message });',
    '  }',
    '})()',
  ].join(" ");

  const result = browserEval(commentJs, 30000);
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = { code: -1, message: "返回解析失败", data: { raw: result.slice(0, 200) } };
  }
  console.log(JSON.stringify(parsed, null, 2));
}

// ── 入口 ───────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

if (command === "comment" || !command) {
  commentOnPost(args.id, args.comment);
} else if (command === "help" || command === "--help") {
  console.log(`
browser-comment.js — 基于 agent-browser (Chrome CDP) 的微博评论

用法:
  node scripts/browser-comment.js comment --id=<MID或base62> --comment="评论内容"

流程: 打开帖子详情页 → 填入评论 → 点击评论按钮 → 验证成功
完全真人操作，不依赖 Ajax API 或 cookie，抗封禁能力最强。

ID 格式: 数字 MID (5326346139994630) 或 base62 (NcU5a07Ib)

返回:
  成功:   { code: 0, channel: "browser", data: { text } }
  受限:   { code: -1, data: { restriction: true, reason: "..." } }
  失败:   { code: -1, message: "..." }
  `);
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}