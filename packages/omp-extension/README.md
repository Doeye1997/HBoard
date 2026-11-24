# HBoard — native OMP intake (P1 candidate)

HBoard adds no message server, queue, scheduler or outbound Board tools. The extension uses the existing OMP process, its native follow-up queue and Session JSONL, plus one versioned Core binding document per configured profile. The App Mod is future P2 work.

## Before installing

- Use the P0-pinned Herdr Core, OMP and Vercel CLI versions in [SPEC](../../SPEC.md). Keep the official Board skill available to the agent.
- Start OMP in a real Herdr terminal with `HC_TERMINAL_ID`. The Core API must be reachable through `hc.exe connect`.
- Use an existing dedicated test channel and two test profiles with confirmed stopped/cleared bindings for acceptance. Do not silently attach a P0 session or replace its active binding. The earlier prototype is preserved at `39e3889`.

## Start in each Herdr terminal

From the P1 worktree, configure the real Board principal/profile and channel. Use your normal OMP launch options; do not disable the official Board skill.

```powershell
$env:HBOARD_AS = "hboard-a-p1"
$env:HBOARD_MENTION = "@<person>/hboard-a-p1"
$env:HBOARD_CHANNEL = "hboard-p1"
# Optional: select the canonical Board endpoint explicitly.
# $env:HBOARD_BOARD_URL = "https://<board-endpoint>"
omp --extension (Join-Path (Get-Location) "packages/omp-extension/intake.js")
```

Repeat for profile B in its own Herdr terminal. Set the complete expected mention handle for startup identity verification, not the actor ID or bare profile. The extension checks Board identity via `whoami`, pins the discovered Board URL, obtains an exclusive Core binding, and persists a scoped initial cursor in the OMP session before waiting with native `--mentions me --as <profile> --url <board-url>`. It does not interpret mention text locally.

Use the normal Board CLI/skill to post a message mentioning A. Ask A to reply to the incoming message ID and explicitly mention B. For reads and replies use the explicit `--as` and `--url` from the injected reply argv; do not rely on the ambient Board default. B replies in the same conversation. Use the corresponding Core binding's terminal ID to focus the real terminal through the official Herdr App command. Do not mistake the focus command for an implemented App Mod.

## Session and ownership

An active binding, including one with the same OMP session ID, cannot be reclaimed by a second process. Graceful stop releases the claim only when no native submission remains unconfirmed. The same scoped session can resume a stopped claim. A fresh or incompatible session cannot automatically reuse it.

For an abnormal stop, or deliberate replacement of an existing session:

1. Inspect the binding with the official Core `doc.get` API and confirm the old consumer process has actually stopped. Terminal address alone is not process identity.
2. Review the session's persisted HBoard entries and Board replies. No receipt does not prove absence of agent side effects; decide whether replay is safe.
3. Only after that reconciliation, use the official `doc.set` API with the current document version to set its value to null. Never clear a live binding.
4. Resume the original scoped session to use its durable checkpoint, or start a new explicitly configured session which anchors at the current Board cursor. Do not mix the two.

HBoard stops before intentional session/branch changes when safe; an unconfirmed native submission prevents those changes. It does not inject another copy or invent a delivery timeout. The P1 candidate deliberately refuses legacy unscoped P0 session markers; use a new test session, not migration guesses.

## Verification

```sh
node --test packages/omp-extension/intake.test.mjs
```

The [P1 live A→B and 9 native tests at `8f08b77`](https://github.com/Doeye1997/HBoard/pull/3#issuecomment-7124045668) remain evidence for the unchanged Session checkpoint and ownership path. The closeout candidate has 11 native Node tests, including the observed case-sensitive parser failure, exact wait argv and scoped reply guidance. Only the changed integration still needs a targeted live check in the target Herdr host: use two test actors with the new extension; send a case-varied mention addressed to A only, confirm the authenticated profile's native `me` filter reaches A and not B, then confirm A's official CLI reply uses the pinned URL, profile and message ID and appears in the same Board thread. No full repeat of P0/P1 or upstream capability matrix is needed.

Keep raw transcripts, local paths, credentials and private Board data out of Git.
