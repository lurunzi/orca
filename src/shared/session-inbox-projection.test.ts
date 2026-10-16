import { describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalToolCallState
} from './agent-session-journal-types'
import { projectSessionInbox, sessionInboxRecommendedOption } from './session-inbox-projection'
import { sessionInboxItemId, sessionInboxToolName } from './session-inbox-tool-contract'

const ROOT = '/repo'
const IDLE = { root: ROOT, isWorking: false }

let sequence = 0

function item(
  body: AgentJournalRenderItem['body'],
  extra: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  sequence += 1
  return { itemId: `item-${sequence}`, sequence, revision: 1, observedAt: sequence, body, ...extra }
}

function user(text: string, extra: Partial<AgentJournalRenderItem> = {}): AgentJournalRenderItem {
  return item({ kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }, extra)
}

function tool(
  name: string,
  input: unknown,
  state: AgentJournalToolCallState = 'completed',
  output = '',
  extra: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  return item(
    {
      kind: 'tool-call',
      name,
      input,
      state,
      output: { head: output, byteLength: output.length, digest: 'd', truncated: false }
    },
    extra
  )
}

const finding = (title: string, extra: Record<string, unknown> = {}) =>
  tool(sessionInboxToolName('record_finding'), {
    kind: 'issue',
    title,
    detail: 'Why it matters.',
    ...extra
  })
const question = (text: string, extra: Record<string, unknown> = {}) =>
  tool(sessionInboxToolName('record_question'), { question: text, ...extra })
const close = (id: string, extra: Record<string, unknown> = {}) =>
  tool(sessionInboxToolName('close'), { id, ...extra })

describe('projectSessionInbox: recorded entries', () => {
  it('lists what the agent recorded, under the ids the server answered with', () => {
    const items = [
      user('Fix the login bug'),
      finding('Retry loop never gives up', { path: 'src/net/retry.ts' }),
      question('Ship the migration today?', {
        options: ['Yes, today', 'Wait for review'],
        recommended: 'Wait for review'
      })
    ]
    const inbox = projectSessionInbox(items, IDLE)

    expect(inbox.findings).toEqual([
      expect.objectContaining({
        id: sessionInboxItemId('finding', 'Retry loop never gives up'),
        kind: 'issue',
        path: 'src/net/retry.ts',
        turnUserItemId: items[0]?.itemId
      })
    ])
    expect(inbox.questions).toEqual([
      expect.objectContaining({
        id: sessionInboxItemId('question', 'Ship the migration today?'),
        options: ['Yes, today', 'Wait for review'],
        recommended: 'Wait for review'
      })
    ])
  })

  it('drops an entry the agent closed, and ignores calls the server refused', () => {
    const id = sessionInboxItemId('finding', 'Stale cache key')
    const inbox = projectSessionInbox(
      [
        user('go'),
        finding('Stale cache key'),
        question('Rename the flag?'),
        close(id, { reason: 'fixed in this change' }),
        tool(
          sessionInboxToolName('record_finding'),
          { kind: 'issue', title: 'Refused', detail: 'x' },
          'failed'
        )
      ],
      IDLE
    )

    expect(inbox.findings).toEqual([])
    expect(inbox.questions.map((entry) => entry.question)).toEqual(['Rename the flag?'])
  })

  it('does not apply a recording or closure that is still running', () => {
    const recorded = finding('Still open')
    const id = sessionInboxItemId('finding', 'Still open')
    const inbox = projectSessionInbox(
      [
        recorded,
        tool(sessionInboxToolName('close'), { id }, 'running'),
        tool(sessionInboxToolName('record_question'), { question: 'Pending?' }, 'running')
      ],
      IDLE
    )

    expect(inbox.findings.map((entry) => entry.id)).toEqual([id])
    expect(inbox.questions).toEqual([])
  })

  it('keeps one entry per text, at its latest recording', () => {
    const items = [user('a'), finding('Same title'), user('b'), finding('Same title')]
    const inbox = projectSessionInbox(items, IDLE)

    expect(inbox.findings).toHaveLength(1)
    expect(inbox.findings[0]?.itemId).toBe(items[3]?.itemId)
  })

  it('expires a question the user has not answered after twelve more prompts', () => {
    const items = [user('start'), question('Which database?')]
    for (let prompt = 0; prompt < 12; prompt += 1) {
      items.push(user(`prompt ${prompt}`))
    }
    expect(projectSessionInbox(items, IDLE).questions).toHaveLength(1)
    items.push(user('one more'))
    expect(projectSessionInbox(items, IDLE).questions).toEqual([])
  })

  it('jumps to the user message that opened the turn, as the turn row names it', () => {
    const opener = user('first')
    const turn = item({ kind: 'turn', turnId: 't1', state: 'completed', userItemId: opener.itemId })
    const later = user('second')
    const recorded = finding('Recorded in the first turn', {})
    const scoped = { ...recorded, turnScope: { kind: 'turn' as const, turnItemId: turn.itemId } }

    const inbox = projectSessionInbox([opener, turn, later, scoped], IDLE)

    expect(inbox.findings[0]?.turnUserItemId).toBe(opener.itemId)
  })

  it('reads older history beside the live window, keeping each row at its newest revision', () => {
    const recorded = finding('From earlier history')
    const live = user('now')
    const closed = close(sessionInboxItemId('finding', 'From earlier history'))
    const window = [live, { ...closed, revision: 2 }]

    expect(projectSessionInbox([recorded, closed, ...window], IDLE).findings).toEqual([])
  })
})

describe('projectSessionInbox: checks', () => {
  const vitestFailure = 'Exit code 1\n × sum adds every value\n Tests  1 failed | 11 passed (12)'

  it('lists a check left failing when its turn ended', () => {
    const inbox = projectSessionInbox(
      [user('test it'), tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure)],
      IDLE
    )

    expect(inbox.checks).toEqual([
      expect.objectContaining({
        name: expect.stringContaining('vitest'),
        result: 'fail',
        isLeftFailing: true
      })
    ])
  })

  it('does not call a check left failing while its turn is still running', () => {
    const opener = user('test it')
    const turn = item({ kind: 'turn', turnId: 't1', state: 'running', userItemId: opener.itemId })
    const run = {
      ...tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure),
      turnScope: { kind: 'turn' as const, turnItemId: turn.itemId }
    }

    const inbox = projectSessionInbox([opener, turn, run], { root: ROOT, isWorking: true })

    expect(inbox.checks[0]?.isLeftFailing).toBe(false)
  })

  it('lets a later passing run of the same check replace the failure', () => {
    const inbox = projectSessionInbox(
      [
        user('test it'),
        tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure),
        tool('Bash', { command: 'pnpm vitest run' }, 'completed', ' Tests  12 passed (12)')
      ],
      IDLE
    )

    expect(inbox.checks.map((check) => check.result)).toEqual(['pass'])
  })

  it('marks a failure stale once a file in its folder changes', () => {
    const inbox = projectSessionInbox(
      [
        user('test it'),
        tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure),
        tool('Edit', { file_path: '/repo/src/sum.ts', old_string: 'a', new_string: 'b' })
      ],
      IDLE
    )

    expect(inbox.checks[0]?.isStale).toBe(true)
  })

  it('reads a piped run from its output, and records nothing when the output says nothing', () => {
    const failing = projectSessionInbox(
      [
        user('go'),
        tool('Bash', { command: 'pnpm vitest run 2>&1 | tail -5' }, 'completed', vitestFailure)
      ],
      IDLE
    )
    const silent = projectSessionInbox(
      [user('go'), tool('Bash', { command: 'pnpm vitest run | tail -1' }, 'completed', 'done')],
      IDLE
    )

    expect(failing.checks.map((check) => check.result)).toEqual(['fail'])
    expect(silent.checks).toEqual([])
  })

  it('leaves out background commands, still-running ones and subagent runs', () => {
    const inbox = projectSessionInbox(
      [
        user('go'),
        tool(
          'Bash',
          { command: 'pnpm vitest run', run_in_background: true },
          'completed',
          'started'
        ),
        tool('Bash', { command: 'pnpm vitest run' }, 'running'),
        tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure, { agentId: 'sub-1' })
      ],
      IDLE
    )

    expect(inbox.checks).toEqual([])
  })

  it('does not clear a failure with a truncated piped success summary', () => {
    const passed = tool(
      'Bash',
      { command: 'pnpm vitest run | cat' },
      'completed',
      'Tests 12 passed (12)'
    )
    if (passed.body.kind !== 'tool-call' || !passed.body.output) {
      throw new Error('expected tool output')
    }
    passed.body.output.truncated = true
    const inbox = projectSessionInbox(
      [tool('Bash', { command: 'pnpm vitest run' }, 'failed', vitestFailure), passed],
      IDLE
    )
    expect(inbox.checks.map((entry) => entry.result)).toEqual(['fail'])
  })

  it('does not attribute a second check output to a silent first check', () => {
    const inbox = projectSessionInbox(
      [
        tool('Bash', { command: 'pnpm vitest run a.test.ts' }, 'failed', vitestFailure),
        tool(
          'Bash',
          {
            command: 'pnpm vitest run a.test.ts >/dev/null 2>&1; pnpm vitest run b.test.ts'
          },
          'completed',
          'Tests 12 passed (12)'
        )
      ],
      IDLE
    )
    expect(inbox.checks.map((entry) => entry.result)).toEqual(['fail'])
  })

  it('keeps a failed TypeScript project when a different configuration passes', () => {
    const inbox = projectSessionInbox(
      [
        tool(
          'Bash',
          { command: 'tsc -p config/tsconfig.web.json' },
          'failed',
          'error TS2322: wrong type'
        ),
        tool('Bash', { command: 'tsc -p config/tsconfig.node.json' }, 'completed')
      ],
      IDLE
    )
    expect(inbox.checks.map((entry) => entry.result)).toEqual(['fail', 'pass'])
  })
})

describe('sessionInboxRecommendedOption', () => {
  it('names the option the recommendation spells out, or none', () => {
    const options = ['Symlink into PATH', 'Copy the binary']
    expect(sessionInboxRecommendedOption(options, 'Copy the binary')).toBe('Copy the binary')
    expect(sessionInboxRecommendedOption(options, 'Symlink into a PATH folder')).toBe(
      'Symlink into PATH'
    )
    expect(sessionInboxRecommendedOption(options, 'Something else')).toBeNull()
  })
})
