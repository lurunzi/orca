import { getPiStateTitleStatus } from '../../shared/pi-state-title-marker'
import type { RuledScreen } from './screen-input-veto'

/** Unparsed output cannot rule out an OMP overlay; its heading also occurs in ordinary answers. */
export function isOmpScreenInputVeto(screen: RuledScreen): boolean {
  return screen.alternateScreen || screen.pendingOutput === true
}

/** OMP paints its idle title before setup too, so it cannot prove composer readiness. */
export function isOmpIdleStateTitle(title: string | null | undefined): boolean {
  return title !== null && title !== undefined && getPiStateTitleStatus(title) === 'idle'
}
