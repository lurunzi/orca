// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { AgentChildWorkView } from '../../../../shared/agent-status/child-work/agent-status-child-work-view'
import { NativeChatBackgroundTasksStatus } from './NativeChatBackgroundTasksStatus'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('shows the agent a background shell runs instead of the shell icon', () => {
  const view = (overrides: Partial<AgentChildWorkView>): AgentChildWorkView => ({
    id: 'child',
    kind: 'command',
    state: 'working',
    membership: 'live',
    firstObservedAt: Date.now() - 65_000,
    observedAt: Date.now() - 1_000,
    stoppable: true,
    invocation: { invocationId: 'spawn-1', generation: 1 },
    ...overrides
  })
  render(
    <NativeChatBackgroundTasksStatus
      expanded
      onExpandedChange={() => {}}
      isVisible
      tasks={[]}
      settledTasks={[]}
      childViews={[
        view({ id: 'worker', description: 'Run Codex worker', agentType: 'codex' }),
        view({ id: 'dev', description: 'pnpm dev' })
      ]}
      indicatorActive
      supportsTaskStop
      offersStopAll={false}
      stoppingTaskIds={new Set()}
      stoppingAll={false}
      onStop={vi.fn()}
    />
  )

  const shell = within(screen.getByRole('list', { name: 'Shell' }))
  const worker = shell.getByText('Run Codex worker').closest('li')!
  const dev = shell.getByText('pnpm dev').closest('li')!
  expect(worker.querySelector('.lucide-square-terminal')).toBeNull()
  expect(dev.querySelector('.lucide-square-terminal')).not.toBeNull()
})

it('lets the 1 Hz tick sleep while every row has settled, with each run frozen', () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  const committed = vi.fn()
  const finished = (id: string, firstObservedAt: number, settledAt: number) => ({
    id,
    providerId: `task-${id}`,
    kind: 'agent' as const,
    description: `child ${id}`,
    state: 'done' as const,
    membership: 'settled' as const,
    outcome: 'succeeded' as const,
    firstObservedAt,
    observedAt: settledAt,
    settledAt,
    stoppable: false,
    invocation: { invocationId: `spawn-${id}`, generation: 1 }
  })
  render(
    <Profiler id="strip" onRender={committed}>
      <NativeChatBackgroundTasksStatus
        expanded
        onExpandedChange={() => {}}
        isVisible
        tasks={[]}
        settledTasks={[]}
        childViews={[finished('a', 400_000, 520_000), finished('b', 700_000, 760_000)]}
        indicatorActive
        supportsTaskStop
        offersStopAll={false}
        stoppingTaskIds={new Set()}
        stoppingAll={false}
        onStop={() => {}}
      />
    </Profiler>
  )
  const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
  expect(rows).toEqual(['child a · Agent2m 0s', 'child b · Agent1m 0s'])
  committed.mockClear()
  act(() => vi.advanceTimersByTime(5_000))
  expect(committed).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it("shows an agent by the provider's id, beside its own Stop, and leaves command rows inert", () => {
  const running = (id: string, kind: 'agent' | 'command') => ({
    id: `host-${id}`,
    providerId: `provider-${id}`,
    kind,
    description: `child ${id}`,
    state: 'working' as const,
    membership: 'live' as const,
    firstObservedAt: 1_000,
    observedAt: 2_000,
    stoppable: true,
    invocation: { invocationId: `spawn-${id}`, generation: 1 }
  })
  const onShowAgent = vi.fn()
  const onStop = vi.fn()
  render(
    <NativeChatBackgroundTasksStatus
      expanded
      onExpandedChange={() => {}}
      isVisible
      tasks={[]}
      settledTasks={[]}
      childViews={[running('a', 'agent'), running('s', 'command')]}
      indicatorActive
      supportsTaskStop
      offersStopAll={false}
      stoppingTaskIds={new Set()}
      stoppingAll={false}
      onStop={onStop}
      onShowAgent={onShowAgent}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show child a in the conversation' }))
  expect(onShowAgent).toHaveBeenCalledWith('provider-a')
  expect(onStop).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Show child s/ })).toBeNull()
})
