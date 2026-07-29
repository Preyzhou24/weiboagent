#!/usr/bin/env bun
/**
 * Weibo Creator Analytics & Data-Driven Strategy Workflow Executor
 *
 * Pulls creator data summary + incentive plan data via API, analyzes:
 * - 30-day read/post/interaction trends
 * - 7-day fan/iron-fan growth
 * - Fan portrait (gender/age/region/interests)
 * - Top performing posts (by reads, interactions, interaction rate)
 * - V榜 ranking trends
 * - Active incentive plans and matching content
 *
 * Outputs a strategy report that guides content creation decisions.
 *
 * Run: bun run workflow run --id weibo-creator-analytics
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
  reportPath?: string;
  topNPosts?: number;
}

const configArg = process.argv.find((_, i, a) => a[i - 1] === "--config");
const config: Config = configArg ? JSON.parse(configArg) : {};
const reportPath = config.reportPath
  ? resolve(ROOT, config.reportPath)
  : resolve(ROOT, "persona", "analytics-report.md");
const topN = config.topNPosts ?? 5;

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

/** Calculate interaction rate per 1000 reads */
function interactionRate(post: any): number {
  const reads = post.readTotal ?? 0;
  if (reads === 0) return 0;
  const interactions = (post.repostTotal ?? 0) + (post.commentTotal ?? 0) + (post.likeTotal ?? 0);
  return (interactions / reads) * 1000;
}

// -- Main ------------------------------------------------------------------

async function main() {
  console.log("[Weibo Creator Analytics] Starting...");

  // Step 1: Fetch creator summary
  console.log("  Fetching creator summary...");
  const summary = weiboApi("creator-summary");
  if (!summary || summary.code !== 0) {
    console.log("  Failed to fetch creator summary");
    process.exit(1);
  }
  const d = summary.data;

  // Step 2: Fetch incentive plan data
  console.log("  Fetching incentive plan data...");
  const incentive = weiboApi("adincentive-summary");
  const incentiveData = incentive && incentive.code === 0 ? incentive.data : null;

  // Step 3: Analyze and build report
  const lines: string[] = [];
  lines.push("# 创作者数据分析报告");
  lines.push("");
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push("");

  // -- User level --
  lines.push("## 账号状态");
  lines.push("");
  lines.push(`- UID: ${d.uid ?? "N/A"}`);
  lines.push(`- 认证等级: ${d.userLevel ?? "N/A"}`);
  lines.push("");

  // -- 30-day trends --
  const readTrend = d.readTrend30Days ?? [];
  const postTrend = d.postTrend30Days ?? [];
  const interactTrend = d.interactTrend30Days ?? [];

  const totalReads = readTrend.reduce((s: number, r: any) => s + (r.totalReadCount ?? 0), 0);
  const totalPosts = postTrend.reduce((s: number, r: any) => s + (r.statusCount ?? 0), 0);
  const totalInteractions = interactTrend.reduce(
    (s: number, r: any) => s + (r.repostCount ?? 0) + (r.commentCount ?? 0) + (r.likeCount ?? 0),
    0
  );
  const avgDailyReads = readTrend.length > 0 ? Math.round(totalReads / readTrend.length) : 0;
  const avgDailyInteractions = interactTrend.length > 0 ? Math.round(totalInteractions / interactTrend.length)! : 0;

  lines.push("## 近30天趋势");
  lines.push("");
  lines.push(`- 总阅读量: ${totalReads.toLocaleString()}`);
  lines.push(`- 日均阅读: ${avgDailyReads.toLocaleString()}`);
  lines.push(`- 总发博数: ${totalPosts}`);
  lines.push(`- 总互动数: ${totalInteractions.toLocaleString()}`);
  lines.push(`- 日均互动: ${avgDailyInteractions.toLocaleString()}`);
  if (totalReads > 0) {
    lines.push(`- 千阅互动率: ${((totalInteractions / totalReads) * 1000).toFixed(1)}`);
  }
  lines.push("");

  // -- Fan trends --
  const fanTrend = d.fanTrend7Days ?? [];
  if (fanTrend.length > 0) {
    const latest = fanTrend[fanTrend.length - 1];
    const newFans = fanTrend.reduce((s: number, r: any) => s + (r.newFansCount ?? 0), 0);
    const newBigFans = fanTrend.reduce((s: number, r: any) => s + (r.newBigFanCount ?? 0), 0);

    lines.push("## 近7天粉丝趋势");
    lines.push("");
    lines.push(`- 总粉丝数: ${latest.fansTotal ?? "N/A"}`);
    lines.push(`- 铁粉总数: ${latest.bigFanTotal ?? "N/A"}`);
    lines.push(`- 7日新增粉丝: ${newFans}`);
    lines.push(`- 7日新增铁粉: ${newBigFans}`);
    lines.push(`- 日均新增粉丝: ${Math.round(newFans / 7)}`);
    lines.push("");
  }

  // -- Fan portrait --
  const portrait = d.bigFanPortrait ?? d.fanPortrait;
  if (portrait) {
    lines.push("## 粉丝画像");
    lines.push("");

    if (portrait.gender) {
      lines.push("### 性别分布");
      for (const [k, v] of Object.entries(portrait.gender)) {
        lines.push(`- ${k}: ${v}%`);
      }
      lines.push("");
    }

    if (portrait.age) {
      lines.push("### 年龄分布");
      for (const [k, v] of Object.entries(portrait.age)) {
        lines.push(`- ${k}: ${v}%`);
      }
      lines.push("");
    }

    if (portrait.tags) {
      lines.push("### 兴趣标签 TOP5");
      for (const [k, v] of Object.entries(portrait.tags)) {
        lines.push(`- ${k}: ${v}%`);
      }
      lines.push("");
    }
  }

  // -- Top posts --
  const topBlogs = d.topBlogs ?? [];
  if (topBlogs.length > 0) {
    // Sort by interaction rate
    const sorted = topBlogs
      .map((p: any) => ({ ...p, _rate: interactionRate(p) }))
      .sort((a: any, b: any) => b._rate - a._rate);

    lines.push(`## 热门博文 TOP${Math.min(topN, sorted.length)} (按千阅互动率)`);
    lines.push("");
    for (const post of sorted.slice(0, topN)) {
      const text = (post.weiboText ?? "").slice(0, 80);
      const interactions = (post.repostTotal ?? 0) + (post.commentTotal ?? 0) + (post.likeTotal ?? 0);
      lines.push(`### ${post.createTimeText ?? "N/A"}`);
      lines.push(`- 内容: ${text}`);
      lines.push(`- 阅读: ${post.readTotal ?? 0} | 互动: ${interactions} | 千阅互动率: ${post._rate.toFixed(1)}`);
      lines.push(`- mid: ${post.mid}`);
      lines.push("");
    }
  }

  // -- V榜 rankings --
  const ranks = d.rankDetails ?? [];
  if (ranks.length > 0) {
    lines.push("## V榜周榜排名");
    lines.push("");
    for (const rank of ranks.slice(0, 4)) {
      lines.push(`- ${rank.period} | ${rank.fieldName} | 排名: ${rank.rank} | 总分: ${rank.totalScore}`);
    }
    lines.push("");
  }

  // -- Incentive plans --
  if (incentiveData) {
    const plans = incentiveData.plans ?? incentiveData.planList ?? [];
    if (Array.isArray(plans) && plans.length > 0) {
      lines.push("## 激励计划");
      lines.push("");
      for (const plan of plans.slice(0, 5)) {
        lines.push(`- ${plan.name ?? plan.planName ?? "N/A"}: ${plan.description ?? plan.desc ?? ""}`);
      }
      lines.push("");
    }
  }

  // -- Strategy recommendations --
  lines.push("## 策略建议");
  lines.push("");

  // Content type recommendation based on top posts
  if (topBlogs.length > 0) {
    const best = topBlogs
      .map((p: any) => ({ ...p, _rate: interactionRate(p) }))
      .sort((a: any, b: any) => b._rate - a._rate)[0];
    lines.push(`- 最高互动率博文: "${(best.weiboText ?? "").slice(0, 50)}..." (千阅互动率 ${best._rate.toFixed(1)})`);
    lines.push(`  → 建议多发类似风格的内容`);
  }

  // Fan interest recommendation
  if (portrait?.tags) {
    const topTag = Object.entries(portrait.tags).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    if (topTag) {
      lines.push(`- 粉丝最感兴趣的话题: ${topTag[0]} (${topTag[1]}%)`);
      lines.push(`  → 建议围绕此话题创作内容`);
    }
  }

  // Growth trend
  if (fanTrend.length >= 2) {
    const recent = fanTrend.slice(-3);
    const older = fanTrend.slice(0, 3);
    const recentAvg = recent.reduce((s: number, r: any) => s + (r.newFansCount ?? 0), 0) / 3;
    const olderAvg = older.reduce((s: number, r: any) => s + (r.newFansCount ?? 0), 0) / 3;
    if (recentAvg > olderAvg * 1.1) {
      lines.push("- 粉丝增长加速中，保持当前内容节奏");
    } else if (recentAvg < olderAvg * 0.9) {
      lines.push("- 粉丝增长放缓，建议尝试新内容方向或蹭热搜");
    } else {
      lines.push("- 粉丝增长稳定，维持当前策略");
    }
  }

  lines.push("");

  // Step 4: Write report
  const report = lines.join("\n");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(reportPath, report, "utf-8");

  console.log(`  Report written to: ${reportPath}`);
  logOperation("analytics", reportPath, "success", `reads:${totalReads},interactions:${totalInteractions}`);

  // Print summary to console
  console.log(`\n  === Summary ===`);
  console.log(`  Total reads (30d): ${totalReads.toLocaleString()}`);
  console.log(`  Total interactions (30d): ${totalInteractions.toLocaleString()}`);
  console.log(`  Avg daily reads: ${avgDailyReads.toLocaleString()}`);
  if (topBlogs.length > 0) {
    const best = topBlogs.map((p: any) => ({ ...p, _rate: interactionRate(p) })).sort((a: any, b: any) => b._rate - a._rate)[0];
    console.log(`  Best post interaction rate: ${best._rate.toFixed(1)} per 1000 reads`);
  }
  console.log("[Weibo Creator Analytics] Done.");
}

main();
