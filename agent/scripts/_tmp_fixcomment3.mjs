import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/browser-comment.js";
let text = readFileSync(path, "utf-8");

// 1. browserExec: add input param. Match exactly including the closing brace.
const execStart = text.indexOf("function browserExec(cmd, timeout = 15000) {");
if (execStart < 0) throw new Error("browserExec not found");
// find the matching closing brace: count braces
let depth = 0;
let i = execStart;
for (; i < text.length; i++) {
  if (text[i] === "{") depth++;
  if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
}
const execEnd = i;
const newExec = [
  "function browserExec(cmd, timeout = 15000, input) {",
  "  try {",
  "    return execSync(cmd, {",
  '      encoding: "utf-8",',
  "      timeout,",
  '      stdio: ["pipe", "pipe", "pipe"],',
  "      input: input || undefined,",
  "    }).trim();",
  "  } catch {",
  '    return "";',
  "  }",
  "}",
].join("\n");
text = text.slice(0, execStart) + newExec + text.slice(execEnd);

// 2. browserEval: replace with base64 version. Find by start marker.
const evalStart = text.indexOf("function browserEval(jsCode, timeout = 15000) {");
if (evalStart < 0) throw new Error("browserEval not found");
depth = 0;
i = evalStart;
for (; i < text.length; i++) {
  if (text[i] === "{") depth++;
  if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
}
const evalEnd = i;
const newEval = [
  "function browserEval(jsCode, timeout = 30000) {",
  "  // Use base64 to avoid all shell-quote escaping issues.",
  '  const b64 = Buffer.from(jsCode).toString("base64");',
  '  const result = browserExec("agent-browser eval -b " + b64, timeout);',
  "  // Strip outer quotes if present.",
  "  if (result.startsWith('\"') && result.endsWith('\"')) {",
  "    return result.slice(1, -1).replace(/\\\\\"/g, '\"').replace(/\\\\\\\\/g, '\\\\');",
  "  }",
  "  return result;",
  "}",
].join("\n");
text = text.slice(0, evalStart) + newEval + text.slice(evalEnd);

writeFileSync(path, text, "utf-8");
console.log("browser-comment.js patched OK (both functions, brace-matched)");
