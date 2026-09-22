import { BRIDGE_PROTOCOL_VERSION, type BridgeHostMessage } from './bridge/bridge-envelope'
import { BRIDGE_BACK_FRAME } from './bridge/bridge-page-back'

/**
 * One host's end of the device Back key: what the document on the other side claimed, and whether
 * a press can be handed to it.
 *
 * Its own module because the claim is the one page fact with a staleness hazard of its own. A claim
 * that outlived its document would have the shell hand Back to a page with nothing to do with it,
 * which is a key that does nothing at all — so every way a document ends drops it here, and the
 * reader above never has to remember to.
 */
export type BridgeHostBack = {
  /** A document has spoken: it takes what it named, and claims nothing until it says otherwise. */
  readonly readReady: (accepts: readonly string[]) => void
  /** The page holding Back, or letting it go. */
  readonly readClaim: (claimed: boolean) => void
  /**
   * Posts one press. False when this page never said it takes one — every page older than the
   * frame — and the caller then leaves Back to the navigator, which is what it did before this.
   */
  readonly send: () => boolean
  /** The document is gone; whatever it claimed goes with it. */
  readonly drop: () => void
}

export function createBridgeHostBack(args: {
  send: (frame: BridgeHostMessage) => void
  /** Whether a document holds the view and has had its `init`. */
  deliverable: () => boolean
  onClaim: (claimed: boolean) => void
}): BridgeHostBack {
  let accepts: readonly string[] = []
  let claimed = false

  function drop(): void {
    if (!claimed) {
      return
    }
    claimed = false
    args.onClaim(false)
  }

  return {
    readReady: (next) => {
      accepts = next
      drop()
    },
    readClaim: (next) => {
      if (next === claimed) {
        return
      }
      claimed = next
      args.onClaim(next)
    },
    send: () => {
      if (!accepts.includes(BRIDGE_BACK_FRAME) || !args.deliverable()) {
        return false
      }
      args.send({ v: BRIDGE_PROTOCOL_VERSION, type: BRIDGE_BACK_FRAME })
      return true
    },
    drop
  }
}
