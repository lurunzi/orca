import {
  agentSessionRefusalError,
  type AgentSessionRefusalError
} from '../../../shared/agent-session-wire-refusals'

/** This host cannot create the requested structured chat. */
export function hostUnsupportedCreateRefusal(): AgentSessionRefusalError {
  return agentSessionRefusalError('structured_agent_session_unsupported', {
    reason: 'hostUnsupported'
  })
}
