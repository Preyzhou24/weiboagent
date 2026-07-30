#!/usr/bin/env node

/**
 * web-comment.js — 双通道评论普通微博 (Web API + 移动端 API)
 *
 * 通道 1 (主): weibo.com Web API  /ajax/comments/create
 * 通道 2 (备): m.weibo.cn 移动端 API /api/comments/create (独立限流计数器)
 *
 * 限流策略:
 *   1. 先走 Web API，成功则返回
 *   2. Web 限流 → 自动切换到移动端 API (不同限流桶)
 *   3. 移动端也限流 → 指数退避重试 (30s→60s→120s, 最多 3 次, 交替通道)
 *   4. 权限限制 (如"仅粉丝评论") → 直接返回 restriction, 不重试
 *
 * 支持 ID 格式: 数字 MID (5326346139994630) 和 base62 (NcU5a07Ib)
 *
 * 用法:
 *   node scripts/web-comment.js comment --id=<MID或base62> --comment="评论内容"
 */

import { execSync } from 'child_process';

// ── Base62 → 数字 MID ──────────────────────────────────────────────────────────

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
  const parts = groups.map(g => decodeGroup(g).toString());
  let result = parts[0];
  for (let j = 1; j < parts.length; j++) result += parts[j].padStart(7, '0');
  return result;
}

function isBase62Id(id) { return /\D/.test(id); }

// ── 参数解析 ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    }
  }
  return args;
}

// ── agent-browser 辅助 ─────────────────────────────────────────────────────────

function browserEval(jsCode) {
  try {
    const escaped = jsCode.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const out = execSync(`agent-browser eval "${escaped}"`, {
      encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let result = out.trim();
    if (result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return result;
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

function browserGetUrl() {
  try {
    return execSync('agent-browser get url', {
      encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { return ''; }
}

function browserNavigate(url) {
  execSync(`agent-browser open ${url}`, {
    encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  execSync('agent-browser wait 2500', {
    encoding: 'utf-8', timeout: 8000, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ── 限流冷却状态文件 ──────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const COOLDOWN_FILE = join(homedir(), '.weibo-skill', 'comment-cooldown.json');

function loadCooldown() {
  try {
    if (existsSync(COOLDOWN_FILE)) {
      return JSON.parse(readFileSync(COOLDOWN_FILE, 'utf-8'));
    }
  } catch {}
  return { web: 0, mobile: 0 };
}

function saveCooldown(data) {
  try {
    writeFileSync(COOLDOWN_FILE, JSON.stringify(data), 'utf-8');
  } catch {}
}

function isOnCooldown(channel, cooldown) {
  const lastLimited = cooldown[channel] || 0;
  // 90 秒冷却期：在此期间跳过该通道
  return Date.now() - lastLimited < 90000;
}

// ── 通道 1: Web API (weibo.com) ───────────────────────────────────────────────

function attemptWebComment(numericMid, commentText) {
  // 确保在 weibo.com
  const url = browserGetUrl();
  if (!url.includes('weibo.com')) {
    browserNavigate('https://weibo.com');
  }

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
    '      return JSON.stringify({ code: 0, message: "success", channel: "web", data: { comment_id: data.data?.id, text: data.data?.text } });',
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
    '      let restriction = false; let friendlyMsg = msg;',
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
  try { return JSON.parse(result); }
  catch { return { code: -1, message: '返回解析失败', data: { raw: result.slice(0, 200) } }; }
}

// ── 通道 2: 移动端 API (m.weibo.cn) ────────────────────────────────────────────

function attemptMobileComment(numericMid, commentText) {
  // 保存当前 URL，评论后导航回来
  const originalUrl = browserGetUrl();

  // 导航到 m.weibo.cn
  if (!originalUrl.includes('m.weibo.cn')) {
    browserNavigate(`https://m.weibo.cn/detail/${numericMid}`);
  }

  const jsCode = [
    '(async () => {',
    '  try {',
    `    const mid = '${numericMid}';`,
    `    const comment = ${JSON.stringify(commentText)};`,
    '    const stMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);',
    '    if (!stMatch) return JSON.stringify({ code: -1, message: "未找到 XSRF-TOKEN，请确保已登录 m.weibo.cn" });',
    '    const st = stMatch[1];',
    '    const formData = new URLSearchParams();',
    '    formData.append("id", mid);',
    '    formData.append("content", comment);',
    '    formData.append("st", st);',
    '    formData.append("mid", mid);',
    '    const resp = await fetch("/api/comments/create", {',
    '      method: "POST",',
    '      headers: {',
    '        "Content-Type": "application/x-www-form-urlencoded",',
    '        "X-XSRF-TOKEN": st,',
    '        "Accept": "application/json",',
    '        "MWeibo-Pwa": "1",',
    `        "Referer": "https://m.weibo.cn/detail/${numericMid}",`,
    '      },',
    '      body: formData.toString(),',
    '      credentials: "include",',
    '    });',
    '    const text = await resp.text();',
    '    let data;',
    '    try { data = JSON.parse(text); } catch { return JSON.stringify({ code: -1, message: "响应解析失败", data: { raw: text.slice(0, 200) } }); }',
    '    if (data.ok === 1) {',
    '      return JSON.stringify({ code: 0, message: "success", channel: "mobile", data: { comment_id: data.data?.id, text: data.data?.text } });',
    '    } else {',
    '      const msg = data.msg || "评论失败";',
    '      if (msg.includes("操作频繁")) {',
    '        return JSON.stringify({ code: -1, message: msg, data: { rate_limited: true, reason: msg } });',
    '      }',
    '      if (msg.includes("参数")) {',
    '        return JSON.stringify({ code: -1, message: "移动端API参数错误: " + msg, data: { raw: JSON.stringify(data).slice(0,200) } });',
    '      }',
    '      return JSON.stringify({ code: -1, message: msg, data: { reason: msg, errno: data.errno } });',
    '    }',
    '  } catch(e) {',
    '    return JSON.stringify({ code: -1, message: "浏览器执行错误: " + e.message });',
    '  }',
    '})()',
  ].join(' ');

  const result = browserEval(jsCode);

  // 导航回原页面
  if (originalUrl && !originalUrl.includes('m.weibo.cn')) {
    browserNavigate(originalUrl);
  }

  try { return JSON.parse(result); }
  catch { return { code: -1, message: '返回解析失败', data: { raw: result.slice(0, 200) } }; }
}

// ── 指数退避 ──────────────────────────────────────────────────────────────────

const RETRY_DELAYS = [30000, 60000, 120000];

function sleep(ms) {
  execSync(`node -e "setTimeout(()=>{}, ${ms})"`, { timeout: ms + 5000, stdio: 'ignore' });
}

// ── 主评论逻辑: 双通道 + 退避重试 ───────────────────────────────────────────

async function commentOnPost(id, commentText) {
  if (!id) {
    console.error(JSON.stringify({ code: -1, message: '需要指定 --id 参数' }));
    process.exit(1);
  }
  if (!commentText) {
    console.error(JSON.stringify({ code: -1, message: '需要指定 --comment 参数' }));
    process.exit(1);
  }

  // base62 转换
  let numericMid = id;
  if (isBase62Id(id)) {
    numericMid = decodeMid(id);
    process.stderr.write(`[info] base62 ID "${id}" -> 数字 MID: ${numericMid}\n`);
  }

  let cooldown = loadCooldown();

  // 决定通道优先级: 跳过冷却中的通道
  let firstChannel, secondChannel;
  if (isOnCooldown('web', cooldown) && !isOnCooldown('mobile', cooldown)) {
    firstChannel = 'mobile'; secondChannel = 'web';
  } else {
    firstChannel = 'web'; secondChannel = 'mobile';
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    // 尝试主通道
    const useChannel = (attempt % 2 === 0) ? firstChannel : secondChannel;
    process.stderr.write(`[comment] 尝试通道: ${useChannel} (第 ${attempt + 1} 次)\n`);

    if (useChannel === 'web') {
      lastResult = attemptWebComment(numericMid, commentText);
    } else {
      lastResult = attemptMobileComment(numericMid, commentText);
    }

    // 成功
    if (lastResult.code === 0) {
      console.log(JSON.stringify(lastResult, null, 2));
      return;
    }

    // 权限限制 -> 不重试
    if (lastResult.data?.restriction) {
      console.log(JSON.stringify(lastResult, null, 2));
      return;
    }

    // 限流 -> 记录冷却时间
    if (lastResult.data?.rate_limited) {
      cooldown = loadCooldown();
      cooldown[useChannel === 'web' ? 'web' : 'mobile'] = Date.now();
      saveCooldown(cooldown);
      process.stderr.write(`[rate-limited] ${useChannel} 通道限流: ${lastResult.data.reason}\n`);

      // 还有重试次数 -> 等待后切到另一通道
      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        process.stderr.write(`  ${delay / 1000}s 后切换通道重试...\n`);
        sleep(delay);
      }
      continue;
    }

    // 其他错误 -> 直接返回
    console.log(JSON.stringify(lastResult, null, 2));
    return;
  }

  // 所有重试均失败
  console.log(JSON.stringify({
    code: -1,
    message: `评论限流，已重试 ${RETRY_DELAYS.length} 次仍失败`,
    data: { rate_limited: true, reason: lastResult?.data?.reason || '操作繁忙' },
  }, null, 2));
}

// ── 主入口 ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';

if (command === 'comment' || !command) {
  commentOnPost(args.id, args.comment);
} else if (command === 'help' || command === '--help') {
  console.log(`
web-comment.js — 双通道评论普通微博

用法:
  node scripts/web-comment.js comment --id=<MID或base62> --comment="评论内容"

双通道策略:
  1. Web API (weibo.com /ajax/comments/create) — 主通道
  2. 移动端 API (m.weibo.cn /api/comments/create) — 限流时自动切换
  限流时记录 90s 冷却期，冷却期内跳过该通道
  双通道均限流时指数退避重试 (30s→60s→120s, 最多 3 次)

ID 格式: 数字 MID (5326346139994630) 或 base62 (NcU5a07Ib)

返回:
  成功:   { code: 0, channel: "web"|"mobile", data: { comment_id, text } }
  限流:   { code: -1, data: { rate_limited: true, reason: "操作繁忙..." } }
  受限:   { code: -1, data: { restriction: true, reason: "..." } }
  `);
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}