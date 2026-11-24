const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveVercel, entryFromManifest } = require("./mods/hboard/resolve-vercel.cjs");

function fixture(t, pkg = { name: "vercel", bin: { vercel: "dist/index.js" } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hboard CLI "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shim = path.join(root, "vercel.cmd");
  const dir = path.join(root, "node_modules", "vercel");
  const entry = path.join(dir, "dist", "index.js");
  const manifest = path.join(dir, "package.json");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(shim, "must not execute this shim");
  fs.writeFileSync(entry, "// official CLI fixture");
  fs.writeFileSync(manifest, JSON.stringify(pkg));
  return { root, shim, manifest, entry: fs.realpathSync(entry) };
}

test("Windows shim locates the installed package without executing a batch file", t => {
  const f = fixture(t);
  assert.deepEqual(resolveVercel({ findShim: () => f.shim + "\r\n" }), {
    command: "node.exe", prefix: [f.entry],
  });
});

test("nonstandard install can select an explicit official manifest", t => {
  const f = fixture(t, { name: "vercel", bin: "dist/index.js" });
  assert.deepEqual(resolveVercel({ manifest: f.manifest, findShim: () => { throw Error("must not search"); } }), {
    command: "node.exe", prefix: [f.entry],
  });
});

test("reject a wrong package and unsupported first shim instead of falling back silently", t => {
  const f = fixture(t, { name: "not-vercel", bin: "dist/index.js" });
  assert.throws(() => entryFromManifest(f.manifest), /official/);
  assert.throws(() => resolveVercel({ findShim: () => "relative/vercel.cmd\r\n" + f.shim }), /locate/);
});

test("reject a bin entry escaping the installed package", t => {
  const f = fixture(t, { name: "vercel", bin: "../../outside.js" });
  fs.writeFileSync(path.join(f.root, "outside.js"), "// not a CLI entry");
  assert.throws(() => entryFromManifest(f.manifest), /Invalid Vercel CLI entry/);
});
