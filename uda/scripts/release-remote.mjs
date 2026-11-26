import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { runCaptured, runInherited, runWithStdin } from './command-runner.mjs'

export const DEFAULT_SSH_HOST = 'orca-release-bot@192.168.178.21'
export const PUBLIC_BASE_URL = 'https://orca-releases.ultramarinedigitalart.com'
// Why an alias: the pin holds whatever address UDA_RELEASE_SSH_HOST names, and ~/.ssh entries never match it.
const HOST_KEY_ALIAS = 'uda-orca-release'
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIvXFM8Bk1LWfO2pwAD2DcUSubEQdpMFsq1dFPAWVoRu'

function sshBinary() {
  if (process.platform === 'win32') {
    const system = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'OpenSSH',
      'ssh.exe'
    )
    if (existsSync(system)) {
      return system
    }
  }
  return 'ssh'
}

export function sshTarget() {
  return process.env.UDA_RELEASE_SSH_HOST || DEFAULT_SSH_HOST
}

function sshArgs(keyPath, knownHosts, remoteCommand) {
  return [
    '-F',
    'none',
    '-i',
    keyPath,
    '-o',
    `UserKnownHostsFile="${knownHosts}"`,
    '-o',
    `GlobalKnownHostsFile="${knownHosts}"`,
    '-o',
    `HostKeyAlias=${HOST_KEY_ALIAS}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    sshTarget(),
    remoteCommand
  ]
}

/** The command line shown to the user; the key appears only as the variable name. */
export function describeSsh(remoteCommand) {
  const args = sshArgs('$UDA_RELEASE_SSH_KEY', '$TMP/known_hosts', remoteCommand)
  return `ssh ${args.map((arg) => (/[\s"]/.test(arg) ? `'${arg}'` : arg)).join(' ')}`
}

export function requireSshKey() {
  const key = process.env.UDA_RELEASE_SSH_KEY
  if (!key) {
    throw new Error('UDA_RELEASE_SSH_KEY is not set (path to the orca-release-bot private key)')
  }
  if (!existsSync(key)) {
    throw new Error('UDA_RELEASE_SSH_KEY does not point to an existing file')
  }
  return key
}

/** Opens a session whose ssh calls all use one temporary known_hosts file holding only the pinned key. */
export function openReleaseSsh() {
  const keyPath = requireSshKey()
  const dir = mkdtempSync(path.join(tmpdir(), 'uda-release-ssh-'))
  const knownHosts = path.join(dir, 'known_hosts')
  writeFileSync(knownHosts, `${HOST_KEY_ALIAS} ${HOST_KEY}\n`)
  const argsFor = (command) => sshArgs(keyPath, knownHosts, command)
  return {
    status() {
      const result = runCaptured(sshBinary(), argsFor('status'))
      if (result.status !== 0) {
        throw new Error(`ssh status failed: ${result.stderr.trim() || `exit ${result.status}`}`)
      }
      try {
        return JSON.parse(result.stdout)
      } catch {
        throw new Error('ssh status did not return JSON')
      }
    },
    put(version, tar) {
      return runWithStdin(sshBinary(), argsFor(`put ${version}`), tar)
    },
    run(command) {
      return runInherited(sshBinary(), argsFor(command))
    },
    close() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export async function fetchPublic(urlPath) {
  const response = await fetch(`${PUBLIC_BASE_URL}${urlPath}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  })
  if (!response.ok) {
    throw new Error(`GET ${urlPath}: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/** Posts one line to ntfy; returns a status line. Never prints the token. */
export async function notify(message) {
  const url = process.env.UDA_NTFY_URL
  const token = process.env.UDA_NTFY_TOKEN
  if (!url || !token) {
    return { ok: true, line: 'notify: not covered — UDA_NTFY_URL / UDA_NTFY_TOKEN not set' }
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
      body: message
    })
    return response.ok
      ? { ok: true, line: `notify: sent ("${message}")` }
      : { ok: false, line: `notify: failed — HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, line: `notify: failed — ${error.message}` }
  }
}
