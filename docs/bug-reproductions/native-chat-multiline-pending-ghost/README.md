# Native Chat: Multi-line / Rapid-Send Pending Echo Reconciliation Failure ("Ghost Messages")

- **Date**: 2026-09-25
- **Platform**: Windows 11 Pro (x64)
- **Component**: `src/renderer/src/components/native-chat/` (`native-chat-pending.ts`, `native-chat-pending-occurrence.ts`, `NativeChatResolvedView.tsx`)
- **Agent**: Antigravity (AGY) Native Chat

---

## 1. Symptom

During an active Antigravity native chat session, a user submitted a multi-line draft:
```text
哦对图挪走了
C:\Users\ABSCOND\.gemini\antigravity-cli\brain\187a120b-37e2-439a-8729-d1c5c2848488\screenshots我本来想让你清理，发错对话了
```

The agent processed the turn and replied. In the next turn, when the user submitted a new prompt (`发出去了吗`) and the assistant started executing a tool (`Ran 1 command`), three separate user bubbles corresponding to the lines of the previous prompt unexpectedly re-appeared **below** the `Ran 1 command` block:

1. `哦对图挪走了`
2. `C:\Users\ABSCOND.gemini\antigravity-cli\brain\187a120b-37e2-439a-8729-d1c5c2848488\screenshots\`
3. `我本来想让你清理，发错对话了`

These bubbles persisted at the bottom of the conversation as "ghost messages" (幽灵消息).

Visual evidence is captured in `evidence.png`.

---

## 2. Root Cause Analysis

### A. Optimistic Send Ingestion
When multi-line input or fast consecutive sends land in the composer, [`onOptimisticSend`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/NativeChatResolvedView.tsx#L201-L218) generates three discrete pending send entries into `pendingSendCache`:
- `send-1`: `"哦对图挪走了"`
- `send-2`: `"C:\\Users\\ABSCOND.gemini\\antigravity-cli\\brain\\187a120b-37e2-439a-8729-d1c5c2848488\\screenshots\\"`
- `send-3`: `"我本来想让你清理，发错对话了"`

### B. Transcript Coalescing
Antigravity CLI (agy) writes incoming prompts into `transcript.jsonl` as a single `USER_INPUT` record wrapped in `<USER_REQUEST> ... </USER_REQUEST>`. The decoded user turn becomes:
```text
哦对图挪走了\nC:\Users\ABSCOND\.gemini\antigravity-cli\brain\187a120b-37e2-439a-8729-d1c5c2848488\screenshots我本来想让你清理，发错对话了
```

### C. Reconciliation Miss in `native-chat-pending.ts`
When [`prunePendingSends`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/native-chat-pending.ts#L182-L218) and [`pendingSendsAsMessages`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/native-chat-pending.ts#L226-L271) reconcile `pendingSendCache` against `session.messages`:

1. **Exact Matching (`exactKeep`)**:
   Checks `nativeChatPendingContentKey(entry)` against `nativeChatUserMessageContentKey(message)`.
   Because no single message equals any individual pending chunk, all 3 items fail exact match.

2. **Glued Matching (`countLeadingPendingTextsGluedToUserText`)**:
   [`countLeadingPendingTextsGluedToUserText`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/native-chat-pending-occurrence.ts#L129-L154) tries to verify if consecutive pending sends concatenate into the transcript text:
   ```ts
   if (userText.startsWith(piece, cursor)) {
     cursor += piece.length
   } else if (index > 0 && userText.startsWith(` ${piece}`, cursor)) {
     cursor += piece.length + 1
   } else {
     return 0
   }
   ```
   This fails for two reasons:
   - **Delimiter rigidity**: It only allows at most one single space (` `). Antigravity text contains newlines `\n` or zero-delimiter concatenation between lines (e.g. `\screenshots我本来想让你清理`).
   - **Path & Escaping divergence**: The pending echo had `ABSCOND.gemini` and trailing `\`, while the transcript contained `ABSCOND\.gemini` and no trailing backslash before Chinese characters.
   
   Because piece 2 failed, the entire glued match returned `0`, and all 3 pending items remained in `pendingSendCache`.

### D. Tail-Append Rendering in `NativeChatResolvedView.tsx`
In [`NativeChatResolvedView.tsx`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/NativeChatResolvedView.tsx#L281-L294):
```tsx
messages: [
  ...sessionAfterCommandBoundaries.messages,
  ...commandMarkersAsMessages(commandMarkers),
  ...(streamingText ? [nativeChatStreamingMessage(streamingText)] : []),
  ...pendingMessages // <-- Unpruned pending items are appended to the very end
]
```
Even after subsequent user turns (e.g., `发出去了吗`) and assistant tool calls (`Ran 1 command`) are recorded in the transcript, any orphaned `pendingMessages` are unconditionally appended to the **tail** of `messages`.

This causes stale pending sends from previous turns to float at the bottom of the newest turn, appearing as "ghost messages".

---

## 3. Recommended Remediation

### Approach 1: Stale Pending Retirement upon Newer User Turns (Recommended)
If `session.messages` contains a confirmed `user` turn with a timestamp strictly greater than a pending send's `sentAt` (or if an assistant turn has already landed for a subsequent user prompt), the older pending send is guaranteed to be obsolete and must be pruned from `pendingSendCache`.

### Approach 2: Robust Glue & Whitespace Normalization
Enhance [`countLeadingPendingTextsGluedToUserText`](file:///C:/Users/ABSCOND/Documents/GitHub/orca/src/renderer/src/components/native-chat/native-chat-pending-occurrence.ts#L129-L154) to:
- Normalize multiple whitespace and newlines (`\r\n`, `\n`) consistently across both pending drafts and transcript blocks.
- Allow zero-width boundaries or path separators at line boundaries.

---

## 4. Resolution (2026-09-25)

Status: **fixed** in `native-chat-pending.ts` / `native-chat-pending-occurrence.ts`, covered by unit tests.

- **Order-based retirement (Approach 1, clock-free)**: sends reach the agent in order, so once a newer pending send is matched (hidden when its row lands, pruned when it advances), every older still-unmatched echo is retired too. No timestamp comparison, because a queued send's transcript row can legitimately land after a later send's `sentAt`.
- **Line-continuation glue (narrow part of Approach 2)**: a send ending in `\` may glue without that backslash when later sends follow, since the TUI treats `\`+Enter as a continuation. Newlines were already normalized to one space, so the "delimiter rigidity" point in 2.C did not apply.
- **Not reproduced**: the missing `\` in `ABSCOND.gemini` is most likely Markdown rendering `\.` as `.` in the bubble, not a real text difference. That was not checked against the raw transcript. Any mismatch that is still unexplained is covered by the order-based retirement once the next send lands.
