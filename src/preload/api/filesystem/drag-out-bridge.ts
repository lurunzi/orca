import { ipcRenderer } from 'electron'
import type { DragOutApi } from '../../../shared/file-drag-out/drag-out-contract'

export const dragOutBridge = {
  begin: (args) => ipcRenderer.invoke('fs:dragOutBegin', args),
  append: (args) => ipcRenderer.invoke('fs:dragOutAppend', args),
  finish: (args) => ipcRenderer.invoke('fs:dragOutFinish', args),
  cancel: (args) => ipcRenderer.invoke('fs:dragOutCancel', args),
  start: (args) => ipcRenderer.invoke('fs:dragOutStart', args)
} satisfies DragOutApi
