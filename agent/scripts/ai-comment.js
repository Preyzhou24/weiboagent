#!/usr/bin/env node

/**
 * ai-comment.js — AI 动态评论生成器
 *
 * 调用 OpenAI 兼容端点（.env 配置），根据原微博正文 + 人设风格，
 * 生成 10-30 字个性化短评，规避机器话术和同质化内容。
 * 内置敏感词安全校验，违规内容降级为通用安全评论。
 *
 * 用法:
 *   node scripts/ai-comment.js generate --content="原微博正文" [--user="博主名"]
 *
 * 返回:
 *   { code: 0, comment: "AI 生成的评论", source: "ai" | "fallback" }
 *   失败: { code: -1, message: "..." }
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 加载 .env ────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const text = readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

const ENV = loadEnv();
const LLM_API_KEY = ENV.LLM_API_KEY ?? "";
const LLM_MODEL = ENV.LLM_MODEL ?? "gpt-4o-mini";
const LLM_BASE_URL = (ENV.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

// ── 加载人设评论风格 ─────────────────────────────────────────────────────────

function loadPersonaStyle() {
  const personaPath = resolve(ROOT, "persona", "persona.md");
  const stylePath = resolve(ROOT, "persona", "comment-style.md");
  let persona = "";
  let style = "";
  if (existsSync(personaPath)) persona = readFileSync(personaPath, "utf-8");
  if (existsSync(stylePath)) style = readFileSync(stylePath, "utf-8");
  return { persona, style };
}

// ── 敏感词安全校验 ─────────────────────────────────────────────────────────

const SENSITIVE_WORDS = [
  "反腐", "上访", "维权", "游行", "示威",
  "六四", "天安门", "法轮", "藏独", "疆独", "台独", "港独", "维稳",
  "习近平", "毛泽东", "邓小平", "江泽民", "胡锦涛",
  "暴力", "恐怖袭击", "炸弹", "枪击",
  "色情", "裸体", "卖淫", "赌博", "吸毒",
  "傻逼", "操你", "日你", "废物", "垃圾",
];

function isSafe(text) {
  const lower = text.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word.toLowerCase())) return false;
  }
  return true;
}

const SAFE_FALLBACKS = [
  "这个观点很有启发！",
  "收藏了，有价值的内容。",
  "同意，这个方向值得关注。",
  "好文，学习了。",
  "这个角度很新颖，感谢分享。",
  "同感，这个思路确实值得探讨。",
];

function safeFallback() {
  return SAFE_FALLBACKS[Math.floor(Math.random() * SAFE_FALLBACKS.length)];
}

// ── LLM 调用 ────────────────────────────────────────────────────────────────

async function callLLM(prompt) {
  const url = `${LLM_BASE_URL}/chat/completions`;
  const body = JSON.stringify({
    model: LLM_MODEL,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    max_tokens: 60,
    temperature: 0.8,
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── 生成评论 ─────────────────────────────────────────────────────────────────

async function generateComment(weiboContent, userName) {
  const { persona, style } = loadPersonaStyle();

  const systemPrompt = [
    "你是一个微博用户「小洛」，AI 科技观察者，专业友善幽默。",
    "任务：根据别人的微博正文，生成一条 10-30 字的自然评论。",
    "要求：",
    "- 像真人说话，口语化，不用书面语",
    "- 不要用「这个思路很有启发」「收藏了」等模板话术",
    "- 针对正文内容发表具体观点或感受",
    "- 只输出评论内容本身，不加引号、不加前缀",
    "- 不涉及政治、敏感话题、人身攻击",
    "- 如果正文是广告或无意义内容，回复一个轻松的吐槽",
  ].join("\n");

  const userPrompt = `博主：${userName || "未知"}\n微博正文：${weiboContent.slice(0, 500)}\n\n请生成一条评论：`;

  const raw = await callLLM({ system: systemPrompt, user: userPrompt });
  // 清理：去引号、去换行、限长
  let comment = raw
    .replace(/^["'"'"]|["'"'"]$/g, "")
    .replace(/\n+/g, " ")
    .trim();
  if (comment.length > 50) comment = comment.slice(0, 50);

  // 安全校验
  if (!isSafe(comment)) {
    process.stderr.write(`[ai-comment] AI 生成内容未通过安全校验，降级为通用评论: "${comment}"\n`);
    return { comment: safeFallback(), source: "fallback" };
  }

  if (comment.length < 5) {
    return { comment: safeFallback(), source: "fallback" };
  }

  return { comment, source: "ai" };
}

// ── 参数解析 + 入口 ─────────────────────────────────────────────────────────

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

const args = parseArgs(process.argv);
const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

if (command === "generate" || !command) {
  const content = args.content ?? "";
  const user = args.user ?? "";
  if (!content) {
    console.log(JSON.stringify({ code: -1, message: "需要指定 --content 参数（原微博正文）" }));
    process.exit(1);
  }
  if (!LLM_API_KEY) {
    console.log(JSON.stringify({ code: 0, comment: safeFallback(), source: "fallback" }));
    process.exit(0);
  }
  try {
    const result = await generateComment(content, user);
    console.log(JSON.stringify({ code: 0, ...result }));
  } catch (err) {
    process.stderr.write(`[ai-comment] LLM 调用失败: ${err.message}\n`);
    console.log(JSON.stringify({ code: 0, comment: safeFallback(), source: "fallback" }));
  }
} else if (command === "help" || command === "--help") {
  console.log(`
ai-comment.js — AI 动态评论生成器

用法:
  node scripts/ai-comment.js generate --content="原微博正文" [--user="博主名"]

读取 .env 中的 LLM_API_KEY / LLM_MODEL / LLM_BASE_URL，
生成 10-30 字个性化评论，带敏感词安全校验。
LLM 不可用时自动降级为通用安全评论。
`);
} else {
  console.error(`未知命令: ${command}`);
  process.exit(1);
}
