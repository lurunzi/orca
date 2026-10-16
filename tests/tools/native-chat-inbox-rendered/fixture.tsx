import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import { setRendererUiLanguage } from '../../../src/renderer/src/i18n/i18n'
import { NativeChatInboxButton } from '../../../src/renderer/src/components/native-chat/NativeChatInboxButton'
import { useNativeChatInbox } from '../../../src/renderer/src/components/native-chat/use-native-chat-inbox'
import type {
  AgentJournalRenderItem,
  AgentJournalToolCallState
} from '../../../src/shared/agent-session-journal-types'
import { sessionInboxToolName } from '../../../src/shared/session-inbox-tool-contract'
import './fixture.css'

const params = new URLSearchParams(window.location.search)
const language = params.get('lang') === 'zh' ? 'zh' : 'en'
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.classList.toggle('dark', theme === 'dark')
document.documentElement.lang = language
localStorage.clear()

let sequence = 0
const now = Date.now()
function item(body: AgentJournalRenderItem['body'], minutesAgo: number): AgentJournalRenderItem {
  sequence += 1
  return {
    itemId: `item-${sequence}`,
    sequence,
    revision: 1,
    observedAt: now - minutesAgo * 60_000,
    body
  }
}
function user(text: string, minutesAgo: number): AgentJournalRenderItem {
  return item({ kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }, minutesAgo)
}
function tool(
  name: string,
  input: unknown,
  minutesAgo: number,
  state: AgentJournalToolCallState = 'completed',
  output = ''
): AgentJournalRenderItem {
  const bounded = { head: output, byteLength: output.length, digest: 'fixture', truncated: false }
  return item({ kind: 'tool-call', name, input, state, output: bounded }, minutesAgo)
}

// What a Claude session journals, recorded through the inbox tools and Bash.
const ITEMS: AgentJournalRenderItem[] = [
  user('Make the retry client survive token expiry', 31),
  tool(
    sessionInboxToolName('record_finding'),
    {
      kind: 'issue',
      title: 'Retry loop never gives up on a 401',
      detail: 'It retries forever when the token is revoked; cap it and surface sign-in.',
      path: 'src/net/retry-client.ts'
    },
    30
  ),
  tool(
    'Bash',
    { command: 'pnpm vitest run src/net' },
    27,
    'failed',
    'Exit code 1\n FAIL  src/net/retry-client.test.ts > gives up after five attempts\n × gives up after five attempts\n Tests  2 failed | 174 passed (176)'
  ),
  tool(
    'Edit',
    { file_path: '/repo/src/net/retry-client.ts', old_string: 'a', new_string: 'b' },
    26
  ),
  tool(
    sessionInboxToolName('record_question'),
    {
      question: 'Should a revoked token sign the user out, or only stop the retries?',
      options: ['Sign out', 'Stop retrying only'],
      recommended: 'Stop retrying only'
    },
    25
  ),
  tool(
    sessionInboxToolName('record_finding'),
    {
      kind: 'opportunity',
      title: 'Share the backoff helper with the upload queue',
      detail: 'Both copies drift; one helper would keep their limits in step.'
    },
    24
  )
]

function App(): React.JSX.Element {
  const [log, setLog] = useState<{ id: string; text: string }[]>([])
  const record = (text: string): void => {
    const entry = { id: crypto.randomUUID(), text }
    setLog((entries) => [...entries, entry])
  }
  const inbox = useNativeChatInbox({
    enabled: true,
    sessionId: 'fixture-session',
    target: { kind: 'local' },
    journalItems: ITEMS,
    hasOlder: false,
    isWorking: false,
    root: '/repo',
    send: (text) => {
      record(`sent: ${text}`)
      return true
    },
    insertIntoComposer: (text) => {
      record(`composer: ${text}`)
      return true
    },
    jumpToMessage: (messageId) => record(`jump: ${messageId}`)
  })
  return (
    <TooltipProvider>
      <main className="flex h-screen flex-col bg-background text-foreground">
        <div className="relative h-[560px] w-[760px] border-b border-border">
          <div className="absolute top-1 right-1 z-20 flex items-center">
            <NativeChatInboxButton inbox={inbox} agentLabel="Claude" />
          </div>
          <p className="p-4 text-sm text-muted-foreground">Chat transcript</p>
        </div>
        <ol data-fixture-log="true" className="p-2 font-mono text-xs">
          {log.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ol>
      </main>
    </TooltipProvider>
  )
}

const root = document.getElementById('root')
void setRendererUiLanguage(language).then(() => {
  if (root) {
    createRoot(root).render(<App />)
  }
})
