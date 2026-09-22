import { useEffect, useRef } from 'react'
import { usePageBridgeClient } from '../transport/client-context.web'
import type { BackClaim } from './use-back-claim'

/**
 * Web sibling: the key belongs to the shell, so the page claims it rather than intercepting it.
 *
 * A claim is one notify, posted only when this document goes from holding nothing to holding
 * something and back; the press arrives as a `back` frame and is offered to the newest claim first.
 * A shell too old to hear the claim keeps the key and pops the screen, which is what it does today.
 */
export function useBackClaim(claim: BackClaim): void {
  // Both held rather than depended on. The handler because a caller rebuilds it every render, and
  // the client because a document holds exactly one for its lifetime: a replaced client is a
  // replaced document, and re-registering on its identity would post a frame per render instead.
  const client = usePageBridgeClient()
  const latest = useRef({ claim, client })
  latest.current = { claim, client }
  const claimed = claim !== null

  useEffect(() => {
    if (!claimed) {
      return
    }
    return latest.current.client.claimBack(() => latest.current.claim?.() ?? false)
  }, [claimed])
}
