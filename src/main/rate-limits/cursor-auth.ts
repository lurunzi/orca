import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import SyncDatabase from '../sqlite/sync-database'

export type CursorAuth =
  | { status: 'ok'; cookie: string; fingerprint: string }
  | { status: 'missing' | 'expired' | 'invalid' | 'unreadable' }

export function cursorAuthPaths(
  platform = process.platform,
  home = homedir(),
  env = process.env
): { cli: string; database: string } {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const absolute = (value: string | undefined): string | undefined =>
    value && paths.isAbsolute(value) ? value : undefined
  const config =
    platform === 'win32'
      ? (absolute(env.APPDATA) ?? paths.join(home, 'AppData', 'Roaming'))
      : platform === 'darwin'
        ? paths.join(home, 'Library', 'Application Support')
        : (absolute(env.XDG_CONFIG_HOME) ?? paths.join(home, '.config'))
  return {
    cli:
      platform === 'darwin'
        ? paths.join(home, '.cursor', 'auth.json')
        : paths.join(config, platform === 'win32' ? 'Cursor' : 'cursor', 'auth.json'),
    database: paths.join(config, 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  }
}

const jwtPayload = z.object({ sub: z.string(), exp: z.number().finite() })

// Protocol reference: steipete/CodexBar (MIT), CursorAppAuth.swift; credentials stay on the host.
export function parseCursorAccessToken(token: unknown, now = Date.now()): CursorAuth {
  if (typeof token !== 'string' || !token) {
    return { status: 'missing' }
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return { status: 'invalid' }
  }
  try {
    const payload = jwtPayload.parse(
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    )
    const userId = payload.sub.split('|').at(-1)
    if (!userId || !/^[A-Za-z0-9._-]+$/.test(userId)) {
      return { status: 'invalid' }
    }
    if (payload.exp * 1000 <= now + 60_000) {
      return { status: 'expired' }
    }
    return {
      status: 'ok',
      cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`,
      fingerprint: createHash('sha256').update(token).digest('hex')
    }
  } catch {
    return { status: 'invalid' }
  }
}

function decodeToken(value: unknown): unknown {
  if (!(value instanceof Uint8Array)) {
    return value
  }
  const bytes = Buffer.from(value)
  return bytes.toString(bytes.length % 2 === 0 && bytes[1] === 0 ? 'utf16le' : 'utf8')
}

export function readCursorAuth(paths = cursorAuthPaths()): CursorAuth {
  try {
    // A present CLI identity wins, even when expired, to avoid silently switching accounts.
    if (existsSync(paths.cli)) {
      const parsed = z
        .object({ accessToken: z.string().optional() })
        .safeParse(JSON.parse(readFileSync(paths.cli, 'utf8')))
      return parsed.success
        ? parseCursorAccessToken(parsed.data.accessToken)
        : { status: 'invalid' }
    }
    if (!existsSync(paths.database)) {
      return { status: 'missing' }
    }
    const db = new SyncDatabase(paths.database, {
      readonly: true,
      fileMustExist: true,
      timeout: 250
    })
    try {
      const row = db
        .prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1')
        .get('cursorAuth/accessToken')
      return parseCursorAccessToken(decodeToken(row?.value))
    } finally {
      db.close()
    }
  } catch {
    return { status: 'unreadable' }
  }
}
