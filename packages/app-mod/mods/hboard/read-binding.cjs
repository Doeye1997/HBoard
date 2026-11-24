// A short-lived, read-only stdin adapter for Core's API-only doc.get.
// The native Mod exec API does not expose stdin; this is not a background service.
const { spawn } = require("node:child_process");
const profile = process.argv[2];
if (process.argv.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(profile ?? "")) {
  process.stderr.write("Invalid Board profile\n"); process.exit(1);
}
const child = spawn(process.platform === "win32" ? "hc.exe" : "hc", ["connect"], {
  stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
});
let out = "";
let failed = false;
const timeout = setTimeout(() => { failed = true; child.kill(); }, 12000);
function fail() { failed = true; process.exitCode = 1; }
child.on("error", fail);
child.stdin.on("error", fail);
child.stdout.setEncoding("utf8");
child.stdout.on("data", text => {
  out += text;
  if (out.length > 1100000) { fail(); child.kill(); }
});
child.on("close", code => {
  clearTimeout(timeout);
  if (failed || code !== 0) { fail(); return; }
  try {
    const response = out.trim().split(/\r?\n/).map(line => JSON.parse(line)).find(r => r.id === 1);
    if (!response?.result || response.error || !Number.isInteger(response.result.version)) throw Error("Invalid Core response");
    process.stdout.write(JSON.stringify(response.result) + "\n");
  } catch { fail(); }
});
child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "doc.get", params: { name: profile } }) + "\n");
