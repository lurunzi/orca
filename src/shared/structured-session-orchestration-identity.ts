/**
 * Whether a user-opened structured chat carries its own orchestration (coordinator) identity.
 *
 * Desktop-only: the identity is a bearer credential, so it is granted over a main-process IPC
 * channel that neither the CLI, a paired client, nor the agent inside the session can reach.
 */

export const ORCHESTRATION_IDENTITY_GET_CHANNEL = "orchestrationIdentity:get";
export const ORCHESTRATION_IDENTITY_SET_CHANNEL = "orchestrationIdentity:set";

export type StructuredSessionOrchestrationIdentityUnavailableReason =
  /** No durable record, or the structured host is not installed. */
  | "missing"
  /** Remote, SSH or WSL execution: structured identities are local-only. */
  | "not-local"
  /** A turn is running or waiting on the user; the child cannot be restarted yet. */
  | "busy"
  /** The orchestration database is not open in this runtime. */
  | "orchestration-unavailable";

export type StructuredSessionOrchestrationIdentityStatus =
  | { state: "enabled" }
  | { state: "disabled" }
  /** Already a dispatched worker; its identity belongs to the dispatch and cannot be toggled. */
  | { state: "worker" }
  | {
      state: "unavailable";
      reason: StructuredSessionOrchestrationIdentityUnavailableReason;
    };

export type StructuredSessionOrchestrationIdentityArgs = { sessionId: string };

export type StructuredSessionOrchestrationIdentitySetArgs = {
  sessionId: string;
  enabled: boolean;
};
