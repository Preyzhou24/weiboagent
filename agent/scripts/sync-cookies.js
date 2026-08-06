#!/usr/bin/env node

/**
 * sync-cookies.js - 从已登录的 Chrome CDP 实例提取微博 cookie 并同步到 aione
 *
 * 前提: 已通过 bun run setup-chrome --target weibo 启动隔离 Chrome 并登录微博。
 * 本脚本通过 CDP HTTP + WebSocket 提取 weibo.com 的全部 cookie（含 HttpOnly），
 * 自动调用 aione auth weibo set-cookie 同步。
 *
 * 用法:
 *   node scripts/sync-cookies.js sync           # 同步到 web profile
 *   node scripts/sync-cookies.js sync --profile mobile  # 同步到 mobile profile
 *   node scripts/sync-cookies.js sync --all     # 同步到 web + mobile
 *   node scripts/sync-cookies.js show           # 只查看 cookie，不同步
 */

import http from "node:http";
import { execSync } from "node:child_process";
import WebSocket from "ws";

const CDP_PORT = 9229;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 0) args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      else args[arg.slice(2)] = true;
    }
  }
  return args;
}

function cdpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: CDP_PORT, path, timeout: 5000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error("CDP 响应解析失败: " + data.slice(0, 200))); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("CDP 连接超时")); });
  });
}

function getCookiesViaWS(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket 超时")); }, 10000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies", params: {} }));
    });
    ws.on("message", (data) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(data.toString());
        ws.close();
        if (msg.id === 1 && msg.result) resolve(msg.result.cookies || []);
        else if (msg.error) reject(new Error("CDP 命令错误: " + msg.error.message));
        else reject(new Error("CDP 返回异常"));
      } catch (e) { reject(e); }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

async function getWeiboCookies() {
  const targets = await cdpGet("/json/list");
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("CDP 未找到任何页面 target，请确认 Chrome 已启动");
  }
  const weiboTarget = targets.find(t => t.url && t.url.includes("weibo.com"))
    || targets.find(t => t.type === "page")
    || targets[0];
  if (!weiboTarget.webSocketDebuggerUrl) {
    throw new Error("CDP target 缺少 webSocketDebuggerUrl");
  }
  const cookies = await getCookiesViaWS(weiboTarget.webSocketDebuggerUrl);
  return cookies.filter(c => {
    const d = c.domain || "";
    return d.includes("weibo.com") || d.includes("weibo.cn");
  });
}

function cookiesToString(cookies) {
  return cookies.map(c => c.name + "=" + c.value).join("; ");
}

function syncToAione(cookieString, profile) {
  try {
    execSync(
      "aione auth weibo set-cookie --profile " + profile + " --cookie " + JSON.stringify(cookieString),
      { encoding: "utf-8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log(JSON.stringify({
      code: 0,
      message: "cookie 已同步到 aione (" + profile + " profile)",
      profile,
      cookie_count: cookieString.split(";").length,
    }));
  } catch (err) {
    console.log(JSON.stringify({
      code: -1,
      message: "aione 同步失败: " + err.message,
      profile,
    }));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";

  if (command === "help" || command === "--help" || command === "") {
    console.log("\nsync-cookies.js - 从 Chrome CDP 提取微博 cookie 并同步到 aione\n\n用法:\n  node scripts/sync-cookies.js sync           # 同步到 web profile\n  node scripts/sync-cookies.js sync --profile mobile  # 同步到 mobile profile\n  node scripts/sync-cookies.js sync --all     # 同步到 web + mobile\n  node scripts/sync-cookies.js show           # 只查看 cookie，不同步\n\n前提: 已通过 bun run setup-chrome --target weibo 启动 Chrome 并登录微博。\n");
    return;
  }

  if (command !== "sync" && command !== "show") {
    console.error("未知命令: " + command);
    process.exit(1);
  }

  process.stderr.write("[sync] 从 Chrome CDP (端口 " + CDP_PORT + ") 提取 cookie...\n");

  let weiboCookies;
  try {
    weiboCookies = await getWeiboCookies();
  } catch (err) {
    console.log(JSON.stringify({
      code: -1,
      message: "提取 cookie 失败: " + err.message,
      hint: "请确认已运行 bun run setup-chrome --target weibo 并登录微博",
    }));
    process.exit(1);
  }

  if (weiboCookies.length === 0) {
    console.log(JSON.stringify({ code: -1, message: "未找到微博 cookie，请确认 Chrome 已登录 weibo.com" }));
    process.exit(1);
  }

  const cookieString = cookiesToString(weiboCookies);
  process.stderr.write("[sync] 提取到 " + weiboCookies.length + " 条微博 cookie\n");

  if (command === "show") {
    console.log(JSON.stringify({
      code: 0,
      cookie_count: weiboCookies.length,
      cookie_names: weiboCookies.map(c => c.name),
      cookie_preview: cookieString.slice(0, 100) + "...",
    }, null, 2));
    return;
  }

  const profiles = args.all ? ["web", "mobile"] : [args.profile || "web"];
  for (const profile of profiles) {
    syncToAione(cookieString, profile);
  }
}

main().catch(err => {
  console.log(JSON.stringify({ code: -1, message: "未预期错误: " + err.message }));
  process.exit(1);
});
