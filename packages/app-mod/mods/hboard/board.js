// The App Mod is a Board client, not a delivery service. All I/O is delegated
// to the official CLI through Herdr's native exec API.
export function canonicalBoard(value) {
  const url = new URL(value);
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      keys.some(key => key !== "teamId") || new Set(keys).size !== keys.length ||
      (keys.length && !url.searchParams.get("teamId"))) throw Error("Expected a canonical HTTPS Board URL");
  return url.href;
}

export function humanScope(me) {
  if (me?.kind !== "person" || me.profile !== null || !me.actor || !me.handle) {
    throw Error("Use a human Board login, not an agent profile (check BOARD_PROFILE)");
  }
  return { board: canonicalBoard(me.board), actor: me.actor, handle: me.handle };
}

export function sameHuman(a, b) {
  return a?.board === b?.board && a?.actor === b?.actor;
}

export function argv(command, { board, flags = [], args = [] } = {}) {
  // Options precede --, so even message text starting with -- is data.
  return ["board", command, ...(board ? ["--url", board] : []), "--json", ...flags,
    ...(args.length ? ["--", ...args] : [])];
}

// Use the same executable and argv prefix for every Board read and write.
export function boardInvocation(transport, args) {
  return { command: transport.command, args: [...transport.prefix, ...args] };
}

function channelName(value) {
  if (typeof value !== "string" || !value || value.startsWith("-")) throw Error("Invalid channel");
  return value;
}

// Hosted boards may reject mention reads. Callers query one loaded channel at a time.
export function inboxMentionArgs(channel) {
  return { flags: ["--mentions", "me", "--limit", "30"], args: [channelName(channel)] };
}

export function inboxPageArgs(channel) {
  return { flags: ["--limit", "30"], args: [channelName(channel)] };
}

// General is a Board channel, not a synthetic cross-channel feed.
export function generalRoute() {
  return { kind: "channel", channel: "general" };
}

export function isGeneral(route) {
  return route?.kind === "channel" && route.channel === "general";
}

// A successful authoritative read is required before composing in a channel.
// Missing/forbidden channels must not look like writable empty channels.
export function canComposeRoute(scope, route, data, readError) {
  if (!scope || readError || !data) return false;
  if (route?.kind === "channel") return Array.isArray(data.threads);
  return route?.kind === "thread" && data.message?.id === route.id && !data.message.deleted;
}

// Read the actual personal layout; never maintain a second visibility flag.
export function terminalPane(layout) {
  if (!layout || typeof layout !== "object") return null;
  if (layout.id === "hboard-terminal") return layout;
  for (const child of Array.isArray(layout.children) ? layout.children : []) {
    const found = terminalPane(child);
    if (found) return found;
  }
  return null;
}

// The list is a location; the selected thread is a separate reading context.
export function threadRoute(message) {
  const id = message?.id;
  if (typeof id !== "string" || !id || id.startsWith("-")) throw Error("Invalid thread root");
  return { kind: "thread", id, channel: channelName(message.channel) };
}

export function draftKey(route) {
  if (route?.kind === "thread") return JSON.stringify(["thread", route.channel, route.id]);
  if (route?.kind === "channel") return JSON.stringify(["channel", route.channel]);
  return null;
}

// Width is the actual Mod viewport, excluding a native terminal when shown.
// A narrow window offers a full reading surface and an explicit menu.
export function workspacePanes(width, hasThread, terminalVisible, menuOpen) {
  const available = Number.isFinite(width) && width > 0 ? width : 1440;
  const compact = available < 760;
  const menu = compact && menuOpen;
  const detail = hasThread && !terminalVisible;
  const split = detail && available >= 1060;
  return {
    compact,
    split,
    showNav: !compact || menu,
    showFeed: !menu && (!detail || split),
    showThread: !menu && detail,
  };
}

export function readArgs(route) {
  if (route.kind === "thread") return { args: [route.id] };
  if (route.kind === "inbox") throw Error("Inbox reads each loaded channel; it has no whole-board query");
  if (route.kind === "channel") return {
    flags: ["--limit", "30", ...(route.before ? ["--before", route.before] : [])], args: [channelName(route.channel)],
  };
  throw Error("Unknown Board view");
}

// A profile mention contains the person handle before a slash. That is not a mention of the person.
export function mentionsHuman(text, scope) {
  if (typeof text !== "string" || !scope) return false;
  const handle = String(scope.handle ?? "").replace(/^@/, "");
  if (handle) {
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("(^|[^A-Za-z0-9_])@" + escaped + "(?![A-Za-z0-9_/-])").test(text)) return true;
  }
  const actor = scope.actor;
  return typeof actor === "string" && actor.length >= 8 && text.includes(actor);
}

export function inboxCoverage(mode, count, more) {
  const loaded = count + " loaded channel" + (count === 1 ? "" : "s") + (more ? "; more channels are not loaded" : "");
  if (!count) return "No channels loaded" + (more ? "; more channels are not loaded" : "") + ". Not a complete inbox.";
  if (mode === "query") return "Mention query, latest 30 threads in each of " + loaded + ". Not a complete inbox.";
  return "This board has no mention index. Mentions found in the latest 30 thread roots of " + loaded + ". Replies outside those roots are not included. Not a complete inbox.";
}

export function dedupeThreads(threads) {
  const byId = new Map();
  for (const thread of threads) {
    const id = thread?.message?.id;
    if (typeof id === "string" && !byId.has(id)) byId.set(id, thread);
  }
  return [...byId.values()].sort((a, b) => String(b?.message?.createdAt ?? "").localeCompare(String(a?.message?.createdAt ?? "")));
}

export function createSend(scope, route, text, key, kind = "message") {
  if (typeof text !== "string" || !text.trim() || text.trim() === "-" || text.includes("\0") || text.length > 10000) {
    throw Error("Enter a message of 1–10,000 characters (a lone '-' is reserved by the CLI)");
  }
  const command = kind === "task" && route.kind === "channel" ? "task-create"
    : kind === "message" ? (route.kind === "thread" ? "reply" : route.kind === "channel" ? "post" : null) : null;
  if (!command) throw Error("Open a channel or thread to send");
  const target = command === "reply" ? route.id : route.channel;
  if (typeof target !== "string" || !target || target.startsWith("-") || !key) throw Error("Invalid message destination");
  return { scope: { ...scope }, command, target, text, key };
}

export function sendArgs(intent) {
  if (intent.command === "task-create") return argv("tasks", { board: intent.scope.board,
    flags: ["--idempotency-key", intent.key], args: ["create", intent.target, intent.text] });
  return argv(intent.command, { board: intent.scope.board,
    flags: ["--idempotency-key", intent.key], args: [intent.target, intent.text] });
}

export function parseReply(output, operation) {
  let value, failure;
  try { value = JSON.parse(output.stdout); } catch { /* no structured result */ }
  // Official CLI failures are JSON on stderr. Never echo arbitrary CLI output.
  if (output.code !== 0) {
    try { failure = JSON.parse(output.stderr); } catch { /* older CLI may use stdout */ }
    const reason = [failure?.reason, value?.reason].find(r => typeof r === "string" && /^[a-z_]{1,80}$/.test(r));
    throw Error("Board " + operation + " failed" + (reason ? ": " + reason : "") + " (exit " + output.code + ")");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error("Board " + operation + " failed (invalid JSON result)");
  }
  return value;
}

export function actorProfile(actor) {
  // Board actor IDs encode principal+profile. The display name is never identity.
  const id = actor?.id;
  if (typeof id !== "string") return null;
  const plus = id.indexOf("+");
  const profile = plus < 0 ? "" : id.slice(plus + 1);
  return /^[A-Za-z0-9_-]+$/.test(profile) ? profile : null;
}

export function bindingTarget(doc, actor, scope, terminals) {
  const b = doc?.value;
  const profile = actorProfile(actor);
  if (!profile || b?.state !== "active" || !b.instanceId || !b.sessionId ||
      b.profile !== profile || b.scope?.profile !== profile || b.scope?.actor !== actor.id ||
      b.scope?.board !== scope.board || b.scope?.sessionId !== b.sessionId) return null;
  const terminal = terminals.find(t => t.address === b.terminal && t.state === "live" && t.program?.agent === true);
  if (!terminal) return null;
  return { address: terminal.address, status: terminal.status || "unknown", sessionId: b.sessionId };
}

export function messageName(message, actors) {
  return message.author?.handle || actors.find(a => a.id === message.by?.actor)?.handle || message.by?.actor || "Unknown actor";
}

export function signature(summary) {
  const m = summary.message, last = summary.last;
  return JSON.stringify([m.id, m.version ?? m.revision, last?.id ?? null, last?.version ?? last?.revision ?? null, summary.replies]);
}

export function threadSummary(thread) {
  const replies = thread.replies.filter(m => !m.deleted);
  return { message: thread.message, last: replies.at(-1) ?? null, replies: replies.length };
}

export function readMarker(prefs, summary) {
  // These are local attention preferences, not copied Board content.
  const seen = { ...prefs.seen, [summary.message.id]: signature(summary) };
  return { ...prefs, seen: Object.fromEntries(Object.entries(seen).slice(-300)) };
}

export function isUnread(prefs, summary) {
  return prefs.seen[summary.message.id] !== signature(summary);
}

export function toggleFollow(prefs, message) {
  const followed = prefs.followed.filter(x => x.id !== message.id);
  if (followed.length === prefs.followed.length) followed.unshift({ id: message.id, channel: message.channel });
  return { ...prefs, followed: followed.slice(0, 30) };
}

// Native TextView can render Markdown and open HTTP(S) links on explicit
// activation. Do not hand it raw HTML or image markup: its document image
// renderer may otherwise request a remote resource during layout.
export function safeMarkdown(text) {
  return typeof text === "string" && !text.includes("<") && !text.includes("![");
}

const FEEDBACK = Object.freeze({ thumbs_up: "👍", eyes: "👀", check: "✅" });
export function reactionsFor(message, actor, offer = false) {
  const values = message?.reactions;
  if (message?.deleted || !values || typeof values !== "object" || Array.isArray(values)) return [];
  const rows = [];
  for (const [name, members] of Object.entries(values)) {
    if (!/^[a-z0-9_+-]{1,80}$/.test(name) || !Array.isArray(members) || !members.every(id => typeof id === "string")) continue;
    const actors = [...new Set(members)];
    if (actors.length || offer) rows.push({ name, title: Object.hasOwn(FEEDBACK, name) ? FEEDBACK[name] : ":" + name + ":", actors, count: actors.length, own: actors.includes(actor) });
  }
  if (offer) for (const [name, title] of Object.entries(FEEDBACK)) {
    if (!rows.some(r => r.name === name)) rows.push({ name, title, actors: [], count: 0, own: false });
  }
  return rows;
}

export function attachmentRows(message) {
  if (message?.deleted || !Array.isArray(message?.attachments)) return [];
  return message.attachments.filter(a => a && typeof a.id === "string" &&
    /^(?:[A-Za-z0-9_-]{22}|att_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(a.id) &&
    typeof a.name === "string" && typeof a.type === "string" &&
    Number.isSafeInteger(a.size) && a.size >= 0).map(a => ({
      id: a.id, name: a.name, type: a.type, size: a.size,
    }));
}

export function messageInThread(snapshot, id) {
  if (snapshot?.message?.id === id) return snapshot.message;
  return Array.isArray(snapshot?.replies) ? snapshot.replies.find(m => m?.id === id) ?? null : null;
}

export function reactionArgs(scope, message, name, remove) {
  if (!message || message.deleted || typeof message.id !== "string" ||
      !reactionsFor(message, scope.actor, true).some(r => r.name === name)) throw Error("Reaction target unavailable");
  return argv("react", { board: scope.board, flags: remove ? ["--remove"] : [], args: [message.id, name] });
}

export function downloadArgs(scope, message, id) {
  if (!attachmentRows(message).some(a => a.id === id)) throw Error("Attachment unavailable");
  // No destination filename argument. The official CLI writes exclusively
  // using its sanitized filename in the user-selected working directory.
  return argv("download", { board: scope.board, args: [id] });
}

const TASK_STATES = new Set(["waiting", "ready", "claimed", "blocked", "completed", "failed", "canceled"]);
export function nativeTask(message) {
  if (message?.deleted) return null;
  const t = message?.task;
  if (!t || typeof t !== "object" || !TASK_STATES.has(t.state)) {
    return t != null || message?.labels?.["board.task"] !== undefined ? { unavailable: true } : null;
  }
  // Read only the public projection, never propagate claim secrets or infer
  // readiness from time, labels or dependencies on the client.
  const value = s => typeof s === "string" && s.length ? s : null;
  return {
    state: t.state, owner: value(t.owner), assigned: value(t.for),
    holder: value(t.claim?.actor), until: value(t.claim?.until),
    blocked: value(t.blocked?.reason), result: value(t.result), reason: value(t.reason),
    needs: Array.isArray(t.needs) ? t.needs.filter(id => typeof id === "string") : [],
  };
}

export function visibleLabels(message, compact) {
  if (message?.deleted || !message?.labels || typeof message.labels !== "object" || Array.isArray(message.labels)) return [];
  return Object.entries(message.labels).filter(([key, value]) => typeof value === "string" &&
    /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(key) &&
    key !== "board.task" && (!compact || key === "project" || key === "kind"));
}

// Permission hints from whoami; Board remains the authorization boundary.
export function channelPermission(me, channel, permission) {
  const can = me?.can;
  if (!can || typeof can !== "object" || Array.isArray(can)) return false;
  const pattern = Object.keys(can).filter(k => k === channel || k === "*" ||
    (k.endsWith("/") && (channel === k.slice(0,-1) || channel.startsWith(k))))
    .sort((a,b) => (b === channel ? 100000 : b === "*" ? 0 : b.length) -
      (a === channel ? 100000 : a === "*" ? 0 : a.length))[0];
  const grants = pattern === undefined ? null : can[pattern];
  return Array.isArray(grants) && (grants.includes(permission) || grants.includes("manage"));
}

export function taskListArgs(channel) {
  const name = channelName(channel);
  if (["create","claim","run","renew","release","complete","fail","block","unblock","reopen","assign","needs","cancel"].includes(name)) throw Error("Channel conflicts with a native tasks command");
  return { flags: ["--state","all","--limit","1"], args: [name] };
}

export function taskAction(scope, me, root, verb) {
  if (!root || root.deleted || typeof root.id !== "string" || !root.id || root.id.startsWith("-") || root.re != null) throw Error("Thread root unavailable");
  const task = nativeTask(root);
  if (verb === "convert" && task === null && channelPermission(me, root.channel, "label")) {
    return {args:argv("tasks",{board:scope.board,args:["create",root.id]}), outcome:"created"};
  }
  const owner = task && !task.unavailable && (channelPermission(me, root.channel, "manage") ||
    (!!me?.principal && task.owner === me.principal && channelPermission(me, root.channel, "label")));
  if (!owner || !((verb === "unblock" && task.state === "blocked") || (verb === "reopen" && task.state === "failed"))) throw Error("Task action is unavailable for this identity and state");
  return {args:argv("tasks",{board:scope.board,args:[verb,root.id]}), outcome:verb === "unblock" ? "unblocked" : "reopened"};
}
