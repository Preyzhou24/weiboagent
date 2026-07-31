#!/usr/bin/env bun
/**
 * Weibo Keyword Search & Reply Workflow Executor (API + Web Comment)
 *
 * Searches specific keywords via Weibo Open API and engages with relevant posts.
 * Likes via API, comments via agent-browser (Chrome CDP 真人操作).
 *
 * 整合改进（相对旧版）:
 *  1. 日上限预检: 启动时读取当天已成功操作数，超限直接退出，防止账号被风控。
 *  2. 限流熔断: 任意 like/comment 命中限流立即终止本轮，不再硬刷。
 *  3. 真实错误码: 失败时 note 记录 API 返回的 code/msg，便于复盘。
 *  4. like 间隔提升: 默认 9s±2s（旧版 4s 过密，实测触发限流）。
 *  5. 权限限制归类: 评论受限按 restricted 记录并跳过，不计入熔断。
 *
 * Run: bun run workflow run --id weibo-search-reply
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_SCRIPT = resolve(ROOT, "scripts", "log-operation.ts");
const WEIBO_API = resolve(ROOT, "scripts", "weibo-api", "weibo-skill.js");
const BROWSER_COMMENT = resolve(ROOT, "scripts", "browser-comment.js");
const WEIBO_SEARCH = resolve(ROOT, "scripts", "weibo-api", "weibo-search.js");
const AI_COMMENT = resolve(ROOT, "scripts", "ai-comment.js");

const POST_COOLDOWN_FILE = join(homedir(), ".weibo-skill", "post-cooldown.json");
const POST_COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟账号级冷却

/** 读取「刚发帖」冷却标记，返回剩余冷却毫秒数（0 = 已过冷却期） */
function getPostCooldownRemaining(): number {
  try {
    if (!existsSync(POST_COOLDOWN_FILE)) return 0;
    const data = JSON.parse(readFileSync(POST_COOLDOWN_FILE, "utf-8"));
    const elapsed = Date.now() - data.ts;
    return Math.max(0, POST_COOLDOWN_MS - elapsed);
  } catch {
    return 0;
  }
}

interface Config {
  searchQueries?: { keyword: string; pages: number; action: string }[];
  maxTotalActions?: number;
  cooldownSeconds?: number;
  // 新增: 日上限（当天 00:00 起累计成功的次数），超则熔断
  dailyLikeCap?: number;
  dailyCommentCap?: number;
  // 每小时评论上限（默认 10）
  hourlyCommentCap?: number;
  // 新增: 单动作间隔（毫秒），加随机抖动
  likeIntervalMs?: number;
  commentIntervalMs?: number;
  commentJitterMs?: number;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const searchQueries = config.searchQueries ?? [
  { keyword: "AI agent", pages: 1, action: "like_and_comment" },
  { keyword: "开源工具", pages: 1, action: "like" },
];
const maxTotalActions = config.maxTotalActions ?? 20;
const dailyLikeCap = config.dailyLikeCap ?? 30;
const dailyCommentCap = config.dailyCommentCap ?? 15;
const hourlyCommentCap = config.hourlyCommentCap ?? 10;
const likeIntervalMs = config.likeIntervalMs ?? 9000;
const commentIntervalMs = config.commentIntervalMs ?? 20000;
const commentJitterMs = config.commentJitterMs ?? 10000;

/** 用 AI 根据原微博正文生成个性化评论（替代固定模板） */
function generateAiComment(content: string, user: string): string {
  try {
    const out = execSync(
      `node "${AI_COMMENT}" generate --content=${JSON.stringify(content)} --user=${JSON.stringify(user)}`,
      { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }
    );
    const result = JSON.parse(out.trim());
    if (result.code === 0 && result.comment) return result.comment;
  } catch {
    // AI 不可用时降级
  }
  return "这个观点很有启发！";
}

// -- Helpers ---------------------------------------------------------------

function weiboApi(command: string, args: string[] = []): any {
  const argStr = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
  try {
    const out = execSync(`node "${WEIBO_API}" ${command} ${argStr}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function searchWeibo(keyword: string): any[] {
  // 整合 aione: 用 cookie 驱动的结构化搜索替代 OAuth 智搜正则扒 ID。
  // aione 返回干净的 content + user + url(base62)，weibo-search.js 已转好数字 MID。
  try {
    const out = execSync(`node "${WEIBO_SEARCH}" search --query=${JSON.stringify(keyword)} --page=1`, {
      encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"],
    });
    const result = JSON.parse(out.trim());
    if (!result || result.code !== 0) return [];
    return (result.data ?? []).map((p: any) => ({ id: p.id, mid: p.id, url: p.url, content: p.content, user: p.user }));
  } catch {
    return [];
  }
}

/** 从 API 返回中提取可读错误信息，写进日志 note */
function extractError(result: any, fallback: string): string {
  if (!result) return fallback;
  const code = result.code ?? result.errno ?? "?";
  const msg = result.msg ?? result.message ?? result.data?.msg ?? result.data?.reason ?? "";
  return msg ? `code=${code} ${msg}` : `code=${code}`;
}

/** 判断某个 like/comment 失败是否属于限流（应触发熔断） */
function isRateLimited(result: any, webResult?: any): boolean {
  if (webResult?.data?.rate_limited) return true;
  const text = `${result?.msg ?? ""} ${result?.message ?? ""} ${result?.data?.reason ?? ""}`;
  return /频繁|繁忙|稍后再试|rate.?limit|too many/i.test(text);
}

function commentOnPost(postId: string, text: string): { ok: boolean; restriction?: boolean; rateLimited?: boolean; message?: string } {
  if (!postId) return { ok: false };
  try {
    const out = execSync(`node "${BROWSER_COMMENT}" comment --id=${postId} --comment=${JSON.stringify(text)}`, {
      encoding: "utf-8",
      timeout: 300000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = JSON.parse(out.trim());
    if (result.code === 0) return { ok: true };
    return {
      ok: false,
      restriction: result.data?.restriction === true,
      rateLimited: result.data?.rate_limited === true,
      message: result.message,
    };
  } catch {
    return { ok: false, message: "browser-comment 执行失败" };
  }
}

function alreadyDone(action: string, url: string): boolean {
  try {
    execSync(`bun run "${LOG_SCRIPT}" check --platform weibo --action ${action} --url "${url}"`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function logOperation(action: string, url: string, status: string, note?: string) {
  const args = ["bun", "run", LOG_SCRIPT, "add", "--platform", "weibo", "--action", action, "--url", url, "--status", status];
  if (note) args.push("--note", note);
  try {
    execSync(args.join(" "), { encoding: "utf-8", timeout: 5000 });
  } catch { /* best-effort */ }
}

/** 读取当天已成功操作数，供日上限判断 */
function dailyCounts(): { likeFamily: number; commentFamily: number } {
  try {
    const out = execSync(`bun run "${LOG_SCRIPT}" daily-count --platform weibo`, {
      encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    const d = JSON.parse(out.trim());
    return { likeFamily: d.likeFamily ?? 0, commentFamily: d.commentFamily ?? 0 };
  } catch {
    return { likeFamily: 0, commentFamily: 0 };
  }
}

/** 读取过去 1 小时已成功评论数，供每小时限流 */
function hourlyCommentCount(): number {
  try {
    const out = execSync(`bun run "${LOG_SCRIPT}" hourly-count --platform weibo --hours 1`, {
      encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    });
    const d = JSON.parse(out.trim());
    return d.commentFamily ?? 0;
  } catch {
    return 0;
  }
}

function jitter(base: number, max: number): number {
  return base + Math.floor(Math.random() * max);
}

// -- Main ------------------------------------------------------------------

async function main() {
  console.log("[Weibo Search Reply] Starting...");

  // 发帖后冷却检查：如果刚发完帖，等待账号级风控窗口过去再评论
  const postCooldownRemaining = getPostCooldownRemaining();
  if (postCooldownRemaining > 0) {
    const waitSec = Math.ceil(postCooldownRemaining / 1000);
    console.log(`  检测到刚发帖，等待 ${waitSec}s 账号级冷却（避免 update weibo too fast）...`);
    await Bun.sleep(postCooldownRemaining);
  }

  // 日上限预检：先看今天已经做了多少
  const counts = dailyCounts();
  console.log(`  今日已成功: like=${counts.likeFamily}/${dailyLikeCap}, comment=${counts.commentFamily}/${dailyCommentCap}`);
  if (counts.likeFamily >= dailyLikeCap && counts.commentFamily >= dailyCommentCap) {
    console.log("  日上限已满，跳过本轮。");
    return;
  }

  let totalActions = 0;
  let likes = 0;
  let comments = 0;
 let circuitBroken = false; // 限流熔断标志
 let consecutiveFailures = 0;

 outer: for (const query of searchQueries) {
    if (totalActions >= maxTotalActions) break;
    console.log(`  Search: "${query.keyword}" (action: ${query.action})`);
    const posts = searchWeibo(query.keyword);
    console.log(`    Found ${posts.length} posts`);

    for (const post of posts) {
      if (totalActions >= maxTotalActions || circuitBroken) break;
      const url = post.url;
      if (!post.id || alreadyDone("search-like", url)) continue;

      // 日上限二次检查（循环中随成功数递增）
      const likeOkCap = counts.likeFamily + likes < dailyLikeCap;
      const commentOkCap = counts.commentFamily + comments < dailyCommentCap;

      // Like via API
      if ((query.action === "like" || query.action === "like_and_comment") && likeOkCap) {
        const result = weiboApi("like-post", [`--id=${post.id}`]);
        const ok = result && result.code === 0;
       if (ok) {
         likes++;
         totalActions++;
         consecutiveFailures = 0;
         logOperation("search-like", url, "success", query.keyword);
         console.log(`    Liked: ${url}`);
       } else {
          // 失败: 记录真实错误码；若是限流则熔断
          const note = `${query.keyword} | ${extractError(result, "like failed")}`;
          logOperation("search-like", url, "failed", note);
          console.log(`    Like failed: ${note}`);
         if (isRateLimited(result)) {
           console.log("    ⚠ 命中限流，熔断本轮剩余操作。");
           circuitBroken = true;
           break outer;
         }
         consecutiveFailures++;
         if (consecutiveFailures >= 3) {
           console.log(`  ⚠ 连续失败 ${consecutiveFailures} 次，停止执行以避免限流`);
           circuitBroken = true;
           break outer;
         }
       }
       await Bun.sleep(jitter(likeIntervalMs, 4000));
      }

      // Comment via agent-browser (Chrome CDP 真人操作)
      const hourlyOk = hourlyCommentCount() + comments < hourlyCommentCap;
      if (query.action === "like_and_comment" && !circuitBroken && commentOkCap && hourlyOk && totalActions < maxTotalActions) {
        // AI 动态生成评论（替代固定模板），用原微博正文 + 博主名
        const text = generateAiComment(post.content ?? query.keyword, post.user ?? "");
        const cResult = commentOnPost(post.id, text);
       if (cResult.ok) {
         comments++;
         totalActions++;
         consecutiveFailures = 0;
         logOperation("search-comment", url, "success", text);
         console.log(`    Commented: ${url}`);
       } else if (cResult.restriction) {
          // 权限限制: 记为 restricted 并跳过，不触发熔断
          console.log(`    ⚠ 评论受限(权限): ${cResult.message}`);
          logOperation("search-comment", url, "restricted", cResult.message ?? "");
        } else if (cResult.rateLimited) {
          // 限流: 熔断
          console.log(`    ⚠ 评论限流: ${cResult.message}`);
          logOperation("search-comment", url, "failed", cResult.message ?? "rate_limited");
          circuitBroken = true;
          break outer;
       } else {
         logOperation("search-comment", url, "failed", cResult.message ?? text);
         consecutiveFailures++;
         if (consecutiveFailures >= 3) {
           console.log(`  ⚠ 连续失败 ${consecutiveFailures} 次，停止执行以避免限流`);
           circuitBroken = true;
           break outer;
         }
       }
       await Bun.sleep(jitter(commentIntervalMs, commentJitterMs));
      }
    }
  }

  console.log(
    `[Weibo Search Reply] Done. likes=${likes} comments=${comments} actions=${totalActions}${circuitBroken ? " (熔断)" : ""}`
  );
}

main();
