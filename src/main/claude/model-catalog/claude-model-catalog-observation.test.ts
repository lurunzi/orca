import { afterEach, describe, expect, it } from 'vitest'
import { readClaudeCatalogObservation } from './claude-model-catalog-observation'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalPairedSubscription = process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION

function signedOutReplies(): ReadonlyMap<string, unknown> {
  return new Map<string, unknown>([
    [
      'orca-model-discovery',
      {
        models: [{ value: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5', description: 'Sonnet' }]
      }
    ],
    ['orca-model-settings', { effective: {}, applied: {} }],
    ['orca-signin-discovery', { account: { tokenSource: 'none', apiProvider: 'firstParty' } }]
  ])
}

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
  if (originalPairedSubscription === undefined) {
    delete process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION
  } else {
    process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION = originalPairedSubscription
  }
})

describe('readClaudeCatalogObservation', () => {
  it('suppresses notSignedIn only when Linux paired subscription is enabled', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    delete process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION
    expect(readClaudeCatalogObservation(signedOutReplies(), {}, 'system').unavailable).toEqual({
      reason: 'notSignedIn',
      account: 'system'
    })

    process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION = '1'
    expect(
      readClaudeCatalogObservation(signedOutReplies(), {}, 'system').unavailable
    ).toBeUndefined()
  })
})
