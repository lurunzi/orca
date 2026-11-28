import { defineMethod } from '../../core'
import { FileOpen } from '../../../../../shared/rpc-contract/filesystem/files-target-params'
import { remoteRpcResultExceedsContentBudget } from '../../../../../shared/remote-runtime/rpc/remote-rpc-content-budget'
import { FILE_TREE_LIST_TOO_LARGE_MESSAGE } from '../../../../../shared/file-listing/file-tree-listing'
import { remoteFileContentBudget } from './files-remote-content-budget'

export const FILE_TREE_LIST_METHODS = [
  defineMethod({
    name: 'files.listTree',
    permission: 'workspace',
    params: FileOpen,
    handler: async (params, { runtime, signal, clientKind, requestId }) => {
      const listing = await runtime.listFileExplorerTree(
        params.worktree,
        params.relativePath,
        signal
      )
      const budget = remoteFileContentBudget(clientKind, requestId)
      // One reply must fit a frame; a bigger folder is refused rather than truncated.
      if (budget !== undefined && remoteRpcResultExceedsContentBudget(listing, budget)) {
        throw new Error(FILE_TREE_LIST_TOO_LARGE_MESSAGE)
      }
      return listing
    }
  })
]
