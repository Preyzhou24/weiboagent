import { readFileSync } from "node:fs";
const text = readFileSync("scripts/browser-like.js", "utf-8");
// Reconstruct the exact likeJs the file builds
const numericMid = "5328860125073555";
const start = text.indexOf('const likeJs = [');
const end = text.indexOf('].join(" ");', start) + '].join(" ");'.length;
const likeJsLine = text.slice(start, end);
// Evaluate it to get the actual string
const likeJs = eval(likeJsLine.replace('const likeJs = ', '').replace(';', ''));
const b64 = Buffer.from(likeJs).toString("base64");
const cmd = "agent-browser eval -b " + b64;
console.log("cmd length:", cmd.length);
console.log("b64 length:", b64.length);
const { execSync } = require("node:child_process");
try {
  const out = execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
  console.log("OUTPUT:", out.trim().slice(0, 200));
} catch (e) {
  console.log("ERROR:", e.message.slice(0, 200));
  if (e.stdout) console.log("STDOUT:", e.stdout.toString().slice(0, 200));
  if (e.stderr) console.log("STDERR:", e.stderr.toString().slice(0, 200));
}
