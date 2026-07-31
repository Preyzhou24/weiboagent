#!/usr/bin/env bun
/**
 * Weibo Hot Trend Monitor & Trending Content Workflow Executor
 *
 * Pulls hot search rankings (科技榜) via API, finds AI/tech-related trends,
 * searches for related posts to engage with, and optionally posts a trending
 * content piece. Logs all actions for dedup.
 *
 * Run: bun run workflow run --id weibo-hot-trend
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_SCRIPT = resolve(ROOT, "scripts", "log-operation.ts");
const WEIBO_API = resolve(ROOT, "scripts", "weibo-api", "weibo-skill.js");

// -- Config ----------------------------------------------------------------

interface Config {
  categories?: string[];
  relevanceKeywords?: string[];
  maxEngagements?: number;
  postEnabled?: boolean;
  postTopic?: string;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const categories = config.categories ?? ["科技榜", "主榜"];
const relevanceKeywords =
  config.relevanceKeywords ?? ["AI", "大模型", "LLM", "Agent", "开源", "编程", "科技", "芯片", "算法"];
const maxEngagements = config.maxEngagements ?? 5;
const postEnabled = config.postEnabled ?? false;
const postTopic = config.postTopic ?? "AI";

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

function isRelevant(text: string): boolean {
  return relevanceKeywords.some((kw) => text.includes(kw));
}

function alreadyDone(action: string, url: string): boolean {
  try {
    execSync(
      `bun run "${LOG_SCRIPT}" check --platform weibo --action ${action} --url "${url}"`,
      { encoding: "utf-8", timeout: 5000, stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

function logOperation(action: string, url: string, status: string, note?: string) {
  const args = [
    "bun", "run", LOG_SCRIPT, "add",
    "--platform", "weibo", "--action", action,
    "--url", url, "--status", status,
  ];
  if (note) args.push("--note", note);
  try {
    execSync(args.join(" "), { encoding: "utf-8", timeout: 5000 });
  } catch { /* best-effort */ }
}

// -- Main ------------------------------------------------------------------

async function main() {
  console.log("[Weibo Hot Trend] Starting...");

  // Step 1: Fetch hot search rankings
  const hotTopics: { text: string; rank: number; category: string }[] = [];

  for (const category of categories) {
    console.log(`  Fetching hot search: ${category}`);
    const result = weiboApi("hot-search", [`--category=${category}`]);
    if (!result || result.code !== 0) {
      console.log(`    Failed to fetch ${category}`);
      continue;
    }

    const items = Array.isArray(result.data) ? result.data : (result.data?.data ?? result.data?.list ?? []);
    for (const item of items) {
      const text = item.word ?? item.name ?? item.text ?? item.keyword ?? item.query ?? "";
      if (text && isRelevant(text)) {
        hotTopics.push({ text, rank: item.rank ?? 0, category });
      }
    }
  }

  console.log(`  Found ${hotTopics.length} relevant hot topics`);

  if (hotTopics.length === 0) {
    console.log("[Weibo Hot Trend] No relevant trends found. Skipping.");
    return;
  }

  // Sort by rank (lower = hotter)
  hotTopics.sort((a, b) => a.rank - b.rank);

  // Step 2: For top trends, search and engage
 let engagements = 0;
 let consecutiveFailures = 0;
 const MAX_CONSECUTIVE_FAILURES = 3;
 let shouldStop = false;
 for (const topic of hotTopics.slice(0, 3)) {
   if (engagements >= maxEngagements || shouldStop) break;
   console.log(`  Trend #${topic.rank} (${topic.category}): ${topic.text}`);

    const searchResult = weiboApi("search", [`--query=${topic.text}`]);
    // 智搜 returns AI summary in data.msg with embedded mblogid references
    const msg = searchResult?.data?.msg ?? "";
    const mblogIds = [...new Set([...msg.matchAll(/mblogid=(\d+)/g)].map(m => m[1]))]
      .slice(0, 3); // top 3 unique post IDs
    const posts = mblogIds.map(id => ({ id: id, mid: id, url: `https://weibo.com/detail/${id}` }));

   for (const post of posts.slice(0, 3)) {
     if (engagements >= maxEngagements || shouldStop) break;
     const postId = post.id ?? post.mid ?? "";
      const url = post.url ?? post.link ?? (postId ? `weibo://post/${postId}` : "");
      if (!postId || alreadyDone("hot-like", url)) continue;

      // Like the trending post
     const likeResult = weiboApi("like-post", [`--id=${postId}`]);
     const ok = likeResult && likeResult.code === 0;
     logOperation("hot-like", url, ok ? "success" : "failed", `trend:${topic.text}`);
     if (ok) {
       engagements++;
       consecutiveFailures = 0;
       console.log(`    Liked: ${url}`);
     }
     else {
       consecutiveFailures++;
       if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
         console.log(`  ⚠ 连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，停止执行以避免限流`);
         shouldStop = true;
         break;
       }
     }
     await Bun.sleep(4000);
    }
  }

  // Step 3: Optionally post a trending content piece
  if (postEnabled && hotTopics.length > 0) {
    const topTrend = hotTopics[0];
    const status = `关注到「${topTrend.text}」上了${topTrend.category}，聊聊这个话题的 AI 视角\n\n${topTrend.text}背后折射出的技术趋势值得深思。作为 AI 领域的观察者，这个方向值得关注。`;
    const postResult = weiboApi("post", [
      `--topic=${postTopic}`,
      `--status=${status}`,
      `--model=deepseek`,
    ]);
    const ok = postResult && postResult.code === 0;
    logOperation("hot-post", topTrend.text, ok ? "success" : "failed", status.slice(0, 100));
    console.log(`  Posted trending content: ${ok ? "success" : "failed"}`);
  }

  console.log(`[Weibo Hot Trend] Done. Engagements: ${engagements}`);
}

main();
