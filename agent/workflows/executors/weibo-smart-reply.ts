#!/usr/bin/env bun
/**
 * Weibo Smart Reply Workflow Executor
 *
 * Fetches comments received via API, scores each by relationship + verification
 * status (mutual follow > follower > I-follow > stranger), ranks by priority,
 * and recommends the top comments worth replying to. Optionally auto-replies
 * to the highest-priority comments.
 *
 * Priority scoring rules:
 *   mutual follow (followMe + following): 30 + verified:5 = 35
 *   follower (followMe only):             20 + verified:5 = 25
 *   I follow (following only):            10 + verified:5 = 15
 *   no relation:                           0 + verified:5 =  5
 *
 * Run: bun run workflow run --id weibo-smart-reply
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
  maxReplies?: number;
  autoReply?: boolean;
  replyTemplates?: Record<string, string[]>;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const maxReplies = config.maxReplies ?? 5;
const autoReply = config.autoReply ?? false;

const replyTemplates: Record<string, string[]> = config.replyTemplates ?? {
  mutual: [
    "感谢老朋友的补充，这个角度很有深度！回头我整理一下展开聊聊。",
    "你的观点总是到位，双向奔赴的互动最珍贵了。",
  ],
  follower: [
    "谢谢支持！有你这样的铁粉关注，更有动力分享了。",
    "感谢认同，以后会分享更多实用的内容，记得关注哦～",
  ],
  following: [
    "哈喽！你也常发有趣的内容，相互学习。",
    "感谢留言，期待后续也能看到你的分享。",
  ],
  stranger: [
    "谢谢留言，欢迎常来交流～",
    "感谢关注这个话题，欢迎持续关注。",
  ],
  verified: [
    "感谢大V的认可！你的专业视角让讨论更有价值，回头展开聊聊。",
  ],
};

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

interface ScoredComment {
  id: string;
  mid: string;
  text: string;
  userName: string;
  userVerified: boolean;
  followMe: boolean;
  following: boolean;
  postJumpLink: string;
  createdAt: string;
  score: number;
  priorityLabel: string;
}

/** Score a comment by relationship + verification status */
function scoreComment(comment: any): ScoredComment {
  const followMe = comment.user?.followMe ?? false;
  const following = comment.user?.following ?? false;
  const verified = comment.user?.verified ?? false;

  let baseScore = 0;
  let priorityLabel = "stranger";

  if (followMe && following) {
    baseScore = 30;
    priorityLabel = "mutual";
  } else if (followMe) {
    baseScore = 20;
    priorityLabel = "follower";
  } else if (following) {
    baseScore = 10;
    priorityLabel = "following";
  }

  if (verified) baseScore += 5;

  return {
    id: comment.id ?? "",
    mid: comment.mid ?? "",
    text: comment.text ?? "",
    userName: comment.user?.name ?? "",
    userVerified: verified,
    followMe,
    following,
    postJumpLink: comment.postJumpLink ?? "",
    createdAt: comment.createdAt ?? "",
    score: baseScore,
    priorityLabel,
  };
}

function pickReplyTemplate(label: string, verified: boolean): string {
  if (verified && replyTemplates.verified) {
    return replyTemplates.verified[Math.floor(Math.random() * replyTemplates.verified.length)];
  }
  const pool = replyTemplates[label] ?? replyTemplates.stranger;
  return pool[Math.floor(Math.random() * pool.length)];
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
  console.log("[Weibo Smart Reply] Starting...");

  // Step 1: Fetch all comments received
  const result = weiboApi("interactive-comments-to-me");
  if (!result || result.code !== 0) {
    console.log("  Failed to fetch comments");
    process.exit(1);
  }

  const comments = result.data?.comments ?? [];
  const total = result.data?.count ?? comments.length;
  console.log(`  Received ${total} comments`);

  if (comments.length === 0) {
    console.log("[Weibo Smart Reply] No comments to process. Done.");
    return;
  }

  // Step 2: Score and rank
  const scored = comments.map(scoreComment);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Newer first when scores equal
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Stats
  const stats = {
    mutual: scored.filter((c) => c.priorityLabel === "mutual").length,
    follower: scored.filter((c) => c.priorityLabel === "follower").length,
    following: scored.filter((c) => c.priorityLabel === "following").length,
    stranger: scored.filter((c) => c.priorityLabel === "stranger").length,
    verified: scored.filter((c) => c.userVerified).length,
  };

  console.log(`  Priority breakdown: 互关 ${stats.mutual} | 粉丝 ${stats.follower} | 我关注 ${stats.following} | 路人 ${stats.stranger} | 认证 ${stats.verified}`);

  // Step 3: Report top recommendations
  const topN = Math.min(maxReplies, 5);
  console.log(`\n  Top ${topN} recommended replies (by priority):`);
  for (const c of scored.slice(0, topN)) {
    const emoji = c.priorityLabel === "mutual" ? "🔴" : c.priorityLabel === "follower" ? "🟡" : c.priorityLabel === "following" ? "🟢" : "⚪";
    const vTag = c.userVerified ? " | 认证用户" : "";
    console.log(`    ${emoji} ${c.priorityLabel}${vTag} | ${c.userName}`);
    console.log(`      「${c.text.slice(0, 60)}」`);
    console.log(`      ${c.postJumpLink}`);
    console.log(`      AI建议回复: ${pickReplyTemplate(c.priorityLabel, c.userVerified)}`);
    console.log("");
  }

  // Step 4: Auto-reply if enabled
  if (autoReply) {
   let replied = 0;
   let consecutiveFailures = 0;
   const MAX_CONSECUTIVE_FAILURES = 3;
   for (const c of scored.slice(0, maxReplies)) {
     if (replied >= maxReplies) break;
      if (alreadyDone("smart-reply", c.postJumpLink)) continue;

      const replyText = pickReplyTemplate(c.priorityLabel, c.userVerified);
      // Reply requires weibo_id (id) and comment_id (cid)
      // The mid from comments-to-me is the post mid, id is the comment id
      const replyResult = weiboApi("reply", [
        `--cid=${c.id}`,
        `--id=${c.mid}`,
        `--comment=${replyText}`,
        `--model=deepseek`,
      ]);

     const ok = replyResult && replyResult.code === 0;
     logOperation("smart-reply", c.postJumpLink, ok ? "success" : "failed", `${c.priorityLabel}: ${replyText.slice(0, 50)}`);
     if (ok) {
       replied++;
       consecutiveFailures = 0;
       console.log(`    Replied to ${c.userName} (${c.priorityLabel}): ${replyText.slice(0, 40)}...`);
     }
     else {
       consecutiveFailures++;
       if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
         console.log(`  ⚠ 连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，停止执行以避免限流`);
         break;
       }
     }
     await Bun.sleep(5000);
    }
    console.log(`\n  Auto-replied to ${replied} comments`);
  }

  console.log("[Weibo Smart Reply] Done.");
}

main();
