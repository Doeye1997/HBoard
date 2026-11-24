# HBoard native Herdr App Mod — P2 candidate

This is a separate Herdr layout and native Mod, not a browser app. It uses the user's existing Vercel CLI human login and the P1 Core binding contract. It does not modify Herdr's shipped layout, deliver messages to OMP, run a server, or store a copy of Board chat. Board remains authoritative for threads and messages.

## Reuse of the real-host spike

The [real Herdr acceptance at `b2203fe`](https://github.com/Doeye1997/HBoard/pull/3#issuecomment-7125555758) proved native Mod loading/rendering, official Board reads through `vercel.cmd` and Core `doc.get`/`agent.focus`. It was a single-channel read-only spike; it did not verify this complete Mod. Its source remains in Git history, not in the install tree. This package is the sole App Mod implementation.

The complete Mod resolves the installed official CLI from the Windows shim's adjacent npm package manifest and executes its declared JS bin through `node.exe`, not `cmd.exe`. This keeps one read/write path and literal argv (including arbitrary Composer text). A nonstandard install can specify the absolute official package manifest as `content.props.vercelPackage` on the `hboard-discussions` block of the personal layout. Resolution refuses an unknown installation rather than trying an unrelated executable. This new resolver still needs targeted Windows acceptance. The binding lookup remains a short-lived read-only Core request, now validated against the actor ID, Board, session binding and live terminal on every click.

## What is implemented

- Connect using the existing CLI login or a canonical Board HTTPS URL, verify human identity, pin the endpoint, list channels and actors; paginate channels and channel discussions.
- Read real discussion roots and replies, post new discussions, reply to the root **message ID**, insert explicit Board handles in the composer. Writes are user-initiated; a failed/uncertain send preserves the same in-memory intent/idempotency key for explicit retry, never silently retries or changes destinations. On layout close/restart, check the Board before sending an uncertain operation again.
- A recent-mentions Inbox uses Board's native human `--mentions me` thread query. Unread marks and followed-thread pointers are local presentation preferences scoped to Board and human Actor. Followed pointers open the current Board thread. This is not a full durable notification queue or aggregate follow-activity feed; no completeness claim for older mention history.
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

Switch to `main` using the Herdr button or native layout picker. The installation does not modify shipped files. For updates review/replace only this Mod directory and layout, then rerun the check.

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
