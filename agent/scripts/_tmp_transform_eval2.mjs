import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// browserEval: use base64 encoding to avoid all shell-quote escaping.
const newFn = `function browserEval(jsCode, timeout = 30000) {
  // Use base64 encoding to avoid all shell-quote escaping issues.
  const b64 = Buffer.from(jsCode).toString("base64");
  const result = browserExec("agent-browser eval -b " + b64, timeout);
  // Strip outer quotes if present.
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, "\\\\");
  }
  return result;
}`;

for (const f of ["browser-like.js", "browser-comment.js"]) {
  const path = "E:/program/weiboagent/agent/scripts/" + f;
  let text = readFileSync(path, "utf-8");
  const start = text.indexOf("function browserEval(jsCode, timeout = 30000) {");
  if (start < 0) throw new Error("browserEval not found in " + f);
  const end = text.indexOf("\n}\n", start) + 3;
  text = text.slice(0, start) + newFn + text.slice(end);
  writeFileSync(path, text, "utf-8");
  console.log(f + " browserEval patched (base64)");
}
