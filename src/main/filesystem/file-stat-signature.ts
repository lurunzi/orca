import type { BigIntStats } from 'node:fs'

type StatIdentity = Pick<BigIntStats, 'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'>

// Wait beyond FAT/exFAT's 2s timestamp bucket so another write cannot share a recent timestamp.
export const RACY_FILE_TIMESTAMP_MARGIN_MS = 2_000

// Preserve full Windows file IDs and timestamps that floating-point stats can collapse.
export function fileStatSignature(stats: StatIdentity): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
}

/** Like Git's racily-clean rule: a same-size rewrite within one timestamp tick keeps the signature. */
export function isFileStatSignatureConclusive(
  stats: Pick<BigIntStats, 'mtimeNs' | 'ctimeNs'>,
  observedAtMs: number
): boolean {
  const newestNs = stats.mtimeNs > stats.ctimeNs ? stats.mtimeNs : stats.ctimeNs
  return observedAtMs - Number(newestNs / 1_000_000n) >= RACY_FILE_TIMESTAMP_MARGIN_MS
}
