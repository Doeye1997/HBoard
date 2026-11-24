// Resolve the official installed Windows Vercel CLI once, without running its
// .cmd wrapper. Subsequent calls use node.exe and a direct argv vector.
const { execFileSync } = require("node:child_process");
const { readFileSync, realpathSync, statSync } = require("node:fs");
const path = require("node:path");

function entryFromManifest(manifest) {
  if (!path.isAbsolute(manifest)) throw Error("Vercel package manifest must be an absolute path");
  const file = realpathSync(manifest);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.vercel;
  if (pkg.name !== "vercel" || typeof bin !== "string" || path.isAbsolute(bin)) {
    throw Error("Expected the installed official vercel package");
  }
  const dir = path.dirname(file);
  const entry = realpathSync(path.resolve(dir, bin));
  const relative = path.relative(dir, entry);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
      !/\.(?:js|cjs|mjs)$/i.test(entry) || !statSync(entry).isFile()) {
    throw Error("Invalid Vercel CLI entry");
  }
  return { command: "node.exe", prefix: [entry] };
}

function resolveVercel({ manifest, findShim = () => execFileSync("where.exe", ["vercel.cmd"], {
  encoding: "utf8", windowsHide: true, timeout: 5000,
}) } = {}) {
  if (manifest) return entryFromManifest(manifest);
  const shim = findShim().split(/\r?\n/).map(s => s.trim()).find(Boolean);
  if (!shim || !path.isAbsolute(shim) || path.basename(shim).toLowerCase() !== "vercel.cmd") {
    throw Error("Cannot locate vercel.cmd");
  }
  return entryFromManifest(path.join(path.dirname(shim), "node_modules", "vercel", "package.json"));
}

module.exports = { entryFromManifest, resolveVercel };

if (require.main === module) {
  try {
    if (process.argv.length > 3) throw Error("Invalid resolver arguments");
    process.stdout.write(JSON.stringify(resolveVercel({ manifest: process.argv[2] })) + "\n");
  } catch {
    process.stderr.write("Cannot resolve the official Windows Vercel CLI. Set the layout mod's vercelPackage to its absolute package.json path.\n");
    process.exitCode = 1;
  }
}
