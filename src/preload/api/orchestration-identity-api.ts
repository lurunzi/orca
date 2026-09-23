import type { StructuredSessionOrchestrationIdentityStatus } from "../../shared/structured-session-orchestration-identity";

export type OrchestrationIdentityApi = {
  get: (
    sessionId: string,
  ) => Promise<StructuredSessionOrchestrationIdentityStatus>;
  set: (
    sessionId: string,
    enabled: boolean,
  ) => Promise<StructuredSessionOrchestrationIdentityStatus>;
};
