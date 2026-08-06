import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-like.js";
let text = readFileSync(path, "utf-8");
// Add debug logging to browserEval
const old = 'const result = browserExec("agent-browser eval -b " + b64, timeout);';
const newCode = 'const cmd = "agent-browser eval -b " + b64; process.stderr.write("[debug] cmd len: " + cmd.length + "\\n"); const result = browserExec(cmd, timeout); process.stderr.write("[debug] raw result: " + JSON.stringify(result).slice(0,100) + "\\n");';
if (text.includes(old)) {
  text = text.replace(old, newCode);
  writeFileSync(path, text, "utf-8");
  console.log("debug logging added");
} else {
  console.log("pattern not found");
}
