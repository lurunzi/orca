import { useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useImeEnterGestureOwnership } from '@/lib/ime-composition-keyboard-event'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import { useNativeChatDraft } from './use-native-chat-draft'

export function CursorTranscriptComposer({
  scopeKey,
  ready,
  resume,
  onSendingChange
}: {
  scopeKey: string
  ready: boolean
  resume: (prompt: string) => Promise<boolean>
  onSendingChange?: (sending: boolean) => void
}): React.JSX.Element {
  const input = useRef<NativeChatComposerInput | null>(null)
  const ime = useImeEnterGestureOwnership()
  const { draft, setDraft, flushDraftAppends } = useNativeChatDraft(scopeKey, ime.isComposing)
  const pending = useRef(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async (): Promise<void> => {
    const text = input.current?.value ?? draft
    if (!ready || pending.current || !text.trim() || ime.isComposing()) {
      return
    }
    pending.current = true
    setSending(true)
    onSendingChange?.(true)
    setError(null)
    try {
      if (await resume(text)) {
        setDraft((current) => (current === text ? '' : current))
        if (input.current?.value === text) {
          input.current.value = ''
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setSending(false)
      onSendingChange?.(false)
    }
  }
  const label = translate(
    'components.native-chat.cursorTranscript.resumeAndSend',
    'Resume and send'
  )
  return (
    <div className="shrink-0 px-4 pb-3 pt-2">
      <div className="mx-auto w-full max-w-(--chat-content-max-width)">
        {error ? (
          <p role="alert" className="mb-2 text-sm text-foreground">
            {error}
          </p>
        ) : null}
        <div className="rounded-xl border border-chat-composer-border bg-chat-composer-surface p-1.5 shadow-xs">
          <NativeChatPromptEditor
            scopeKey={scopeKey}
            inputRef={input}
            initialValue={draft}
            disabled={sending}
            placeholder={translate(
              'components.native-chat.cursorTranscript.placeholder',
              'Continue this conversation in Orca'
            )}
            onChange={(editor) => setDraft(editor.value)}
            onSelect={() => undefined}
            onCompositionStart={() => ime.setComposing(true)}
            onCompositionEnd={() => {
              ime.onCompositionEnd()
              flushDraftAppends()
            }}
            onKeyUp={ime.onKeyUp}
            onKeyDownCapture={(event) => {
              if (!ime.ownsKeyDown(event) && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            className="scrollbar-sleek max-h-48 min-h-16 overflow-y-auto rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button
              size="icon-sm"
              aria-label={label}
              title={label}
              disabled={!ready || sending || !draft.trim()}
              onClick={() => void send()}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
