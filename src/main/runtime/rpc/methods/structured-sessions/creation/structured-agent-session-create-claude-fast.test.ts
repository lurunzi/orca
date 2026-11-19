import '../../../dispatch/testing/unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../../../shared/agent-session/capabilities/agent-session-runtime-capabilities'
import { AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY } from '../../../../../../shared/agent-session/lifecycle/operations/agent-session-create-capabilities'
import { structuredAgentSessionCreateParams } from '../../../../../../shared/agent-session/lifecycle/operations/structured-agent-session-create'
import {
  createRestTestRig,
  type RestTestRig
} from '../../../../../native-chat/agent-session-wire/host/testing/structured-agent-session-rest-test-rig.test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_NOW as NOW
} from '../../../../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import { setStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { call } from '../protocol/structured-agent-session-rpc.test-fixture'

const capable = {
  clientId: 'device-1',
  clientKind: 'runtime' as const,
  clientCapabilities: [
    STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
    AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY
  ]
}
let rig: RestTestRig
beforeEach(async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  setStructuredAgentSessionHost(rig.host)
})
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  await rig.dispose()
  vi.restoreAllMocks()
})

it.each(['true', 'false'] as const)(
  'checks Claude Fast=%s before creating an at-rest chat',
  async (fastMode) => {
    const input = structuredAgentSessionCreateParams({
      sessionId: SESSION,
      worktree: 'id:workspace-1',
      agent: 'claude',
      randomUuid: () => '00000000-0000-0000-0000-0000000000fa',
      now: NOW,
      options: { fastMode }
    })
    expect(await call('agentSession.create', input, capable)).toMatchObject({
      ok: true,
      result:
        fastMode === 'true'
          ? { ok: false, refusal: { details: { reason: 'optionRejected' } } }
          : { ok: true }
    })
    expect(rig.adapter.acquire).not.toHaveBeenCalled()
    if (fastMode === 'true') {
      expect(rig.store.getRecord(SESSION)).toBeNull()
    } else {
      expect(rig.store.getRecord(SESSION)?.options?.fastMode).toBe('false')
    }
  }
)
