import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  pendingSendsAsMessages,
  prunePendingSends,
  type NativeChatPendingSend
} from '../../../../shared/native-chat-pending-sends'

function userMessage(id: string, text: string, timestamp = 1): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

function assistantMessage(id: string, text: string, timestamp = 2): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

const pendingOf = (id: string, text: string): NativeChatPendingSend => ({ id, text, sentAt: 100 })

// A glued row is written by the agent AFTER the sends that produced it, so every
// fixture here puts the transcript row past `sentAt`. Matching an earlier row is
// the failure mode these tests exist to pin down.
const GLUE_BOUNDARY = assistantMessage('glue-boundary', 'ready', 1000)
const GLUE_SENT_AT = 5000

function gluePending(id: string, text: string): NativeChatPendingSend {
  return {
    id,
    text,
    sentAt: GLUE_SENT_AT,
    afterMessageId: GLUE_BOUNDARY.id,
    afterMessageTimestamp: GLUE_BOUNDARY.timestamp
  }
}

/** Visible history, the send boundary, then the row the agent glued the queue into. */
function glueTranscript(row: string): NativeChatMessage[] {
  return [
    userMessage('glue-history', 'hello', 900),
    GLUE_BOUNDARY,
    userMessage('glue-row', row, 6000)
  ]
}

function advancedGlueTranscript(row: string): NativeChatMessage[] {
  return [...glueTranscript(row), assistantMessage('glue-answer', 'done', 6100)]
}

describe('glued rapid sends', () => {
  it('retires both echoes when a lost Enter glued the pair into one row', () => {
    const pending = [gluePending('p1', 'tell me a joke'), gluePending('p2', 'continue')]

    expect(prunePendingSends(pending, advancedGlueTranscript('tell me a jokecontinue'))).toEqual([])
  })

  it('hides both echoes as soon as the glued row lands, before the reply', () => {
    const pending = [gluePending('p1', 'tell me a joke'), gluePending('p2', 'continue')]

    expect(pendingSendsAsMessages(pending, glueTranscript('tell me a jokecontinue'))).toEqual([])
  })

  it('retires a pair the agent glued with a separator of its own', () => {
    const pending = [gluePending('p1', 'tell me a joke'), gluePending('p2', 'continue')]

    expect(prunePendingSends(pending, advancedGlueTranscript('tell me a joke continue'))).toEqual(
      []
    )
  })

  it('retires a pair whose glued row separates with tabs and newlines', () => {
    const pending = [gluePending('p1', 'tell me a joke'), gluePending('p2', 'continue')]

    expect(
      prunePendingSends(pending, advancedGlueTranscript('tell me a joke \t\n continue'))
    ).toEqual([])
  })

  it('retires three prompts collapsed into one row with mixed boundaries', () => {
    const pending = [
      gluePending('p1', 'first'),
      gluePending('p2', 'second'),
      gluePending('p3', 'third')
    ]

    expect(prunePendingSends(pending, advancedGlueTranscript('firstsecond third'))).toEqual([])
  })

  it('retires prompts that themselves contain the separator', () => {
    const pending = [gluePending('p1', 'fix the bug'), gluePending('p2', 'then run the tests')]

    expect(
      prunePendingSends(pending, advancedGlueTranscript('fix the bug then run the tests'))
    ).toEqual([])
  })

  it('retires an identical prompt sent twice', () => {
    const pending = [gluePending('p1', 'repeat'), gluePending('p2', 'repeat')]

    expect(prunePendingSends(pending, advancedGlueTranscript('repeat repeat'))).toEqual([])
  })

  it('retires an identical prompt sent three times', () => {
    const pending = [gluePending('p1', 'ha'), gluePending('p2', 'ha'), gluePending('p3', 'ha')]

    expect(prunePendingSends(pending, advancedGlueTranscript('haha ha'))).toEqual([])
  })

  it('retires a pending send that is a prefix of the next one', () => {
    const pending = [gluePending('p1', 'hi'), gluePending('p2', 'hi there')]

    expect(prunePendingSends(pending, advancedGlueTranscript('hi hi there'))).toEqual([])
  })

  it('keeps sends when the glue only reaches a prefix of the row', () => {
    const pending = [gluePending('p1', 'hi'), gluePending('p2', 'story')]

    expect(prunePendingSends(pending, advancedGlueTranscript('hi story continued'))).toEqual(
      pending
    )
  })

  it('keeps sends when the row runs out mid-prompt', () => {
    const pending = [gluePending('p1', 'hi'), gluePending('p2', 'there friend')]

    expect(prunePendingSends(pending, advancedGlueTranscript('hi there'))).toEqual(pending)
  })

  // A draft ending in `\` is a newline request to the agent TUI, not a submit:
  // measured against Claude Code v2.1.234, `first\` + CR leaves the input open
  // with the backslash dropped, so the next send lands in the SAME turn
  // ("first\nsecond"). The echo keeps the backslash the transcript never has.
  it('still retires literal-backslash sends glued by agents that retain it', () => {
    const pending = [gluePending('p1', 'run\\'), gluePending('p2', 'again')]
    expect(prunePendingSends(pending, advancedGlueTranscript('run\\ again'))).toEqual([])
  })

  it('keeps repeated continuation sends matched to separate transcript occurrences', () => {
    const pending = [gluePending('p1', 'run\\'), gluePending('p2', 'run\\')]
    expect(prunePendingSends(pending, advancedGlueTranscript('run again'))).toEqual([pending[1]])
  })

  it.each(['one\\ two three', 'one two\\ three'])(
    'retires mixed literal and continuation backslashes in %s',
    (text) => {
      const pending = [
        gluePending('p1', 'one\\'),
        gluePending('p2', 'two\\'),
        gluePending('p3', 'three')
      ]
      expect(prunePendingSends(pending, advancedGlueTranscript(text))).toEqual([])
    }
  )

  it('retires a pair whose first send ended in a continuation backslash', () => {
    const pending = [gluePending('p1', 'tell me a joke\\'), gluePending('p2', 'continue')]

    expect(prunePendingSends(pending, advancedGlueTranscript('tell me a joke\ncontinue'))).toEqual(
      []
    )
  })

  it('hides a continuation-backslash pair as soon as its glued row lands', () => {
    const pending = [gluePending('p1', 'tell me a joke\\'), gluePending('p2', 'continue')]

    expect(pendingSendsAsMessages(pending, glueTranscript('tell me a joke\ncontinue'))).toEqual([])
  })

  // The observed report: the rest of the turn was finished somewhere this queue
  // cannot see (another client, or typed into the pane), so the echo is alone.
  it('retires a lone continuation echo absorbed into a longer turn', () => {
    const pending = [gluePending('p1', 'tell me a joke\\')]

    expect(
      prunePendingSends(pending, advancedGlueTranscript('tell me a joke\nabout cats'))
    ).toEqual([])
  })

  it('keeps a continuation echo when a later row only shares its prefix', () => {
    const pending = [gluePending('p1', 'hi\\')]

    expect(prunePendingSends(pending, advancedGlueTranscript('history repeats'))).toEqual(pending)
  })

  it('retires a continuation echo the user then submitted on its own', () => {
    // `\` + Enter, then Enter again on the empty line it opened.
    const pending = [gluePending('p1', 'tell me a joke\\')]

    expect(prunePendingSends(pending, advancedGlueTranscript('tell me a joke'))).toEqual([])
  })

  it('retires a pair when only the last of several backslashes was eaten', () => {
    const pending = [gluePending('p1', 'tell me a joke\\\\'), gluePending('p2', 'continue')]

    expect(
      prunePendingSends(pending, advancedGlueTranscript('tell me a joke\\\ncontinue'))
    ).toEqual([])
  })

  it('retires a run of three sends chained by continuations', () => {
    const pending = [
      gluePending('p1', 'first\\'),
      gluePending('p2', 'second\\'),
      gluePending('p3', 'third')
    ]

    expect(prunePendingSends(pending, advancedGlueTranscript('first\nsecond\nthird'))).toEqual([])
  })

  it('retires the reported prompt, whose text is not Latin', () => {
    const pending = [
      gluePending('p1', '사양을 올리는게 가능해? 이건 과금의 영역아니야?\\'),
      gluePending('p2', '일단 퀵하게 되는 버전으로 반영되어야할거같아')
    ]

    expect(
      prunePendingSends(
        pending,
        advancedGlueTranscript(
          '사양을 올리는게 가능해? 이건 과금의 영역아니야?\n일단 퀵하게 되는 버전으로 반영되어야할거같아'
        )
      )
    ).toEqual([])
  })

  it('keeps a continuation echo the row breaks mid-word', () => {
    // The run must stop on the separator the TUI's newline normalizes to.
    const pending = [gluePending('p1', 'tell me a jo\\')]

    expect(prunePendingSends(pending, advancedGlueTranscript('tell me a joke about cats'))).toEqual(
      pending
    )
  })

  it('keeps a queued pair when an earlier turn splits across it (#14406 regression)', () => {
    // The row predates both sends: "run the tests"+"again" only looks glued.
    const pending = [pendingOf('p1', 'run the tests'), pendingOf('p2', 'again')]

    expect(
      prunePendingSends(pending, [
        userMessage('u1', 'run the tests again'),
        assistantMessage('a1', 'sure')
      ])
    ).toEqual(pending)
  })

  it('keeps a re-sent pair that an older identical turn would match (#14406 regression)', () => {
    // Rapid-sending "fix the"+"bug" a second time must not bind to the first
    // "fix the bug" turn — that drops a real queued prompt with no bubble.
    const history = [userMessage('u1', 'fix the bug', 1000), assistantMessage('a1', 'fixed', 1100)]
    const pending = [gluePending('p3', 'fix the'), gluePending('p4', 'bug')]

    expect(prunePendingSends(pending, history)).toEqual(pending)
    expect(pendingSendsAsMessages(pending, history)).toHaveLength(2)
  })

  it('keeps a re-sent pair even with no recorded message boundary', () => {
    const history = [userMessage('u1', 'fix the bug', 1000), assistantMessage('a1', 'fixed', 1100)]
    const pending = [
      { id: 'p3', text: 'fix the', sentAt: GLUE_SENT_AT },
      { id: 'p4', text: 'bug', sentAt: GLUE_SENT_AT }
    ]

    expect(prunePendingSends(pending, history)).toEqual(pending)
    expect(pendingSendsAsMessages(pending, history)).toHaveLength(2)
  })

  // A row that already existed when a send was issued can never be that send's
  // echo — for EVERY queued send, not just the oldest one the glue run starts at.
  const mixedAgeGlue = (): { messages: NativeChatMessage[]; pending: NativeChatPendingSend[] } => {
    const gluedRow = userMessage('glue-row', 'fix the bug', 6000)
    return {
      messages: [
        GLUE_BOUNDARY,
        gluedRow,
        assistantMessage('glue-answer', 'fixed', 6100),
        userMessage('later-history', 'anything', 6200)
      ],
      // 'fix the' was queued before the row landed; 'bug' only after it.
      pending: [
        gluePending('p1', 'fix the'),
        {
          id: 'p2',
          text: 'bug',
          sentAt: 7000,
          afterMessageId: 'glue-answer',
          afterMessageTimestamp: 6100
        }
      ]
    }
  }

  it('keeps a queued send whose own boundary is newer than the glued row (STA-4477)', () => {
    const { messages, pending } = mixedAgeGlue()

    expect(prunePendingSends(pending, messages)).toEqual(pending)
  })

  // Separate from the prune case on purpose: the render path is what makes the
  // bubble visually vanish, and a shared `it` would mask it behind the first
  // failing assertion.
  it('still renders a queued send whose own boundary is newer than the row (STA-4477)', () => {
    const { messages, pending } = mixedAgeGlue()

    expect(pendingSendsAsMessages(pending, messages)).toHaveLength(2)
  })

  // Glue is adjacency: a send the row predates ends the run rather than being
  // skipped, so a row must never bridge across a send it cannot represent.
  it('never glues across a send the row cannot represent (STA-4477)', () => {
    const gluedRow = userMessage('glue-row', 'alpha gamma', 6000)
    const messages = [GLUE_BOUNDARY, gluedRow, assistantMessage('glue-answer', 'ok', 6100)]
    const pending = [
      gluePending('p1', 'alpha'),
      // Queued after the row landed, so the row is not its echo...
      {
        id: 'p2',
        text: 'beta',
        sentAt: 7000,
        afterMessageId: 'glue-row',
        afterMessageTimestamp: 6000
      },
      // ...and 'alpha'+'gamma' must not close over the gap it leaves.
      gluePending('p3', 'gamma')
    ]

    expect(prunePendingSends(pending, messages)).toEqual(pending)
    expect(pendingSendsAsMessages(pending, messages)).toHaveLength(3)
  })

  it('still retires the leading run the glued row did land after (STA-4477)', () => {
    const gluedRow = userMessage('glue-row', 'first second', 6000)
    const messages = [GLUE_BOUNDARY, gluedRow, assistantMessage('glue-answer', 'done', 6100)]
    const third = {
      id: 'p3',
      text: 'third',
      sentAt: 7000,
      afterMessageId: 'glue-row',
      afterMessageTimestamp: gluedRow.timestamp
    }
    const pending = [gluePending('p1', 'first'), gluePending('p2', 'second'), third]

    expect(prunePendingSends(pending, messages)).toEqual([third])
  })
})

// Observed with Claude --prefill: the first send never submitted, so the next
// send's one Ctrl+U killed only the draft's wrapped last row before gluing on.
describe('a send glued onto a truncated earlier send', () => {
  const draft =
    'Continue from the prior session.\n\nBriefly state where it stopped. Ask me only if the context is not enough.'
  const truncatedRow =
    'Continue from the prior session.\n\nBriefly state where it stopped. Ask me only if can you go on?'

  it('hides and retires both echoes', () => {
    const pending = [gluePending('p1', draft), gluePending('p2', 'can you go on?')]

    expect(pendingSendsAsMessages(pending, glueTranscript(truncatedRow))).toEqual([])
    expect(prunePendingSends(pending, advancedGlueTranscript(truncatedRow))).toEqual([])
  })

  it('keeps both when the lead is not a prefix of the first send', () => {
    const pending = [gluePending('p1', draft), gluePending('p2', 'can you go on?')]

    expect(
      prunePendingSends(pending, advancedGlueTranscript('Something else entirely can you go on?'))
    ).toEqual(pending)
  })

  it('leaves an exact first-send row to exact matching', () => {
    const pending = [gluePending('p1', 'fix the bug'), gluePending('p2', 'bug')]

    expect(prunePendingSends(pending, advancedGlueTranscript('fix the bug'))).toEqual([pending[1]])
  })
})

// docs/bug-reproductions/native-chat-multiline-pending-ghost: Antigravity folded
// three queued sends into one turn, and the unmatched echoes then floated below
// every later turn.
describe('queued sends the agent coalesced into one turn', () => {
  const path = 'C:\\Users\\ABSCOND\\.gemini\\antigravity-cli\\brain\\187a120b\\screenshots'
  const queued = (): NativeChatPendingSend[] => [
    gluePending('p1', '哦对图挪走了'),
    gluePending('p2', `${path}\\`),
    gluePending('p3', '我本来想让你清理，发错对话了')
  ]

  it('retires all three when the continuation ate the trailing backslash', () => {
    const row = `哦对图挪走了\n${path}我本来想让你清理，发错对话了`

    expect(pendingSendsAsMessages(queued(), glueTranscript(row))).toEqual([])
    expect(prunePendingSends(queued(), advancedGlueTranscript(row))).toEqual([])
  })

  const unmatchableTurn = (): NativeChatMessage[] =>
    advancedGlueTranscript('哦对图挪走了 C:\\Users\\ABSCOND.gemini 我本来想让你清理')
  const followUp: NativeChatPendingSend = {
    id: 'p4',
    text: '发出去了吗',
    sentAt: 7000,
    afterMessageId: 'glue-answer',
    afterMessageTimestamp: 6100
  }

  it('keeps unmatched echoes until a newer send is confirmed', () => {
    const pending = queued()

    expect(prunePendingSends(pending, unmatchableTurn())).toEqual(pending)
  })

  it('hides older unmatched echoes once a newer send lands', () => {
    const messages = [...unmatchableTurn(), userMessage('u2', '发出去了吗', 7100)]

    expect(pendingSendsAsMessages([...queued(), followUp], messages)).toEqual([])
  })

  it('retires older unmatched echoes once a newer send advances', () => {
    const messages = [
      ...unmatchableTurn(),
      userMessage('u2', '发出去了吗', 7100),
      assistantMessage('a2', 'Ran 1 command', 7200)
    ]

    expect(prunePendingSends([...queued(), followUp], messages)).toEqual([])
  })

  it('keeps sends queued after the newest confirmed one', () => {
    const later = { ...followUp, id: 'p5', text: 'still queued', sentAt: 7050 }
    const messages = [
      ...unmatchableTurn(),
      userMessage('u2', '发出去了吗', 7100),
      assistantMessage('a2', 'Ran 1 command', 7200)
    ]

    expect(prunePendingSends([...queued(), followUp, later], messages)).toEqual([later])
    expect(pendingSendsAsMessages([...queued(), followUp, later], messages)).toHaveLength(1)
  })
})
