import { describe, expect, it } from 'vitest'
import { nextComputerAwakeTargetId, parseRemoteComputerAwake } from './remote-computer-awake'

describe('parseRemoteComputerAwake', () => {
  it('reads the mode a host reports', () => {
    expect(
      parseRemoteComputerAwake({ settings: { computerAwake: { mode: 'auto', active: true } } })
    ).toEqual({ kind: 'ready', status: { mode: 'auto', active: true } })
  })

  it('treats a host that omits the setting as unsupported', () => {
    expect(parseRemoteComputerAwake({ settings: { machineName: 'mini' } })).toEqual({
      kind: 'unsupported'
    })
  })

  it('does not trust a mode this build does not know', () => {
    expect(
      parseRemoteComputerAwake({ settings: { computerAwake: { mode: 'display', active: true } } })
    ).toEqual({ kind: 'unsupported' })
  })
})

describe('nextComputerAwakeTargetId', () => {
  it('walks from this computer through each host and back', () => {
    expect(nextComputerAwakeTargetId(null, ['a', 'b'])).toBe('a')
    expect(nextComputerAwakeTargetId('a', ['a', 'b'])).toBe('b')
    expect(nextComputerAwakeTargetId('b', ['a', 'b'])).toBeNull()
  })
})
