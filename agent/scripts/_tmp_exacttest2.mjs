import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const text = readFileSync("scripts/browser-like.js", "utf-8");
const numericMid = "5328860125073555";
const start = text.indexOf('const likeJs = [');
const end = text.indexOf('].join(" ");', start) + '].join(" ");'.length;
const likeJsLine = text.slice(start, end);
const likeJs = eval(likeJsLine.replace('const likeJs = ', '').replace(';', ''));
const b64 = Buffer.from(likeJs).toString("base64");
const cmd = "agent-browser eval -b " + b64;
console.log("cmd length:", cmd.length);
try {
  const out = execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
  console.log("OUTPUT:", out.trim().slice(0, 300));
} catch (e) {
  console.log("ERROR:", e.message.slice(0, 300));
  if (e.stdout) console.log("STDOUT:", e.stdout.toString().slice(0, 300));
  if (e.stderr) console.log("STDERR:", e.stderr.toString().slice(0, 300));
}
