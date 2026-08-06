const testJs = "(async () => { const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/); return JSON.stringify({ hasXsrf: !!xsrfMatch, url: location.href }); })()";
const b64 = Buffer.from(testJs).toString("base64");
console.log("b64 length:", b64.length);
console.log("b64:", b64.slice(0, 60) + "...");
const { execSync } = require("node:child_process");
const cmd = "agent-browser eval -b " + b64;
console.log("cmd length:", cmd.length);
try {
  const out = execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
  console.log("RAW OUTPUT:", JSON.stringify(out));
  console.log("trimmed:", JSON.stringify(out.trim()));
} catch (e) {
  console.log("ERROR:", e.message);
  if (e.stderr) console.log("STDERR:", e.stderr.toString().slice(0, 300));
  if (e.stdout) console.log("STDOUT:", e.stdout.toString().slice(0, 300));
}
