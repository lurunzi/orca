import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import {
  useTerminalWebViewController,
  type TerminalWebViewTransport
} from './use-terminal-webview-controller'

vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }))

vi.mock('./terminal-webview-engine-error-state', () => ({
  useTerminalWebViewEngineErrorState: () => ({
    clearEngineError: vi.fn(),
    engineError: null,
    reportEngineError: vi.fn(),
    reportNativeEngineError: vi.fn()
  })
}))

let root: ReactTestRenderer | undefined

function mountController(interactionActive = true) {
  const post = vi.fn<TerminalWebViewTransport['post']>()
  const onTerminalInput = vi.fn()
  const exposed: { current: ReturnType<typeof useTerminalWebViewController> | null } = {
    current: null
  }
  const transport = { post, pingsOnForegroundRecovery: () => false }
  function Probe() {
    exposed.current = useTerminalWebViewController(
      { onTerminalInput, interactionActive },
      transport
    )
    return null
  }
  act(() => {
    root = create(<Probe />)
  })
  const controller = exposed.current
  if (!controller) {
    throw new Error('Controller did not mount')
  }
  act(() => controller.receive({ type: 'web-ready' }))
  return { controller, post }
}

describe('terminal prompt suggestion reads', () => {
  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
  })

  it('flushes queued output before a suggestion read and resolves its document reply', async () => {
    const { controller, post } = mountController()
    controller.handle.write('queued output')
    const pending = controller.handle.readPromptSuggestion!()
    const request = post.mock.calls.at(-1)![0]
    expect(request.type).toBe('read-prompt-suggestion')
    if (request.type !== 'read-prompt-suggestion') {
      throw new Error('Expected suggestion request')
    }
    controller.receive({
      type: 'prompt-suggestion',
      requestId: request.requestId,
      text: 'Write tests'
    })
    expect(await pending).toBe('Write tests')
    expect(post.mock.calls.some(([message]) => message.type === 'write')).toBe(true)
  })

  it('invalidates pending suggestion reads on clear and document replacement', async () => {
    const { controller } = mountController()
    const pending = controller.handle.readPromptSuggestion!()
    controller.handle.clear()
    expect(await pending).toBeNull()
    const replaced = controller.handle.readPromptSuggestion!()
    controller.resetReadiness()
    expect(await replaced).toBeNull()
    expect(await controller.handle.readPromptSuggestion!()).toBeNull()
  })
})
