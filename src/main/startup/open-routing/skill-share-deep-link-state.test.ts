import { describe, expect, it } from 'vitest'
import { isRoutedOrcaDeepLink } from './orca-deep-link-url'
import { DeepLinkState } from '../deep-link-state'
import { PluginInstallLinkState, RemotePairingLinkState } from './skill-share-deep-link-state'

describe('UDA Orca deep link scheme', () => {
  it('routes the UDA Orca uda-orca:// scheme like orca://', () => {
    const shares = new DeepLinkState()
    expect(shares.accepts('uda-orca://skills/share/share_uda')).toBe(true)
    expect(shares.capture(['orca', 'uda-orca://skills/share/share_uda'])).toBe(true)
    expect(shares.consumeSkillShare()).toBe('share_uda')

    const plugins = new PluginInstallLinkState()
    expect(plugins.capture(['orca', 'uda-orca://plugins/acme.todo'])).toBe(true)
    expect(plugins.consume()).toBe('orca://plugins/acme.todo')

    const pairing = new RemotePairingLinkState()
    expect(pairing.capture(['orca', 'uda-orca://pair?code=abc'])).toBe(true)
    expect(pairing.consume()).toBe('orca://pair?code=abc')

    expect(isRoutedOrcaDeepLink('uda-orca://pair?code=abc')).toBe(true)
    expect(isRoutedOrcaDeepLink('orca://pair?code=abc')).toBe(true)
    expect(isRoutedOrcaDeepLink('orca://pairing?code=abc')).toBe(false)
    expect(isRoutedOrcaDeepLink('uda-orca://unknown')).toBe(false)
  })
})
