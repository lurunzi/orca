import { describe, expect, it } from 'vitest'
import { readAntigravityNativeError } from './antigravity-native-error'

const ID = '00000000-0000-4000-8000-000000000001-10'
const MESSAGE =
  'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h56m48s.'

describe('Antigravity native error cells', () => {
  it('keeps the actual failure, reset time and error identifier', () => {
    expect(
      readAntigravityNativeError([
        '> investigate',
        'Got one result.',
        `⚠ ${MESSAGE}`,
        `ErrID: ${ID}`,
        '────',
        '>',
        '? for shortcuts'
      ])
    ).toEqual({ id: ID, text: `${MESSAGE}\nErrID: ${ID}` })
  })

  it('joins wrapped message and identifier rows', () => {
    expect(
      readAntigravityNativeError([
        '⚠ Connection failed.',
        'Try again.',
        'ErrID: 00000000-0000-4000-',
        '8000-000000000001-10',
        '>'
      ])
    ).toEqual({ id: ID, text: `Connection failed. Try again.\nErrID: ${ID}` })
  })

  it.each(
    [
      [`The error says: ⚠ ${MESSAGE}`, `ErrID: ${ID}`, '>'],
      [`⚠ ${MESSAGE}`, `ErrID: ${ID}`, '> retry', 'Thinking...', '>'],
      [`⚠ ${MESSAGE}`, `ErrID: ${ID}`, '> retry'],
      [`⚠ ${MESSAGE}`, 'ErrID: not-an-id', '>'],
      [`⚠ ${MESSAGE}`, `ErrID: ${ID}`, 'Working...', '>'],
      [`⚠ ${MESSAGE}`, `ErrID: ${ID}`]
    ].map((lines) => [lines])
  )('rejects quoted output, old errors and unfinished screens %#', (lines) => {
    expect(readAntigravityNativeError(lines)).toBeNull()
  })
})
