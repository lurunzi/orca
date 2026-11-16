import type { Editor } from '@tiptap/react'
import { useLayoutEffect } from 'react'

/** Fork: repaints a changed placeholder, such as a prompt suggestion, without adding an undo step. */
export function useNativeChatPlaceholderRepaint(editor: Editor | null, placeholder: string): void {
  useLayoutEffect(() => {
    if (editor) {
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
    }
  }, [editor, placeholder])
}
