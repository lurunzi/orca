import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { TAR_NAME_MAX_BYTES } from './release-feed.mjs'

const BLOCK = 512

function writeOctal(header, offset, length, value) {
  // Why: length-1 octal digits then NUL, the classic ustar numeric field.
  const text = value.toString(8).padStart(length - 1, '0')
  if (text.length > length - 1) {
    throw new Error(`tar field overflow: ${value}`)
  }
  header.write(`${text}\0`, offset, length, 'ascii')
}

/** One ustar header for a regular file at the archive root. */
export function ustarHeader(name, size, mtimeSeconds) {
  const nameBytes = Buffer.from(name, 'utf8')
  if (nameBytes.length === 0 || nameBytes.length > TAR_NAME_MAX_BYTES || name.includes('/')) {
    throw new Error(`tar: name not storable as a root entry: ${JSON.stringify(name)}`)
  }
  const header = Buffer.alloc(BLOCK, 0)
  nameBytes.copy(header, 0)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, Math.max(0, Math.floor(mtimeSeconds)))
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const byte of header) {
    sum += byte
  }
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

/** Streams an uncompressed tar of `names` (files directly in `dir`) with no directory entries. */
export async function* tarStream(dir, names) {
  for (const name of names) {
    const filePath = path.join(dir, name)
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      throw new Error(`tar: ${name} is not a regular file`)
    }
    yield ustarHeader(name, stat.size, stat.mtimeMs / 1000)
    let written = 0
    for await (const chunk of createReadStream(filePath)) {
      written += chunk.length
      yield chunk
    }
    if (written !== stat.size) {
      throw new Error(`tar: ${name} changed size while it was being read`)
    }
    const pad = (BLOCK - (stat.size % BLOCK)) % BLOCK
    if (pad > 0) {
      yield Buffer.alloc(pad, 0)
    }
  }
  yield Buffer.alloc(BLOCK * 2, 0)
}
