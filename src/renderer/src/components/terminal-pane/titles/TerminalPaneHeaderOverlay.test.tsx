/**
 * @vitest-environment happy-dom
 */
import type * as I18n from '@/i18n/i18n'
import { act, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import path from 'node:path'
import { isTerminalLeafId } from '../../../../../shared/workspace-layout/stable-pane-id'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from '../pty-transport/pty-transport-types'
import type { AppState } from '../../../store/types'
import TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
vi.mock('@/store/index', () => ({
  useAppStore: Object.assign((selector: (state: Partial<AppState>) => unknown) => selector({}), {
    getState: () => ({
      settings: { activeRuntimeEnvironmentId: null },
      repos: [{ id: 'repo1', connectionId: null, executionHostId: 'local' }],
      worktreesByRepo: { repo1: [{ id: 'wt-1', repoId: 'repo1', hostId: 'local', path: '/repo' }] },
      detectedWorktreesByRepo: {},
      folderWorkspaces: [],
      sshConnectionStates: new Map()
    })
  })
}))
vi.mock('../input/terminal-input-activity', () => ({ recordTerminalUserInputForLeaf: vi.fn() }))
vi.mock('../chat/TerminalPaneResumeInChatButton', () => ({
  TerminalPaneResumeInChatButton: () => <button type="button">Continue in Chat UI</button>
}))

const mounted: { container: HTMLDivElement; root: Root }[] = []

function makePane(id: number): ManagedPane {
  const leafId = `00000000-0000-4000-8000-00000000000${id}`
  if (!isTerminalLeafId(leafId)) {
    throw new Error('Invalid test leaf')
  }
  return {
    id,
    leafId,
    stablePaneId: leafId,
    container: document.createElement('div'),
    linkTooltip: document.createElement('div'),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Drops only call focus on the test terminal.
    terminal: { focus: vi.fn() } as unknown as ManagedPane['terminal'],
    fitAddon: {} as ManagedPane['fitAddon'],
    searchAddon: {} as ManagedPane['searchAddon'],
    serializeAddon: {} as ManagedPane['serializeAddon']
  }
}

function renderOverlay({
  paneTitles,
  paneCount = 2,
  showAlwaysOnHeaders = true,
  showSplitButton = true,
  isTabPinned = false,
  onClosePane = vi.fn(),
  onRemoveTitle = vi.fn(),
  onRenameSubmit = vi.fn(),
  canContinueAgentSessionInNewSession = false,
  onContinueAgentSessionInNewSession = vi.fn(),
  canShowTerminal = false,
  canShowChat = false,
  onToggleNativeChat = vi.fn(),
  canResumeInNewNativeChat = false,
  renameValue = '',
  renamingPaneId = null,
  dropSetup
}: {
  paneTitles: Record<number, string>
  paneCount?: number
  showAlwaysOnHeaders?: boolean
  showSplitButton?: boolean
  isTabPinned?: boolean
  onClosePane?: ReturnType<typeof vi.fn>
  onRemoveTitle?: ReturnType<typeof vi.fn>
  onRenameSubmit?: ReturnType<typeof vi.fn>
  canContinueAgentSessionInNewSession?: boolean
  onContinueAgentSessionInNewSession?: ReturnType<typeof vi.fn>
  canShowTerminal?: boolean
  canShowChat?: boolean
  onToggleNativeChat?: () => void
  canResumeInNewNativeChat?: boolean
  renameValue?: string
  renamingPaneId?: number | null
  dropSetup?: {
    panes: ManagedPane[]
    manager: PaneManager
    transports: Map<number, PtyTransport>
    activate: (id: number) => void
  }
}): {
  container: HTMLDivElement
  onClosePane: ReturnType<typeof vi.fn>
  onRemoveTitle: ReturnType<typeof vi.fn>
  onRenameSubmit: ReturnType<typeof vi.fn>
} {
  const panes = dropSetup?.panes ?? [makePane(1), makePane(2)].slice(0, paneCount)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TerminalPaneHeaderOverlay
        tabId="tab-1"
        worktreeId="wt-1"
        cwd={path.join(path.sep, 'tmp')}
        showAlwaysOnHeaders={showAlwaysOnHeaders}
        showSplitButton={showSplitButton}
        isTabPinned={isTabPinned}
        paneCount={paneCount}
        activePaneId={1}
        panes={panes}
        paneTitles={paneTitles}
        paneTitleOverlayRects={{
          1: { left: 0, top: 0, width: 200 },
          2: { left: 220, top: 0, width: 200 }
        }}
        renamingPaneId={renamingPaneId}
        renameValue={renameValue}
        renameInputRef={createRef<HTMLInputElement>()}
        titleUsesLightSurface={false}
        paneTitleBackground="transparent"
        terminalContentVisible
        hiddenStartupStyle={{}}
        managerRef={{ current: dropSetup?.manager ?? null }}
        paneTransportsRef={{ current: dropSetup?.transports ?? new Map<number, PtyTransport>() }}
        canContinueAgentSessionInNewSession={canContinueAgentSessionInNewSession}
        onContinueAgentSessionInNewSession={
          onContinueAgentSessionInNewSession as (pane: ManagedPane) => void
        }
        canShowTerminal={canShowTerminal}
        canShowChat={canShowChat}
        onToggleNativeChat={onToggleNativeChat}
        canResumeInNewNativeChat={canResumeInNewNativeChat}
        onSplitPane={vi.fn()}
        onBeginPaneDrag={vi.fn()}
        onActivatePaneTitleInteraction={dropSetup?.activate ?? vi.fn()}
        onPaneTitleContextMenu={vi.fn()}
        onStartRename={vi.fn()}
        onRemoveTitle={onRemoveTitle as (paneId: number) => void}
        onClosePane={onClosePane as (paneId: number) => void}
        onRenameValueChange={vi.fn()}
        onRenameSubmit={onRenameSubmit as () => void}
        onRenameCancel={vi.fn()}
        onRenameBlur={vi.fn()}
      />
    )
  })
  mounted.push({ container, root })
  return { container, onClosePane, onRemoveTitle, onRenameSubmit }
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('TerminalPaneHeaderOverlay', () => {
  it('switches the active supported terminal into chat from its header', () => {
    const onToggleNativeChat = vi.fn()
    const { container } = renderOverlay({ paneTitles: {}, canShowChat: true, onToggleNativeChat })
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Continue in Chat UI"]'
    )
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('.pane-title-bar')?.hasAttribute('data-active-pane')).toBe(true)
    act(() => buttons[0].click())
    expect(onToggleNativeChat).toHaveBeenCalledOnce()
  })
})
