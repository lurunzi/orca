import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { applyAgentStatusHooksEnabledMock } from '../../orca-runtime-test-mocks/setup.spec'
import { store } from '../../construction/test-context/orca-runtime-test-fixtures.spec'
import { RuntimeClientSettingsController } from './runtime-client-settings'

describe('paired client settings', () => {
  it('lets a paired client keep this host awake', async () => {
    let settings = store.getSettings()
    const setMode = vi.fn()
    const controller = new RuntimeClientSettingsController({
      getSettings: () => settings,
      updateSettings: (updates) => {
        settings = { ...settings, ...updates }
      }
    })
    controller.computerAwake.attach({ getStatus: () => ({ mode: 'on', active: true }), setMode })

    const result = await controller.update({ computerAwakeMode: 'on' })

    expect(setMode).toHaveBeenCalledExactlyOnceWith('on')
    expect(settings).toMatchObject({
      computerAwakeMode: 'on',
      keepComputerAwakeWhileAgentsRun: true
    })
    expect(result.computerAwake).toEqual({ mode: 'on', active: true })
  })

  it('refuses an awake mode on a host that cannot hold itself awake', async () => {
    const updateSettings = vi.fn()
    const controller = new RuntimeClientSettingsController({
      getSettings: () => store.getSettings(),
      updateSettings
    })

    await expect(controller.update({ computerAwakeMode: 'on' })).rejects.toThrow(
      'computer_awake_unsupported'
    )
    expect(updateSettings).not.toHaveBeenCalled()
    expect(controller.get()).not.toHaveProperty('computerAwake')
  })

  it('repairs missing hooks when explicitly enabled again', async () => {
    const settings = { ...store.getSettings(), agentStatusHooksEnabled: true }
    const runtime = new OrcaRuntimeService({
      ...store,
      getSettings: () => settings,
      updateSettings: vi.fn()
    })

    await runtime.updateClientSettings({ agentStatusHooksEnabled: true })

    expect(applyAgentStatusHooksEnabledMock).toHaveBeenCalledOnce()
    expect(applyAgentStatusHooksEnabledMock).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ agentStatusHooksEnabled: true }),
      expect.objectContaining({ shouldContinue: expect.any(Function) })
    )
  })
})
