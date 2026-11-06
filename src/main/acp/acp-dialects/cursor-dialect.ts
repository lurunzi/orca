import type { AcpDialect } from './acp-dialect'
import { CURSOR_EFFORT_OPTION_IDS, CURSOR_FAST_OPTION_ID } from './cursor-model-catalog'
import { CURSOR_SESSIONLESS_REQUESTS, cursorRequest, cursorSettleRequest } from './cursor-requests'

export const CURSOR_ACP_DIALECT: AcpDialect = {
  request: cursorRequest,
  settleRequest: cursorSettleRequest,
  sessionlessRequests: CURSOR_SESSIONLESS_REQUESTS,
  effortOptionIds: CURSOR_EFFORT_OPTION_IDS,
  fastOptionId: CURSOR_FAST_OPTION_ID
}
