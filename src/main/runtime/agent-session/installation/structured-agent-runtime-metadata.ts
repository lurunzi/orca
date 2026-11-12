import {
  agentSessionAccountHome,
  agentSessionAccountHomePath
} from '../../../../shared/agent-session/lifecycle/agent-session-account-home'
import { applyStructuredCodexWorkspaceTrust } from '../../../agent-launch/trust/agent-workspace-trust-spawn'
import { ACP_LAUNCH_SPECS } from '../../../acp/launch/acp-launch-registry'
import type { AcpLaunchSpec } from '../../../acp/launch/acp-launch-contract'
import { acpStructuredAgentDefinition } from '../../../acp/session/acp-structured-agent-definitions'
import {
  acpHostBackendSpec,
  resolveAcpLaunchCommand,
  selectAcpHostAccountHome
} from '../../../acp/launch/acp-launch-command'
import { acpLaunchRunsPermissionMode } from '../../../acp/launch/acp-launch-permission-modes'
import { CODEX_STRUCTURED_AGENT } from '../../../codex/structured/launch/codex-structured-agent-definition'
import { CLAUDE_STRUCTURED_AGENT } from '../../../claude/structured/claude-structured-agent-definition'
import { CLAUDE_CLI_CONVERSATIONS } from '../../../claude/claude-cli-conversations'
import { CODEX_CLI_CONVERSATIONS } from '../../../codex/history/journal-views/codex-cli-conversations'
import { isNativeLocalLocation as supportsCodexStructuredLocation } from '../../../../shared/execution-host'
import { supportsClaudeStructuredLocation } from '../../../claude/structured/launch/claude-structured-location-support'
import { supportsAcpStructuredLocation } from '../../../acp/session/acp-structured-location-support'
import { PI_RPC_RUNTIME_METADATA } from '../../../pi/rpc-runtime-metadata'
import { getClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'
import { claudeChatAccountSwitchable } from '../../../claude/structured/launch/claude-structured-account-switch'
import { codexChatAccountSwitchable } from '../../../codex/structured/launch/codex-structured-account-switch'
import {
  resolveStructuredClaudeAccountHomePath,
  resolveStructuredCodexAccountHomePath
} from '../environment/structured-agent-account-home'
import {
  acpModelCatalogDiscovery,
  claudeModelCatalogDiscovery,
  codexModelCatalogDiscovery
} from '../model-catalog/structured-agent-model-catalog-discovery'
import { resolveStructuredAgentCommand } from '../../../native-chat/structured-agent-command-resolution'
import { getProfileUserDataPath } from '../../../orca-profiles/profile-storage-paths'
import type {
  StructuredAgentAccountHomeRequest,
  StructuredAgentChatProgram,
  StructuredAgentAccountHomeServices,
  StructuredAgentAccountSwitchSettings,
  StructuredAgentRuntimeMetadata
} from './structured-agent-runtime-registration-types'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'

export type StructuredAgentRuntimeCatalogEntry =
  | { kind: 'pi' | 'codex' | 'claude'; metadata: StructuredAgentRuntimeMetadata }
  | { kind: 'acp'; metadata: StructuredAgentRuntimeMetadata; spec: AcpLaunchSpec }

// Why the host's data folder: a start runs Orca's installed release before PATH.
function acpChatProgram(spec: AcpLaunchSpec): StructuredAgentChatProgram {
  const { managedRuntime } = spec
  return {
    resolve: (shellEnv, commandSettings) => {
      const env = { ...shellEnv, ...spec.env }
      const options = { commandSettings, dataDirectory: getProfileUserDataPath() }
      return { ...resolveAcpLaunchCommand(spec, env, options), env }
    },
    ...(managedRuntime ? { installable: () => managedRuntime.pin() !== null } : {}),
    ...(spec.hostBackend
      ? {
          hostAlternative: async (shellEnv, settings) =>
            (await selectAcpHostAccountHome(spec, shellEnv, getProfileUserDataPath(), settings)) !==
            null
        }
      : {})
  }
}

function cliChatProgram(agent: 'claude' | 'codex'): StructuredAgentChatProgram {
  return {
    resolve: (env, commandSettings) => {
      const homePath = env.HOME ?? env.USERPROFILE
      const pathEnv = env.PATH ?? env.Path ?? null
      const options = { pathEnv, ...(homePath ? { homePath } : {}) }
      return { ...resolveStructuredAgentCommand(agent, commandSettings, options), env }
    }
  }
}

function acpMetadata(spec: AcpLaunchSpec): StructuredAgentRuntimeMetadata {
  const { minimumVersions } = spec
  return {
    definition: acpStructuredAgentDefinition(spec),
    chatProgram: acpChatProgram(spec),
    supportsLocation: (location) => supportsAcpStructuredLocation(spec, location),
    ...(minimumVersions
      ? {
          launchCheck: {
            resolveLaunch: (shellEnv, commandSettings) => {
              const env = { ...shellEnv, ...spec.env }
              const invocation = resolveAcpLaunchCommand(spec, env, {
                commandSettings,
                dataDirectory: null
              })
              return { ...invocation, env }
            },
            minimumVersions,
            ...(spec.readVersion ? { readVersion: spec.readVersion } : {})
          }
        }
      : {}),
    // New chats prefer a compatible host program, which their account home then pins; reads such
    // as Orca's own sign-in keep the agent's account.
    resolveAccountHome: async (
      { launchEnv, purpose, permissionMode },
      { stateDirectory, hostLaunchEnvironment, hostSettings }
    ) => {
      // A host program without the chat's permission mode never takes it; `own` sets none.
      const host =
        spec.hostBackend &&
        purpose === 'launch' &&
        (permissionMode === undefined ||
          permissionMode === 'own' ||
          acpLaunchRunsPermissionMode(
            acpHostBackendSpec(spec.hostBackend, hostSettings()),
            permissionMode
          ))
          ? await hostLaunchEnvironment(spec.agent)
              .then((env) => selectAcpHostAccountHome(spec, env, stateDirectory, hostSettings()))
              .catch(() => null)
          : null
      return host ?? spec.account.resolve({ launchEnv, stateDirectory })
    },
    modelCatalog: (context) => acpModelCatalogDiscovery(spec, context),
    transcriptImport: spec.transcriptImport,
    sessionHistory: spec.sessionHistory
  }
}

async function resolveCodexAccountHomePath(
  request: StructuredAgentAccountHomeRequest,
  services: StructuredAgentAccountHomeServices
): Promise<string> {
  const { launchEnv, purpose, workspacePath, location } = request
  const codexHome = await resolveStructuredCodexAccountHomePath({
    launchEnv,
    resolveLaunchHome:
      purpose === 'launch' ? services.prepareCodexLaunchHome : services.readCodexLaunchHome
  })
  if (purpose === 'launch' && workspacePath) {
    await applyStructuredCodexWorkspaceTrust({
      workspacePath: await workspacePath(),
      launchEnv,
      codexHome,
      settings: services.workspaceTrustSettings(),
      repoDecision: services.workspaceTrustRepoDecision(location)
    })
  }
  return codexHome
}

async function codexRecordAccountSwitchable(
  record: AgentSessionRecord,
  settings: StructuredAgentAccountSwitchSettings
): Promise<boolean> {
  const home = agentSessionAccountHomePath(record.accountHome)
  return home !== null && codexChatAccountSwitchable(home, settings)
}

// One roster supplies both metadata readers and the host's synchronous adapter factories.
export const STRUCTURED_AGENT_RUNTIME_CATALOG: readonly StructuredAgentRuntimeCatalogEntry[] = [
  { kind: 'pi', metadata: PI_RPC_RUNTIME_METADATA },
  {
    kind: 'codex',
    metadata: {
      definition: CODEX_STRUCTURED_AGENT,
      chatProgram: cliChatProgram('codex'),
      modelCatalog: codexModelCatalogDiscovery,
      ...CODEX_CLI_CONVERSATIONS,
      supportsLocation: (location) => supportsCodexStructuredLocation(location),
      launchFollowsSelection: () => true,
      launchAccountSwitchable: codexRecordAccountSwitchable,
      accountSwitchable: ({ record, settings }) => codexRecordAccountSwitchable(record, settings),
      resolveAccountHome: async (request, services) =>
        agentSessionAccountHome(
          CODEX_STRUCTURED_AGENT,
          await resolveCodexAccountHomePath(request, services)
        )
    }
  },
  {
    kind: 'claude',
    metadata: {
      definition: CLAUDE_STRUCTURED_AGENT,
      chatProgram: cliChatProgram('claude'),
      modelCatalog: claudeModelCatalogDiscovery,
      ...CLAUDE_CLI_CONVERSATIONS,
      supportsLocation: supportsClaudeStructuredLocation,
      // Without a router a launch keeps the record's home (resolveClaudeStructuredLaunchHome).
      launchFollowsSelection: () => getClaudeProfileRouter() !== undefined,
      accountSwitchable: claudeChatAccountSwitchable,
      resolveAccountHome: async ({ launchEnv, location, purpose }, services) =>
        agentSessionAccountHome(
          CLAUDE_STRUCTURED_AGENT,
          await resolveStructuredClaudeAccountHomePath({
            launchEnv,
            wslDistro: location?.wslDistro ?? null,
            ...(purpose !== 'read' ? { purpose: 'identity' } : {}),
            getClaudeConfigDirectory: services.getClaudeConfigDirectory
          })
        )
    }
  },
  ...ACP_LAUNCH_SPECS.map((spec): StructuredAgentRuntimeCatalogEntry => ({
    kind: 'acp',
    metadata: acpMetadata(spec),
    spec
  }))
]

export const STRUCTURED_AGENT_RUNTIME_METADATA: readonly StructuredAgentRuntimeMetadata[] =
  STRUCTURED_AGENT_RUNTIME_CATALOG.map(({ metadata }) => metadata)

/** The metadata of `agent`, without constructing its adapter or installing the host. */
export function structuredAgentRuntimeMetadata(
  agent: string
): StructuredAgentRuntimeMetadata | null {
  return (
    STRUCTURED_AGENT_RUNTIME_METADATA.find(({ definition }) => definition.agent === agent) ?? null
  )
}
