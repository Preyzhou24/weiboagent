#!/usr/bin/env node

/**
 * weibo-search.js — 基于 aione (All-IN-ONE) 的微博搜索封装
 *
 * 整合 aione 的 cookie 驱动搜索，替代 OAuth 智搜。
 * 优势: aione post search 直接返回结构化结果 (content + user + 干净 URL)，
 *       而 OAuth 智搜只返回 AI 摘要文本，需正则扒 mblogid，目标 ID 不准。
 *
 * 返回的 base62 ID 会被自动转换为数字 MID，供 OAuth like-post 使用。
 * 转换逻辑与 web-comment.js 的 decodeMid 一致。
 *
 * 用法:
 *   node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1
 *
 * 返回 JSON:
 *   { code: 0, data: [{ id, base62, url, content, user }] }
 *   失败: { code: -1, message: "..." }
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** 从 weibo.com/{uid}/{base62id} URL 提取 base62 ID */
function extractBase62(url) {
  const m = url.match(/\/([A-Za-z0-9]{6,})(?:\?|#|$)/);
  if (m && /[A-Za-z]/.test(m[1])) return m[1];
  return null;
}

// ── 参数解析 ──────────────────────────────────────────────────────────────────

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

// ── 主搜索逻辑 ─────────────────────────────────────────────────────────────────

function searchWeibo(query, page = 1) {
  if (!query) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --query 参数" }));
    process.exit(1);
  }

  // 用临时文件规避 PowerShell GBK 控制台编码问题
  const tmpFile = join(mkdtempSync(join(tmpdir(), "wb-search-")), "result.json");

  try {
    execSync(
      `aione weibo post search --query=${JSON.stringify(query)} --page=${page} --output file --path="${tmpFile}"`,
      { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    console.log(JSON.stringify({ code: -1, message: `aione 调用失败: ${err.message}` }));
    rmSync(tmpFile, { recursive: true, force: true });
    return;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(tmpFile, "utf-8"));
  } catch {
    console.log(JSON.stringify({ code: -1, message: "aione 返回解析失败" }));
    rmSync(tmpFile, { recursive: true, force: true });
    return;
  }
  rmSync(tmpFile, { recursive: true, force: true });

  // aione 返回三元组 [success: bool, msg: string, results: array]
  if (!Array.isArray(raw) || raw.length < 3) {
    console.log(JSON.stringify({ code: -1, message: "aione 返回格式异常", data: { raw: String(raw).slice(0, 200) } }));
    return;
  }

  const [success, msg, results] = raw;
  if (!success) {
    console.log(JSON.stringify({ code: -1, message: `aione 搜索失败: ${msg}` }));
    return;
  }

  if (!Array.isArray(results)) {
    console.log(JSON.stringify({ code: 0, data: [] }));
    return;
  }

  // 转换每条结果：提取 base62，转数字 MID，保留原文和用户
  const posts = results
    .map((r) => {
      const url = r.url || "";
      const base62 = extractBase62(url);
      if (!base62) return null; // 没有有效 URL 的条目跳过
      const id = decodeMid(base62);
      return {
        id,
        base62,
        url,
        content: (r.content || "").slice(0, 200),
        user: r.user || "",
      };
    })
    .filter(Boolean);

  console.log(JSON.stringify({ code: 0, data: posts, total: posts.length }));
}

// ── 入口 ───────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

if (command === "search" || !command) {
  searchWeibo(args.query, args.page ? parseInt(args.page, 10) : 1);
} else if (command === "help" || command === "--help") {
  console.log(`
weibo-search.js — aione 微博搜索封装

用法:
  node scripts/weibo-api/weibo-search.js search --query="关键词" [--page=1]

返回结构化帖子列表，每条含数字 ID (id)、base62 ID、URL、正文摘要、博主名。
`);
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}
