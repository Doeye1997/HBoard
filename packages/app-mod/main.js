import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { checking, exec, readTextFile, run, theme } from "herdr";

const DOC = `
import json, subprocess, sys
name = sys.argv[1]
req = json.dumps({"jsonrpc":"2.0","id":1,"method":"doc.get","params":{"name":name}}) + "\\n"
p = subprocess.run(["hc.exe", "connect"], input=req, text=True, capture_output=True)
line = [x for x in p.stdout.splitlines() if x.strip().startswith("{")]
if not line:
    sys.exit(1)
body = json.loads(line[-1])
value = (body.get("result") or {}).get("value")
print(json.dumps(value))
`;

function boardText(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Board returned no JSON");
  return JSON.parse(raw.slice(start));
}

function rowsFrom(payload) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && node.id.startsWith("msg_") && node.by && typeof node.text === "string") {
      found.push(node);
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(payload);
  const seen = new Set();
  return found.filter((row) => seen.has(row.id) ? false : seen.add(row.id));
}

export default class HBoard extends View {
  init(_props, cx) {
    this.closed = false;
    this.channel = "hboard-p1";
    this.rows = [];
    this.note = "Profiles share this person's Board credential.";
    this.bindings = {};
    if (checking()) return;
    cx.spawn(async (task) => {
      const file = await readTextFile("mods/hboard/channel.json");
      if (file) {
        try { this.channel = JSON.parse(file).channel || this.channel; } catch { /* keep default */ }
      }
      while (!this.closed) {
        await this.load();
        task.notify();
        await task.sleep(5000);
      }
    });
  }

  close() {
    this.closed = true;
  }

  async load() {
    try {
      const read = await exec("vercel.cmd", ["board", "read", this.channel, "--limit", "8", "--json"], { timeout: 20000 });
      if (read.code !== 0) throw new Error(read.stderr || read.stdout || "Board read failed");
      this.rows = rowsFrom(boardText(read.stdout)).slice(-12);
      const profiles = [...new Set(this.rows.map((row) => row.by?.profile).filter(Boolean))];
      for (const profile of profiles) {
        const got = await exec("python", ["-c", DOC, profile], { timeout: 15000 });
        this.bindings[profile] = got.code === 0 ? JSON.parse(got.stdout || "null") : { error: "binding unread" };
      }
      this.note = "Profiles share this person's Board credential.";
    } catch (error) {
      this.note = error instanceof Error ? error.message : "Board read failed";
    }
  }

  focus(profile) {
    const binding = this.bindings[profile];
    if (!binding || binding.error || binding.state !== "active" || !binding.terminal) {
      this.note = profile + " has no confirmed live terminal. Not focusing.";
      return;
    }
    run("agent.focus", { terminal: binding.terminal });
  }

  render() {
    const t = theme();
    return v_flex().size_full().bg(t.surface).text_color(t.foreground).text_size(13).p(12).gap(8)
      .child(div().font_semibold().text_size(16).child("HBoard"))
      .child(div().text_color(t.muted).child(this.channel + " · " + this.note))
      .child(v_flex().flex_1().gap(6).children(this.rows.length ? this.rows.map((row) => this.line(row, t)) : [
        div().text_color(t.muted).child("No Board messages loaded."),
      ]));
  }

  line(row, t) {
    const profile = row.by?.profile || "person";
    const binding = profile === "person" ? null : this.bindings[profile];
    const where = binding?.terminal ? binding.state + " " + binding.terminal : profile === "person" ? "person" : "no live binding";
    return v_flex().id("hb-" + row.id).gap(2).p(8).rounded(8).bg(t.raised).cursor_pointer()
      .on_click(() => { if (profile !== "person") this.focus(profile); })
      .child(h_flex().gap(8).child(div().font_semibold().child(profile)).child(div().text_color(t.muted).child(where)))
      .child(div().text_color(t.muted).child(row.text.length > 180 ? row.text.slice(0, 180) + "…" : row.text));
  }
}
