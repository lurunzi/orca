import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import { bindTerminalTextFieldSubmit } from './terminal-text-field-submit-binding'

/**
 * A ref for a terminal text field that also binds the platform's submit signal to it.
 *
 * A callback ref rather than an effect over `fieldRef.current`: the field mounts and unmounts with
 * the mode it belongs to, and no prop or dependency marks that, so an effect would keep a listener
 * on a detached node. React reports both edges here.
 *
 * The handler ref is refreshed on every commit rather than when the callback identity changes.
 * That is the whole reason it exists: callers pass per-render closures — the buffered field's
 * submit reads `client` and `activeHandle`, which arrive in effects — and a binding that trusted a
 * caller's memoization held a handler whose guard could never pass. An effect rather than a render
 * assignment, because an uncommitted render must not move it.
 */
export function useTerminalTextFieldSubmitBinding(
  fieldRef: RefObject<TextInput | null>,
  onSubmit: () => void
): (node: TextInput | null) => void {
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  })
  const unbindRef = useRef<(() => void) | null>(null)

  return useCallback(
    (node: TextInput | null): void => {
      fieldRef.current = node
      unbindRef.current?.()
      unbindRef.current = node
        ? bindTerminalTextFieldSubmit(node, () => onSubmitRef.current())
        : null
    },
    [fieldRef]
  )
}
