import http from 'node:http'
import https from 'node:https'
import { z } from 'zod'
import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import { readWindowsProcessTable } from '../windows/windows-process-table'
import { runPortScanCommand } from '../ports/port-scan-command-client'
import {
  parseLsofListeningOutput,
  parseNetstatListeningOutput,
  parseProcNetTcp
} from '../ports/local-workspace-platform-port-scanner'
import { readFile } from 'node:fs/promises'

const CSRF_HEADER_NAME = 'X-Codeium-Csrf-Token'
const QUOTA_SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary'
const USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus'
const REQUEST_TIMEOUT_MS = 2500

const quotaBucketSchema = z.object({
  bucketId: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  window: z.string().optional(),
  remainingFraction: z.number().finite().optional(),
  resetTime: z.string().optional()
})

const quotaGroupSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  buckets: z.array(quotaBucketSchema).optional()
})

const quotaSummarySchema = z.object({
  response: z
    .object({
      groups: z.array(quotaGroupSchema).optional(),
      description: z.string().optional()
    })
    .optional(),
  groups: z.array(quotaGroupSchema).optional()
})

const userStatusSchema = z.object({
  userStatus: z
    .object({
      planStatus: z
        .object({
          planInfo: z
            .object({
              planName: z.string().optional()
            })
            .optional()
        })
        .optional()
    })
    .optional(),
  planName: z.string().optional()
})

export type ParsedAntigravityQuota = {
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
}

function isFiveHourBucket(b: z.infer<typeof quotaBucketSchema>): boolean {
  const windowStr = (b.window || '').toLowerCase()
  const nameStr = `${b.displayName || ''} ${b.bucketId || ''}`.toLowerCase()
  return (
    windowStr === '5h' ||
    windowStr === '300' ||
    nameStr.includes('5h') ||
    nameStr.includes('five hour') ||
    nameStr.includes('5 hour')
  )
}

function isWeeklyBucket(b: z.infer<typeof quotaBucketSchema>): boolean {
  const windowStr = (b.window || '').toLowerCase()
  const nameStr = `${b.displayName || ''} ${b.bucketId || ''}`.toLowerCase()
  return (
    windowStr === 'weekly' ||
    windowStr === '10080' ||
    nameStr.includes('weekly') ||
    nameStr.includes('week')
  )
}

export function parseAntigravityQuotaSummary(raw: unknown): ParsedAntigravityQuota {
  const parsed = quotaSummarySchema.safeParse(raw)
  if (!parsed.success) {
    return { session: null, weekly: null }
  }
  const groups = parsed.data.response?.groups ?? parsed.data.groups ?? []
  let session: RateLimitWindow | null = null
  let weekly: RateLimitWindow | null = null

  for (const group of groups) {
    for (const b of group.buckets ?? []) {
      const usedPercent = Math.min(
        100,
        Math.max(0, Math.round((1 - (b.remainingFraction ?? 1)) * 100))
      )
      const resetsAt = b.resetTime ? new Date(b.resetTime).getTime() : null
      const validResetsAt = resetsAt && !Number.isNaN(resetsAt) ? resetsAt : null

      if (isFiveHourBucket(b)) {
        const item: RateLimitWindow = {
          usedPercent,
          windowMinutes: 300,
          resetsAt: validResetsAt,
          resetDescription: null
        }
        if (!session || item.usedPercent > session.usedPercent) {
          session = item
        }
      } else if (isWeeklyBucket(b)) {
        const item: RateLimitWindow = {
          usedPercent,
          windowMinutes: 10080,
          resetsAt: validResetsAt,
          resetDescription: null
        }
        if (!weekly || item.usedPercent > weekly.usedPercent) {
          weekly = item
        }
      }
    }
  }

  return { session, weekly }
}

export function parseAntigravityUserPlan(raw: unknown): string | null {
  const parsed = userStatusSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  return parsed.data.userStatus?.planStatus?.planInfo?.planName ?? parsed.data.planName ?? null
}

type LocalServerTarget = {
  pid: number
  csrfToken: string
}

async function findLocalLanguageServerProcess(): Promise<LocalServerTarget | null> {
  if (process.platform === 'win32') {
    const table = await readWindowsProcessTable().catch(() => [])
    for (const row of table) {
      if (
        row.name.toLowerCase().includes('language_server') ||
        row.command.toLowerCase().includes('language_server')
      ) {
        const tokenMatch = row.command.match(/--csrf_token(?:=|\s+)([^\s]+)/)
        if (tokenMatch?.[1]) {
          return { pid: row.pid, csrfToken: tokenMatch[1] }
        }
      }
    }
    return null
  }

  // Darwin / Linux: find process command line
  try {
    const { stdout } = await runPortScanCommand('ps', ['-ax', '-o', 'pid,command'])
    for (const line of stdout.split('\n')) {
      if (line.includes('language_server') && line.includes('--csrf_token')) {
        const trimmed = line.trim()
        const spaceIndex = trimmed.indexOf(' ')
        if (spaceIndex === -1) {
          continue
        }
        const pid = Number.parseInt(trimmed.slice(0, spaceIndex), 10)
        const command = trimmed.slice(spaceIndex + 1)
        const tokenMatch = command.match(/--csrf_token(?:=|\s+)([^\s]+)/)
        if (Number.isFinite(pid) && tokenMatch?.[1]) {
          return { pid, csrfToken: tokenMatch[1] }
        }
      }
    }
  } catch {
    // Process enumeration unavailable
  }

  return null
}

async function findListeningPortsForPid(pid: number): Promise<number[]> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await runPortScanCommand('netstat', ['-ano', '-p', 'tcp'])
      const ports = parseNetstatListeningOutput(stdout)
      return ports.filter((p) => p.pid === pid && p.port > 0).map((p) => p.port)
    } catch {
      return []
    }
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runPortScanCommand('lsof', [
        '-nP',
        '-iTCP',
        '-sTCP:LISTEN',
        '-F',
        'pcnd'
      ])
      const ports = parseLsofListeningOutput(stdout)
      return ports.filter((p) => p.pid === pid && p.port > 0).map((p) => p.port)
    } catch {
      return []
    }
  }

  if (process.platform === 'linux') {
    try {
      const tcp4 = await readFile('/proc/net/tcp', 'utf-8').catch(() => '')
      const tcp6 = await readFile('/proc/net/tcp6', 'utf-8').catch(() => '')
      const sockets = [...parseProcNetTcp(tcp4), ...parseProcNetTcp(tcp6)]
      return sockets.map((s) => s.port).filter((port) => port > 0)
    } catch {
      return []
    }
  }

  return []
}

function requestJson(options: {
  port: number
  path: string
  csrfToken: string
  isHttps: boolean
  signal?: AbortSignal
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const transport = options.isHttps ? https : http
    const req = transport.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CSRF_HEADER_NAME]: options.csrfToken
        },
        timeout: REQUEST_TIMEOUT_MS,
        ...(options.isHttps ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {})
      },
      (res) => {
        let buffer = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => {
          buffer += chunk
        })
        res.on('end', () => {
          try {
            const body: unknown = JSON.parse(buffer)
            resolve({ status: res.statusCode ?? 500, body })
          } catch {
            resolve({ status: res.statusCode ?? 500, body: null })
          }
        })
      }
    )

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        req.destroy()
        reject(new Error('Aborted'))
      })
    }

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })

    req.on('error', (err) => {
      reject(err)
    })

    req.write('{}')
    req.end()
  })
}

export type AntigravityProbeDependencies = {
  findProcess?: () => Promise<LocalServerTarget | null>
  findPorts?: (pid: number) => Promise<number[]>
  requestJson?: (options: {
    port: number
    path: string
    csrfToken: string
    isHttps: boolean
    signal?: AbortSignal
  }) => Promise<{ status: number; body: unknown }>
}

export async function probeLocalAntigravityLanguageServer(
  options: {
    signal?: AbortSignal
    deps?: AntigravityProbeDependencies
  } = {}
): Promise<ProviderRateLimits | null> {
  const deps = options.deps ?? {}
  const findProcess = deps.findProcess ?? findLocalLanguageServerProcess
  const findPorts = deps.findPorts ?? findListeningPortsForPid
  const requester = deps.requestJson ?? requestJson

  const target = await findProcess().catch(() => null)
  if (!target) {
    return null
  }

  const ports = await findPorts(target.pid).catch(() => [])
  if (ports.length === 0) {
    return null
  }

  for (const port of ports) {
    for (const isHttps of [false, true]) {
      try {
        const quotaRes = await requester({
          port,
          path: QUOTA_SUMMARY_PATH,
          csrfToken: target.csrfToken,
          isHttps,
          signal: options.signal
        })

        if (quotaRes.status === 200 && quotaRes.body) {
          const quota = parseAntigravityQuotaSummary(quotaRes.body)
          if (quota.session || quota.weekly) {
            let planType: string | null = null
            try {
              const statusRes = await requester({
                port,
                path: USER_STATUS_PATH,
                csrfToken: target.csrfToken,
                isHttps,
                signal: options.signal
              })
              if (statusRes.status === 200) {
                planType = parseAntigravityUserPlan(statusRes.body)
              }
            } catch {
              // Plan extraction optional
            }

            return {
              provider: 'antigravity',
              session: quota.session,
              weekly: quota.weekly,
              planType: planType ?? 'Pro',
              updatedAt: Date.now(),
              error: null,
              status: 'ok',
              buckets: undefined
            }
          }
        }
      } catch {
        // Try next port or protocol
      }
    }
  }

  return null
}
