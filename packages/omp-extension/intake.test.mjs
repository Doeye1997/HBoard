import test from "node:test";
import assert from "node:assert/strict";
import { MENTION, START, checkpoint, addressed, mayClaim, consume } from "./intake.js";

const scope = { board: "https://example.test/", actor: "a", profile: "p", channel: "test", sessionId: "s" };
const anchor = { id: "base", type: "custom", customType: START, data: { scope, cursor: "head" } };
const receipt = (messageId, cursor) => ({
  id: "entry-" + messageId, type: "custom_message", customType: MENTION,
  details: { scope, messageId, cursor },
});
const posted = (id, cursor, actor = "b", text = "@[a] hello") => ({
  event: { type: "message.posted", cursor, message: { id, by: { actor }, text } },
});
const cp0 = checkpoint([anchor], [anchor], scope);
const row = receipt("m1", "c1");
const cp1 = checkpoint([anchor, row], [anchor, row], scope);

test("checkpoint uses last scoped receipt; empty session has no baseline", () => {
  assert.equal(checkpoint([], [], scope), null);
  assert.equal(cp0.cursor, "head");
  assert.equal(cp1.cursor, "c1");
  assert.ok(cp1.seen.has("m1"));
});

test("rewind, scope change, and legacy unscoped receipt fail closed", () => {
  assert.throws(() => checkpoint([anchor, row], [anchor], scope), /active branch/);
  assert.throws(() => checkpoint([anchor], [anchor], { ...scope, channel: "other" }), /scope mismatch/);
  assert.throws(() => checkpoint([row], [row], scope), /initial checkpoint/);
  const duplicate = { ...row, id: "other" };
  assert.throws(() => checkpoint([anchor, row, duplicate], [anchor, row, duplicate], scope), /Duplicate/);
});

test("only new explicitly addressed posts from other actors are eligible", () => {
  assert.equal(addressed(posted("m", "c").event, "a").message.id, "m");
  assert.equal(addressed(posted("m", "c", "a").event, "a").message, null);
  assert.equal(addressed(posted("m", "c", "b", "@[other] hi").event, "a").message, null);
  assert.equal(addressed({ ...posted("m", "c").event, type: "message.edited" }, "a").message, null);
  assert.equal(addressed({ type: "reaction.added", cursor: "r" }, "a").message, null);
  assert.throws(() => addressed({ type: "message.posted", cursor: "c" }, "a"), /message ID/);
});

test("binding cannot be reclaimed by another live process, even in the same session", () => {
  assert.equal(mayClaim(null, scope), true);
  assert.equal(mayClaim({ state: "active", scope }, scope), false);
  assert.equal(mayClaim({ state: "stopped", scope }, scope), true);
  assert.equal(mayClaim({ state: "stopped", scope }, { ...scope, sessionId: "new" }), false);
  assert.equal(mayClaim({ profile: "p", sessionId: "s" }, scope), false);
});

function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

test("one in-flight message; next wait only follows the confirmed durable cursor", async () => {
  let cp = cp0;
  const submitted = gate(), persisted = gate();
  const waits = [], states = [], submissions = [];
  const signal = { stopped: false, throwIfAborted() { if (this.stopped) throw Error("stop"); } };
  const task = consume({
    signal, actor: "a", initial: cp0, readCheckpoint: () => cp,
    assertOwned: async () => {},
    wait: async cursor => {
      waits.push(cursor);
      if (waits.length === 1) return posted("m1", "c1");
      signal.stopped = true;
      return posted("m2", "c2");
    },
    submit: (message, cursor) => { submissions.push([message.id, cursor]); submitted.open(); },
    confirm: async () => { await persisted.promise; cp = cp1; return cp1; },
    setInflight: value => states.push(value),
  });
  await submitted.promise;
  assert.deepEqual(waits, ["head"]);
  assert.deepEqual(states, [true]);
  persisted.open();
  await assert.rejects(task, /stop/);
  assert.deepEqual(waits, ["head", "c1"]);
  assert.deepEqual(submissions, [["m1", "c1"]]);
  assert.deepEqual(states, [true, false]);
});

test("uncertain receipt stops intake and retains in-flight ownership", async () => {
  let waits = 0;
  const states = [];
  await assert.rejects(consume({
    signal: { throwIfAborted() {} }, actor: "a", initial: cp0,
    readCheckpoint: () => cp0, assertOwned: async () => {},
    wait: async () => { waits++; return posted("m1", "c1"); },
    submit: () => {}, confirm: async () => { throw Error("disk uncertain"); },
    setInflight: value => states.push(value),
  }), /disk uncertain/);
  assert.equal(waits, 1);
  assert.deepEqual(states, [true]);
});

test("loss of ownership between wait and submit never injects a message", async () => {
  let checks = 0, submitted = false;
  await assert.rejects(consume({
    signal: { throwIfAborted() {} }, actor: "a", initial: cp0,
    readCheckpoint: () => cp0,
    assertOwned: async () => { if (++checks === 2) throw Error("binding lost"); },
    wait: async () => posted("m1", "c1"),
    submit: () => { submitted = true; }, confirm: async () => cp1, setInflight: () => {},
  }), /binding lost/);
  assert.equal(submitted, false);
});

test("non-delivery events and timeout never skip an unconfirmed addressed post", async () => {
  const events = [
    { event: { type: "reaction.added", cursor: "reaction" } },
    posted("m1", "duplicate"),
    null,
    posted("m2", "c2"),
  ];
  const waits = [], submissions = [];
  await assert.rejects(consume({
    signal: { throwIfAborted() {} }, actor: "a", initial: cp1,
    readCheckpoint: () => cp1, assertOwned: async () => {},
    wait: async cursor => { waits.push(cursor); return events.shift(); },
    submit: message => submissions.push(message.id),
    confirm: async () => { throw Error("stop at receipt"); },
    setInflight: () => {},
  }), /stop at receipt/);
  assert.deepEqual(waits, ["c1", "reaction", "duplicate", "duplicate"]);
  assert.deepEqual(submissions, ["m2"]);
});
