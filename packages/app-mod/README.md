# HBoard native Herdr App Mod — P2 candidate

This is a separate Herdr layout and native Mod, not a browser app. It uses the user's existing Vercel CLI human login and the P1 Core binding contract. It does not modify Herdr's shipped layout, deliver messages to OMP, run a server, or store a copy of Board chat. Board remains authoritative for threads and messages.

## Reuse of the real-host spike

The [real Herdr acceptance at `b2203fe`](https://github.com/Doeye1997/HBoard/pull/3#issuecomment-7125555758) proved native Mod loading/rendering, official Board reads through `vercel.cmd` and Core `doc.get`/`agent.focus`. It was a single-channel read-only spike; it did not verify this complete Mod. Its source remains in Git history, not in the install tree. This package is the sole App Mod implementation.

The complete Mod resolves the installed official CLI from the Windows shim's adjacent npm package manifest and executes its declared JS bin through `node.exe`, not `cmd.exe`. This keeps one read/write path and literal argv (including arbitrary Composer text). A nonstandard install can specify the absolute official package manifest as `content.props.vercelPackage` on the `hboard-discussions` block of the personal layout. Resolution refuses an unknown installation rather than trying an unrelated executable. This new resolver still needs targeted Windows acceptance. The binding lookup remains a short-lived read-only Core request, now validated against the actor ID, Board, session binding and live terminal on every click.

## P3.1a candidate — General-first and native terminal on demand

Connect reads the exact existing `general` channel (even when the initial directory page does not list it). If it cannot be read, the real reason is visible and Composer is disabled for that unverified route; choose another existing channel. HBoard never creates General implicitly. General is the primary navigation item and is not duplicated in Channels. The installed personal layout now starts with its actual `hboard-terminal` node hidden. Opening a verified live Actor binding shows the native node and invokes `agent.focus`; Hide terminal hides only that layout node, not the agent or the current discussion/draft. The #7 candidate separates the main feed and selected Thread. Wide Mod viewports keep General on screen and open the discussion beside it. Opening a native terminal temporarily replaces that detail view; hiding the terminal returns to the selected discussion. A narrower viewport uses a full-width reading surface and, when necessary, an explicit Menu. Feed and Thread have independent reads and scroll handles, and drafts are scoped to the actual channel or root message (not to a pagination cursor). Native theme colors are retained; the composition follows the approved Devin direction, but actual rendered fidelity is still unverified. The candidate now also reads native attachment metadata, lets a human select a folder for the official exclusive download, renders safe Markdown through Herdr TextView in the detail view (raw HTML/image markup remains plain text), and performs explicit Board reactions with canonical readback. Native task state, owner/assignee/holder, reason/result, dependency count and labels are read from the root; no claim token or local state transition is exposed. Attachment upload, Task/Label mutation and filtering, and live events are not complete. Keep the existing scoped OMP consumer; changing its channel to General requires v1 stop/reconfigure/checkpoint rules, not automatic migration.

## What is implemented

- Connect using the existing CLI login or a canonical Board HTTPS URL, verify human identity, pin the endpoint, list channels and actors; paginate channels and channel discussions.
- Read real discussion roots and replies, post new discussions, reply to the root **message ID**, insert explicit Board handles in the composer. Writes are user-initiated; a failed/uncertain send preserves the same in-memory intent/idempotency key for explicit retry, never silently retries or changes destinations. On layout close/restart, check the Board before sending an uncertain operation again.
- A recent-mentions Inbox queries each loaded channel with `read <channel> --mentions me --limit 30`. If that board has no mention index, it instead reads the latest 30 thread roots of each loaded channel and keeps roots that mention the human handle or actor. It does not read every channel when the directory has another page, and it does not search reply bodies in the fallback. Unread marks and followed-thread pointers are local presentation preferences scoped to Board and human Actor. Followed pointers open the current Board thread. This is not a full durable notification queue or a complete mention history.
- Actor Open reads the P1 profile document via a short-lived, read-only `hc connect` adapter, checks exact Board/Actor/profile/session scope and a live native agent terminal, then calls `agent.focus`. The right pane is Herdr's native focused-agent terminal. A claim can remain after forced process exit; its address/status is not proof that the original OMP Session is live. Never auto-launch or take over an agent.
- Refresh current views every 15 seconds; no overlapping refresh of the same view, no background daemon. Older pages stay still. Sync directory refreshes actor/channel metadata; return to the Herdr main layout to close this view.

Resolve/reopen, complete followed-thread activity and cross-device attention synchronization are intentionally not implemented in this candidate. Do not confuse discussion state with Board task state. Attachments are counted, not uploaded/downloaded by the Mod.

## Install on the target Herdr host (Windows)

Requires the P0/P1 pinned Herdr App/Core and Vercel CLI, Node on PATH, and `hc.exe connect` available in the App environment. The App Mod uses the native `exec` API; make sure `node.exe` and `vercel.cmd` are on the desktop App's PATH, not only an interactive OMP shell (or set `vercelPackage` as above). The Board endpoint may include `teamId`; enter it when the App's home-directory CLI context has no default board. A human principal is required: unset `BOARD_PROFILE` in the App environment if it selects an agent profile. No tokens are entered or stored in HBoard.

From the HBoard checkout root, with a **new** HBoard mod/layout destination (for the existing spike installation, first back up its Mod directory and personal layout outside Herdr's `mods/` and `layouts/` directories; remove only those HBoard-specific files before installing):

```powershell
$root = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config/herdr-app' }
$mod = Join-Path $root 'mods/hboard'
$layout = Join-Path $root 'layouts/hboard.json'
if ((Test-Path $mod) -or (Test-Path $layout)) { throw 'HBoard already exists; review the existing files before replacing them.' }
New-Item -ItemType Directory -Force (Join-Path $root 'mods'), (Join-Path $root 'layouts') | Out-Null
Copy-Item -Recurse packages/app-mod/mods/hboard $mod
Copy-Item packages/app-mod/layouts/hboard.json $layout
herdr-app check $mod
# Only after check succeeds, select the new layout:
herdr-app do layout.switch --name hboard
```

Switch to `main` using the Herdr button or native layout picker. The installation does not modify shipped files. For updates review/replace only this Mod directory and the personal HBoard layout (back it up first), then rerun the check. The P3.1a initial hidden terminal behavior requires the updated layout as well as the Mod; do not overwrite a different personal layout.

## Acceptance

```sh
node --test packages/app-mod/board.test.mjs packages/app-mod/transport.test.cjs
node --check packages/app-mod/mods/hboard/main.js
node --check packages/app-mod/mods/hboard/read-binding.cjs
node --check packages/app-mod/mods/hboard/resolve-vercel.cjs
```

These tests cover HBoard's own CLI argument/identity/scope, installed Windows CLI entry resolution, literal argv composition, canonical receipt parsing, binding eligibility and local attention preferences. They are not UI acceptance. Use `herdr-app check` and the live App on the real Windows host before merge. Do not repeat P0/P1 or upstream capability matrices.

Reuse the native-render/read/focus evidence from the spike. On the complete Mod, verify the resolved CLI can connect in the real Windows App, select a channel, open a real thread, post/reply through the native composer (include a quote, line break, and literal `%PATH%` in test text), mention a test profile, and observe its Board reply via refresh. Select that actor: the expected native terminal is shown, without injecting a message from the Mod. Confirm a different Board/actor or stopped/missing binding cannot be used for focus. Check the mention Inbox and follow/read controls; navigate while reads are in flight, and confirm stale results do not replace the active view. Capture `herdr-app shot` and actual Board result evidence on the candidate SHA; inspect `herdr-app status` for deferred-render errors. Record any remaining visual issues. The upstream `herdr-app check` only loads/renders once; a real window and actual interactions are required.

P2 development is stacked on P1 PR #3; #2 is historical. P1's last targeted live acceptance remains independent. Never merge the P0 prototype alone.

### P3.1a targeted host acceptance

Install both candidate Mod and layout. Connect to a Board with an existing General (also test a Board or configuration in which General cannot be read, without creating a channel). Confirm General opens by default; the missing/forbidden channel shows a reason and cannot be composed to. Select an existing channel and confirm its Composer and Thread still work. In General, open an active, scope-matching Agent binding: native terminal appears, then Hide terminal removes only the view, while the agent, Board reading route and draft remain. Test a missing/stopped binding; it must not open a terminal. Run the existing checks and record the exact candidate SHA, real host and visible UI/Board results; do not repeat P0/P1/P2 upstream matrices. The branch is not accepted until this host check is recorded.

### P3.1b targeted host acceptance

On the updated personal layout, inspect General at a 1440×900 window and at a narrow width. Scroll to a discussion, open it beside General, switch quickly to a second root, and confirm the first root cannot replace it. Type different channel and thread drafts; open a verified native Agent terminal, return to the discussion, then close it. Check that General stays on its prior page/reading position, drafts keep their original target, and the Composer is not silently retargeted. When a send is unconfirmed, changing the destination must be blocked until it is reconciled. Exercise the actual Thread reply and local Follow/Mark read, and the narrow Menu/Back controls. Confirm herdr-app status has no errors. Reuse #6 evidence; no separate renderer or terminal emulator.

### Native evidence/feedback candidate checks

Open a thread with ordinary Markdown, a safe HTTP(S) link, an attachment and a reaction. Verify Markdown is native text and HTML/image syntax is plain (no automatic image request). Choose an actual folder with Save; the official CLI download gets an attachment ID and no filename, so the upstream exclusive-create rule remains in force. Existing files must not be overwritten. Add/remove a reaction as the human and compare the authoritative thread readback. Verify a real task root renders its actual state/reason/result and project/kind labels; if task details are absent, show unavailable, never infer a local state. Attachment upload remains available through the official Board skill/CLI until its UI send/retry contract is resolved. Task writes remain pending actual installed hosted capability verification.
