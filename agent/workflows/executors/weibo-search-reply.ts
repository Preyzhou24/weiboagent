#!/usr/bin/env bun
/**
 * Weibo Keyword Search & Reply Workflow Executor (API + Web Comment)
 *
 * Searches specific keywords via Weibo Open API and engages with relevant posts.
 * Likes via API, comments via web-comment (internal Web API).
 *
 * Run: bun run workflow run --id weibo-search-reply
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_SCRIPT = resolve(ROOT, "scripts", "log-operation.ts");
const WEIBO_API = resolve(ROOT, "scripts", "weibo-api", "weibo-skill.js");
const WEB_COMMENT = resolve(ROOT, "scripts", "web-comment.js");

interface Config {
  searchQueries?: { keyword: string; pages: number; action: string }[];
  maxTotalActions?: number;
  cooldownSeconds?: number;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const searchQueries = config.searchQueries ?? [
  { keyword: "AI agent", pages: 1, action: "like_and_comment" },
  { keyword: "开源工具", pages: 1, action: "like" },
];
const maxTotalActions = config.maxTotalActions ?? 30;

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
  const result = weiboApi("search", [`--query=${keyword}`]);
  if (!result || result.code !== 0) return [];
  const msg = result.data?.msg ?? "";
  const mblogIds = [...new Set([...msg.matchAll(/mblogid=(\d+)/g)].map((m) => m[1]))];
  return mblogIds.map((id) => ({ id, mid: id, url: `https://weibo.com/detail/${id}` }));
}

function commentOnPost(postId: string, text: string): { ok: boolean; restriction?: boolean; message?: string } {
  if (!postId) return { ok: false };
  try {
    const out = execSync(`node "${WEB_COMMENT}" comment --id=${postId} --comment=${JSON.stringify(text)}`, {
      encoding: "utf-8",
      timeout: 300000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = JSON.parse(out.trim());
    if (result.code === 0) return { ok: true };
    return { ok: false, restriction: result.data?.restriction, message: result.message };
  } catch {
    return { ok: false, message: "web-comment 执行失败" };
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

async function main() {
  console.log("[Weibo Search Reply] Starting...");
  let totalActions = 0;

  for (const query of searchQueries) {
    if (totalActions >= maxTotalActions) break;
    console.log(`  Search: "${query.keyword}" (action: ${query.action})`);
    const posts = searchWeibo(query.keyword);
    console.log(`    Found ${posts.length} posts`);

    for (const post of posts) {
      if (totalActions >= maxTotalActions) break;
      const url = post.url;
      if (!post.id || alreadyDone("search-like", url)) continue;

      // Like via API
      if (query.action === "like" || query.action === "like_and_comment") {
        const result = weiboApi("like-post", [`--id=${post.id}`]);
        const ok = result && result.code === 0;
        logOperation("search-like", url, ok ? "success" : "failed", query.keyword);
        if (ok) {
          totalActions++;
          console.log(`    Liked: ${url}`);
        }
        await Bun.sleep(4000);
      }

      // Comment via web-comment (internal Web API)
      if (query.action === "like_and_comment" && totalActions < maxTotalActions) {
        const comments = ["这个思路很有启发！", "收藏了，有价值的内容。", "同意，这个方向值得关注。", "好文，学习了。"];
        const text = comments[Math.floor(Math.random() * comments.length)];
        const cResult = commentOnPost(post.id, text);
        if (cResult.ok) {
          totalActions++;
          logOperation("search-comment", url, "success", text);
          console.log(`    Commented: ${url}`);
        } else if (cResult.restriction) {
          console.log(`    ⚠ 评论受限: ${cResult.message}`);
          logOperation("search-comment", url, "restricted", cResult.message ?? "");
        } else {
          logOperation("search-comment", url, "failed", cResult.message ?? text);
        }
        await Bun.sleep(15000 + Math.random() * 15000);
      }
    }
  }

  console.log(`[Weibo Search Reply] Done. ${totalActions} posts engaged.`);
}

main();
