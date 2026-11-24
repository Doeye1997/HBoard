# P0 — Native Mention intake

## Result

Normal-path integration reported successful by the local operator on 2026-11-23. Prototype baseline: [39e3889](https://github.com/Doeye1997/HBoard/commit/39e38896f38051af93e5f4b7690de780fe9a35fd). This report preserves the supplied observations; it does not claim independent access to the private session files or Board logs.

| Step | Reported observation |
| --- | --- |
| Human → A | A real Board message explicitly mentioned test profile A. |
| A intake | The running OMP session received a native follow-up and persisted one `sh.doe.hboard.mention` custom record. |
| A → B | A replied with the official Board CLI in the same thread and mentioned B. |
| B intake/reply | B persisted one custom record and replied in the same thread. |
| Terminal association | Each actor binding mapped to its actual Herdr terminal. The official `herdr-app do agent.focus --terminal <terminal>` command selected A's space and tab. |

App Mod was not implemented. The focus command, not an actor click in a Mod, supplied the terminal-navigation evidence. Private Board IDs, full session transcripts, credentials and intake logs are intentionally omitted from the evidence file.

## Integration findings

- CLI 66.6.0: use the complete `@person/profile` handle for `--mentions`.
- CLI reply takes a **message ID**, not a thread ID.
- OMP's native `followUp` path works for the observed normal round trip.
- Persisted custom-message records provide a candidate checkpoint and deduplication evidence. Do not equate enqueue success or in-memory session entries with durable receipt.
- Core documents hold actor bindings, not chat content.

Versions and upstream source revisions are recorded in [SPEC](../SPEC.md#11-what-is-already-settled).

## Remaining work

The committed prototype is a spike, not production code. Review identified these HBoard-owned gaps:

1. The prototype polls for a session record for only 30 seconds; after timeout it starts another Board wait and can overwrite the in-flight message identity. Hold one intake until durable receipt or explicit stop.
2. `getBranch()` alone is not evidence of a disk write. Establish the exact OMP persistence contract and observe the intended persisted branch.
3. A fresh wait without `--after` starts at the current head. Capture a stable initial baseline and define crash-before-first-record recovery; never silently rebase a resumed consumer.
4. A second process with the same session ID can pass the existing binding check. Claim exclusivity must cover process instances, and takeover requires evidence of old-consumer termination.
5. Stop the watcher on shutdown or session changes; check binding before intake. Do not treat a generation read as a fence for a running consumer.
6. Handle non-post events and malformed responses without injecting them or skipping an unpersisted addressed event. Use the upstream event contract.
7. Remove hard-coded machine paths and test-specific reply instructions from the installable extension.

No new message server, queue, ledger, outbox, scheduler or Board tool wrapper. Trust the upstream contracts. P1 needs only targeted tests of these new integration boundaries and an actual productionized normal-path round trip.
