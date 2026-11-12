import {
  resolveAntigravityChatFullAccessApprovals,
  type AntigravityChatFullAccessApprovals
} from '../../shared/antigravity-chat-full-access-approvals'
import type { RuntimeStore } from '../runtime/construction/runtime-store-contract'

type ApprovalsStore = Pick<RuntimeStore, 'getSettings' | 'updateSettingsAndFlush'>

export function readAntigravityChatFullAccessApprovals(
  store: Pick<RuntimeStore, 'getSettings'>
): AntigravityChatFullAccessApprovals {
  return resolveAntigravityChatFullAccessApprovals(
    store.getSettings().antigravityChatFullAccessApprovals
  )
}

// Running chats keep their launch; the next launch, including a permission change, reads it.
export async function applyAntigravityChatFullAccessApprovals(
  store: ApprovalsStore,
  approvals: AntigravityChatFullAccessApprovals
): Promise<AntigravityChatFullAccessApprovals> {
  if (readAntigravityChatFullAccessApprovals(store) === approvals) {
    return approvals
  }
  if (!store.updateSettingsAndFlush) {
    throw new Error(
      'Antigravity approval settings cannot be saved on this host. Update Orca and try again.'
    )
  }
  await store.updateSettingsAndFlush(
    { antigravityChatFullAccessApprovals: approvals },
    { notifyListeners: true }
  )
  return readAntigravityChatFullAccessApprovals(store)
}
