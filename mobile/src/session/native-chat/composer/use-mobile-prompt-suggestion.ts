import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import type { TextInput } from 'react-native'
import type { MobileNativeChatController } from '../mobile-native-chat-controller-contract'

export type MobilePromptSuggestionSource = {
  scopeKey?: string
  text?: string | null
  read?: () => Promise<string | null>
}

/** What the chat's own draft field offers; queued-message editors sit outside its provider. */
export type MobileNativeChatFieldSuggestion = MobilePromptSuggestionSource & {
  scopeKey: string
  enabled: boolean
  getEditGeneration: () => number
  getFocusGeneration: () => number
}

/** Offered only to an idle, connected chat with an empty, unattached draft and no prompt card. */
export function mobileNativeChatFieldSuggestion(
  controller: MobileNativeChatController,
  route: {
    scopeKey: string
    blocked: boolean
    attachmentCount: number
    getFocusGeneration: () => number
  }
): MobileNativeChatFieldSuggestion {
  const structured = controller.nativeChatStructured
  const agent = controller.nativeChatAgent
  // Claude's dim suggestion is read from its terminal; structured hosts publish Claude's and Codex's.
  const agentOffers = agent === 'claude' || (structured && agent === 'codex')
  return {
    scopeKey: route.scopeKey,
    ...(structured
      ? { text: controller.nativeChatPromptSuggestion }
      : { read: controller.nativeChatReadTerminalPromptSuggestion }),
    enabled:
      agentOffers &&
      !route.blocked &&
      route.attachmentCount === 0 &&
      controller.nativeChatSession.status === 'ready' &&
      !controller.nativeChatTurnActive &&
      !(
        controller.nativeChatAsk ??
        controller.nativeChatQuestion ??
        controller.nativeChatPermission
      ) &&
      !controller.nativeChatCollapsedPrompt &&
      controller.nativeChatSessionOptions?.controller.pendingId == null,
    getEditGeneration: controller.getChatComposerEditGeneration,
    getFocusGeneration: route.getFocusGeneration
  }
}

export const MobileNativeChatPromptSuggestionContext =
  createContext<MobileNativeChatFieldSuggestion | null>(null)

/** Suggestions only edit drafts; an async terminal read must still belong to the same empty field. */
export function useMobilePromptSuggestion(args: {
  source?: MobilePromptSuggestionSource
  scopeKey: string
  enabled: boolean
  value: string
  onAccept: (text: string) => void
  getEditGeneration: () => number
  getFocusGeneration?: () => number
}) {
  const { source, scopeKey, enabled, value } = args
  const read = source?.read
  const [sample, setSample] = useState<{ scope: string; read: typeof read; text: string | null }>()
  const [dismissed, setDismissed] = useState<{ scope: string; text: string }>()
  const current = useRef(args)
  const generation = useRef(0)
  useLayoutEffect(() => {
    current.current = args
  })
  useLayoutEffect(() => {
    generation.current += 1
    return () => {
      generation.current += 1
    }
  }, [scopeKey, enabled, value, read, source?.text])
  const visible = enabled && value === ''
  useEffect(() => {
    if (!visible || !read) {
      return
    }
    let cancelled = false
    let pending = false
    const poll = async () => {
      if (pending) {
        return
      }
      pending = true
      const text = await read().catch(() => null)
      pending = false
      if (cancelled) {
        return
      }
      setSample({ scope: scopeKey, read, text })
    }
    const timer = setInterval(() => void poll(), 1_000)
    void poll()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [read, scopeKey, visible])
  const candidate = read
    ? sample?.scope === scopeKey && sample.read === read
      ? sample.text
      : null
    : source?.text
  const text =
    visible &&
    typeof candidate === 'string' &&
    candidate.trim() &&
    !(dismissed?.scope === scopeKey && dismissed.text === candidate)
      ? candidate
      : null
  const accept = useCallback(async () => {
    if (!text || !current.current.enabled || current.current.value !== '') {
      return
    }
    const before = generation.current
    const editGeneration = current.current.getEditGeneration()
    const focusGeneration = current.current.getFocusGeneration?.()
    if (read && (await read().catch(() => null)) !== text) {
      return
    }
    if (
      before !== generation.current ||
      editGeneration !== current.current.getEditGeneration() ||
      focusGeneration !== current.current.getFocusGeneration?.() ||
      current.current.scopeKey !== scopeKey ||
      !current.current.enabled ||
      current.current.value !== ''
    ) {
      return
    }
    setDismissed({ scope: scopeKey, text })
    generation.current += 1
    current.current.onAccept(text)
  }, [read, scopeKey, text])
  const dismiss = () => {
    generation.current += 1
    if (text) {
      setDismissed({ scope: scopeKey, text })
    }
  }
  return { text, accept, dismiss }
}

const NO_EDITS = () => 0

export function useMobileNativeChatFieldSuggestion(
  value: string,
  onChangeText: ((text: string) => void) | undefined,
  ref: RefObject<TextInput | null>
) {
  const offer = use(MobileNativeChatPromptSuggestionContext)
  return useMobilePromptSuggestion({
    source: offer ?? undefined,
    scopeKey: offer?.scopeKey ?? '',
    enabled: offer?.enabled === true && onChangeText !== undefined,
    value,
    getEditGeneration: offer?.getEditGeneration ?? NO_EDITS,
    getFocusGeneration: offer?.getFocusGeneration,
    onAccept: (text) => {
      onChangeText?.(text)
      ref.current?.focus()
    }
  })
}
