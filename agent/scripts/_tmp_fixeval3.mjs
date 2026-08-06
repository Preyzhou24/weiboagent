import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-comment.js";
let text = readFileSync(path, "utf-8");
// The line is broken. Replace the whole browserEval function cleanly.
const start = text.indexOf("function browserEval(jsCode, timeout = 30000) {");
const end = text.indexOf("return result;\n}", start) + "return result;\n}".length;
const newFn = [
  "function browserEval(jsCode, timeout = 30000) {",
  "  // Use base64 encoding to avoid all shell-quote escaping issues.",
  "  const b64 = Buffer.from(jsCode).toString(\"base64\");",
  "  const result = browserExec(\"agent-browser eval -b \" + b64, timeout);",
  "  // Strip outer quotes if present.",
  "  if (result.startsWith('\"') && result.endsWith('\"')) {",
  "    return result.slice(1, -1).replace(/\\\\\"/g, '\"').replace(/\\\\\\\\/g, '\\\\');",
  "  }",
  "  return result;",
  "}",
].join("\n");
text = text.slice(0, start) + newFn + text.slice(end);
writeFileSync(path, text, "utf-8");
console.log("browserEval fixed in browser-comment.js");
