#!/usr/bin/env bun
/**
 * Weibo Feed Monitor & Auto-Engage Workflow Executor (API-first refactor)
 *
 * Searches Weibo for keywords via aione (cookie-driven), then for each
 * undiscovered post uses Chrome CDP to like and comment. No OAuth needed.
 * Logs every action for cross-session dedup.
 *
 * 节流/熔断/日上限逻辑:
 *  1. 日上限预检 (dailyLikeCap/dailyCommentCap) 启动即查，超限退出。
 *  2. 限流熔断: like/comment 命中限流立即终止本轮，不再硬刷。
 *  3. 真实错误码: 失败 note 记录 API 返回的 code/msg。
 *  4. like 间隔提升: 旧版 3s 过密，默认提升到 9s±2s。
 *  5. 权限限制归类: 评论受限按 restricted 跳过，不触发熔断。
 *
 * Run: bun run workflow daemon --id weibo-feed-monitor --interval 120
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
const BROWSER_COMMENT = resolve(ROOT, "scripts", "browser-comment.js");
const BROWSER_LIKE = resolve(ROOT, "scripts", "browser-like.js");
const WEIBO_SEARCH = resolve(ROOT, "scripts", "weibo-api", "weibo-search.js");
const AI_COMMENT = resolve(ROOT, "scripts", "ai-comment.js");

const POST_COOLDOWN_FILE = join(homedir(), ".weiboagent", "post-cooldown.json");
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
  searchKeywords?: string[];
  maxActionsPerRun?: number;
  dailyLikeCap?: number;
  dailyCommentCap?: number;
  hourlyCommentCap?: number;
  likeIntervalMs?: number;
  commentIntervalMs?: number;
  commentJitterMs?: number;
  engagementRules?: {
    like?: { enabled?: boolean; maxPerRun?: number };
    comment?: { enabled?: boolean; maxPerRun?: number; commentTemplates?: string[] };
  };
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const keywords = config.searchKeywords ?? ["AI agent", "大模型", "LLM"];
const maxActions = config.maxActionsPerRun ?? 20;
const dailyLikeCap = config.dailyLikeCap ?? 30;
const dailyCommentCap = config.dailyCommentCap ?? 15;
const hourlyCommentCap = config.hourlyCommentCap ?? 10;
const likeIntervalMs = config.likeIntervalMs ?? 9000;
const commentIntervalMs = config.commentIntervalMs ?? 20000;
const commentJitterMs = config.commentJitterMs ?? 10000;
const likeEnabled = config.engagementRules?.like?.enabled ?? true;
const likeMax = config.engagementRules?.like?.maxPerRun ?? 10;
const commentEnabled = config.engagementRules?.comment?.enabled ?? true;
const commentMax = config.engagementRules?.comment?.maxPerRun ?? 3;

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

/** Chrome CDP 点赞 (browser-like.js) — 替代 OAuth like-post */
function browserLike(postId: string, postUrl?: string): any {
  try {
    const urlArg = postUrl ? ` --url=${JSON.stringify(postUrl)}` : ``;
    const out = execSync(`node "${BROWSER_LIKE}" like --id=${postId}${urlArg}`, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(out.trim());
  } catch {
    return null;
  }
}

function searchWeibo(keyword: string): any[] {
  // 整合 aione: cookie 驱动的结构化搜索替代 OAuth 智搜正则扒 ID。
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

function getPostUrl(post: any): string {
  if (post.url) return post.url;
  if (post.link) return post.link;
  const id = post.id ?? post.mid ?? post.weibo_id ?? "";
  return id ? `https://weibo.com/detail/${id}` : "";
}

/** 从 API 返回中提取可读错误信息 */
function extractError(result: any, fallback: string): string {
  if (!result) return fallback;
  const code = result.code ?? result.errno ?? "?";
  const msg = result.msg ?? result.message ?? result.data?.msg ?? result.data?.reason ?? "";
  return msg ? `code=${code} ${msg}` : `code=${code}`;
}

/** 判断 like 失败是否属于限流（触发熔断） */
function isRateLimited(result: any): boolean {
  const text = `${result?.msg ?? ""} ${result?.message ?? ""} ${result?.data?.reason ?? ""}`;
  return /频繁|繁忙|稍后再试|rate.?limit|too many/i.test(text);
}

function commentOnPost(postId: string, text: string, postUrl?: string): { ok: boolean; restriction?: boolean; rateLimited?: boolean; message?: string } {
  if (!postId) return { ok: false };
  try {
    const urlArg = postUrl ? ` --url=${JSON.stringify(postUrl)}` : ``;
    const out = execSync(`node "${BROWSER_COMMENT}" comment --id=${postId} --comment=${JSON.stringify(text)}${urlArg}`, {
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
      encoding: "utf-8", timeout: 5000, stdio: "pipe",
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
  console.log("[Weibo Feed Monitor] Starting scan (API mode)...");

  // 发帖后冷却检查：如果刚发完帖，等待账号级风控窗口过去再评论
  const postCooldownRemaining = getPostCooldownRemaining();
  if (postCooldownRemaining > 0) {
    const waitSec = Math.ceil(postCooldownRemaining / 1000);
    console.log(`  检测到刚发帖，等待 ${waitSec}s 账号级冷却（避免 update weibo too fast）...`);
    await Bun.sleep(postCooldownRemaining);
  }

  const counts = dailyCounts();
  console.log(`  今日已成功: like=${counts.likeFamily}/${dailyLikeCap}, comment=${counts.commentFamily}/${dailyCommentCap}`);
  if (counts.likeFamily >= dailyLikeCap && counts.commentFamily >= dailyCommentCap) {
    console.log("  日上限已满，跳过本轮。");
    return;
  }

  let actions = 0;
  let likes = 0;
  let comments = 0;
 let circuitBroken = false;
 let consecutiveFailures = 0;

 outer: for (const keyword of keywords) {
    if (actions >= maxActions || circuitBroken) break;
    console.log(`  Searching: "${keyword}"`);
    const posts = searchWeibo(keyword);
    if (!Array.isArray(posts) || posts.length === 0) {
      console.log(`    No results for "${keyword}"`);
      continue;
    }
    console.log(`    Found ${posts.length} posts`);

    for (const post of posts) {
      if (actions >= maxActions || circuitBroken) break;
      const postId = post.id ?? post.mid ?? "";
      const url = getPostUrl(post);
      if (!postId && !url) continue;

      const likeOkCap = counts.likeFamily + likes < dailyLikeCap;
      const commentOkCap = counts.commentFamily + comments < dailyCommentCap;

      // Like via API
      if (likeEnabled && likes < likeMax && likeOkCap && !alreadyDone("search-like", url)) {
        console.log(`    Liking: ${url || postId}`);
        const result = browserLike(postId, url);
        const ok = result && result.code === 0;
       if (ok) {
         likes++;
         consecutiveFailures = 0;
         logOperation("search-like", url, "success", keyword);
       } else {
          const note = `${keyword} | ${extractError(result, "like failed")}`;
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
       actions++;
        await Bun.sleep(jitter(likeIntervalMs, 4000));
      }

      // Comment via agent-browser (Chrome CDP 真人操作)
      const hourlyOk = hourlyCommentCount() + comments < hourlyCommentCap;
      if (commentEnabled && comments < commentMax && commentOkCap && hourlyOk && !circuitBroken && actions < maxActions && !alreadyDone("search-comment", url)) {
        // AI 动态生成评论（替代固定模板），用原微博正文 + 博主名
        const text = generateAiComment(post.content ?? keyword, post.user ?? "");
        console.log(`    Commenting: ${url || postId}`);
        const result = commentOnPost(postId, text, url);
       if (result.ok) {
         comments++;
         consecutiveFailures = 0;
         logOperation("search-comment", url, "success", text);
       } else if (result.restriction) {
          console.log(`    ⚠ 评论受限(权限): ${result.message}`);
          logOperation("search-comment", url, "restricted", result.message ?? "");
        } else if (result.rateLimited) {
          console.log(`    ⚠ 评论限流: ${result.message}`);
          logOperation("search-comment", url, "failed", result.message ?? "rate_limited");
          circuitBroken = true;
          break outer;
       } else {
         logOperation("search-comment", url, "failed", result.message ?? text);
         consecutiveFailures++;
         if (consecutiveFailures >= 3) {
           console.log(`  ⚠ 连续失败 ${consecutiveFailures} 次，停止执行以避免限流`);
           circuitBroken = true;
           break outer;
         }
       }
       actions++;
        await Bun.sleep(jitter(commentIntervalMs, commentJitterMs));
      }
    }
  }

  console.log(
    `[Weibo Feed Monitor] Done. Likes: ${likes}, Comments: ${comments}, Total actions: ${actions}${circuitBroken ? " (熔断)" : ""}`
  );
}

main();
