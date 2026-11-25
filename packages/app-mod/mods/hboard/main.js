import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, appHome, checking, props, run, theme, terminals, window, layout } from "herdr";
import { canonicalBoard, humanScope, sameHuman, argv, boardInvocation, generalRoute, isGeneral, canComposeRoute, terminalPane, readArgs, inboxMentionArgs, inboxPageArgs, mentionsHuman, inboxCoverage, dedupeThreads, createSend, sendArgs, parseReply, actorProfile, bindingTarget, messageName, threadSummary, readMarker, isUnread, toggleFollow } from "./board.js";

// Adopt the Herdr native theme and the spacing/typography scale of its panels.
const UI = { rail: 216, pad: 12, gap: 8, row: 30, radius: 7, small: 11.5, text: 13, heading: 16, composer: 92 };
const EMPTY = () => ({ seen: {}, followed: [] });
const routeKey = r => JSON.stringify(r);
const scopeKey = s => "hboard.attention:" + JSON.stringify([s.board, s.actor]);
const errorText = e => String(e?.message ?? e).slice(0, 500);
const time = m => m.createdAt ? new Date(m.createdAt).toLocaleString() : "";
const array = (value, field) => { if (!Array.isArray(value)) throw Error("Invalid Board " + field); return value; };
const label = (text, t) => div().text_size(UI.small).text_color(t.dim).child(text);

function button(id, text, t, action, enabled = true, primary = false) {
  return h_flex().id(id).h(UI.row).px(UI.gap).rounded(UI.radius).items_center().flex_none()
    .text_size(UI.text).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
    .bg(primary && enabled ? t.solid : t.raised)
    .when(enabled, e => e.cursor_pointer().hover(s => s.opacity(0.85)).on_click(action)).child(text);
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
    this.focusSeq = 0;
    this.prefs = EMPTY();
    this.drafts = new Map();
    this.endpoint = InputState.new({ value: props()?.url ?? localStorage.getItem("hboard.endpoint") ?? "", placeholder: "Optional Board URL (use CLI login by default)" });
    this.draft = TextareaState.new({ placeholder: "Write a Board message…", rows: 3 });
    this.draft.on("change", (_event, cx) => cx.notify());
    if (!checking()) cx.timer.every(15000, cx => {
      if (this.scope && !this.loading && !this.sending && !this.route.before && this.route.kind !== "following") this.refresh(cx);
    });
  }

  async execBoard(args) {
    if (!this.transport) throw Error("Board CLI is not connected");
    const { command, args: actual } = boardInvocation(this.transport, args);
    return exec(command, actual, { timeout: 30000 });
  }

  async cli(command, board, options = {}) {
    return parseReply(await this.execBoard(argv(command, { board, ...options })), command);
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

  navigate(route, cx) {
    if (this.pending || this.sending || this.connecting) return;
    this.drafts.set(routeKey(this.route), this.draft.value());
    this.seq++;
    this.route = route;
    this.data = null;
    this.loading = false;
    this.readError = "";
    this.actionError = "";
    this.sent = "";
    this.draft.set_value(this.drafts.get(routeKey(route)) ?? "");
    if (route.kind === "following") cx.notify();
    else this.refresh(cx, route.kind === "thread");
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


  refresh(cx, mark = false) {
    if (checking() || !this.scope || this.loading || this.sending || this.route.kind === "following") return;
    const scope = this.scope, route = this.route, seq = ++this.seq;
    this.loading = true;
    this.readError = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const data = route.kind === "inbox" ? await this.readInbox(scope) : await this.cli("read", scope.board, readArgs(route));
        if (seq !== this.seq || !sameHuman(scope, this.scope)) return;
        if (route.kind === "thread") {
          if (data.message?.id !== route.id) throw Error("Board returned a different thread root");
          array(data.replies, "replies");
          if (mark) { this.prefs = readMarker(this.prefs, threadSummary(data)); this.savePrefs(); }
        } else if (route.kind === "inbox") {
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
    this.navigate({ kind: "thread", id: message.id, channel: message.channel }, cx);
  }

  mention(actor, cx) {
    if (!this.canCompose() || !actor.handle || this.pending || this.sending) return;
    const old = this.draft.value();
    this.draft.set_value(old + (old && !/\s$/.test(old) ? " " : "") + "@" + actor.handle.replace(/^@/, "") + " ");
    this.draft.focus(); cx.notify();
  }

  openActor(actor, cx) {
    const profile = actorProfile(actor);
    if (checking() || !profile || !this.scope) return;
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

  canCompose() { return canComposeRoute(this.scope, this.route, this.data, this.readError); }

  send(cx) {
    if (checking() || this.sending || (!this.pending && !this.canCompose())) return;
    let intent;
    try {
      intent = this.pending ?? createSend(this.scope, this.route, this.draft.value(),
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
        this.drafts.delete(routeKey(this.route));
        this.sent = "Posted · " + m.id;
      } catch (error) {
        if (!invoked && !previouslyUnconfirmed) this.pending = null;
        this.actionError = (this.pending ? "Send unconfirmed. Check the thread before retrying the same operation. " : "") + errorText(error);
      } finally {
        this.sending = false;
        // Invalidate any read that started before the write completed.
        this.seq++; this.loading = false;
        if (!this.pending && this.route.kind === "channel" && this.route.before) this.navigate({ kind: "channel", channel: this.route.channel }, cx);
        else this.refresh(cx);
        cx.notify();
      }
    });
  }

  row(id, text, t, on, action, enabled = true) {
    return h_flex().id(id).h(UI.row).px(UI.gap).gap(UI.gap).rounded(UI.radius).items_center().flex_none()
      .when(on, e => e.bg(t.selected)).text_color(on ? t.foreground : t.muted)
      .when(enabled, e => e.cursor_pointer().hover(s => s.bg(t.hover)).on_click(action))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  sidebar(t) {
    const enabled = !this.pending && !this.sending && !this.connecting;
    const channel = this.route.channel;
    const unread = this.route.kind === "inbox" && this.data?.threads ? this.data.threads.filter(s => isUnread(this.prefs, s)).length : null;
    return v_flex().w(UI.rail).h_full().flex_none().min_h(0).bg(t.chrome).p(UI.pad).gap(UI.gap)
      .child(div().font_semibold().text_size(UI.heading).child("HBoard"))
      .child(label(this.scope ? "@" + this.scope.handle : "Connect a Board", t))
      .when(!!this.scope, e => e
        .child(this.row("general", "General", t, isGeneral(this.route) || (this.route.kind === "thread" && channel === "general"), (_e, cx) => this.navigate(generalRoute(), cx), enabled))
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
            .when(!!actorProfile(actor), e => e.child(button("open-" + actor.id, this.focusing === actor.id ? "…" : "Open", t, (_e, cx) => this.openActor(actor, cx), !this.focusing)))))));
  }

  message(m, t, compact = false) {
    const actor = this.actors.find(a => a.id === m.by?.actor);
    return v_flex().gap(4).min_w(0).flex_none()
      .child(h_flex().items_center().gap(UI.gap)
        .child(div().font_medium().text_color(t.foreground).min_w(0).truncate().child(messageName(m, this.actors)))
        .child(div().flex_1())
        .child(label(time(m), t))
        .when(!!actorProfile(actor), e => e.child(button("message-open-" + m.id, "Open agent", t, (_e, cx) => this.openActor(actor, cx), !this.focusing))))
      .child(div().min_w(0).text_color(m.deleted ? t.dim : t.foreground)
        .child(m.deleted ? "[Deleted message]" : compact ? (m.text ?? "").slice(0, 240) : (m.text ?? "")))
      .when(!m.deleted && !!m.attachments?.length, e => e.child(label(m.attachments.length + " attachment(s) · read in Board", t)));
  }

  content(t) {
    if (this.route.kind === "following") return v_flex().gap(UI.gap)
      .child(label("Local followed threads · open to read current Board content", t))
      .children(this.prefs.followed.map(m => this.row("follow-" + m.id, "# " + m.channel + " · " + m.id, t, false, (_e, cx) => this.openThread(m, cx))))
      .when(!this.prefs.followed.length, e => e.child(label("No followed threads", t)));
    if (!this.data) return label(this.loading ? "Reading Board…" : "No data loaded", t);
    if (this.route.kind === "thread") return v_flex().gap(UI.pad).children([this.data.message, ...this.data.replies].map(m => this.message(m, t)));
    const list = [...this.data.threads].reverse();
    return v_flex().gap(UI.gap)
      .when(!list.length, e => e.child(label(this.route.kind === "inbox" ? "No returned mention threads" : "No discussions", t)))
      .children(list.map(s => v_flex().id("thread-" + s.message.id).p(UI.gap).rounded(UI.radius).gap(5).bg(t.surface)
        .child(this.message(s.message, t, true))
        .child(h_flex().items_center().gap(UI.gap)
          .when(isUnread(this.prefs, s), e => e.child(label("Unread", t)))
          .child(label(s.replies + " replies", t)).child(div().flex_1())
          .child(button("thread-open-" + s.message.id, "Open thread", t, (_e, cx) => this.openThread(s.message, cx), !this.pending && !this.sending)))))
      .when(this.route.kind === "channel" && !!this.data.older, e => e.child(button("older", "Older discussions", t, (_e, cx) => this.navigate({ kind: "channel", channel: this.route.channel, before: this.data.older }, cx), !this.pending && !this.sending)));
  }

  composer(t) {
    if (!this.canCompose() && !this.pending) return null;
    return v_flex().gap(UI.gap).flex_none()
      .child(label(this.route.kind === "thread" ? "Reply in #" + this.route.channel : "Post to " + (isGeneral(this.route) ? "General" : "#" + this.route.channel), t))
      .when(!this.pending, e => e.child(Textarea.new(this.draft).h(UI.composer).px(UI.gap).rounded(UI.radius).border_1().border_color(t.input).bg(t.background).text_color(t.foreground)))
      .when(!!this.pending, e => e.child(div().text_color(t.muted).child(this.pending.text)))
      .child(label("Mention to notify · profiles share their person's credential", t))
      .child(h_flex().gap(UI.gap).items_center()
        .child(div().flex_1())
        .when(!!this.pending && !this.sending, e => e.child(button("forget", "Forget unconfirmed send", t, (_e, cx) => { this.pending = null; this.actionError = "Unconfirmed send forgotten locally. Check Board before posting again."; cx.notify(); })))
        .child(button("send", this.sending ? "Sending…" : this.pending ? "Retry same send" : this.route.kind === "thread" ? "Reply" : "Post", t, (_e, cx) => this.send(cx), !this.sending && (!!this.pending || !!this.draft.value().trim()), true)));
  }

  render() {
    const t = theme(), connected = !!this.scope, route = this.route;
    const title = route.kind === "thread" ? "Thread · #" + route.channel : isGeneral(route) ? "General" : route.kind === "channel" ? "# " + route.channel : route.kind === "following" ? "Following" : "Inbox · mentions";
    const nativeTerminal = terminalPane(layout());
    const thread = route.kind === "thread" ? this.data?.message : null;
    const bound = this.bound && terminals().find(t => t.address === this.bound.address && t.state === "live" && t.program?.agent);
    return h_flex().id("hboard-root").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground).text_size(UI.text)
      .child(this.sidebar(t))
      .child(v_flex().flex_1().h_full().min_w(0).min_h(0).p(UI.pad).gap(UI.gap)
        .child(h_flex().items_center().gap(UI.gap).flex_none()
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(UI.heading).child(connected ? title : "Connect Board"))
          .when(connected, e => e.child(button("refresh", this.loading ? "Reading…" : "Refresh", t, (_e, cx) => this.refresh(cx), !this.loading && !this.sending && route.kind !== "following")))
          .when(!connected, e => e.child(button("connect", this.connecting ? "Connecting…" : "Connect", t, (_e, cx) => this.connect(cx), !this.connecting, true)))
          .when(!!nativeTerminal && !nativeTerminal.hidden, e => e.child(button("hide-terminal", "Hide terminal", t, (_e, cx) => {
            // Hiding a layout node leaves the native agent process running.
            this.focusSeq++;
            this.focusing = null;
            run("layout.hide", { id: "hboard-terminal" });
            cx.notify();
          })))
          .child(button("herdr", "Herdr", t, () => run("layout.switch", { name: "main" }))))
        .when(!connected, e => e.child(v_flex().gap(UI.gap).flex_none()
          .child(label("Use the existing Vercel CLI login, as a human, or enter a Board endpoint. No credentials are stored here.", t))
          .child(Input.new(this.endpoint).h(36).px(UI.gap).rounded(UI.radius).border_1().border_color(t.input).bg(t.surface).text_color(t.foreground))))
        .when(connected, e => e
          .child(h_flex().items_center().gap(UI.gap).flex_none()
            .child(div().flex_1().min_w(0).truncate().text_size(UI.small).text_color(t.dim).child(this.scope.board))
            .child(button("directory", "Sync directory", t, (_e, cx) => this.syncDirectory(cx), !this.loadingChannels && !this.sending)))
          .when(!!nativeTerminal && !nativeTerminal.hidden && !!this.bound, e => e.child(label("Bound terminal " + this.bound.address + " · " + (bound?.status ?? "not live / unknown") + " · claim is not proof of Session liveness", t)))
          .when(route.kind === "thread", e => e.child(h_flex().gap(UI.gap)
            .child(button("back", "Channel", t, (_e, cx) => this.navigate({ kind: "channel", channel: route.channel }, cx), !this.pending && !this.sending))
            .when(!!thread, e => e.child(button("mark-read", "Mark read", t, (_e, cx) => { this.prefs = readMarker(this.prefs, threadSummary(this.data)); this.savePrefs(); cx.notify(); })))
            .when(!!thread, e => e.child(button("follow", this.prefs.followed.some(x => x.id === thread.id) ? "Unfollow" : "Follow", t, (_e, cx) => { this.prefs = toggleFollow(this.prefs, thread); this.savePrefs(); cx.notify(); })))))
          .when(route.kind === "inbox", e => e.child(label(this.inboxNote || "Inbox covers only loaded channels and is not a complete mention history.", t)))
          .when(route.kind === "channel" && !!route.before, e => e.child(button("latest", "Back to latest", t, (_e, cx) => this.navigate({ kind: "channel", channel: route.channel }, cx), !this.pending && !this.sending)))
          .child(v_flex().id("hboard-content").flex_1().min_h(0).overflow_y_scrollbar().child(this.content(t)))
          .when(!!this.readError, e => e.child(div().text_color(t.blocked ?? t.foreground).child("Read failed" + (this.data ? " (last loaded data)" : "") + ": " + this.readError)))
          .when(isGeneral(route) && !!this.readError, e => e.child(label("General is unavailable. Retry or select an existing channel in the sidebar. No channel was created.", t)))
          .when(!!this.sent, e => e.child(label(this.sent, t)))
          .when(this.canCompose() || !!this.pending, e => e.child(this.composer(t))))
        .when(!!this.actionError, e => e.child(div().text_color(t.blocked ?? t.foreground).child(this.actionError))));
  }
}
