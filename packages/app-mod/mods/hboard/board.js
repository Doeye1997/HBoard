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

export function readArgs(route) {
  if (route.kind === "thread") return { args: [route.id] };
  if (route.kind === "inbox") return { flags: ["--mentions", "me", "--limit", "30"] };
  if (route.kind === "channel") return {
    flags: ["--limit", "30", ...(route.before ? ["--before", route.before] : [])], args: [route.channel],
  };
  throw Error("Unknown Board view");
}

export function createSend(scope, route, text, key) {
  if (typeof text !== "string" || !text.trim() || text.trim() === "-" || text.includes("\0") || text.length > 10000) {
    throw Error("Enter a message of 1–10,000 characters (a lone '-' is reserved by the CLI)");
  }
  const command = route.kind === "thread" ? "reply" : route.kind === "channel" ? "post" : null;
  if (!command) throw Error("Open a channel or thread to send");
  const target = command === "reply" ? route.id : route.channel;
  if (typeof target !== "string" || !target || target.startsWith("-") || !key) throw Error("Invalid message destination");
  return { scope: { ...scope }, command, target, text, key };
}

export function sendArgs(intent) {
  return argv(intent.command, { board: intent.scope.board,
    flags: ["--idempotency-key", intent.key], args: [intent.target, intent.text] });
}

export function parseReply(output, operation) {
  let value;
  try { value = JSON.parse(output.stdout); } catch { /* no structured result */ }
  if (output.code !== 0 || !value || typeof value !== "object") {
    const reason = typeof value?.reason === "string" && /^[a-z_]+$/.test(value.reason) ? ": " + value.reason : "";
    throw Error("Board " + operation + " failed" + reason + " (exit " + output.code + ")");
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
  return JSON.stringify([m.id, m.revision ?? m.version, last?.id ?? null, last?.revision ?? last?.version ?? null, summary.replies]);
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
