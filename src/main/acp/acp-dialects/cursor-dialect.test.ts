import { describe, expect, it } from 'vitest'
import { scrubCursorAcpEnvironment } from '../../cursor/cursor-acp-launch-spec'

describe('Cursor launch environment', () => {
  it('drops a POSIX SHELL on Windows only', () => {
    const env = { SHELL: '/usr/bin/bash', PATH: 'p' }
    expect(scrubCursorAcpEnvironment({ ...env }, {}, 'linux')).toEqual([])
    const scrubbed: Record<string, string> = { ...env }
    expect(scrubCursorAcpEnvironment(scrubbed, {}, 'win32')).toEqual(['SHELL'])
    expect(scrubbed).toEqual({ PATH: 'p' })
    expect(scrubCursorAcpEnvironment({ PATH: 'p' }, { SHELL: 'bash' }, 'win32')).toEqual(['SHELL'])
  })
})
