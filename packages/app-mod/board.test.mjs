import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBoard, humanScope, sameHuman, argv, boardInvocation, readArgs, inboxMentionArgs, inboxPageArgs, mentionsHuman, inboxCoverage, dedupeThreads, createSend, sendArgs, parseReply, actorProfile, bindingTarget, signature, threadSummary, readMarker, isUnread, toggleFollow } from "./mods/hboard/board.js";
const scope = { board: "https://board.example/v1/boards/b?teamId=t", actor: "person", handle: "me" };
const actor = { id: "person+worker", handle: "me/worker" };
const root = { id: "msg_1", channel: "dev", version: 1, text: "root" };
const reply = { id: "msg_2", version: 2, text: "reply" };
const prefs = { seen: {}, followed: [] };

test("connect uses the authenticated human and canonical endpoint", () => {
  assert.deepEqual(humanScope({ ...scope, kind: "person", profile: null }), scope);
  assert.throws(() => humanScope({ ...scope, kind: "person", profile: "worker" }), /human/);
  assert.throws(() => canonicalBoard("https://u:p@board.example/"), /canonical/);
  assert.throws(() => canonicalBoard("https://board.example/?token=secret"), /canonical/);
  assert.equal(sameHuman(scope, { ...scope, actor: "other" }), false);
});

test("inbox queries one loaded channel and does not claim a whole-board read", () => {
  assert.deepEqual(argv("read", { board: scope.board, ...inboxMentionArgs("dev") }),
    ["board", "read", "--url", scope.board, "--json", "--mentions", "me", "--limit", "30", "--", "dev"]);
  assert.deepEqual(inboxPageArgs("dev"), { flags: ["--limit", "30"], args: ["dev"] });
  assert.throws(() => readArgs({ kind: "inbox" }), /loaded channel/);
  assert.equal(mentionsHuman("wake @me now", scope), true);
  assert.equal(mentionsHuman("wake @me/worker", scope), false);
  assert.equal(mentionsHuman("id person-1 is here", { handle: "other", actor: "person-1" }), true);
  assert.equal(mentionsHuman("short", { handle: "other", actor: "person" }), false);
  assert.match(inboxCoverage("query", 2, true), /2 loaded channels; more channels are not loaded/);
  assert.match(inboxCoverage("scan", 1, false), /no mention index/);
  assert.match(inboxCoverage("scan", 0, false), /No channels loaded/);
  assert.deepEqual(dedupeThreads([
    { message: { id: "b", createdAt: "2020-01-01" } },
    { message: { id: "a", createdAt: "2021-01-01" } },
    { message: { id: "a", createdAt: "2021-01-01" } },
  ]).map(thread => thread.message.id), ["a", "b"]);
  assert.deepEqual(readArgs({ kind: "thread", id: "msg_1", thread: "not-message-id" }), { args: ["msg_1"] });
  assert.deepEqual(readArgs({ kind: "channel", channel: "dev", before: "older" }),
    { flags: ["--limit", "30", "--before", "older"], args: ["dev"] });
});

test("send freezes destination and idempotency; leading flags are text", () => {
  const draft = createSend(scope, { kind: "thread", id: "msg_1" }, "--url attacker\n@me/worker", "same-key");
  const args = ["board", "reply", "--url", scope.board, "--json", "--idempotency-key", "same-key", "--", "msg_1", "--url attacker\n@me/worker"];
  assert.deepEqual(sendArgs(draft), args);
  assert.deepEqual(sendArgs(draft), args);
  assert.throws(() => createSend(scope, { kind: "inbox" }, "hello", "k"), /Open a channel/);
  assert.throws(() => createSend(scope, { kind: "channel", channel: "dev" }, "-", "k"), /reserved/);
});

test("only exact scoped active binding plus a live agent permits navigation", () => {
  const value = { state: "active", profile: "worker", instanceId: "i", sessionId: "s", terminal: "t1", scope: { board: scope.board, actor: actor.id, profile: "worker", sessionId: "s" } };
  const terminals = [{ address: "t1", state: "live", program: { agent: true }, status: "working" }];
  assert.equal(actorProfile(actor), "worker");
  assert.equal(bindingTarget({ value }, actor, scope, terminals).address, "t1");
  assert.equal(bindingTarget({ value }, { ...actor, id: "other+worker" }, scope, terminals), null);
  assert.equal(bindingTarget({ value }, actor, { ...scope, board: "https://other/" }, terminals), null);
  assert.equal(bindingTarget({ value: { ...value, state: "stopped" } }, actor, scope, terminals), null);
  assert.equal(bindingTarget({ value }, actor, scope, [{ ...terminals[0], program: { agent: false } }]), null);
});

test("only an actual successful structured result is accepted", () => {
  assert.deepEqual(parseReply({ code: 0, stdout: '{"channels":[]}' }, "channels"), { channels: [] });
  assert.throws(() => parseReply({ code: 1, stdout: '{"reason":"channel_not_found"}' }, "read"), /channel_not_found/);
  assert.throws(() => parseReply({ code: 0, stdout: "unstructured" }, "read"), /failed/);
});

test("local attention markers use Board revisions, not message copies", () => {
  const summary = threadSummary({ message: root, replies: [reply] });
  assert.equal(isUnread(prefs, summary), true);
  const seen = readMarker(prefs, summary);
  assert.equal(isUnread(seen, summary), false);
  assert.equal(isUnread(seen, { ...summary, last: { ...reply, version: 3 } }), true);
  assert.equal(seen.seen.msg_1, signature(summary));
  const following = toggleFollow(seen, root);
  assert.deepEqual(following.followed, [{ id: "msg_1", channel: "dev" }]);
  assert.deepEqual(toggleFollow(following, root).followed, []);
});

test("Windows CLI invocation preserves arbitrary composer text as one literal argument", () => {
  const transport = { command: "node.exe", prefix: ["C:/Program Files/vercel/dist/index.js"] };
  const text = '--flag & | ^ %PATH% !X! "quoted" \n第二行';
  const intent = createSend(scope, { kind: "thread", id: "msg_1" }, text, "same-key");
  const invocation = boardInvocation(transport, sendArgs(intent));
  assert.equal(invocation.command, "node.exe");
  assert.deepEqual(invocation.args, [transport.prefix[0], ...sendArgs(intent)]);
  assert.equal(invocation.args.at(-1), text);
  assert.deepEqual(boardInvocation(transport, argv("whoami", { board: scope.board })).args,
    [transport.prefix[0], ...argv("whoami", { board: scope.board })]);
});
