import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'
import { cursorAuthPaths, parseCursorAccessToken, readCursorAuth } from './cursor-auth'

const jwt = (sub = 'auth0|user_test', exp = Date.now() / 1000 + 3600): string =>
  `e30.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.signature`
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(): { cli: string; database: string } {
  const directory = mkdtempSync(join(tmpdir(), 'orca-cursor-auth-'))
  directories.push(directory)
  return { cli: join(directory, 'auth.json'), database: join(directory, 'state.vscdb') }
}

describe('Cursor host credentials', () => {
  it('uses host-specific app and CLI paths, including spaces and absolute XDG overrides', () => {
    expect(cursorAuthPaths('win32', 'C:/User Name', { APPDATA: 'D:/Roaming' }).cli).toBe(
      'D:\\Roaming\\Cursor\\auth.json'
    )
    expect(cursorAuthPaths('darwin', '/User Name', {}).database).toBe(
      '/User Name/Library/Application Support/Cursor/User/globalStorage/state.vscdb'
    )
    expect(cursorAuthPaths('linux', '/home/user', { XDG_CONFIG_HOME: '/config' }).cli).toBe(
      '/config/cursor/auth.json'
    )
    expect(cursorAuthPaths('linux', '/home/user', { XDG_CONFIG_HOME: 'relative' }).cli).toBe(
      '/home/user/.config/cursor/auth.json'
    )
  })
  it('derives only a cookie and opaque provenance, without returning the user ID', () => {
    const token = jwt()
    const result = parseCursorAccessToken(token)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') {
      throw new Error('Expected valid fixture')
    }
    expect(result.cookie).toBe(`WorkosCursorSessionToken=user_test%3A%3A${token}`)
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects expired, malformed and header-injection tokens', () => {
    expect(parseCursorAccessToken(jwt('user', 1)).status).toBe('expired')
    expect(parseCursorAccessToken(jwt('bad;value')).status).toBe('invalid')
    expect(parseCursorAccessToken('invalid\r\nCookie: leak').status).toBe('invalid')
  })
  it('keeps a present invalid CLI identity instead of falling back to the app', () => {
    const paths = fixture()
    writeFileSync(paths.cli, JSON.stringify({ accessToken: jwt('user', 1) }))
    expect(readCursorAuth(paths).status).toBe('expired')
    writeFileSync(paths.cli, '{')
    expect(readCursorAuth(paths).status).toBe('unreadable')
  })
  it('does not create missing credential files', () => {
    expect(readCursorAuth(fixture()).status).toBe('missing')
  })
  it.each(['text', 'utf8', 'utf16le'] as const)(
    'reads %s app tokens with a read-only SQLite connection',
    (encoding) => {
      const paths = fixture()
      const db = new SyncDatabase(paths.database)
      const token = jwt()
      db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)')
      db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
        'cursorAuth/accessToken',
        encoding === 'text' ? token : Buffer.from(token, encoding)
      )
      db.close()
      expect(readCursorAuth(paths)).toEqual(parseCursorAccessToken(token))
    }
  )
})
