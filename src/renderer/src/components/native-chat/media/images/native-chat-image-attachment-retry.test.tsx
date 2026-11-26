// @vitest-environment happy-dom

import { act, createElement } from 'react'

import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetLocalImageCacheState as resetLocalImageSrcStateForTests } from '@/components/editor/document-images/local-image-src-cache'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { NativeChatImageAttachments } from './NativeChatImageAttachments'

// Chat images carry their runtime owner without resolving an editor connection.
const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  getConnectionIdForFile: vi.fn(() => {
    throw new Error('Chat image fixtures must not resolve editor file connections')
  })
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: mocks.callRuntimeRpc
}))
vi.mock('@/lib/workspace/ownership/connection-context', () => ({
  getConnectionIdForFile: mocks.getConnectionIdForFile
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function runtimeContext(worktreeId: string): RuntimeFileOperationArgs {
  return {
    target: { kind: 'local' as const },
    worktreeId,
    worktreePath: `/repo/${worktreeId}`,
    expectedExecutionHostId: 'local'
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  mocks.callRuntimeRpc.mockReset().mockResolvedValue({
    content: 'AA==',
    isBinary: true,
    mimeType: 'image/png'
  })
  resetLocalImageSrcStateForTests()
  vi.stubGlobal('IntersectionObserver', undefined)
  let urlSequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:owner-${++urlSequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  window.api = {
    fs: {
      readFile: vi.fn().mockResolvedValue({
        content: 'AA==',
        isBinary: true,
        mimeType: 'image/png'
      })
    }
  } as unknown as Window['api']
})

afterEach(() => {
  resetLocalImageSrcStateForTests()
  vi.unstubAllGlobals()
  try {
    expect(mocks.getConnectionIdForFile).not.toHaveBeenCalled()
  } finally {
    mocks.getConnectionIdForFile.mockClear()
    vi.restoreAllMocks()
  }
})

describe('NativeChatImageAttachments retries', () => {
  it('recovers a newly sent image when its first read is temporarily unavailable', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const root = createRoot(container)
    vi.mocked(window.api.fs.readFile).mockRejectedValueOnce(new Error('Image not ready'))
    try {
      await act(async () => {
        root.render(
          createElement(NativeChatImageAttachments, {
            blocks: [{ type: 'image-ref', path: '/repo/orca-paste-new.png' }],
            runtimeContext: runtimeContext('wt-1')
          })
        )
        await flushPromises()
      })
      expect(container.querySelector('img')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:owner-1')
      expect(window.api.fs.readFile).toHaveBeenCalledTimes(2)
    } finally {
      root.unmount()
      vi.useRealTimers()
    }
  })

  it('bounds failed image retries and cancels them when the preview unmounts', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const root = createRoot(container)
    vi.mocked(window.api.fs.readFile).mockRejectedValue(new Error('Unavailable'))
    const render = (path: string) =>
      root.render(
        createElement(NativeChatImageAttachments, {
          blocks: [{ type: 'image-ref', path }],
          runtimeContext: runtimeContext('wt-1')
        })
      )
    try {
      await act(async () => {
        render('/repo/missing.png')
        await flushPromises()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(window.api.fs.readFile).toHaveBeenCalledTimes(3)
      await act(async () => {
        render('/repo/other.png')
        await flushPromises()
      })
      expect(window.api.fs.readFile).toHaveBeenCalledTimes(4)
      root.unmount()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(window.api.fs.readFile).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})
