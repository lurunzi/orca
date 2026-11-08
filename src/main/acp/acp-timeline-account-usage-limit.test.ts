import { afterEach, describe, expect, it } from 'vitest'
import { closeProviderTimelineRigs } from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { openAcpFixtureRig } from './acp-timeline-fixture.test-support'
import { AcpAgentError } from './acp-errors'
import { acpPromptTurnId } from './acp-prompt-turns'

afterEach(closeProviderTimelineRigs)

const REASON = 'Request failed: placeholder reason'
const rpcError = new AcpAgentError(-32603, 'Internal error', { message: REASON })

async function statusBodies(f: Awaited<ReturnType<typeof openAcpFixtureRig>>) {
  return (await f.rig.rows()).flatMap((row) => (row.body.kind === 'status' ? [row.body] : []))
}

describe('an ACP failure that account usage explains', () => {
  it('becomes a usage limit with the used-up pool reset, so the chat can continue then', async () => {
    const f = await openAcpFixtureRig()
    const lane = f.lane()
    lane.openPrompt('c1', 1000)
    f.apply(lane.promptFailed('c1', rpcError, 1001))
    expect((await statusBodies(f))[0]?.failure).toBeUndefined()

    f.apply(lane.failures.usageLimitFromAccount(acpPromptTurnId('c1'), { resetsAt: 90_000 }))
    expect(await statusBodies(f)).toEqual([
      expect.objectContaining({
        tone: 'warning',
        failure: expect.objectContaining({
          kind: 'usageLimitReached',
          usageLimit: { resetsAt: 90_000 }
        })
      })
    ])
    // Once explained, a second reading leaves the row alone.
    expect(
      lane.failures.usageLimitFromAccount(acpPromptTurnId('c1'), { resetsAt: 95_000 })
    ).toEqual([])
  })
})
