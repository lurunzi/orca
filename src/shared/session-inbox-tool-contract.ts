// The tools an agent uses to record questions and findings in the session inbox. The host's MCP
// server and every journal reader share this file, so a recorded item means the same on both.
// Wording adapted from petekp/inbox `hooks/register.tsx` (https://github.com/petekp/inbox
// @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash); license: resources/licenses/petekp-inbox/LICENSE.

import { z } from 'zod'

export const SESSION_INBOX_MCP_SERVER = 'orca_inbox'

export const SESSION_INBOX_TOOLS = {
  recordFinding: 'record_finding',
  recordQuestion: 'record_question',
  close: 'close'
} as const

type SessionInboxTool = (typeof SESSION_INBOX_TOOLS)[keyof typeof SESSION_INBOX_TOOLS]

/** The name the model calls a tool by, such as `mcp__orca_inbox__close`. */
export function sessionInboxToolName(tool: SessionInboxTool): string {
  return `mcp__${SESSION_INBOX_MCP_SERVER}__${tool}`
}

export const SESSION_INBOX_TOOL_NAMES: readonly string[] =
  Object.values(SESSION_INBOX_TOOLS).map(sessionInboxToolName)

export const recordFindingToolFields = {
  kind: z
    .enum(['issue', 'opportunity'])
    .describe('issue: something wrong or risky. opportunity: something that could be better.'),
  title: z.string().trim().min(1).max(200).describe('What it is, in at most 12 plain words.'),
  detail: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Why it matters and what you would do, in one or two sentences.'),
  path: z.string().trim().max(500).optional().describe('The file it is about, if one.')
}

export const recordQuestionToolFields = {
  question: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('The question, readable without your reply, in at most 25 words.'),
  options: z
    .array(z.string().trim().min(1).max(120))
    .max(6)
    .optional()
    .describe('Answers the user can pick, at most 5 words each. Leave out for an open question.'),
  recommended: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('The option you recommend, copied exactly from options.')
}

export const closeToolFields = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe('The id its record call returned, such as q0k3x9a2.'),
  answer: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("The user's answer, in their words, when their own message answered a question."),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe('Otherwise, why it is closed, in at most 8 words, such as "fixed in this change".')
}

const recordFindingInput = z.object(recordFindingToolFields)
const recordQuestionInput = z.object(recordQuestionToolFields)
const closeInput = z.object(closeToolFields)

export type SessionInboxToolCall =
  | { tool: 'record_finding'; input: z.infer<typeof recordFindingInput> }
  | { tool: 'record_question'; input: z.infer<typeof recordQuestionInput> }
  | { tool: 'close'; input: z.infer<typeof closeInput> }

/** A journaled tool call read as an inbox call; null for any other tool or an input the server refused. */
export function readSessionInboxToolCall(
  name: string,
  input: unknown
): SessionInboxToolCall | null {
  switch (name) {
    case sessionInboxToolName(SESSION_INBOX_TOOLS.recordFinding): {
      const parsed = recordFindingInput.safeParse(input)
      return parsed.success ? { tool: 'record_finding', input: parsed.data } : null
    }
    case sessionInboxToolName(SESSION_INBOX_TOOLS.recordQuestion): {
      const parsed = recordQuestionInput.safeParse(input)
      return parsed.success ? { tool: 'record_question', input: parsed.data } : null
    }
    case sessionInboxToolName(SESSION_INBOX_TOOLS.close): {
      const parsed = closeInput.safeParse(input)
      return parsed.success ? { tool: 'close', input: parsed.data } : null
    }
    default:
      return null
  }
}

export type SessionInboxItemKind = 'finding' | 'question'

const ID_PREFIX: Record<SessionInboxItemKind, string> = { finding: 'f', question: 'q' }
const ID_PATTERN = /^[fq][0-9a-z]{7}$/

/**
 * An item's id, derived from its text, so the stateless server and every reader agree and a
 * repeat of the same text is the same item. Never change the hash: ids reach the model.
 */
export function sessionInboxItemId(kind: SessionInboxItemKind, text: string): string {
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5
  for (const char of normalized) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${ID_PREFIX[kind]}${hash.toString(36).padStart(7, '0')}`
}

export function isSessionInboxItemId(id: string): boolean {
  return ID_PATTERN.test(id)
}

export const SESSION_INBOX_FINDING_DESCRIPTION = `Record a finding for the user: something you noticed that deserves their attention but is outside the current task. It waits in the Orca Inbox beside this conversation until it is closed, and from there the user can ask you to address it or discuss it. Record what a careful senior engineer would flag to a teammate, and leave out style nits and anything the user already decided. Returns the finding's id.`

export const SESSION_INBOX_QUESTION_DESCRIPTION = `Record a question your reply leaves to the user, so it waits in the Orca Inbox until they answer it. Use it for a decision only the user can make that you leave open when your turn ends; when you need the answer before you can go on, ask with AskUserQuestion instead. Do not record rhetorical questions, offers to continue, or questions about what the user saw or meant. Returns the question's id.`

export const SESSION_INBOX_CLOSE_DESCRIPTION = `Close a question or finding you recorded, by the id its record call returned. Pass the user's answer when their own message answered a question, and a reason otherwise.`

/** Appended to the agent's system prompt, so it records and closes items without being asked. */
export const SESSION_INBOX_GUIDANCE = `# Orca Inbox
Orca shows the user an Inbox beside this conversation: the questions and findings you record there, and the tests, type checks, lints and builds that were failing when your turn ended.

A finding is something you noticed that deserves the user's attention but is outside the current task: a bug, a risk, missing tests, tech debt, or a chance to improve something. Record it with ${sessionInboxToolName(SESSION_INBOX_TOOLS.recordFinding)} the moment you notice it, then go on with the task; fixing it waits until the user asks. Record one too when you work around a problem instead of fixing it, or when part of your change could not be tested or verified, and say so in your reply as well.

When your reply leaves a decision to the user that only they can make, also record it with ${sessionInboxToolName(SESSION_INBOX_TOOLS.recordQuestion)}.

Close with ${sessionInboxToolName(SESSION_INBOX_TOOLS.close)}, by the id the record call returned:
- When the user's message answers a recorded question, close it first, with their answer.
- When a question or finding is done or no longer applies, close it with a short reason.
The answer to a question is the user's to give: close a question with their answer, or once it no longer applies, and never with an answer of your own.`
