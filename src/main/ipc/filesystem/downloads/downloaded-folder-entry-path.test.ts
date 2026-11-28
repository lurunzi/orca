import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDownloadedFolderEntryPath } from './downloaded-folder-entry-path'

describe('resolveDownloadedFolderEntryPath', () => {
  const root = join('/tmp', 'staging')

  it('maps a nested host path, including non-ASCII names, inside the staging root', () => {
    expect(resolveDownloadedFolderEntryPath(root, 'docs/café résumé.txt')).toBe(
      join(root, 'docs', 'café résumé.txt')
    )
  })

  it.each([
    '../escape.txt',
    'a/../../escape.txt',
    'a/./b',
    '/etc/passwd',
    'a//b',
    'a\\..\\..\\escape',
    'C:/Windows/x',
    'a/CON',
    'a/name.',
    'a/b:c',
    ''
  ])('refuses %j', (relativePath) => {
    expect(() => resolveDownloadedFolderEntryPath(root, relativePath)).toThrow('invalid_entry_name')
  })
})
