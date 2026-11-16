import { describe, expect, it } from 'vitest'
import { resolveCursorLegacyModel } from './cursor-legacy-model-ids'
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

describe('Cursor CLI model ids', () => {
  const listed = ['default', 'composer-2.5', 'claude-opus-5', 'claude-opus-5-5', 'grok-4.6']

  it('maps variant ids to the longest listed base and keeps only Fast', () => {
    expect(resolveCursorLegacyModel({ model: 'composer-2.5-fast' }, listed)).toEqual({
      model: 'composer-2.5',
      fastMode: 'true'
    })
    expect(resolveCursorLegacyModel({ model: 'claude-opus-5-5-high' }, listed)).toEqual({
      model: 'claude-opus-5-5'
    })
    expect(resolveCursorLegacyModel({ model: 'cursor-grok-4.6-high-fast' }, listed)).toEqual({
      model: 'grok-4.6',
      fastMode: 'true'
    })
    expect(resolveCursorLegacyModel({ model: 'auto' }, listed)).toEqual({ model: 'default' })
  })

  it('leaves listed, unknown and explicitly Fast-chosen requests alone', () => {
    expect(resolveCursorLegacyModel({ model: 'composer-2.5' }, listed)).toEqual({
      model: 'composer-2.5'
    })
    expect(resolveCursorLegacyModel({ model: 'gpt-9' }, listed)).toEqual({ model: 'gpt-9' })
    expect(resolveCursorLegacyModel({ model: 'composer-2.5-fast' }, [])).toEqual({
      model: 'composer-2.5-fast'
    })
    expect(
      resolveCursorLegacyModel({ model: 'composer-2.5-fast', fastMode: 'false' }, listed)
    ).toEqual({ model: 'composer-2.5', fastMode: 'false' })
  })
})
