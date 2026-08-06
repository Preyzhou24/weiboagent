import { readFileSync, writeFileSync } from "node:fs";

function patchBrowserExec(text) {
  // browserExec is defined once near the top; add input param + input option.
  const start = text.indexOf("function browserExec(cmd, timeout = 15000) {");
  if (start < 0) throw new Error("browserExec not found");
  const end = text.indexOf("\n}\n", start) + 3;
  const newFn = `function browserExec(cmd, timeout = 15000, input) {
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
  return text.slice(0, start) + newFn + text.slice(end);
}

function patchBrowserEval(text) {
  // browserEval is defined once; switch to --stdin to avoid quote escaping.
  const start = text.indexOf("function browserEval(jsCode, timeout = 15000) {");
  if (start < 0) throw new Error("browserEval not found");
  const end = text.indexOf("\n}\n", start) + 3;
  const newFn = `function browserEval(jsCode, timeout = 30000) {
  // Use --stdin to avoid all shell-quote escaping issues.
  const result = browserExec("agent-browser eval --stdin", timeout, jsCode);
  // Strip outer quotes if present.
  if (result.startsWith('"') && result.endsWith('"')) {
    return result.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\\\");
  }
  return result;
}`;
  return text.slice(0, start) + newFn + text.slice(end);
}

for (const f of ["browser-like.js", "browser-comment.js"]) {
  const path = "E:/program/weiboagent/agent/scripts/" + f;
  let text = readFileSync(path, "utf-8");
  text = patchBrowserExec(text);
  text = patchBrowserEval(text);
  writeFileSync(path, text, "utf-8");
  console.log(f + " patched (browserExec + browserEval stdin)");
}
