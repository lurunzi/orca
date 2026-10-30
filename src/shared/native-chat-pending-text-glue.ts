// Fork: how rapid sends that landed on one transcript row glue together.

/**
 * How many leading pending texts concatenate to exactly `userText`, allowing at
 * most one collapsed space at each send boundary. Covers rapid-send glue
 * ("joke"+"continue" → "joke continue") while still requiring the whole row to
 * be consumed, so unrelated prefixes never match ("hi" ↛ "history").
 *
 * Both sides are whitespace-normalized, so a piece never starts with a space and
 * the boundary space is unambiguous; only the line-continuation form branches.
 */
export function countLeadingPendingTextsGluedToUserText(
  pendingTexts: readonly string[],
  userText: string
): number {
  if (pendingTexts.length === 0 || userText.length === 0) {
    return 0
  }
  return countGluedPendingTextsFrom(pendingTexts, userText, 0, 0)
}

function countGluedPendingTextsFrom(
  pendingTexts: readonly string[],
  userText: string,
  index: number,
  cursor: number
): number {
  const piece = pendingTexts[index]
  if (!piece) {
    return 0
  }
  const start = index > 0 && userText[cursor] === ' ' ? cursor + 1 : cursor
  // Why: a send ending in `\` turns the TUI's Enter into a line continuation, so
  // the agent eats the backslash and the next send lands on the same turn.
  const forms = piece.length > 1 && piece.endsWith('\\') ? [piece, piece.slice(0, -1)] : [piece]
  for (const form of forms) {
    if (!userText.startsWith(form, start)) {
      continue
    }
    const end = start + form.length
    if (end === userText.length) {
      if (form === piece) {
        return index + 1
      }
      continue
    }
    const count = countGluedPendingTextsFrom(pendingTexts, userText, index + 1, end)
    if (count > 0) {
      return count
    }
  }
  return 0
}

/**
 * Like the leading glue above, but the first send survives only as a truncated
 * lead: its Enter never landed, so the next send's single Ctrl+U killed the
 * wrapped tail row of it before gluing on ("…only if the rest" + "go?" →
 * "…only if go?"). Returns how many pending texts that row represents (≥ 2).
 */
export function countPendingTextsGluedAfterTruncatedLead(
  pendingTexts: readonly string[],
  userText: string
): number {
  const lead = pendingTexts[0]
  if (!lead) {
    return 0
  }
  for (let count = pendingTexts.length; count >= 2; count -= 1) {
    let end = userText.length
    for (let index = count - 1; index >= 1 && end >= 0; index -= 1) {
      const piece = pendingTexts[index]
      if (!piece || !userText.endsWith(piece, end)) {
        end = -1
        break
      }
      end -= piece.length
      // Pieces are trimmed, so a space before one is always a collapsed boundary.
      if (userText[end - 1] === ' ') {
        end -= 1
      }
    }
    const kept = end > 0 ? userText.slice(0, end) : ''
    if (kept && kept.length < lead.length && lead.startsWith(kept)) {
      return count
    }
  }
  return 0
}
