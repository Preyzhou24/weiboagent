#!/usr/bin/env bun
/**
 * Weibo Feed Monitor & Auto-Engage Workflow Executor (API-first refactor)
 *
 * Searches Weibo for keywords via Weibo Open API (weibo-skill.js search),
 * then for each undiscovered post uses API to like and comment.
 * Falls back to agent-browser only when API is unavailable.
 * Logs every action for cross-session dedup.
 *
 * Run: bun run workflow daemon --id weibo-feed-monitor --interval 120
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
  searchKeywords?: string[];
  maxActionsPerRun?: number;
  engagementRules?: {
    like?: { enabled?: boolean; maxPerRun?: number };
    comment?: { enabled?: boolean; maxPerRun?: number; commentTemplates?: string[] };
  };
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const keywords = config.searchKeywords ?? ["AI agent", "大模型", "LLM"];
const maxActions = config.maxActionsPerRun ?? 20;
const likeEnabled = config.engagementRules?.like?.enabled ?? true;
const likeMax = config.engagementRules?.like?.maxPerRun ?? 10;
const commentEnabled = config.engagementRules?.comment?.enabled ?? true;
const commentMax = config.engagementRules?.comment?.maxPerRun ?? 3;
const commentTemplates =
  config.engagementRules?.comment?.commentTemplates ?? [
    "这个思路很有启发！",
    "收藏了，很有价值的内容。",
    "同意，这个方向值得关注。",
    "好文，学习了。",
  ];

// -- Helpers ---------------------------------------------------------------

/** Run weibo-skill.js command and return parsed JSON */
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

/** Search Weibo via API (智搜) — returns AI summary with embedded mblogid references */
function searchWeibo(keyword: string): any[] {
  const result = weiboApi("search", [`--query=${keyword}`]);
  if (!result || result.code !== 0) return [];
  // 智搜 returns AI summary in data.msg with embedded mblogid references
  const msg = result.data?.msg ?? "";
  const mblogIds = [...new Set([...msg.matchAll(/mblogid=(\d+)/g)].map(m => m[1]))];
  return mblogIds.map(id => ({ id: id, mid: id, url: `https://weibo.com/detail/${id}` }));
}

/** Extract a post ID from search result */
function getPostId(post: any): string {
  return post.id ?? post.mid ?? post.weibo_id ?? "";
}

/** Extract a URL from search result (for dedup logging) */
function getPostUrl(post: any): string {
  if (post.url) return post.url;
  if (post.link) return post.link;
  const id = getPostId(post);
  const uid = post.user_id ?? post.uid ?? post.userid ?? "";
  return id ? `https://weibo.com/${uid}/${id}` : "";
}

/** Like a post via API */
function likePost(postId: string): boolean {
  if (!postId) return false;
  const result = weiboApi("like-post", [`--id=${postId}`]);
  return result && result.code === 0;
}

/** Comment on a post via API */
function commentOnPost(postId: string, text: string): boolean {
  if (!postId) return false;
  const result = weiboApi("comment", [
    `--id=${postId}`,
    `--comment=${text}`,
    `--model=deepseek`,
  ]);
  return result && result.code === 0;
}

/** Check if we already performed an action on this URL (exit 0 = done) */
function alreadyDone(action: string, url: string): boolean {
  try {
    execSync(
      `bun run "${LOG_SCRIPT}" check --platform weibo --action ${action} --url "${url}"`,
      { encoding: "utf-8", timeout: 5000, stdio: "pipe" }
    );
    return true; // exit 0 = already done
  } catch {
    return false; // exit 1 = not done
  }
}

function logOperation(action: string, url: string, status: string, note?: string) {
  const args = [
    "bun",
    "run",
    LOG_SCRIPT,
    "add",
    "--platform",
    "weibo",
    "--action",
    action,
    "--url",
    url,
    "--status",
    status,
  ];
  if (note) args.push("--note", note);
  try {
    execSync(args.join(" "), { encoding: "utf-8", timeout: 5000 });
  } catch {
    /* best-effort */
  }
}

// -- Main ------------------------------------------------------------------

async function main() {
  console.log("[Weibo Feed Monitor] Starting scan (API mode)...");
  let actions = 0;
  let likes = 0;
  let comments = 0;

  for (const keyword of keywords) {
    if (actions >= maxActions) break;
    console.log(`  Searching: "${keyword}"`);
    const posts = searchWeibo(keyword);
    if (!Array.isArray(posts) || posts.length === 0) {
      console.log(`    No results for "${keyword}"`);
      continue;
    }
    console.log(`    Found ${posts.length} posts`);

    for (const post of posts) {
      if (actions >= maxActions) break;
      const postId = getPostId(post);
      const url = getPostUrl(post);
      if (!postId && !url) continue;

      // Like via API
      if (likeEnabled && likes < likeMax && !alreadyDone("like", url)) {
        console.log(`    Liking: ${url || postId}`);
        const ok = likePost(postId);
        logOperation("like", url, ok ? "success" : "failed");
        if (ok) likes++;
        actions++;
        await Bun.sleep(3000); // rate-limit safety
      }

      // Comment via API
      if (commentEnabled && comments < commentMax && !alreadyDone("comment", url)) {
        const text =
          commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        console.log(`    Commenting: ${url || postId}`);
        const ok = commentOnPost(postId, text);
        logOperation("comment", url, ok ? "success" : "failed", text);
        if (ok) comments++;
        actions++;
        await Bun.sleep(5000);
      }
    }
  }

  console.log(
    `[Weibo Feed Monitor] Done. Likes: ${likes}, Comments: ${comments}, Total actions: ${actions}`
  );
}

main();
