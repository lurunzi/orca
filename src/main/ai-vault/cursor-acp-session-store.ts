import { tableExists } from '../opencode-usage/schema-helpers'
import { readOpenCodeDatabase } from './session-scanner-opencode-sqlite-open'
import { asRecord } from './session-scanner-record-value'
import { extractString } from './session-scanner-values'

// cursor-agent acp keeps each chat in a content-addressed store.db: meta row "0" names the latest root
// blob, whose protobuf field 1 lists the conversation's message blob ids in order.
const MAX_MESSAGES = 10_000
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const BLOB_ID_BYTES = 32

export type CursorAcpStore = {
  name: string | null
  createdAtMs: number | null
  messages: Record<string, unknown>[]
}

/** Read the latest conversation in order; a store without the expected tables yields no messages. */
export function readCursorAcpStore(dbPath: string): CursorAcpStore {
  return readOpenCodeDatabase({
    dbPath,
    read: (db) => {
      const store: CursorAcpStore = { name: null, createdAtMs: null, messages: [] }
      if (!tableExists(db, 'meta') || !tableExists(db, 'blobs')) {
        return store
      }
      const metaRow = asRecord(db.prepare("SELECT value FROM meta WHERE key = '0'").get())
      const meta = decodeMetaValue(metaRow?.value)
      store.name = extractString(meta?.name)
      store.createdAtMs = typeof meta?.createdAt === 'number' ? meta.createdAt : null
      const rootId = extractString(meta?.latestRootBlobId)
      if (!rootId) {
        return store
      }
      const blob = db.prepare('SELECT data FROM blobs WHERE id = ?')
      const root = blobBytes(asRecord(blob.get(rootId))?.data)
      let totalBytes = 0
      for (const id of root ? rootMessageIds(root) : []) {
        const data = blobBytes(asRecord(blob.get(id))?.data)
        if (!data || data.length > MAX_MESSAGE_BYTES) {
          continue
        }
        totalBytes += data.length
        if (totalBytes > MAX_TOTAL_BYTES) {
          break
        }
        const message = parseMessage(data)
        if (message) {
          store.messages.push(message)
        }
      }
      return store
    }
  })
}

function decodeMetaValue(value: unknown): Record<string, unknown> | null {
  const text =
    typeof value === 'string' && /^(?:[0-9a-f]{2})+$/i.test(value)
      ? Buffer.from(value, 'hex').toString('utf8')
      : value
  if (typeof text !== 'string') {
    return null
  }
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function blobBytes(value: unknown): Buffer | null {
  return value instanceof Uint8Array
    ? Buffer.from(value.buffer, value.byteOffset, value.length)
    : null
}

function parseMessage(data: Buffer): Record<string, unknown> | null {
  // Tree nodes share the table as protobuf; messages are JSON objects.
  if (data[0] !== 0x7b) {
    return null
  }
  try {
    return asRecord(JSON.parse(data.toString('utf8')))
  } catch {
    return null
  }
}

/** Collect field-1 blob ids, skipping other fields and stopping at the first malformed tag. */
export function rootMessageIds(root: Buffer): string[] {
  const ids: string[] = []
  let offset = 0
  const varint = (): number | null => {
    let value = 0
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= root.length) {
        return null
      }
      const byte = root[offset++]!
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) {
        return value
      }
    }
    return null
  }
  while (offset < root.length && ids.length < MAX_MESSAGES) {
    const tag = varint()
    if (tag === null) {
      break
    }
    const wireType = tag % 8
    if (wireType === 0) {
      if (varint() === null) {
        break
      }
    } else if (wireType === 2) {
      const length = varint()
      if (length === null || offset + length > root.length) {
        break
      }
      if (Math.floor(tag / 8) === 1 && length === BLOB_ID_BYTES) {
        ids.push(root.toString('hex', offset, offset + length))
      }
      offset += length
    } else if (wireType === 1 || wireType === 5) {
      offset += wireType === 1 ? 8 : 4
    } else {
      break
    }
  }
  return ids
}
