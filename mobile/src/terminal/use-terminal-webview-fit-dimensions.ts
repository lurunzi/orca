import { useCallback, useRef } from 'react'
import type { TerminalCellBox } from './terminal-cell-box'
import { fitDimensionsFromCell } from './terminal-grid-fit'
import type { TerminalFrame } from './terminal-webview-messages'

/** The document's last measured cell box, and the grid it fits into a frame at this text scale. */
export function useTerminalWebViewFitDimensions(textScale: number) {
  const cellBoxRef = useRef<TerminalCellBox | null>(null)
  const fitDimensions = useCallback(
    (frame: TerminalFrame) => {
      const cell = cellBoxRef.current
      // A cell box measured at another text scale cannot authorize this grid’s fit.
      return cell && cell.fontScale === textScale && frame.width > 0 && frame.height > 0
        ? fitDimensionsFromCell(cell, frame.width, frame.height)
        : null
    },
    [textScale]
  )
  return { cellBoxRef, fitDimensions }
}
