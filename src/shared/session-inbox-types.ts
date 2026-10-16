// What the session inbox shows, as projected from a session's journal. Plain JSON.

import type { SessionInboxCheckKind, SessionInboxCheckTarget } from './session-inbox-check-types'

/** Where an entry came from in the journal. */
export type SessionInboxSource = {
  /** The journal item that recorded it. */
  itemId: string
  /** The user message that opened its turn, which a jump lands on; null when none is known. */
  turnUserItemId: string | null
  /** Host clock when it was journaled. */
  at: number
}

/** Something the agent noticed outside the task and recorded for the user. */
export type SessionInboxFinding = SessionInboxSource & {
  id: string
  kind: 'issue' | 'opportunity'
  title: string
  detail: string
  path: string | null
}

/** A decision the agent recorded as left to the user. */
export type SessionInboxQuestion = SessionInboxSource & {
  id: string
  question: string
  options: string[]
  /** The option the agent recommended, exactly as `options` has it. */
  recommended: string | null
}

/** The latest result of one check the agent ran. */
export type SessionInboxCheck = SessionInboxSource & {
  /** The check's identity: its folder, its name and, when it narrows anything, its target. */
  key: string
  name: string
  kind: SessionInboxCheckKind
  target: SessionInboxCheckTarget
  /** Absolute, `/`-separated; null for the session's own folder. */
  folder: string | null
  /** The piece of the agent's command that ran it. */
  command: string
  result: 'pass' | 'fail'
  summary: string
  failures: string[]
  /** A file it reads changed after it ran. */
  isStale: boolean
  /** It was still failing when its turn ended. */
  isLeftFailing: boolean
}

export type SessionInboxProjection = {
  questions: SessionInboxQuestion[]
  findings: SessionInboxFinding[]
  /** Each check's latest result, passing ones included. */
  checks: SessionInboxCheck[]
}
