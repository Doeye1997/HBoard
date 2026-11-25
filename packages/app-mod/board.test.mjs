import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBoard, humanScope, sameHuman, argv, boardInvocation, generalRoute, isGeneral, canComposeRoute, terminalPane, threadRoute, draftKey, workspacePanes, readArgs, inboxMentionArgs, inboxPageArgs, mentionsHuman, inboxCoverage, dedupeThreads, createSend, sendArgs, parseReply, actorProfile, bindingTarget, signature, threadSummary, readMarker, isUnread, toggleFollow, safeMarkdown, reactionsFor, attachmentRows, messageInThread, reactionArgs, downloadArgs, nativeTask, visibleLabels, channelPermission, taskListArgs, taskAction } from "./mods/hboard/board.js";
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

test("General reads the exact native channel without a directory dependency or write", () => {
  const route = generalRoute();
  assert.equal(isGeneral(route), true);
  assert.equal(isGeneral({ kind: "channel", channel: "general/archive" }), false);
  assert.deepEqual(argv("read", { board: scope.board, ...readArgs(route) }),
    ["board", "read", "--url", scope.board, "--json", "--limit", "30", "--", "general"]);
  assert.equal(canComposeRoute(scope, route, null, ""), false);
  assert.equal(canComposeRoute(scope, route, { threads: [] }, ""), true);
  assert.equal(canComposeRoute(scope, route, { threads: [] }, "channel_not_found"), false);
  assert.equal(canComposeRoute(null, route, { threads: [] }, ""), false);
  assert.equal(canComposeRoute(scope, { kind: "thread", id: "msg_1" }, { message: root }, ""), true);
  assert.equal(canComposeRoute(scope, { kind: "thread", id: "msg_2" }, { message: root }, ""), false);
  assert.equal(canComposeRoute(scope, { kind: "thread", id: "msg_1" }, { message: { ...root, deleted: true } }, ""), false);
});

test("official stderr reason survives, without exposing raw diagnostics", () => {
  assert.throws(() => parseReply({ code: 1, stdout: "", stderr: '{"reason":"channel_not_found","message":"secret text"}' }, "read"),
    /^Error: Board read failed: channel_not_found \(exit 1\)$/);
  assert.throws(() => parseReply({ code: 1, stdout: "", stderr: "secret text" }, "read"),
    /^Error: Board read failed \(exit 1\)$/);
  assert.throws(() => parseReply({ code: 0, stdout: "[]" }, "read"), /invalid JSON result/);
});

test("terminal visibility comes from the actual native layout, including nested nodes", () => {
  const hidden = { id: "hboard-terminal", hidden: true, children: [] };
  const tree = { id: "root", children: [{ id: "body", children: [hidden] }] };
  assert.equal(terminalPane(tree), hidden);
  assert.equal(terminalPane(tree).hidden, true);
  assert.equal(terminalPane({ id: "root", children: [] }), null);
  assert.equal(terminalPane(null), null);
});

test("thread selection and paging keep distinct composer destinations", () => {
  const general = generalRoute();
  const detail = threadRoute({ id: "msg_1", channel: "general" });
  assert.deepEqual(detail, { kind: "thread", id: "msg_1", channel: "general" });
  assert.equal(draftKey(general), draftKey({ ...general, before: "older" }));
  assert.notEqual(draftKey(general), draftKey(detail));
  assert.notEqual(draftKey(detail), draftKey({ ...detail, id: "msg_2" }));
  assert.equal(draftKey({ kind: "inbox" }), null);
  assert.throws(() => threadRoute({ id: "-bad", channel: "general" }), /Invalid thread/);
});

test("General stays in a wide workspace and native terminal replaces only the detail", () => {
  assert.deepEqual(workspacePanes(1440, true, false, false),
    { compact: false, split: true, showNav: true, showFeed: true, showThread: true });
  assert.deepEqual(workspacePanes(1000, true, true, false),
    { compact: false, split: false, showNav: true, showFeed: true, showThread: false });
  assert.deepEqual(workspacePanes(850, true, false, false),
    { compact: false, split: false, showNav: true, showFeed: false, showThread: true });
  assert.deepEqual(workspacePanes(620, true, false, true),
    { compact: true, split: false, showNav: true, showFeed: false, showThread: false });
  assert.deepEqual(workspacePanes(620, false, true, false),
    { compact: true, split: false, showNav: false, showFeed: true, showThread: false });
});

test("native Markdown accepts prose and links but never hands embedded HTML or images to the renderer", () => {
  assert.equal(safeMarkdown("# Report\n- done\n[PR](https://github.com/example/repo/pull/1)"), true);
  assert.equal(safeMarkdown("![tracking](https://example.com/pixel)"), false);
  assert.equal(safeMarkdown("![image][ref]\n[ref]: https://example.com/pixel"), false);
  assert.equal(safeMarkdown("<img src='https://example.com/pixel'>"), false);
});

test("native reaction identity is canonical and remove targets only the selected message", () => {
  const m = { id: "msg_1", reactions: { thumbs_up: ["person", "other", "other"], eyes: ["other"] } };
  assert.deepEqual(reactionsFor(m, "person", false)[0], { name: "thumbs_up", title: "👍", actors: ["person", "other"], count: 2, own: true });
  assert.equal(reactionsFor(m, "person", true).find(r => r.name === "check").count, 0);
  assert.deepEqual(reactionArgs(scope, m, "thumbs_up", true), ["board", "react", "--url", scope.board, "--json", "--remove", "--", "msg_1", "thumbs_up"]);
  assert.equal(messageInThread({message: m, replies: [{id:"msg_2"}]}, "msg_2").id, "msg_2");
  assert.equal(reactionsFor({...m, deleted:true}, "person", true).length, 0);
  assert.throws(() => reactionArgs(scope, m, "--danger", false), /unavailable/);
});

test("attachment download has no explicit overwrite path and only uses an actual attachment ID", () => {
  const attachment = { id: "att_12345678-1234-1234-1234-123456789012", name: "../evidence.txt", type: "text/plain", size: 5 };
  const m = { id: "msg_1", attachments: [attachment, { id: "wrong/path", name: "bad", type: "x", size: 1 }] };
  assert.deepEqual(attachmentRows(m), [attachment]);
  assert.deepEqual(downloadArgs(scope, m, attachment.id), ["board", "download", "--url", scope.board, "--json", "--", attachment.id]);
  assert.throws(() => downloadArgs(scope, m, "wrong/path"), /unavailable/);
});

test("task and labels are read projections, not a local task state machine", () => {
  const m = { labels: { "board.task": "claimed", project: "JSON", kind: "review", custom: "x" }, task: {
    state: "claimed", owner: "person", for: "person+worker",
    claim: { actor: "person+worker", until: "2020-01-01", token: "secret" }, needs: ["msg_0"], blocked: null, result: null, reason: null
  }};
  const t = nativeTask(m);
  assert.equal(t.state, "claimed");
  assert.equal(t.holder, "person+worker");
  assert.equal(JSON.stringify(t).includes("secret"), false);
  assert.deepEqual(t.needs, ["msg_0"]);
  assert.deepEqual(nativeTask({labels:{"board.task":"ready"}}), { unavailable:true });
  assert.equal(nativeTask({ labels: { kind: "task" } }), null);
  assert.deepEqual(visibleLabels(m, true), [["project","JSON"],["kind","review"]]);
  assert.deepEqual(visibleLabels(m, false), [["project","JSON"],["kind","review"],["custom","x"]]);
});

test("Task create uses native idempotency and channel capability check", () => {
  const intent = createSend(scope, generalRoute(), "ship it", "task-key", "task");
  assert.deepEqual(sendArgs(intent), ["board","tasks","--url",scope.board,"--json","--idempotency-key","task-key","--","create","general","ship it"]);
  assert.throws(() => createSend(scope,{kind:"thread",id:"msg_1"},"task","k","task"),/Open a channel/);
  assert.deepEqual(taskListArgs("general"),{flags:["--state","all","--limit","1"],args:["general"]});
  assert.throws(() => taskListArgs("create"),/conflicts/);
});

test("Task controls respect observed owner and permission hints", () => {
  const me={principal:"person",can:{"*":["label","post"],"private/":[]}};
  const root={id:"msg_1",channel:"general",task:{owner:"person",state:"blocked"}};
  assert.equal(channelPermission(me,"private/x","label"),false);
  assert.deepEqual(taskAction(scope,me,root,"unblock").args,["board","tasks","--url",scope.board,"--json","--","unblock","msg_1"]);
  assert.throws(() => taskAction(scope,{...me,principal:"other"},root,"unblock"),/unavailable/);
  assert.equal(taskAction(scope,me,{id:"msg_1",channel:"general"},"convert").outcome,"created");
  assert.throws(() => taskAction(scope,me,root,"reopen"),/unavailable/);
});
