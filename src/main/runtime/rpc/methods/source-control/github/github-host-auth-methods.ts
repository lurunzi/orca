import { defineMethod, type RpcContext } from '../../../core'
import { rpcCallerOperationKey } from '../../../callers/rpc-caller-identity'
import { GitHubHostAuthFlows } from '../../../../../github/host-auth/github-host-auth-flows'
import { runGhHostDeviceLogin } from '../../../../../github/host-auth/gh-host-device-login'
import {
  GitHubHostAuthFlowParams,
  GitHubHostAuthStartParams,
  GitHubHostAuthWaitParams
} from '../../../../../../shared/rpc-contract/github-host-auth-params'

// Per process: gh keeps one login store per host user, so one sign-in runs at a time.
let flows: GitHubHostAuthFlows | null = null
function hostAuthFlows(): GitHubHostAuthFlows {
  flows ??= new GitHubHostAuthFlows((channel) => runGhHostDeviceLogin(channel))
  return flows
}

function flowOwner({ caller }: Pick<RpcContext, 'caller'>): string {
  if (!caller) {
    throw new Error('This client cannot sign this host in to GitHub.')
  }
  return rpcCallerOperationKey(caller)
}

// `workspace`: anyone who can run commands here could run `gh auth login` in a terminal anyway.
export const GITHUB_HOST_AUTH_METHODS = [
  defineMethod({
    name: 'github.hostAuth.start',
    permission: 'workspace',
    params: GitHubHostAuthStartParams,
    handler: async ({ replace }, ctx) => hostAuthFlows().start(flowOwner(ctx), replace)
  }),
  defineMethod({
    name: 'github.hostAuth.wait',
    permission: 'workspace',
    params: GitHubHostAuthWaitParams,
    handler: async ({ flowId, afterRevision }, ctx) =>
      hostAuthFlows().wait(flowOwner(ctx), flowId, afterRevision, ctx.signal)
  }),
  defineMethod({
    name: 'github.hostAuth.cancel',
    permission: 'workspace',
    params: GitHubHostAuthFlowParams,
    handler: async ({ flowId }, ctx) => hostAuthFlows().cancel(flowOwner(ctx), flowId)
  })
]
