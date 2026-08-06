import { readFileSync, writeFileSync } from "node:fs";
const path = "scripts/browser-like.js";
let text = readFileSync(path, "utf-8");
// Remove debug logging
const debugCode = 'const cmd = "agent-browser eval -b " + b64; process.stderr.write("[debug] cmd len: " + cmd.length + "\\n"); const result = browserExec(cmd, timeout); process.stderr.write("[debug] raw result: " + JSON.stringify(result).slice(0,100) + "\\n");';
const origCode = 'const result = browserExec("agent-browser eval -b " + b64, timeout);';
if (text.includes(debugCode)) {
  text = text.replace(debugCode, origCode);
  writeFileSync(path, text, "utf-8");
  console.log("Debug logging removed");
} else {
  console.log("Debug code not found");
}
