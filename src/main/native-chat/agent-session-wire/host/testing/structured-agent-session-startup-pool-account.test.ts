import { expect, it } from 'vitest'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/accounts/agent-session-pool-account'
import { mintStructuredAgentSessionStartupAttempt } from '../../startup/structured-agent-session-startup-attempt-mint'
import { writeTestAgentSessionRecordRow } from '../../../../runtime/agent-session/records/agent-session-record-row-write.test-fixture'
import { HOST_TEST_SESSION as SESSION } from './structured-agent-session-host-test-data.test-fixture'
import {
  acquire,
  eventually,
  heldBehindStart,
  host,
  proveOpen,
  publishFirst,
  restartWith,
  root,
  store,
  submission,
  registerStartupAttemptHostTests
} from './structured-agent-session-startup-attempt-host.test-fixture'

registerStartupAttemptHostTests()

it('carries a persisted inherited pool identity into acquisition as an independent snapshot', async () => {
  await writeTestAgentSessionRecordRow(
    root,
    {
      ...store.requireWritableRecord(SESSION),
      poolAccount: {
        version: 1,
        origin: AgentSessionPoolAccountOrigin.InheritedCopy,
        instanceId: 'instance-1',
        provider: DashboardToolProvider.Codex,
        accountId: 'account-1',
        bindingRevision: 3,
        credentialVersion: 7,
        sourceSessionId: 'source-session'
      }
    },
    store
  )
  await restartWith(publishFirst)
  const id = await heldBehindStart('hello')
  const input = acquire.mock.calls.at(-1)![0]
  const stored = store.requireWritableRecord(SESSION)
  expect(input.launch?.poolAccount).toEqual({
    version: 1,
    origin: 'inherited_copy',
    instanceId: 'instance-1',
    provider: 'codex',
    accountId: 'account-1',
    bindingRevision: 3,
    credentialVersion: 7,
    sourceSessionId: 'source-session'
  })
  expect(input.launch?.poolAccount).not.toBe(stored.poolAccount)

  const source = structuredClone(stored)
  const attempt = mintStructuredAgentSessionStartupAttempt({
    record: source,
    identity: input.identity,
    spawnToken: input.spawnToken
  })
  if (source.poolAccount?.origin !== AgentSessionPoolAccountOrigin.InheritedCopy) {
    throw new Error('expected persisted inherited identity')
  }
  source.poolAccount.accountId = 'account-2'
  source.poolAccount.bindingRevision = 4
  source.poolAccount.credentialVersion = 8
  source.poolAccount.sourceSessionId = 'another-source'
  await writeTestAgentSessionRecordRow(
    root,
    { ...store.requireWritableRecord(SESSION), poolAccount: source.poolAccount },
    store
  )
  for (const launch of [input.launch, attempt.launch]) {
    expect(launch?.poolAccount).toEqual({
      version: 1,
      origin: 'inherited_copy',
      instanceId: 'instance-1',
      provider: 'codex',
      accountId: 'account-1',
      bindingRevision: 3,
      credentialVersion: 7,
      sourceSessionId: 'source-session'
    })
  }
  await proveOpen()
  await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
  await host.close(SESSION, 'evict')
})
