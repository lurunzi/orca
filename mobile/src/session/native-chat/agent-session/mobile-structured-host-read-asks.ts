import {
  type AgentSessionTextAppendCapabilities,
  agentSessionTextAppendRequest
} from '../../../../../src/shared/agent-session/view/live-read/agent-session-text-append'
import {
  readRuntimeStatusProbe,
  recordRuntimeStatusProbe
} from '../../../transport/connection/runtime-status-probe'
import { decodeHostStatusReply, readHostStatusReply } from '../../../query/host-status-query'
import { hostStatusSchema } from '../../../transport/hosts/host-status-reply-schema'
import {
  AGENT_SESSION_PROMPT_SUGGESTIONS_RUNTIME_CAPABILITY,
  AGENT_SESSION_TEXT_APPEND_RUNTIME_CAPABILITY,
  AGENT_SESSION_TOOL_OUTPUT_APPEND_RUNTIME_CAPABILITY
} from '../../../../../src/shared/agent-session/capabilities/agent-session-runtime-capabilities'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'

// Read alongside the hold, so the stream's first open knows whether to ask for appends: this
// connection's probe, else the status the shell proved (direct hosts only), else the connection's status read.
// Fork: the same read says whether to ask for prompt suggestions, which the phone shows above its composer.
export function hostReadAsks(client: RpcClient): {
  textAppend: Promise<AgentSessionTextAppendCapabilities | null>
  promptSuggestions: Promise<boolean>
} {
  const advertised = hostAdvertisedCapabilities(client)
  return {
    textAppend: advertised.then((capabilities) =>
      agentSessionTextAppendRequest({
        textAppend: capabilities.includes(AGENT_SESSION_TEXT_APPEND_RUNTIME_CAPABILITY),
        toolOutputAppend: capabilities.includes(AGENT_SESSION_TOOL_OUTPUT_APPEND_RUNTIME_CAPABILITY)
      })
    ),
    promptSuggestions: advertised.then((capabilities) =>
      capabilities.includes(AGENT_SESSION_PROMPT_SUGGESTIONS_RUNTIME_CAPABILITY)
    )
  }
}

async function hostAdvertisedCapabilities(client: RpcClient): Promise<readonly string[]> {
  let status = readRuntimeStatusProbe(client)
  const shell =
    status === undefined ? hostStatusSchema.safeParse(client.getShellHostStatus?.()) : null
  if (shell?.success) {
    status = shell.data
  } else if (status === undefined) {
    const reply = await readHostStatusReply(client, {
      timeoutMs: 15_000,
      failWhenDisconnected: true
    }).catch(() => null)
    const landed = reply ? decodeHostStatusReply(reply) : null
    if (landed) {
      recordRuntimeStatusProbe(client, landed.status)
    }
    status = landed?.status
  }
  return status?.capabilities ?? []
}
