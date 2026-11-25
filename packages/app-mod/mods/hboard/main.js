import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, ScrollHandle, TextView } from "gpui-base";
import { exec, appHome, checking, props, run, theme, terminals, window, layout, pickFolder } from "herdr";
import { canonicalBoard, humanScope, sameHuman, argv, boardInvocation, generalRoute, isGeneral, canComposeRoute, terminalPane, threadRoute, draftKey, workspacePanes, readArgs, inboxMentionArgs, inboxPageArgs, mentionsHuman, inboxCoverage, dedupeThreads, createSend, sendArgs, parseReply, actorProfile, bindingTarget, messageName, threadSummary, readMarker, isUnread, toggleFollow, safeMarkdown, reactionsFor, attachmentRows, messageInThread, reactionArgs, downloadArgs, nativeTask, visibleLabels } from "./board.js";

// Adopt the Herdr native theme and the spacing/typography scale of its panels.
const UI = { rail: 208, detail: 416, pad: 16, gap: 8, row: 32, radius: 10, small: 12, text: 14, heading: 20, composer: 72, avatar: 32 };
const EMPTY = () => ({ seen: {}, followed: [] });
const scopeKey = s => "hboard.attention:" + JSON.stringify([s.board, s.actor]);
const errorText = e => String(e?.message ?? e).slice(0, 500);
const time = m => m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
const array = (value, field) => { if (!Array.isArray(value)) throw Error("Invalid Board " + field); return value; };
const label = (text, t) => div().text_size(UI.small).text_color(t.dim).child(text);

function button(id, text, t, action, enabled = true, primary = false) {
  return h_flex().id(id).h(UI.row).px(UI.gap).rounded(UI.radius).items_center().flex_none()
    .text_size(UI.text).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.muted)
    .when(primary, e => e.bg(enabled ? t.solid : t.raised))
    .when(enabled, e => e.cursor_pointer().hover(s => primary ? s.opacity(0.85) : s.bg(t.hover)).on_click(action)).child(text);
}

async function resolveBoardCli() {
  if (window().platform !== "windows") return { command: "vercel", prefix: [] };
  const manifest = props()?.vercelPackage;
  const result = await exec("node.exe", [appHome() + "/mods/hboard/resolve-vercel.cjs",
    ...(manifest ? [manifest] : [])], { timeout: 10000 });
  if (result.code !== 0) throw Error("Cannot resolve the Windows Vercel CLI. Set the layout mod's vercelPackage to the official package.json path.");
  const transport = JSON.parse(result.stdout);
  if (transport?.command !== "node.exe" || !Array.isArray(transport.prefix) ||
      transport.prefix.length !== 1 || typeof transport.prefix[0] !== "string" || !transport.prefix[0]) {
    throw Error("Invalid Windows CLI resolution");
  }
  return transport;
}

export default class HBoard extends View {
  init(_props, cx) {
    this.scope = null;
    this.transport = null;
    this.channels = [];
    this.actors = [];
    this.nextChannel = null;
    this.route = generalRoute();
    this.inboxNote = "";
    this.data = null;
    this.seq = 0;
    this.detailSeq = 0;
    this.focusSeq = 0;
    this.detail = null;
    this.detailData = null;
    this.detailLoading = false;
    this.detailReadError = "";
    this.viewportWidth = 0;
    this.menuOpen = false;
    this.feedScroll = ScrollHandle.new();
    this.threadScroll = ScrollHandle.new();
    this.prefs = EMPTY();
    this.drafts = new Map();
    this.endpoint = InputState.new({ value: props()?.url ?? localStorage.getItem("hboard.endpoint") ?? "", placeholder: "Optional Board URL (use CLI login by default)" });
    this.draft = TextareaState.new({ placeholder: "Write a Board message…", rows: 3 });
    this.draft.on("change", (_event, cx) => cx.notify());
    if (!checking()) cx.timer.every(15000, cx => {
      if (this.scope && !this.loading && !this.sending && !this.route.before && this.route.kind !== "following") this.refresh(cx);
      if (this.scope && this.detail && !this.detailLoading && !this.sending && !this.terminalVisible()) this.refreshDetail(cx);
    });
  }

  async execBoard(args, options = {}) {
    if (!this.transport) throw Error("Board CLI is not connected");
    const { command, args: actual } = boardInvocation(this.transport, args);
    return exec(command, actual, { timeout: 30000, ...options });
  }

  async cli(command, board, options = {}, execOptions = {}) {
    return parseReply(await this.execBoard(argv(command, { board, ...options }), execOptions), command);
  }

  async directory(scope) {
    const [channels, actors] = await Promise.all([
      this.cli("channels", scope.board, { flags: ["--limit", "100"], args: ["list"] }),
      this.cli("actors", scope.board),
    ]);
    return { channels: array(channels.channels, "channels"), next: channels.next ?? null, actors: array(actors.actors, "actors") };
  }

  connect(cx) {
    if (checking() || this.connecting || this.pending || this.sending) return;
    const seq = ++this.seq;
    this.clearDetail();
    this.focusSeq++;
    this.focusing = null;
    this.menuOpen = false;
    this.scope = null;
    this.transport = null;
    this.inboxNote = "";
    this.data = null;
    this.connecting = true;
    this.loading = false;
    this.actionError = "";
    this.readError = "";
    this.sent = "";
    this.drafts.clear();
    this.draft.set_value("");
    const entered = this.endpoint.value().trim();
    cx.notify();
    cx.spawn(async cx => {
      try {
        this.transport = await resolveBoardCli();
        const scope = humanScope(await this.cli("whoami", entered ? canonicalBoard(entered) : undefined));
        const pinned = humanScope(await this.cli("whoami", scope.board));
        if (!sameHuman(scope, pinned)) throw Error("Board identity changed while connecting");
        const directory = await this.directory(scope);
        if (seq !== this.seq) return;
        this.scope = scope;
        this.channels = directory.channels;
        this.nextChannel = directory.next;
        this.actors = directory.actors;
        this.endpoint.set_value(scope.board);
        localStorage.setItem("hboard.endpoint", scope.board);
        this.prefs = EMPTY();
        try {
          const saved = JSON.parse(localStorage.getItem(scopeKey(scope)) ?? "null");
          if (saved && saved.seen && typeof saved.seen === "object" && Array.isArray(saved.followed)) this.prefs = saved;
        } catch { /* invalid local preferences do not affect Board */ }
        this.route = generalRoute();
        this.connecting = false;
        this.bound = null;
        this.refresh(cx);
      } catch (error) {
        if (seq === this.seq) { this.connecting = false; this.actionError = errorText(error); }
      }
      cx.notify();
    });
  }

  savePrefs() { if (this.scope) localStorage.setItem(scopeKey(this.scope), JSON.stringify(this.prefs)); }

  composeRoute() { return this.detail ?? this.route; }

  saveDraft() {
    const key = draftKey(this.composeRoute());
    if (key !== null) this.drafts.set(key, this.draft.value());
  }

  restoreDraft() {
    this.draft.set_value(this.drafts.get(draftKey(this.composeRoute())) ?? "");
  }

  clearDetail() {
    this.detailSeq++;
    this.detail = null;
    this.detailData = null;
    this.detailLoading = false;
    this.detailReadError = "";
  }

  terminalVisible() {
    const node = terminalPane(layout());
    return !!node && !node.hidden;
  }

  hideTerminal(cx, refresh = true) {
    this.focusSeq++;
    this.focusing = null;
    if (this.terminalVisible()) run("layout.hide", { id: "hboard-terminal" });
    if (refresh && this.detail) this.refreshDetail(cx);
    cx.notify();
  }

  navigate(route, cx) {
    if (this.pending || this.sending || this.connecting) return;
    this.saveDraft();
    this.clearDetail();
    this.focusSeq++;
    this.focusing = null;
    this.seq++;
    this.route = route;
    this.menuOpen = false;
    this.feedScroll = ScrollHandle.new();
    this.data = null;
    this.loading = false;
    this.readError = "";
    this.actionError = "";
    this.sent = "";
    this.restoreDraft();
    if (route.kind === "following") cx.notify();
    else this.refresh(cx);
  }

  async readInbox(scope) {
    const channels = this.channels.map(channel => channel?.path).filter(path => typeof path === "string" && path && !path.startsWith("-"));
    const more = !!this.nextChannel;
    if (!channels.length) return { threads: [], note: inboxCoverage("scan", 0, more) };
    const mention = await Promise.all(channels.map(async channel => {
      try { return { ok: true, data: await this.cli("read", scope.board, inboxMentionArgs(channel)) }; }
      catch (error) { return { ok: false, error }; }
    }));
    const unsupported = mention.every(item => !item.ok && /not_supported/.test(String(item.error?.message ?? "")));
    if (unsupported) {
      const pages = await Promise.all(channels.map(channel => this.cli("read", scope.board, inboxPageArgs(channel))));
      const threads = dedupeThreads(pages.flatMap(page => array(page.threads, "threads").filter(thread => mentionsHuman(thread?.message?.text, scope))));
      return { threads, note: inboxCoverage("scan", channels.length, more) };
    }
    const failed = mention.find(item => !item.ok);
    if (failed) throw failed.error;
    return {
      threads: dedupeThreads(mention.flatMap(item => array(item.data.threads, "threads"))),
      note: inboxCoverage("query", channels.length, more),
    };
  }


  refresh(cx) {
    if (checking() || !this.scope || this.loading || this.sending || this.route.kind === "following") return;
    const scope = this.scope, route = this.route, seq = ++this.seq;
    this.loading = true;
    this.readError = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const data = route.kind === "inbox" ? await this.readInbox(scope) : await this.cli("read", scope.board, readArgs(route));
        if (seq !== this.seq || !sameHuman(scope, this.scope)) return;
        if (route.kind === "inbox") {
          this.inboxNote = data.note;
          this.data = { threads: data.threads };
        } else array(data.threads, "threads");
        if (route.kind !== "inbox") this.data = data;
      } catch (error) {
        if (seq === this.seq) this.readError = errorText(error);
      } finally {
        if (seq === this.seq) { this.loading = false; cx.notify(); }
      }
    });
  }

  refreshDetail(cx, mark = false) {
    if (checking() || !this.scope || !this.detail || this.detailLoading || this.sending) return;
    const scope = this.scope, route = this.detail, seq = ++this.detailSeq;
    this.detailLoading = true;
    this.detailReadError = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const data = await this.cli("read", scope.board, readArgs(route));
        if (seq !== this.detailSeq || !sameHuman(scope, this.scope)) return;
        if (data.message?.id !== route.id || data.message.channel !== route.channel) {
          throw Error("Board returned a different thread root or channel");
        }
        array(data.replies, "replies");
        this.detailData = data;
        if (mark) { this.prefs = readMarker(this.prefs, threadSummary(data)); this.savePrefs(); }
      } catch (error) {
        if (seq === this.detailSeq) this.detailReadError = errorText(error);
      } finally {
        if (seq === this.detailSeq) { this.detailLoading = false; cx.notify(); }
      }
    });
  }

  syncDirectory(cx) {
    if (!this.scope || this.loadingChannels || this.connecting) return;
    const scope = this.scope;
    this.loadingChannels = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const pinned = humanScope(await this.cli("whoami", scope.board));
        if (!sameHuman(scope, pinned)) throw Error("Board identity changed; reopen the layout to reconnect");
        const directory = await this.directory(scope);
        if (!sameHuman(scope, this.scope)) return;
        this.channels = directory.channels;
        this.nextChannel = directory.next;
        this.actors = directory.actors;
        this.actionError = "";
      } catch (error) { this.actionError = errorText(error); }
      finally { this.loadingChannels = false; cx.notify(); }
    });
  }

  moreChannels(cx) {
    if (!this.scope || !this.nextChannel || this.loadingChannels || this.connecting) return;
    const scope = this.scope, next = this.nextChannel;
    this.loadingChannels = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const page = await this.cli("channels", scope.board, { flags: ["--limit", "100", "--after", next], args: ["list"] });
        if (!sameHuman(scope, this.scope) || this.nextChannel !== next) return;
        this.channels = [...new Map([...this.channels, ...array(page.channels, "channels")].map(c => [c.path, c])).values()];
        this.nextChannel = page.next ?? null;
      } catch (error) { this.actionError = errorText(error); }
      finally { this.loadingChannels = false; cx.notify(); }
    });
  }

  openThread(message, cx) {
    if (this.pending || this.sending || this.connecting || !this.scope) return;
    let route;
    try { route = threadRoute(message); }
    catch (error) { this.actionError = errorText(error); cx.notify(); return; }
    // Keep the feed, its current page, and its scroll handle untouched.
    this.saveDraft();
    this.clearDetail();
    this.detail = route;
    this.menuOpen = false;
    this.threadScroll = ScrollHandle.new();
    this.actionError = "";
    this.sent = "";
    this.restoreDraft();
    this.hideTerminal(cx, false);
    this.refreshDetail(cx, true);
    cx.notify();
  }

  closeThread(cx) {
    if (this.pending || this.sending) return;
    this.saveDraft();
    this.clearDetail();
    this.actionError = "";
    this.sent = "";
    this.restoreDraft();
    cx.notify();
  }

  mention(actor, cx) {
    if (!this.canCompose() || !actor.handle || this.pending || this.sending) return;
    const old = this.draft.value();
    this.draft.set_value(old + (old && !/\s$/.test(old) ? " " : "") + "@" + actor.handle.replace(/^@/, "") + " ");
    this.draft.focus(); cx.notify();
  }

  openActor(actor, cx) {
    const profile = actorProfile(actor);
    if (checking() || !profile || !this.scope || this.pending || this.sending) return;
    const scope = this.scope, seq = ++this.focusSeq;
    this.actionError = ""; this.focusing = actor.id; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await exec(window().platform === "windows" ? "node.exe" : "node",
          [appHome() + "/mods/hboard/read-binding.cjs", profile], { timeout: 20000 });
        if (seq !== this.focusSeq || !sameHuman(scope, this.scope)) return;
        const doc = parseReply(result, "binding read");
        const target = bindingTarget(doc, actor, scope, terminals());
        if (!target) { this.bound = null; throw Error("No matching active binding and live agent terminal for @" + actor.handle); }
        if (!terminalPane(layout())) throw Error("The HBoard layout has no native terminal pane. Install the HBoard layout.");
        run("layout.show", { id: "hboard-terminal" });
        run("agent.focus", { terminal: target.address });
        this.bound = { ...target, actor: actor.id };
      } catch (error) {
        if (seq === this.focusSeq) this.actionError = errorText(error);
      } finally { if (seq === this.focusSeq) { this.focusing = null; cx.notify(); } }
    });
  }

  canCompose() {
    if (this.detail && this.terminalVisible()) return false;
    return canComposeRoute(this.scope, this.composeRoute(),
      this.detail ? this.detailData : this.data,
      this.detail ? this.detailReadError : this.readError);
  }

  send(cx) {
    if (checking() || this.sending || (!this.pending && !this.canCompose())) return;
    let intent;
    try {
      intent = this.pending ?? createSend(this.scope, this.composeRoute(), this.draft.value(),
        "hboard-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2));
    } catch (error) { this.actionError = errorText(error); cx.notify(); return; }
    const previouslyUnconfirmed = !!this.pending;
    this.pending = intent; this.sending = true; this.actionError = ""; this.sent = ""; cx.notify();
    cx.spawn(async cx => {
      let invoked = false;
      try {
        const human = humanScope(await this.cli("whoami", intent.scope.board));
        if (!sameHuman(human, intent.scope) || !sameHuman(this.scope, intent.scope)) throw Error("Board identity changed; send refused");
        invoked = true;
        const result = parseReply(await this.execBoard(sendArgs(intent)), intent.command);
        const m = result.message;
        if (result.outcome !== "posted" || typeof m?.id !== "string" || m.by?.actor !== intent.scope.actor ||
            (intent.command === "post" ? m.channel !== intent.target : m.re !== intent.target && m.replyTo !== intent.target)) {
          throw Error("No matching canonical Board receipt");
        }
        this.pending = null;
        this.draft.set_value("");
        this.drafts.delete(draftKey(this.composeRoute()));
        this.sent = intent.command === "reply" ? "Reply posted" : "Posted";
      } catch (error) {
        if (!invoked && !previouslyUnconfirmed) this.pending = null;
        this.actionError = (this.pending ? "Send unconfirmed. Check the thread before retrying the same operation. " : "") + errorText(error);
      } finally {
        this.sending = false;
        // Invalidate any read that started before the write completed.
        this.seq++; this.loading = false;
        this.detailSeq++; this.detailLoading = false;
        if (!this.pending && !this.detail && this.route.kind === "channel" && this.route.before) this.navigate({ kind: "channel", channel: this.route.channel }, cx);
        else {
          if (!this.route.before) this.refresh(cx);
          if (this.detail) this.refreshDetail(cx);
        }
        cx.notify();
      }
    });
  }

  detailMessage(id) {
    return this.detail && !this.terminalVisible() && !this.detailReadError
      ? messageInThread(this.detailData, id) : null;
  }

  // One explicit human action, official CLI, and an authoritative reread.
  // No local reaction/task state or retry loop.
  react(cx, id, name) {
    if (checking() || this.pending || this.sending || !this.scope) return;
    const message = this.detailMessage(id);
    if (!message || message.deleted) return;
    const row = reactionsFor(message, this.scope.actor, true).find(r => r.name === name);
    if (!row) return;
    const scope = this.scope, route = this.detail, remove = row.own;
    const args = reactionArgs(scope, message, name, remove);
    this.sending = true;
    this.nativeAction = true;
    this.actionError = "";
    this.sent = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const human = humanScope(await this.cli("whoami", scope.board));
        if (!sameHuman(human, scope) || !sameHuman(scope, this.scope)) throw Error("Board identity changed; reaction refused");
        const result = parseReply(await this.execBoard(args), "react");
        if (result.message?.id !== id || result.outcome !== (remove ? "unreacted" : "reacted")) throw Error("No matching reaction receipt");
        const snapshot = await this.cli("read", scope.board, readArgs(route));
        if (snapshot.message?.id !== route.id || snapshot.message.channel !== route.channel || !Array.isArray(snapshot.replies)) throw Error("Invalid thread readback");
        const changed = messageInThread(snapshot, id);
        if (!changed || changed.deleted || !changed.reactions || typeof changed.reactions !== "object") throw Error("Reaction readback unavailable");
        const observed = reactionsFor(changed, scope.actor).find(r => r.name === name)?.own ?? false;
        if (observed !== !remove) throw Error("Reaction differs from requested state; reread Board");
        this.detailSeq++;
        this.detailLoading = false;
        this.detailData = snapshot;
        this.sent = remove ? "Reaction removed" : "Reaction added";
      } catch (error) {
        this.actionError = "Reaction not confirmed. Check Board before trying again. " + errorText(error);
      } finally {
        this.nativeAction = false;
        this.sending = false;
        this.seq++; this.loading = false;
        this.detailSeq++; this.detailLoading = false;
        if (!this.route.before) this.refresh(cx);
        if (this.detail) this.refreshDetail(cx);
        cx.notify();
      }
    });
  }

  downloadAttachment(cx, messageId, attachmentId) {
    if (checking() || this.pending || this.sending || !this.scope) return;
    const message = this.detailMessage(messageId);
    const attachment = attachmentRows(message).find(a => a.id === attachmentId);
    if (!attachment) return;
    const scope = this.scope, args = downloadArgs(scope, message, attachmentId);
    this.sending = true;
    this.nativeAction = true;
    this.actionError = "";
    this.sent = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const cwd = await pickFolder({ prompt: "Save Board attachment" });
        if (!cwd) return;
        const human = humanScope(await this.cli("whoami", scope.board, {}, { cwd }));
        if (!sameHuman(human, scope) || !sameHuman(scope, this.scope)) throw Error("Board identity changed; download refused");
        const result = parseReply(await this.execBoard(args, { cwd, timeout: 120000 }), "download");
        if (result.outcome !== "downloaded" || result.attachment?.id !== attachmentId) throw Error("No matching download receipt");
        this.sent = "Attachment saved: " + attachment.name;
      } catch (error) {
        this.actionError = "Download not confirmed. Check the selected folder. " + errorText(error);
      } finally {
        this.nativeAction = false;
        this.sending = false;
        cx.notify();
      }
    });
  }

  actorLabel(id) {
    if (!id) return null;
    if (id === this.scope?.actor) return "You";
    return this.actors.find(a => a.id === id)?.handle ?? "Actor not in loaded directory";
  }

  taskInfo(message, t, compact) {
    const task = nativeTask(message);
    if (!task) return null;
    if (task.unavailable) return label("Task details unavailable · read its thread", t);
    const reason = task.blocked ?? task.reason ?? task.result;
    const holder = this.actorLabel(task.holder);
    const assigned = this.actorLabel(task.assigned);
    const owner = this.actorLabel(task.owner);
    return v_flex().gap(4).min_w(0)
      .child(h_flex().items_center().gap(UI.gap)
        .child(div().font_medium().text_color(task.state === "blocked" || task.state === "failed" ? (t.blocked ?? t.foreground) : t.foreground).child("Task · " + task.state))
        .when(!!holder, e => e.child(label("Claimed by " + holder, t)))
        .when(!holder && !!assigned, e => e.child(label("Assigned to " + assigned, t))))
      .when(!!reason, e => e.child(div().min_w(0).text_color(t.muted).child(compact ? reason.slice(0, 200) : reason)))
      .when(!compact && !!owner, e => e.child(label("Owner · " + owner, t)))
      .when(!compact && !!task.until, e => e.child(label("Claim until " + task.until, t)))
      .when(task.needs.length > 0, e => e.child(label(task.needs.length + " prerequisite task(s)", t)));
  }

  artifactInfo(message, t, compact) {
    const rows = attachmentRows(message);
    return v_flex().gap(4).min_w(0)
      .when(compact && rows.length > 0, e => e.child(label(rows.length + " attachment(s)", t)))
      .when(!compact, e => e.children(rows.map(a => h_flex().items_center().gap(UI.gap).min_w(0)
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(t.foreground).child(a.name))
          .child(label(a.type + " · " + a.size + " bytes", t)))
        .child(button("attachment-" + message.id + "-" + a.id, "Save", t, (_e, cx) => this.downloadAttachment(cx, message.id, a.id), !this.pending && !this.sending)))));
  }

  feedbackInfo(message, t, compact) {
    const rows = reactionsFor(message, this.scope?.actor, !compact);
    if (!rows.length) return null;
    if (compact) return label(rows.map(r => r.title + " " + r.count).join("  "), t);
    return h_flex().gap(4).items_center()
      .children(rows.map(r => button("reaction-" + message.id + "-" + r.name,
        r.title + (r.count ? " " + r.count : "") + (r.own ? " · you" : ""), t,
        (_e, cx) => this.react(cx, message.id, r.name), !this.pending && !this.sending)));
  }

  row(id, text, t, on, action, enabled = true) {
    return h_flex().id(id).h(UI.row).px(UI.gap).gap(UI.gap).rounded(UI.radius).items_center().flex_none()
      .when(on, e => e.bg(t.selected)).text_color(on ? t.foreground : t.muted)
      .when(enabled, e => e.cursor_pointer().hover(s => s.bg(t.hover)).on_click(action))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  sidebar(t, compact = false) {
    const enabled = !this.pending && !this.sending && !this.connecting;
    const channel = this.route.channel;
    const unread = this.route.kind === "inbox" && this.data?.threads ? this.data.threads.filter(s => isUnread(this.prefs, s)).length : null;
    return v_flex().h_full().min_h(0).bg(t.chrome).p(UI.pad).rounded(UI.radius).gap(UI.gap)
      .when(compact, e => e.flex_1().min_w(0))
      .when(!compact, e => e.w(UI.rail).flex_none())
      .child(h_flex().items_center().gap(UI.gap)
        .child(div().flex_1().font_semibold().text_size(UI.heading).child("HBoard"))
        .when(compact, e => e.child(button("close-menu", "Close", t, (_e, cx) => { this.menuOpen = false; cx.notify(); }))))
      .child(label(this.scope ? "@" + this.scope.handle : "Connect a Board", t))
      .when(!!this.scope, e => e
        .child(this.row("general", "General", t, isGeneral(this.route), (_e, cx) => this.navigate(generalRoute(), cx), enabled))
        .child(this.row("inbox", unread === null ? "Inbox · mentions" : "Inbox · " + unread + " unread in page", t, this.route.kind === "inbox", (_e, cx) => this.navigate({ kind: "inbox" }, cx), enabled))
        .child(this.row("following", "Following", t, this.route.kind === "following", (_e, cx) => this.navigate({ kind: "following" }, cx), enabled))
        .child(label("CHANNELS", t))
        .child(v_flex().id("hboard-channels").flex_1().min_h(0).overflow_y_scrollbar()
          .children(this.channels.filter(c => c.path !== "general").map(c => this.row("channel-" + c.path, "# " + c.path, t, channel === c.path, (_e, cx) => this.navigate({ kind: "channel", channel: c.path }, cx), enabled)))
          .when(!!this.nextChannel, e => e.child(button("more-channels", "More channels", t, (_e, cx) => this.moreChannels(cx), !this.loadingChannels))))
        .child(label("MEMBERS · @ mention / open", t))
        .child(v_flex().id("hboard-members").flex_1().min_h(0).overflow_y_scrollbar().gap(3)
          .children(this.actors.map(actor => h_flex().id("member-" + actor.id).items_center().gap(4).h(UI.row).flex_none()
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(actor.handle ?? actor.id))
            .child(button("mention-" + actor.id, "@", t, (_e, cx) => this.mention(actor, cx), this.canCompose() && enabled))
            .when(!!actorProfile(actor), e => e.child(button("open-" + actor.id, this.focusing === actor.id ? "…" : "Open", t, (_e, cx) => this.openActor(actor, cx), !this.focusing && !this.pending && !this.sending)))))));
  }

  message(m, t, compact = false) {
    const actor = this.actors.find(a => a.id === m.by?.actor);
    const name = messageName(m, this.actors);
    const text = m.deleted ? "[Deleted message]" : compact ? String(m.text ?? "").slice(0, 240) : String(m.text ?? "");
    const firstNewline = compact && !m.deleted ? text.indexOf("\n") : -1;
    const first = firstNewline > 0 ? text.slice(0, firstNewline) : null;
    const rest = first !== null ? text.slice(firstNewline + 1) : text;
    const own = this.scope?.actor === m.by?.actor;
    return h_flex().gap(UI.gap).min_w(0).flex_none()
      .child(h_flex().w(UI.avatar).h(UI.avatar).flex_none().rounded(8).bg(t.raised).items_center().justify_center()
        .child(div().font_medium().text_color(t.muted).child(Array.from(name.replace(/^@/, ""))[0]?.toUpperCase() ?? "?")))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(h_flex().items_center().gap(UI.gap)
          .child(div().font_medium().text_color(t.foreground).min_w(0).truncate().child(name))
          .child(label(time(m), t))
          .child(div().flex_1())
          .when(!!actorProfile(actor), e => e.child(button("message-open-" + m.id, "Terminal", t, (_e, cx) => this.openActor(actor, cx), !this.focusing && !this.pending && !this.sending))))
        .child(v_flex().min_w(0).gap(4)
          .when(!compact && own, e => e.p(UI.gap).rounded(UI.radius).bg(t.selected))
          .when(first !== null, e => e.child(div().font_medium().text_color(t.foreground).child(first)))
          .child(!compact && !m.deleted && safeMarkdown(rest)
            ? TextView.markdown("board-markdown-" + m.id, rest).scrollable(false).min_w(0)
            : div().min_w(0).text_color(m.deleted ? t.dim : t.foreground).child(rest)))
        .when(visibleLabels(m, compact).length > 0, e => e.child(label(visibleLabels(m, compact).map(([k,v]) => k + ": " + v).join("  ·  "), t)))
        .when(!!nativeTask(m), e => e.child(this.taskInfo(m, t, compact)))
        .when(attachmentRows(m).length > 0, e => e.child(this.artifactInfo(m, t, compact)))
        .when(reactionsFor(m, this.scope?.actor, !compact).length > 0, e => e.child(this.feedbackInfo(m, t, compact))));
  }

  content(t) {
    if (this.route.kind === "following") return v_flex().gap(UI.gap)
      .child(label("Local followed threads · open to read current Board content", t))
      .children(this.prefs.followed.map(m => this.row("follow-" + m.id, "# " + m.channel + " · " + m.id, t, false, (_e, cx) => this.openThread(m, cx))))
      .when(!this.prefs.followed.length, e => e.child(label("No followed threads", t)));
    if (!this.data) return label(this.loading ? "Reading Board…" : "No data loaded", t);
    const list = [...this.data.threads].reverse();
    return v_flex().gap(UI.gap)
      .when(!list.length, e => e.child(label(this.route.kind === "inbox" ? "No returned mention threads" : "No discussions", t)))
      .children(list.map(s => v_flex().id("thread-" + s.message.id).p(UI.gap).rounded(UI.radius).gap(4)
        .when(this.detail?.id === s.message.id, e => e.bg(t.selected))
        .child(this.message(s.message, t, true))
        .child(h_flex().items_center().gap(UI.gap)
          .when(isUnread(this.prefs, s), e => e.child(label("Unread", t)))
          .child(label(s.replies + " replies", t)).child(div().flex_1())
          .child(button("thread-open-" + s.message.id, "Open thread", t, (_e, cx) => this.openThread(s.message, cx), !this.pending && !this.sending)))))
      .when(this.route.kind === "channel" && !!this.data.older, e => e.child(button("older", "Older discussions", t, (_e, cx) => this.navigate({ kind: "channel", channel: this.route.channel, before: this.data.older }, cx), !this.pending && !this.sending)));
  }

  composer(t) {
    if (!this.canCompose() && !this.pending) return null;
    const route = this.composeRoute();
    return v_flex().gap(UI.gap).flex_none()
      .child(label(route.kind === "thread" ? "Reply in #" + route.channel : "Post to " + (isGeneral(route) ? "General" : "#" + route.channel), t))
      .when(!this.pending, e => e.child(Textarea.new(this.draft).h(UI.composer).px(UI.gap).rounded(UI.radius).border_1().border_color(t.input).bg(t.background).text_color(t.foreground)))
      .when(!!this.pending, e => e.child(div().text_color(t.muted).child(this.pending.text)))
      .child(label("Mention to notify · profiles share their person's credential", t))
      .child(h_flex().gap(UI.gap).items_center()
        .child(div().flex_1())
        .when(!!this.pending && !this.sending, e => e.child(button("forget", "Forget unconfirmed send", t, (_e, cx) => { this.pending = null; this.actionError = "Unconfirmed send forgotten locally. Check Board before posting again."; cx.notify(); })))
        .child(button("send", this.sending ? (this.nativeAction ? "Updating…" : "Sending…") : this.pending ? "Retry same send" : route.kind === "thread" ? "Reply" : "Post", t, (_e, cx) => this.send(cx), !this.sending && (!!this.pending || !!this.draft.value().trim()), true)));
  }

  menuButton(t) {
    return button("menu", "Menu", t, (_e, cx) => { this.menuOpen = true; cx.notify(); });
  }

  panel(t) {
    return v_flex().h_full().min_w(0).min_h(0).p(UI.pad).gap(UI.gap)
      .bg(t.background).rounded(UI.radius).border_1().border_color(t.border);
  }

  feedPane(t, panes, terminalVisible) {
    const connected = !!this.scope, route = this.route;
    const title = isGeneral(route) ? "General" : route.kind === "channel" ? "# " + route.channel : route.kind === "following" ? "Following" : "Inbox · mentions";
    const showComposer = !this.detail && (this.canCompose() || !!this.pending);
    return this.panel(t).flex_1()
      .child(h_flex().items_center().gap(UI.gap).flex_none()
        .when(panes.compact, e => e.child(this.menuButton(t)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(UI.heading).child(connected ? title : "Connect Board"))
        .when(connected, e => e.child(button("refresh", this.loading ? "Reading…" : "Refresh", t, (_e, cx) => this.refresh(cx), !this.loading && !this.sending && route.kind !== "following")))
        .when(!connected, e => e.child(button("connect", this.connecting ? "Connecting…" : "Connect", t, (_e, cx) => this.connect(cx), !this.connecting, true)))
        .when(terminalVisible, e => e.child(button("hide-terminal", this.detail ? "Back to thread" : "Hide terminal", t, (_e, cx) => this.hideTerminal(cx))))
        .child(button("herdr", "Herdr", t, () => run("layout.switch", { name: "main" }), !this.pending && !this.sending)))
      .when(!connected, e => e.child(v_flex().gap(UI.gap).flex_none()
        .child(label("Use the existing Vercel CLI login as a human, or enter a Board endpoint.", t))
        .child(Input.new(this.endpoint).h(36).px(UI.gap).rounded(UI.radius).border_1().border_color(t.input).bg(t.surface).text_color(t.foreground))))
      .when(connected, e => e
        .child(h_flex().items_center().gap(UI.gap).flex_none()
          .child(div().flex_1())
          .child(button("directory", "Sync directory", t, (_e, cx) => this.syncDirectory(cx), !this.loadingChannels && !this.sending)))
        .when(route.kind === "inbox", e => e.child(label(this.inboxNote || "Inbox covers only loaded channels and is not a complete mention history.", t)))
        .when(route.kind === "channel" && !!route.before, e => e.child(button("latest", "Back to latest", t, (_e, cx) => this.navigate({ kind: "channel", channel: route.channel }, cx), !this.pending && !this.sending)))
        .child(v_flex().id("hboard-feed").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.feedScroll).child(this.content(t)))
        .when(!!this.readError, e => e.child(div().text_color(t.blocked ?? t.foreground).child("Read failed" + (this.data ? " (last loaded data)" : "") + ": " + this.readError)))
        .when(isGeneral(route) && !!this.readError, e => e.child(label("General is unavailable. Retry or select an existing channel in the sidebar. No channel was created.", t)))
        .when(terminalVisible && !!this.bound, e => e.child(label("Native terminal · " + (terminals().find(t => t.address === this.bound.address && t.state === "live" && t.program?.agent)?.status ?? "not live / unknown") + " · binding is not proof of Session liveness", t)))
        .when(terminalVisible && !!this.detail && !!this.pending, e => e.child(label("A send is unconfirmed in the selected thread. Return to the thread to reconcile it.", t)))
        .when(!this.detail && !!this.sent, e => e.child(label(this.sent, t)))
        .when(showComposer, e => e.child(this.composer(t))))
      .when(!!this.actionError && !panes.showThread, e => e.child(div().text_color(t.blocked ?? t.foreground).child(this.actionError)));
  }

  threadPane(t, panes) {
    const route = this.detail, data = this.detailData, thread = data?.message;
    return this.panel(t)
      .when(panes.split, e => e.w(UI.detail).flex_none())
      .when(!panes.split, e => e.flex_1())
      .child(h_flex().items_center().gap(UI.gap).flex_none()
        .when(panes.compact, e => e.child(this.menuButton(t)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(UI.heading).child("Thread"))
        .child(button("thread-refresh", this.detailLoading ? "Reading…" : "Refresh", t, (_e, cx) => this.refreshDetail(cx), !this.detailLoading && !this.sending))
        .child(button("thread-close", panes.split ? "Close" : "Back", t, (_e, cx) => this.closeThread(cx), !this.pending && !this.sending)))
      .child(label("# " + route.channel, t))
      .when(!!thread, e => e.child(h_flex().items_center().gap(UI.gap)
        .child(button("mark-read", "Mark read", t, (_e, cx) => { this.prefs = readMarker(this.prefs, threadSummary(this.detailData)); this.savePrefs(); cx.notify(); }))
        .child(button("follow", this.prefs.followed.some(x => x.id === thread.id) ? "Unfollow" : "Follow", t, (_e, cx) => { this.prefs = toggleFollow(this.prefs, thread); this.savePrefs(); cx.notify(); }))))
      .child(v_flex().id("hboard-thread").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.threadScroll)
        .child(data ? v_flex().gap(UI.pad).children([data.message, ...data.replies].map(m => this.message(m, t))) : label(this.detailLoading ? "Reading thread…" : "No thread loaded", t)))
      .when(!!this.detailReadError, e => e.child(div().text_color(t.blocked ?? t.foreground).child("Thread read failed: " + this.detailReadError)))
      .when(!!this.sent, e => e.child(label(this.sent, t)))
      .when(this.canCompose() || !!this.pending, e => e.child(this.composer(t)))
      .when(!!this.actionError, e => e.child(div().text_color(t.blocked ?? t.foreground).child(this.actionError)));
  }

  render() {
    const t = theme();
    const terminalVisible = this.terminalVisible();
    const panes = workspacePanes(this.viewportWidth, !!this.detail, terminalVisible, this.menuOpen);
    return h_flex().id("hboard-root").size_full().min_h(0).min_w(0).gap(UI.gap).bg(t.canvas).text_color(t.foreground).text_size(UI.text)
      .on_size_change((size, cx) => {
        if (size.width !== this.viewportWidth) { this.viewportWidth = size.width; cx.notify(); }
      })
      .when(panes.showNav, e => e.child(this.sidebar(t, panes.compact)))
      .when(panes.showFeed, e => e.child(this.feedPane(t, panes, terminalVisible)))
      .when(panes.showThread, e => e.child(this.threadPane(t, panes)));
  }
}
