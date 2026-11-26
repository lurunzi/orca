import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { tarStream, ustarHeader } from './release-tar.mjs'

let dir
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// Independent reader: what Python's tarfile sees for each header block.
function readTar(archive) {
  const members = []
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      break
    }
    const field = (start, length) =>
      header.toString('latin1', start, start + length).replace(/\0.*$/s, '')
    const size = Number.parseInt(field(124, 12), 8)
    let sum = 0
    for (let i = 0; i < 512; i++) {
      sum += i >= 148 && i < 156 ? 0x20 : header[i]
    }
    members.push({
      name: field(0, 100),
      type: field(156, 1),
      magic: field(257, 6),
      prefix: field(345, 155),
      checksumOk: Number.parseInt(field(148, 8), 8) === sum,
      data: archive.subarray(offset + 512, offset + 512 + size).toString('latin1')
    })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return { members, end: offset, trailer: archive.subarray(offset) }
}

describe('tarStream', () => {
  it('writes only root-level regular files with their exact bytes', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uda-release-tar-'))
    writeFileSync(path.join(dir, 'latest.yml'), 'version: 1.4.27501\n')
    writeFileSync(path.join(dir, 'Orca Setup (x64) 1.4.27501.exe'), 'A'.repeat(513))
    writeFileSync(path.join(dir, 'SHA256SUMS'), '')

    const archive = await collect(
      tarStream(dir, ['latest.yml', 'Orca Setup (x64) 1.4.27501.exe', 'SHA256SUMS'])
    )
    const { members, end, trailer } = readTar(archive)

    expect(members).toEqual([
      {
        name: 'latest.yml',
        type: '0',
        magic: 'ustar',
        prefix: '',
        checksumOk: true,
        data: 'version: 1.4.27501\n'
      },
      {
        name: 'Orca Setup (x64) 1.4.27501.exe',
        type: '0',
        magic: 'ustar',
        prefix: '',
        checksumOk: true,
        data: 'A'.repeat(513)
      },
      { name: 'SHA256SUMS', type: '0', magic: 'ustar', prefix: '', checksumOk: true, data: '' }
    ])
    expect(end).toBe(512 + 512 + 512 + 1024 + 512)
    expect(trailer.length).toBe(1024)
    expect(trailer.every((byte) => byte === 0)).toBe(true)
  })

  it('refuses names that cannot be a root entry', () => {
    expect(() => ustarHeader('sub/latest.yml', 1, 0)).toThrow('root entry')
    expect(() => ustarHeader(`${'a'.repeat(101)}`, 1, 0)).toThrow('root entry')
  })
})
