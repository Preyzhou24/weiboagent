// Simulate the file's browserEval quote-stripping logic
const realOutput = "{\"code\":0,\"message\":\"success\",\"channel\":\"browser\",\"data\":{\"liked\":true,\"attitude\":\"heart\",\"attitude_id\":\"5328965495686663\"}}";
// This is what agent-browser eval -b returns (with surrounding quotes)
const result = '"' + realOutput.replace(/"/g, '\\"') + '"';
console.log("result:", result);
console.log("startsWith quote:", result.startsWith('"'));
console.log("endsWith quote:", result.endsWith('"'));
let stripped = result.slice(1, -1);
console.log("after slice:", stripped);
let final = stripped.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
console.log("after replace:", final);
try {
  const parsed = JSON.parse(final);
  console.log("PARSED OK:", JSON.stringify(parsed));
} catch (e) {
  console.log("PARSE FAILED:", e.message);
}
