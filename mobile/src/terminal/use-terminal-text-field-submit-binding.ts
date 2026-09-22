import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import { bindTerminalTextFieldSubmit } from './terminal-text-field-submit-binding'

/**
 * A ref for the live input that also binds the platform's submit signal to it.
 *
 * A callback ref rather than an effect over `liveInputRef.current`: the field mounts and unmounts
 * with `liveInputEnabled`, and no prop or dependency marks that, so an effect would keep a
 * listener on a detached node. React reports both edges here.
 */
export function useTerminalTextFieldSubmitBinding(
  liveInputRef: RefObject<TextInput | null>,
  onSubmit: () => void
): (node: TextInput | null) => void {
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])
  const unbindRef = useRef<(() => void) | null>(null)

  return useCallback(
    (node: TextInput | null): void => {
      liveInputRef.current = node
      unbindRef.current?.()
      unbindRef.current = node
        ? bindTerminalTextFieldSubmit(node, () => onSubmitRef.current())
        : null
    },
    [liveInputRef]
  )
}
