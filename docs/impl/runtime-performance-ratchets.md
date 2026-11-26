# Runtime Sync File I/O and Client Polling Ratchets

## Scope

The approved Dashboard deployment source is pinned to fork tag `v0.1.0-mvp.3` at commit `9cd7142f4d0cdb65f7a475a91f981e6a15ca1431`. That revision fails two ratchets—`main-sync-fs-ratchet` and `recurring-timer-ratchet`—across 7 files.

Fork `main` commit [32c9634f1f77e871d5100a8faf910cb397b6238d](https://github.com/lurunzi/orca/commit/32c9634f1f77e871d5100a8faf910cb397b6238d) addresses both ratchets. The frozen deployment tag does not yet include that commit, and whether to adopt those changes in a future deployment batch remains pending confirmation.

These ratchets count call sites in source files and compare them against per-file baselines. Call-site counts do not measure runtime call frequency, latency, or failure probability. The current failure means the implementation is out of alignment with the baseline; actual performance impact still depends on call frequency, image sizes, and storage speed.

## Reproduction and Verification Results

After installing dependencies at the fork root of the target revision, run:

```powershell
pnpm check:main-sync-fs-ratchet
pnpm check:recurring-timer-ratchet
```

Verification environment: Windows, Node.js `v24.19.0`, pnpm `12.14.0`.

| Revision                                                      | Ratchet Result | Evidence Scope                                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen deployment `9cd7142f4d0cdb65f7a475a91f981e6a15ca1431`  | Both failed    | Reused the prior pre-push check record for this exact commit; compared to the earlier frozen commit `4d56bc0c9193ce4185996b3ef939a598e25ca3e8`, Git blob IDs for all 7 files and both baselines are unchanged. |
| Fork `main` commit `32c9634f1f77e871d5100a8faf910cb397b6238d` | Both passed    | Executed both ratchets directly on Windows in this pass. Verifies static ratchets only; does not cover Linux images or concurrent performance validation.                                                      |

Prior passes on the frozen revision—the mobile-web build, 30 targeted regressions, and Node/CLI/Web typechecks—do not substitute for these two ratchets and do not prove Linux runtime performance.

## Synchronous File Operations

The [sync file I/O ratchet](../../config/scripts/static-analysis/ratchets/runtime-lifecycle/check-main-sync-fs-ratchet.mjs) scans production code for synchronous filesystem calls and compares them against the [per-file baseline](../../config/main-sync-fs-baseline.txt). In the frozen revision, the following 3 files have no allowlist entries and match 6 call sites in total.

Source links in the table are pinned to the frozen deployment commit so reviewers can inspect the implementation prior to the follow-up fix.

| Feature and Location                                                                                                                                                                                               | Call Sites                                                             | Trigger Conditions and Visible Impact                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor ACP history parsing](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/ai-vault/session-scanner-cursor-acp-parser.ts#L45-L56)                                         | 1 `existsSync`                                                         | Checks whether the database exists when parsing ACP history. Slow storage can slow down history scanning, search, and list refreshes. Cache reuse reduces repeated parses.                                                   |
| [Antigravity hook status check](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/antigravity/hook-service.ts#L44-L49)                                                        | 1 `statSync`                                                           | Verifies whether configured managed scripts exist. Triggered by certain installs, settings updates, and status queries; Windows also checks event wrapper scripts. One call site may run multiple times per status check.    |
| [Claude read-image snapshot persistence](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/main/native-chat/agent-session-attachments/agent-session-attachment-store.ts#L177-L193) | 4 sync calls: `existsSync`, `mkdirSync`, `writeFileSync`, `renameSync` | Runs when first saving a snapshot after a successful image read; duplicate images reuse the existing file. Large images, many images, or slow disks can delay tool-result journaling and other requests on the same Runtime. |

### Execution Context and Blast Radius

Normal Cursor ACP history scanning runs in a [dedicated scanner subprocess](../../src/main/ai-vault/scan-service/session-scanner-service-spawn.ts#L39-L52). The synchronous existence check occupies the scanner process thread while the parent Runtime awaits the query result, so the parent event loop is not directly blocked; other history tasks on the same scanner process may still wait.

The Antigravity status check can be triggered indirectly by [hook reconciliation after Runtime settings updates](../../src/main/runtime/client/settings/runtime-client-settings.ts#L267-L286). When installation and configuration conditions match, it runs on the Runtime thread handling the request. It belongs to the install/status path rather than per-turn model requests or tool calls.

Claude snapshot writes happen [before tool results are journaled](https://github.com/lurunzi/orca/blob/32c9634f1f77e871d5100a8faf910cb397b6238d/src/main/claude/claude-message-journaling.ts#L184-L199). Headless Runtime also [wires attachment storage](https://github.com/lurunzi/orca/blob/32c9634f1f77e871d5100a8faf910cb397b6238d/src/main/runtime/agent-session/structured-agent-session-attachment-wiring.ts#L43-L56), so this synchronous write path can run inside Docker instances on the host Runtime process rather than the Claude CLI subprocess.

The latter two synchronous waits can delay sessions or RPCs within the same Runtime; under heavy delay, callers may hit response timeouts. Other containers' event loops are not directly blocked. Whether shared-disk contention indirectly affects other instances requires measurement.

Image snapshots must be persisted before the journal references them. Any change to the write path must preserve this ordering so the journal never references an image that has not yet been written to disk.

## Client Polling

The [recurring-timer ratchet](../../config/scripts/static-analysis/ratchets/runtime-lifecycle/check-recurring-timer-ratchet.mjs) counts `setInterval` calls in production code and compares them against the [per-file baseline](../../config/recurring-timer-baseline.txt). In the frozen revision, each of the 4 files below has 1 call site without an allowlist entry.

| Feature and Location                                                                                                                                                                                                                | Interval | Existing Guards and Remaining Overhead in Frozen Revision                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Cursor external session discovery](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/CursorTranscriptDiscoveryGate.tsx#L64-L125)                               | 60 s     | Skips callbacks when the page is hidden, deduplicates in-flight requests, and cleans up on unmount. Still polls history while visible, adding scan load when history is large.                   |
| [Terminal chat model option detection](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/session/options/terminal/use-native-chat-session-options.ts#L129-L207) | 1 s      | Probes model info during Claude/Antigravity startup and stops once found or after ~1 minute, with concurrency protection. Adds terminal screen reads during startup.                             |
| [Cursor transcript resume status](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/use-cursor-transcript-resume.ts#L41-L76)                                    | 60 s     | Enabled by parent visibility state and cleaned up on unmount. No internal in-flight deduplication, so queries slower than the interval can overlap; composer availability updates on query.      |
| [Chat prompt suggestions](https://github.com/lurunzi/orca/blob/9cd7142f4d0cdb65f7a475a91f981e6a15ca1431/src/renderer/src/components/native-chat/use-native-chat-prompt-suggestion.ts#L21-L38)                                       | 500 ms   | Reads existing terminal suggestions; structured chats skip this poller, and parent visibility gates it. Overhead is client read/parse/state update—it does not send model requests every 500 ms. |

All four call sites clean up on unmount. Because the ratchet only counts call sites, it cannot prove the absence of timer leaks or automatically judge whether manual guards are sufficient.

These timers live in the Orca renderer layer. Deploying headless containers alone does not register them in server processes, though client-initiated history queries and terminal snapshot reads can still send load to Runtime.

## Origin and Current Remediation

Compared with merged upstream commit `dedec1407402fb7d5711d45fac84106e1b57f802`, all 7 call sites are fork-specific differences. The Cursor ACP sync check came from fork commit [5bbb1c49311c7d14440ece88811f5517ea3421db](https://github.com/lurunzi/orca/commit/5bbb1c49311c7d14440ece88811f5517ea3421db); the image sync snapshot came from [3f44a10d8fcad54e142f7c369894ef9264d9b5a9](https://github.com/lurunzi/orca/commit/3f44a10d8fcad54e142f7c369894ef9264d9b5a9).

The Antigravity sync check and the 4 timers were already present in the earliest locally visible fork integration commit `2e8b1cc272379ee70dbedeef02a84e8bde11904e`. Because that local checkout was shallow, this boundary commit should not be treated as their first introduction. Non-merge commits unique to the deployment branch did not add any of these 7 call sites.

Fork `main` handles them in two ways:

- All four pollers are wired to [window visibility intervals](../../src/renderer/src/lib/window-activity/window-visibility-interval.ts), and Cursor ACP existence checks switch to gated async `stat`.
- The Antigravity status check and image snapshot persistence keep synchronous I/O with documented rationale and baseline entries. The former preserves an existing synchronous status interface while checking only a handful of scripts; the latter guarantees images land on disk before journal references.

Adding baseline entries satisfies the ratchet for justified calls, but the underlying synchronous I/O cost remains. That commit also includes other lint, cleanup, and test-collection changes, so review the whole commit or explicitly select the desired scope before adopting it.

## Verification Requirements for Future Releases

Whether to include these changes in a deployed release—and whether to adopt the full commit or cherry-pick a subset—remains to be confirmed. Keep the frozen tag unchanged and run an independent verification batch if adopted later:

- Run both ratchets on the exact target commit and re-review the scope and rationale of synchronous I/O allowlist entries.
- Verify polling pauses while hidden, refreshes on return to visibility, and preserves history auto-discovery, session resume, and model option detection.
- Verify history scanning reads empty ACP sessions that have a database but no sent messages.
- Verify image snapshots are saved before journal references, duplicate images are reused, and historical images remain viewable after source files are deleted.
- To confirm runtime performance impact, measure image snapshot and history query latency on actual Linux storage and observe concurrent request latency on the same Runtime.

Linux image measurements and real concurrent load data are not yet available. Passing both static ratchets does not prove the absence of runtime stalls, nor do the existing failures prove data corruption or permission failures.
