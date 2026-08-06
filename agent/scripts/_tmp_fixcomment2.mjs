import { readFileSync, writeFileSync } from "node:fs";

const path = "E:/program/weiboagent/agent/scripts/browser-comment.js";
let text = readFileSync(path, "utf-8");

// 1. Patch browserExec: add input param
const oldExec = `function browserExec(cmd, timeout = 15000) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}`;
const newExec = `function browserExec(cmd, timeout = 15000, input) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      input: input || undefined,
    }).trim();
  } catch {
    return "";
  }
}`;
if (!text.includes(oldExec)) throw new Error("browserExec pattern not found");
text = text.replace(oldExec, newExec);

// 2. Patch browserEval: use base64 to avoid shell-quote escaping
const oldEval = `function browserEval(jsCode, timeout = 15000) {
  const result = browserExec(\`agent-browser eval "\${jsCode.replace(/"/g, '\\\\"').replace(/\\n/g, " ")}"\`, timeout);
  // \u53bb\u6389\u5916\u5c42\u5f15\u53f7
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, "\\\\");
  }
  return result;
}`;
const newEval = `function browserEval(jsCode, timeout = 30000) {
  // Use base64 encoding to avoid all shell-quote escaping issues.
  const b64 = Buffer.from(jsCode).toString("base64");
  const result = browserExec("agent-browser eval -b " + b64, timeout);
  // Strip outer quotes if present.
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, "\\\\");
  }
  return result;
}`;

// The comment in the original may have mojibake, so match by structure.
const evalStart = text.indexOf("function browserEval(jsCode, timeout = 15000) {");
if (evalStart < 0) throw new Error("browserEval not found");
const evalEnd = text.indexOf("\n}\n", evalStart) + 3;
text = text.slice(0, evalStart) + newEval + text.slice(evalEnd);

writeFileSync(path, text, "utf-8");
console.log("browser-comment.js patched OK (browserExec + browserEval base64)");
