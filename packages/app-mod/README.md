# HBoard native Herdr App Mod — P2 candidate

This is a separate Herdr layout and native Mod, not a browser app. It uses the user's existing Vercel CLI human login and the P1 Core binding contract. It does not modify Herdr's shipped layout, deliver messages to OMP, run a server, or store a copy of Board chat. Board remains authoritative for threads and messages.

## What is implemented

- Connect using the existing CLI login or a canonical Board HTTPS URL, verify human identity, pin the endpoint, list channels and actors; paginate channels and channel discussions.
- Read real discussion roots and replies, post new discussions, reply to the root **message ID**, insert explicit Board handles in the composer. Writes are user-initiated; a failed/uncertain send preserves the same in-memory intent/idempotency key for explicit retry, never silently retries or changes destinations. On layout close/restart, check the Board before sending an uncertain operation again.
- A recent-mentions Inbox uses Board's native human `--mentions me` thread query. Unread marks and followed-thread pointers are local presentation preferences scoped to Board and human Actor. Followed pointers open the current Board thread. This is not a full durable notification queue or aggregate follow-activity feed; no completeness claim for older mention history.
- Actor Open reads the P1 profile document via a short-lived, read-only `hc connect` adapter, checks exact Board/Actor/profile/session scope and a live native agent terminal, then calls `agent.focus`. The right pane is Herdr's native focused-agent terminal. A claim can remain after forced process exit; its address/status is not proof that the original OMP Session is live. Never auto-launch or take over an agent.
- Refresh current views every 15 seconds; no overlapping refresh of the same view, no background daemon. Older pages stay still. Sync directory refreshes actor/channel metadata; return to the Herdr main layout to close this view.

Resolve/reopen, complete followed-thread activity and cross-device attention synchronization are intentionally not implemented in this candidate. Do not confuse discussion state with Board task state. Attachments are counted, not uploaded/downloaded by the Mod.

## Install on the target Herdr host (Windows)

Requires the P0/P1 pinned Herdr App/Core and Vercel CLI, Node on PATH, and `hc.exe connect` available in the App environment. The App Mod uses the native `exec` API; make sure `vercel` is available to the desktop app, not only an interactive OMP shell. The Board endpoint may include `teamId`; enter it when the App's home-directory CLI context has no default board. A human principal is required: unset `BOARD_PROFILE` in the App environment if it selects an agent profile. No tokens are entered or stored in HBoard.

From the HBoard checkout root, with a **new** HBoard mod/layout destination:

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

Switch to `main` using the Herdr button or native layout picker. The installation does not modify shipped files. For updates review/replace only this Mod directory and layout, then rerun the check.

## Acceptance

```sh
node --test packages/app-mod/board.test.mjs
node --check packages/app-mod/mods/hboard/main.js
node --check packages/app-mod/mods/hboard/read-binding.cjs
```

These tests cover HBoard's own CLI argument/identity/scope, canonical receipt parsing, binding eligibility and local attention preferences. They are not UI acceptance. Use `herdr-app check` and the live App on the real Windows host before merge. Do not repeat P0/P1 or upstream capability matrices.

Use an existing test channel and stopped/cleared P1 test bindings. Open HBoard, connect, select a channel, open a real thread, post/reply through the native composer, mention a test profile, and observe its Board reply via refresh. Select that actor: the expected native terminal is shown, without injecting a message from the Mod. Confirm a different Board/actor or stopped/missing binding cannot be used for focus. Check the mention Inbox and follow/read controls; navigate while reads are in flight, and confirm stale results do not replace the active view. Capture `herdr-app shot` and actual Board result evidence on the candidate SHA; inspect `herdr-app status` for deferred-render errors. Record any remaining visual issues. The upstream `herdr-app check` only loads/renders once; a real window and actual interactions are required.

P2 development is stacked on P1 PR #3; #2 is historical. P1's last targeted live acceptance remains independent. Never merge the P0 prototype alone.
