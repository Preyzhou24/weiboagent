#!/usr/bin/env node

/**
 * web-comment.js — 通过微博内部 Web API 评论普通微博
 *
 * 龙虾 API 的 comment 命令只能评论超话帖子，不能评论普通微博。
 * 这个脚本通过 agent-browser 在已登录的浏览器上下文中直接调用
 * /ajax/comments/create 内部接口，绕过 UI 层的反机器人检测。
 *
 * 支持:
 *   - 数字 MID (如 5326346139994630)
 *   - base62 ID (如 NcU5a07Ib，自动转换为数字 MID)
 *   - 限流检测 ("操作繁忙") + 指数退避重试 (30s->60s->120s, 最多 3 次)
 *
 * 前提：Chrome CDP (端口 9229) 已启动并登录 weibo.com
 *
 * 用法:
 *   node scripts/web-comment.js comment --id=<微博MID或base62> --comment="评论内容"
 *
 * 返回:
 *   成功: { code: 0, message: "success", data: { comment_id, text, ... } }
 *   被限制: { code: -1, message: "评论受限: <原因>", data: { restriction: true, reason: "<原因>" } }
 *   限流:   { code: -1, message: "评论限流，已重试 N 次仍失败", data: { rate_limited: true, reason: "操作繁忙,请稍后再试" } }
 *   失败:   { code: -1, message: "<错误信息>" }
 */

import { execSync } from 'child_process';

// ── Base62 -> 数字 MID 转换 ────────────────────────────────────────────────────

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function decodeGroup(str) {
  let n = 0;
  for (const ch of str) {
    n = n * 62 + BASE62.indexOf(ch);
  }
  return n;
}

function decodeMid(b62) {
  const firstLen = b62.length % 4 || 4;
  const groups = [b62.slice(0, firstLen)];
  let i = firstLen;
  while (i < b62.length) {
    groups.push(b62.slice(i, i + 4));
    i += 4;
  }
  const parts = groups.map((g) => decodeGroup(g).toString());
  let result = parts[0];
  for (let j = 1; j < parts.length; j++) {
    result += parts[j].padStart(7, '0');
  }
  return result;
}

function isBase62Id(id) {
  return /\D/.test(id); // contains non-digit -> base62
}

// ── 参数解析 ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.slice(2, eqIdx);
        args[key] = arg.slice(eqIdx + 1);
      }
    }
  }
  return args;
}

// ── 通过 agent-browser 在浏览器上下文中执行 JS ──────────────────────────────────

function browserEval(jsCode) {
  try {
    const escaped = jsCode.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const out = execSync(`agent-browser eval "${escaped}"`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let result = out.trim();
    if (result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1);
      result = result.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return result;
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// ── 确保在 weibo.com 页面 ──────────────────────────────────────────────────────

function ensureWeiboPage() {
  let url = '';
  try {
    url = execSync('agent-browser get url', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return false;
  }
  if (!url.includes('weibo.com')) {
    execSync('agent-browser open https://weibo.com', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    execSync('agent-browser wait 3000', {
      encoding: 'utf-8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  return true;
}

// ── 单次评论尝试 ──────────────────────────────────────────────────────────────

function attemptComment(numericMid, commentText) {
  const jsCode = [
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
    '      return JSON.stringify({ code: 0, message: "success", data: { comment_id: data.data?.id, text: data.data?.text, created_at: data.data?.created_at } });',
    '    } else {',
    '      const msg = data.message || "评论失败";',
    '      if (msg.includes("操作繁忙")) {',
    '        return JSON.stringify({ code: -1, message: msg, data: { rate_limited: true, reason: msg } });',
    '      }',
    '      const restrictionMap = {',
    '        "作者只允许关注": "该博主设置了评论限制：仅允许关注一定天数的粉丝评论。你的账号尚不满足条件，暂时无法评论。",',
    '        "无评论权限": "你没有评论此微博的权限，可能原因：博主设置了评论权限限制、微博已删除、或非粉丝无法评论。",',
    '        "内容包含敏感词": "评论内容包含敏感词，请修改后重试。",',
    '      };',
    '      let restriction = false;',
    '      let friendlyMsg = msg;',
    '      for (const [key, val] of Object.entries(restrictionMap)) {',
    '        if (msg.includes(key)) { friendlyMsg = val; restriction = true; break; }',
    '      }',
    '      return JSON.stringify({ code: -1, message: friendlyMsg, data: { restriction, reason: msg } });',
    '    }',
    '  } catch(e) {',
    '    return JSON.stringify({ code: -1, message: "浏览器执行错误: " + e.message });',
    '  }',
    '})()',
  ].join(' ');

  const result = browserEval(jsCode);
  try {
    return JSON.parse(result);
  } catch {
    return { code: -1, message: '返回解析失败', data: { raw: result.slice(0, 200) } };
  }
}

// ── 评论命令 (带限流重试) ─────────────────────────────────────────────────────

const RATE_LIMIT_DELAYS = [30000, 60000, 120000]; // 30s -> 60s -> 120s

function sleep(ms) {
  execSync(`node -e "setTimeout(()=>{}, ${ms})"`, { timeout: ms + 5000, stdio: 'ignore' });
}

async function commentOnPost(id, commentText) {
  if (!id) {
    console.error(JSON.stringify({ code: -1, message: '需要指定 --id 参数（微博 MID 或 base62 ID）' }));
    process.exit(1);
  }
  if (!commentText) {
    console.error(JSON.stringify({ code: -1, message: '需要指定 --comment 参数（评论内容）' }));
    process.exit(1);
  }

  // base62 -> 数字 MID 自动转换
  let numericMid = id;
  if (isBase62Id(id)) {
    numericMid = decodeMid(id);
    process.stderr.write(`[info] 检测到 base62 ID "${id}"，已转换为数字 MID: ${numericMid}\n`);
  }

  // 确保浏览器在 weibo.com
  if (!ensureWeiboPage()) {
    console.error(
      JSON.stringify({ code: -1, message: '无法获取浏览器 URL，请确保 Chrome CDP (端口 9229) 已启动' })
    );
    process.exit(1);
  }

  // 带退避重试的评论
  let lastResult = null;
  for (let attempt = 0; attempt <= RATE_LIMIT_DELAYS.length; attempt++) {
    lastResult = attemptComment(numericMid, commentText);

    if (lastResult.code === 0 || !lastResult.data?.rate_limited) {
      console.log(JSON.stringify(lastResult, null, 2));
      return;
    }

    if (attempt < RATE_LIMIT_DELAYS.length) {
      const delay = RATE_LIMIT_DELAYS[attempt];
      process.stderr.write(
        `[rate-limited] 评论被限流: ${lastResult.data.reason}，${delay / 1000}s 后重试 (${attempt + 1}/${RATE_LIMIT_DELAYS.length})...\n`
      );
      sleep(delay);
    }
  }

  console.log(
    JSON.stringify(
      {
        code: -1,
        message: `评论限流，已重试 ${RATE_LIMIT_DELAYS.length} 次仍失败`,
        data: { rate_limited: true, reason: lastResult?.data?.reason || '操作繁忙' },
      },
      null,
      2
    )
  );
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';

if (command === 'comment' || !command) {
  commentOnPost(args.id, args.comment);
} else if (command === 'help' || command === '--help') {
  console.log(`
web-comment.js — 通过微博内部 Web API 评论普通微博

用法:
  node scripts/web-comment.js comment --id=<微博MID或base62> --comment="评论内容"

支持的 ID 格式:
  数字 MID:  5326346139994630
  base62 ID: NcU5a07Ib (自动转换为数字 MID)

限流处理:
  当服务器返回 "操作繁忙" 时，自动指数退避重试 (30s->60s->120s, 最多 3 次)

前提:
  Chrome CDP (端口 9229) 已启动并登录 weibo.com

返回:
  成功:    { code: 0, message: "success", data: { comment_id, text } }
  被限制:  { code: -1, message: "<友好提示>", data: { restriction: true, reason: "<原始原因>" } }
  限流:   { code: -1, message: "评论限流...", data: { rate_limited: true, reason: "操作繁忙..." } }
  失败:    { code: -1, message: "<错误信息>" }
`);
} else {
  console.error(`未知命令: ${command}`);
  console.error('运行 node scripts/web-comment.js help 查看用法');
  process.exit(1);
}