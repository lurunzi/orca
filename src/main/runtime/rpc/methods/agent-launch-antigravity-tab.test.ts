import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetAgentLaunchPanesForTests } from '../../../agent-launch/agent-launch-pane-attachment'
import { publishAgentLaunchTabEarly } from './agent-launch-tab-publication'
import { rpcContext, runtimeStub } from './agent-launch.test-fixture'
import { agentLaunchWorkspaceFactory } from './agent-launch-worktree-creation'

afterEach(() => resetAgentLaunchPanesForTests())

describe('Antigravity early tab view', () => {
  it.each([true, false])(
    'carries the desktop preference %s into a new worktree',
    async (enabled) => {
      const runtime = runtimeStub({ settings: { nativeChatProviders: { antigravity: !enabled } } })
      const factory = agentLaunchWorkspaceFactory(rpcContext(runtime, {}), 'antigravity')
      await factory.createWorktree({
        create: { repo: 'repo-1', name: 'review' },
        startupAgent: 'antigravity',
        nativeChatDefault: enabled
      })
      expect(runtime.createManagedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          startupAgent: 'antigravity',
          startupViewMode: enabled ? 'chat' : 'terminal'
        })
      )
    }
  )

  it.each([true, false])(
    'uses the Chat UI preference %s for a terminal-only cwd',
    async (enabled) => {
      const publish = vi.fn(async () => ({
        tabId: 'tab-1',
        created: true,
        placement: { groupId: 'group-1' }
      }))
      const runtime = runtimeStub({
        settings: { nativeChatProviders: { antigravity: enabled } },
        publishAgentLaunchTab: publish
      })
      const early = await publishAgentLaunchTabEarly(
        {
          agent: 'antigravity',
          cwd: join(tmpdir(), 'orca-antigravity-outside-workspace'),
          target: { kind: 'existing', worktree: 'id:wt-7' }
        },
        rpcContext(runtime, {})
      )
      expect(early).not.toBeNull()
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          launchAgent: 'antigravity',
          viewMode: enabled ? 'chat' : 'terminal'
        })
      )
      early?.finish()
    }
  )
})
