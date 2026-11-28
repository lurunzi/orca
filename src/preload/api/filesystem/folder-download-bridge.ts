import { ipcRenderer } from 'electron'

export const folderDownloadBridge = {
  startDownloadedFolder: (args: {
    suggestedName: string
  }): Promise<{ canceled: true } | { canceled: false; transferId: string; parentPath: string }> =>
    ipcRenderer.invoke('fs:startDownloadedFolder', args),
  createDownloadedFolderDirectory: (args: {
    transferId: string
    relativePath: string
  }): Promise<{ ok: true }> => ipcRenderer.invoke('fs:createDownloadedFolderDirectory', args),
  writeDownloadedFolderFileChunk: (args: {
    transferId: string
    relativePath: string
    contentBase64: string
    append: boolean
  }): Promise<{ ok: true }> => ipcRenderer.invoke('fs:writeDownloadedFolderFileChunk', args),
  finishDownloadedFolder: (args: { transferId: string }): Promise<{ destinationPath: string }> =>
    ipcRenderer.invoke('fs:finishDownloadedFolder', args),
  cancelDownloadedFolder: (args: { transferId: string }): Promise<{ ok: true }> =>
    ipcRenderer.invoke('fs:cancelDownloadedFolder', args)
}
