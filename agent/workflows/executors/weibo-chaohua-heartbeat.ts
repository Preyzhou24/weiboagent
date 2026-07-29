#!/usr/bin/env bun
/**
 * Weibo Super Topic Heartbeat Workflow Executor
 *
 * Periodically engages with super topic (超话) communities:
 * 1. Lists available super topics
 * 2. Browses each topic timeline for recent posts
 * 3. Likes and comments on interesting posts (via API, not browser)
 * 4. Optionally posts a community contribution
 * 5. Reports progress
 *
 * Run: bun run workflow daemon --id weibo-chaohua-heartbeat --interval 60
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
  topics?: string[];
  maxActionsPerTopic?: number;
  likeEnabled?: boolean;
  commentEnabled?: boolean;
  commentTemplates?: string[];
  postEnabled?: boolean;
  postContent?: string;
  model?: string;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const topics = config.topics ?? ["赛博茶馆"];
const maxActionsPerTopic = config.maxActionsPerTopic ?? 5;
const likeEnabled = config.likeEnabled ?? true;
const commentEnabled = config.commentEnabled ?? true;
const commentTemplates = config.commentTemplates ?? [
  "这个观点很新颖，感谢分享！",
  "学到了，这个角度我之前没想到。",
  "好内容，收藏了。",
  "同感，这个方向确实值得关注。",
];
const postEnabled = config.postEnabled ?? false;
const postContent = config.postContent ?? "";
const model = config.model ?? "deepseek";

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
  console.log("[Weibo Chaohua Heartbeat] Starting...");
  let totalActions = 0;
  let totalLikes = 0;
  let totalComments = 0;

  // Step 1: Discover available topics if not configured
  let activeTopics = topics;
  if (topics.length === 0 || topics[0] === "auto") {
    console.log("  Discovering available super topics...");
    const result = weiboApi("topic-details");
    if (result && result.code === 0 && Array.isArray(result.data)) {
      activeTopics = result.data.map((t: any) => t.topic_name).filter(Boolean);
      console.log(`  Found ${activeTopics.length} topics: ${activeTopics.join(", ")}`);
    }
  }

  // Step 2: Engage with each topic
  for (const topic of activeTopics) {
    console.log(`\n  Topic: ${topic}`);
    let topicActions = 0;

    // Browse timeline
    const timelineResult = weiboApi("timeline", [`--topic=${topic}`, `--page=1`, `--count=10`]);
    if (!timelineResult || timelineResult.code !== 0) {
      console.log(`    Failed to fetch timeline for ${topic}`);
      continue;
    }

    const posts = timelineResult?.data?.statuses ?? [];
    console.log(`    Found ${posts.length} posts in timeline`);

    for (const post of posts) {
      if (topicActions >= maxActionsPerTopic) break;

      const postId = post.id ?? post.mid ?? "";
      const url = post.url ?? `weibo://topic/${topic}/${postId}`;
      if (!postId) continue;

      // Like via API
      if (likeEnabled && !alreadyDone("topic-like", url)) {
        const result = weiboApi("like-post", [`--id=${postId}`]);
        const ok = result && result.code === 0;
        logOperation("topic-like", url, ok ? "success" : "failed", `topic:${topic}`);
        if (ok) {
          totalLikes++;
          topicActions++;
          totalActions++;
          console.log(`    Liked: ${postId}`);
        }
        await Bun.sleep(3000);
      }

      // Comment via API
      if (commentEnabled && topicActions < maxActionsPerTopic && !alreadyDone("topic-comment", url)) {
        const text = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
        const result = weiboApi("comment", [
          `--id=${postId}`,
          `--comment=${text}`,
          `--model=${model}`,
        ]);
        const ok = result && result.code === 0;
        logOperation("topic-comment", url, ok ? "success" : "failed", `topic:${topic}:${text.slice(0, 30)}`);
        if (ok) {
          totalComments++;
          topicActions++;
          totalActions++;
          console.log(`    Commented: ${postId}`);
        }
        await Bun.sleep(5000);
      }
    }
  }

  // Step 3: Optionally post content to a topic
  if (postEnabled && postContent && activeTopics.length > 0) {
    const topic = activeTopics[0];
    console.log(`\n  Posting to ${topic}...`);
    const result = weiboApi("post", [
      `--topic=${topic}`,
      `--status=${postContent}`,
      `--model=${model}`,
    ]);
    const ok = result && result.code === 0;
    logOperation("topic-post", `topic:${topic}`, ok ? "success" : "failed", postContent.slice(0, 100));
    console.log(`    Post ${ok ? "success" : "failed"}`);
  }

  console.log(`\n[Weibo Chaohua Heartbeat] Done. Likes: ${totalLikes}, Comments: ${totalComments}, Total: ${totalActions}`);
}

main();
