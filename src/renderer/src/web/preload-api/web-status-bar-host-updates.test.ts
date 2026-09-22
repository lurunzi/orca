import { describe, expect, it, vi } from 'vitest'
import { prepareHostUiUpdates } from './web-status-bar-host-updates'
import { getRemoteRuntimeStatus } from './web-runtime-calls'
import { STATUS_BAR_CURSOR_ITEM_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'

vi.mock('./web-runtime-calls', () => ({ getRemoteRuntimeStatus: vi.fn() }))
const status = {
  runtimeId: 'test-host',
  rendererGraphEpoch: 1,
  graphStatus: 'ready',
  authoritativeWindowId: null,
  liveTabCount: 0,
  liveLeafCount: 0
} as const

describe('Cursor visibility preference wire compatibility', () => {
  it('preserves every other setting when an older host cannot accept Cursor', async () => {
    vi.mocked(getRemoteRuntimeStatus).mockResolvedValue(
      Object.assign({}, status, { capabilities: [] })
    )
    const updates = {
      statusBarItems: ['claude', 'cursor', 'codex'] as const,
      statusBarVisible: false
    }
    expect(
      await prepareHostUiUpdates({ ...updates, statusBarItems: [...updates.statusBarItems] })
    ).toEqual({
      statusBarItems: ['claude', 'codex'],
      statusBarVisible: false
    })
  })
  it('sends Cursor only to a host advertising support', async () => {
    vi.mocked(getRemoteRuntimeStatus).mockResolvedValue(
      Object.assign({}, status, { capabilities: [STATUS_BAR_CURSOR_ITEM_RUNTIME_CAPABILITY] })
    )
    expect((await prepareHostUiUpdates({ statusBarItems: ['cursor'] })).statusBarItems).toEqual([
      'cursor'
    ])
  })
  it('does not probe hosts when the update has no Cursor item', async () => {
    vi.mocked(getRemoteRuntimeStatus).mockClear()
    expect(await prepareHostUiUpdates({ statusBarItems: ['claude'] })).toEqual({
      statusBarItems: ['claude']
    })
    expect(getRemoteRuntimeStatus).not.toHaveBeenCalled()
  })
})
