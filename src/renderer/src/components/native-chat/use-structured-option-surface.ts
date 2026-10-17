import { useMemo } from 'react'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'

/** Fork: the structured chat's option surface, with the re-read the picker runs when it opens. */
export function useStructuredOptionSurface(
  snapshot: SessionOptionDescriptor[],
  setOption: SessionOptionsSurface['setOption'],
  refresh: () => void
): SessionOptionsSurface {
  return useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => snapshot,
      refresh,
      setOption,
      invokeAction: async () => ({ snapshot }),
      subscribe: () => () => {}
    }),
    [setOption, snapshot, refresh]
  )
}
