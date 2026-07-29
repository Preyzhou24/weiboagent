#!/usr/bin/env bun
/**
 * Weibo Keyword Search & Reply Workflow Executor (API)
 *
 * Searches specific keywords via Weibo Open API and engages with relevant posts.
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
    }
  }

  console.log(`[Weibo Search Reply] Done. ${totalActions} posts engaged.`);
}

main();
