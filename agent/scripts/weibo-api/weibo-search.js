#!/usr/bin/env node

/**
 * weibo-search.js - aione (All-IN-ONE) 微博搜索与浏览封装
 *
 * 整合 aione 的 cookie 驱动搜索与浏览能力，覆盖 aione 微博模块的全部读操作命令：
 *   search (web)      - 关键词搜索，返回结构化帖子列表
 *   user-info         - 查看任意用户资料（替代浏览器 follow 前的资料查询）
 *   user-posted       - 分页拉取用户微博列表
 *   user-all-posted   - 拉取用户全部微博历史
 *   work-info         - 单条微博详情（OAuth status-show 的 cookie 降级通道）
 *   word-comments     - 微博评论列表（OAuth comments 的 cookie 降级通道）
 *   mobile-search     - 移动端关键词搜索（web cookie 限流时的降级路径）
 *   mobile-work-info  - 移动端作品详情
 *
 * 优势: aione 直接返回结构化结果 (content + user + 干净 URL)，
 *       而 OAuth 智搜只返回 AI 摘要文本，需正则抓 mblogid，目标 ID 不准。
 *
 * 返回的 base62 ID 会被自动转换为数字 MID，供 OAuth like-post 使用。
 * 转换逻辑与 web-comment.js 的 decodeMid 一致。
 *
 * 用法:
 *   node scripts/weibo-api/weibo-search.js search --query="AI agent" --page=1
 *   node scripts/weibo-api/weibo-search.js user-info --user-id="<uid>"
 *   node scripts/weibo-api/weibo-search.js user-posted --user-id="<uid>" --page=1
 *   node scripts/weibo-api/weibo-search.js user-all-posted --user-url="<url>"
 *   node scripts/weibo-api/weibo-search.js work-info --url="<post_url>"
 *   node scripts/weibo-api/weibo-search.js word-comments --user-id="<uid>" --mid="<mid>"
 *   node scripts/weibo-api/weibo-search.js mobile-search --query="AI" --page=1
 *   node scripts/weibo-api/weibo-search.js mobile-work-info --work-id="<id>"
 *
 * 返回 JSON:
 *   { code: 0, data: ... }  // 成功
 *   { code: -1, message: "..." }  // 失败
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Base62 -> 数字 MID（与 web-comment.js 保持一致）---

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

// --- 参数解析 ---

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

// --- 通用 aione 调用封装 ---

/**
 * 调用 aione CLI，返回解析后的结果。
 * 使用临时文件绕过 PowerShell GBK 控制台编码问题。
 * aione 返回三元组 [success: bool, msg: string, results: any]
 * @param {string} aioneCmd - 完整的 aione 命令（不含 output/path 参数）
 * @returns {{ success: boolean, msg: string, data: any }}
 */
function runAione(aioneCmd) {
  const tmpFile = join(mkdtempSync(join(tmpdir(), "wb-aione-")), "result.json");

  try {
    execSync(
      `${aioneCmd} --output file --path="${tmpFile}"`,
      { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    rmSync(tmpFile, { recursive: true, force: true });
    return { success: false, msg: `aione 调用失败: ${err.message}`, data: null };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(tmpFile, "utf-8"));
  } catch {
    rmSync(tmpFile, { recursive: true, force: true });
    return { success: false, msg: "aione 返回解析失败", data: null };
  }
  rmSync(tmpFile, { recursive: true, force: true });

  if (!Array.isArray(raw) || raw.length < 3) {
    return { success: false, msg: "aione 返回格式异常", data: String(raw).slice(0, 200) };
  }

  const [success, msg, results] = raw;
  if (!success) {
    return { success: false, msg: `aione 失败: ${msg}`, data: null };
  }

  return { success: true, msg, data: results };
}

/** 将帖子列表结果标准化：提取 base62、转数字 MID、截断正文 */
function normalizePosts(results) {
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => {
      const url = r.url || "";
      const base62 = extractBase62(url);
      if (!base62) return null;
      return {
        id: decodeMid(base62),
        base62,
        url,
        content: (r.content || "").slice(0, 200),
        user: r.user || "",
      };
    })
    .filter(Boolean);
}

// --- 各命令实现 ---

/** 关键词搜索（web profile） */
function searchWeibo(query, page = 1) {
  if (!query) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --query 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo post search --query=${JSON.stringify(query)} --page=${page}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  const posts = normalizePosts(res.data);
  console.log(JSON.stringify({ code: 0, data: posts, total: posts.length }));
}

/** 查看任意用户资料（web profile） */
function userInfo(userId) {
  if (!userId) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --user-id 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo user info --user-id=${JSON.stringify(userId)}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  console.log(JSON.stringify({ code: 0, data: res.data }));
}

/** 分页拉取用户微博列表（web profile） */
function userPosted(userId, page = 1) {
  if (!userId) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --user-id 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo user posted --user-id=${JSON.stringify(userId)} --page=${page}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  const posts = normalizePosts(res.data);
  console.log(JSON.stringify({ code: 0, data: posts, total: posts.length }));
}

/** 拉取用户全部微博历史（web profile） */
function userAllPosted(userUrl) {
  if (!userUrl) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --user-url 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo user all-posted --user-url=${JSON.stringify(userUrl)}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  const posts = normalizePosts(res.data);
  console.log(JSON.stringify({ code: 0, data: posts, total: posts.length }));
}

/** 单条微博详情（web profile）- OAuth status-show 的 cookie 降级通道 */
function workInfo(postUrl) {
  if (!postUrl) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --url 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo work info --url=${JSON.stringify(postUrl)}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  const enriched = { ...(res.data || {}) };
  if (res.data && res.data.url) {
    const base62 = extractBase62(res.data.url);
    if (base62) { enriched.id = decodeMid(base62); enriched.base62 = base62; }
  }
  console.log(JSON.stringify({ code: 0, data: enriched }));
}

/** 微博评论列表（web profile）- OAuth comments 的 cookie 降级通道 */
function wordComments(userId, mid) {
  if (!userId || !mid) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --user-id 和 --mid 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo word comments --user-id=${JSON.stringify(userId)} --mid=${JSON.stringify(mid)}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  console.log(JSON.stringify({ code: 0, data: res.data }));
}

/** 移动端关键词搜索（mobile profile）- web cookie 限流时的降级路径 */
function mobileSearch(query, page = 1) {
  if (!query) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --query 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo mobile search --query=${JSON.stringify(query)} --page=${page}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  const posts = normalizePosts(res.data);
  console.log(JSON.stringify({ code: 0, data: posts, total: posts.length }));
}

/** 移动端作品详情（mobile profile） */
function mobileWorkInfo(workId) {
  if (!workId) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --work-id 参数" }));
    process.exit(1);
  }
  const res = runAione(`aione weibo mobile work-info --work-id=${JSON.stringify(workId)}`);
  if (!res.success) { console.log(JSON.stringify({ code: -1, message: res.msg })); return; }
  console.log(JSON.stringify({ code: 0, data: res.data }));
}

// --- 入口 ---

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

switch (command) {
  case "search":
    searchWeibo(args.query, args.page ? parseInt(args.page, 10) : 1);
    break;
  case "user-info":
    userInfo(args["user-id"]);
    break;
  case "user-posted":
    userPosted(args["user-id"], args.page ? parseInt(args.page, 10) : 1);
    break;
  case "user-all-posted":
    userAllPosted(args["user-url"]);
    break;
  case "work-info":
    workInfo(args.url);
    break;
  case "word-comments":
    wordComments(args["user-id"], args.mid);
    break;
  case "mobile-search":
    mobileSearch(args.query, args.page ? parseInt(args.page, 10) : 1);
    break;
  case "mobile-work-info":
    mobileWorkInfo(args["work-id"]);
    break;
  case "help":
  case "--help":
  case "":
    console.log(`
weibo-search.js - aione 微博搜索与浏览封装

用法:
  node scripts/weibo-api/weibo-search.js <command> [options]

命令:
  search            关键词搜索（web profile），返回结构化帖子列表
  user-info         查看任意用户资料
  user-posted       分页拉取用户微博列表
  user-all-posted   拉取用户全部微博历史
  work-info         单条微博详情（OAuth status-show 的降级通道）
  word-comments     微博评论列表（OAuth comments 的降级通道）
  mobile-search     移动端关键词搜索（web cookie 限流时的降级路径）
  mobile-work-info  移动端作品详情

选项:
  --query=<keyword>       搜索关键词
  --user-id=<uid>         用户 ID
  --user-url=<url>        用户主页 URL
  --url=<post_url>        微博帖子 URL
  --mid=<mid>             微博消息 ID
  --work-id=<id>          作品 ID（移动端）
  --page=<n>              页码（默认 1）

返回结构化帖子列表，每条含数字 ID (id)、base62 ID、URL、正文摘要、博主名。
`);
    break;
  default:
    console.error(`未知命令: ${command}`);
    process.exit(1);
}
