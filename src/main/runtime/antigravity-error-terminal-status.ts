import type {
  AgentStatusIpcPayload,
  ParsedAgentStatusPayload
} from '../../shared/agent-status-types'
import { readAntigravityNativeError } from '../../shared/antigravity-native-error'
import { createTerminalEscapeScanner } from '../../shared/terminal-escape-scanner'
import type { HeadlessEmulator } from '../daemon/headless-emulator'

type ErrorStatus = Pick<
  AgentStatusIpcPayload,
  'agentType' | 'prompt' | 'model' | 'subagents' | 'mainAgent' | 'turnStartedAt'
>

class AntigravityErrorTracker {
  private tail = ''
  private pending = false
  private pendingChars = 0
  private lastId: string | undefined
  private readonly scanner = createTerminalEscapeScanner({
    onCsi: () => {},
    onText: (text) => {
      const candidate = this.tail + text
      if (candidate.includes('ErrID:') || candidate.includes('Error ID:')) {
        this.pending = true
        this.pendingChars = 0
      }
      this.tail = candidate.slice(-128)
      this.pendingChars += text.length
    }
  })

  observe(emulator: HeadlessEmulator, data: string): string | null {
    this.scanner.observe(data)
    if (!this.pending || emulator.isSynchronizedOutput) {
      return null
    }
    const error = readAntigravityNativeError(emulator.getVisibleLines())
    if (!error) {
      if (this.pendingChars > 4096) {
        this.pending = false
      }
      return null
    }
    this.pending = false
    this.tail = ''
    if (error.id === this.lastId) {
      return null
    }
    this.lastId = error.id
    return error.text
  }
}

const trackers = new WeakMap<HeadlessEmulator, AntigravityErrorTracker>()

export function observeAntigravityErrorTerminalStatus(
  emulator: HeadlessEmulator,
  data: string,
  launchAgent: string | null | undefined,
  readStatus: () => ErrorStatus | undefined,
  outputObservedAt = Date.now()
): ParsedAgentStatusPayload | null {
  let tracker = trackers.get(emulator)
  if (!tracker) {
    if (launchAgent !== 'antigravity' && !data.includes('⚠')) {
      return null
    }
    if (launchAgent !== 'antigravity' && readStatus()?.agentType !== 'antigravity') {
      return null
    }
    tracker = new AntigravityErrorTracker()
    trackers.set(emulator, tracker)
  }
  const text = tracker.observe(emulator, data)
  if (!text) {
    return null
  }
  const previous = readStatus()
  if (previous && previous.agentType !== 'antigravity') {
    return null
  }
  if (previous?.turnStartedAt !== undefined && previous.turnStartedAt >= outputObservedAt) {
    return null
  }
  return {
    state: 'done',
    agentType: 'antigravity',
    prompt: previous?.prompt ?? '',
    model: previous?.model,
    subagents: previous?.subagents,
    lastAssistantMessage: text,
    lastAssistantMessageIsToolOutput: true,
    mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() }
  }
}
