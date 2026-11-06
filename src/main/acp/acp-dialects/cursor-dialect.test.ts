import { describe, expect, it } from 'vitest'
import { translateAcpRequest } from '../acp-timeline-requests'
import { AcpStructuredOptions } from '../acp-structured-options'
import { AcpToolTimeline } from '../acp-tool-timeline'
import { scrubCursorAcpEnvironment } from '../../cursor/cursor-acp-launch-spec'
import { CURSOR_ACP_DIALECT } from './cursor-dialect'
import { parseCursorModelListing } from './cursor-model-catalog'
import { cursorRequest } from './cursor-requests'

const tools = new AcpToolTimeline()
const translate = (method: string, params: unknown) =>
  translateAcpRequest(method, params, 1, { sessionId: 's1', dialect: CURSOR_ACP_DIALECT, tools })

describe('Cursor sessionless requests', () => {
  it('accepts listed extension requests without a session and still checks a named one', () => {
    const plan = { toolCallId: 't', plan: 'p' }
    expect(translate('cursor/create_plan', plan).presentation?.body.kind).toBe('approval')
    expect(() => translate('cursor/create_plan', { ...plan, sessionId: 'other' })).toThrow(
      /unknown session/
    )
    expect(() => translate('session/request_permission', { toolCall: {}, options: [] })).toThrow(
      /unknown session/
    )
  })
})

describe('Cursor question replies', () => {
  const question = cursorRequest('cursor/ask_question', {
    toolCallId: 't',
    questions: [
      {
        id: 'q1',
        prompt: 'Pick',
        allowMultiple: true,
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' }
        ]
      }
    ]
  })!

  it('replies cancelled when withdrawn and refuses free text or unoffered choices', () => {
    expect(question.reply(null)).toEqual({ outcome: { outcome: 'cancelled' } })
    const answer = (optionIds: string[], other?: string) =>
      question.reply({
        kind: 'answers',
        answers: [{ questionId: 'q1', optionIds, ...(other ? { other } : {}) }]
      })
    expect(answer(['a', 'b'])).toEqual({
      outcome: {
        outcome: 'answered',
        answers: [{ questionId: 'q1', selectedOptionIds: ['a', 'b'] }]
      }
    })
    expect(() => answer(['c'])).toThrow(/offered options/)
    expect(() => answer([], 'free text')).toThrow(/offered options/)
  })

  it('keeps planning with a reason', () => {
    const plan = cursorRequest('cursor/create_plan', { plan: 'p' })!
    expect(plan.body).toMatchObject({ title: 'Review proposed plan' })
    expect(plan.reply({ kind: 'option', optionId: 'reject' })).toMatchObject({
      outcome: { outcome: 'rejected' }
    })
  })
})

describe('Cursor model listing', () => {
  // Trimmed from cursor-agent 2026.11.05 `cursor/list_available_models`.
  const listing = {
    models: [
      { value: 'default', name: 'Auto', configOptions: [] },
      {
        value: 'claude-opus-5',
        name: 'Claude Opus 5',
        configOptions: [
          {
            id: 'thinking',
            category: 'thought_level',
            type: 'select',
            currentValue: 'true',
            options: [{ value: 'false' }, { value: 'true' }]
          },
          {
            id: 'effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'high',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'high', name: 'High' }
            ]
          }
        ]
      }
    ]
  }

  it('lists every model with its effort menu, not the thinking switch', () => {
    expect(parseCursorModelListing(listing)).toEqual([
      { id: 'default', label: 'Auto', isDefault: false, efforts: [], declaredDefaultEffort: null },
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        isDefault: false,
        efforts: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' }
        ],
        declaredDefaultEffort: 'high'
      }
    ])
    expect(() => parseCursorModelListing({})).toThrow(/did not list/)
  })

  it('writes effort to the preferred thought-level option of a live session', () => {
    const options = new AcpStructuredOptions(CURSOR_ACP_DIALECT)
    const [, effort] = listing.models[1]!.configOptions
    options.adoptSession({
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'claude-opus-5',
          options: []
        },
        ...listing.models[1]!.configOptions.map((option) => ({
          name: option.id,
          ...option,
          options: []
        }))
      ]
    })
    expect(options.write('effort', 'low')).toEqual({
      method: 'config',
      configId: effort!.id,
      value: 'low'
    })
  })
})

describe('Cursor launch environment', () => {
  it('drops a POSIX SHELL on Windows only', () => {
    const env = { SHELL: '/usr/bin/bash', PATH: 'p' }
    expect(scrubCursorAcpEnvironment({ ...env }, {}, 'linux')).toEqual([])
    const scrubbed: Record<string, string> = { ...env }
    expect(scrubCursorAcpEnvironment(scrubbed, {}, 'win32')).toEqual(['SHELL'])
    expect(scrubbed).toEqual({ PATH: 'p' })
    expect(scrubCursorAcpEnvironment({ PATH: 'p' }, { SHELL: 'bash' }, 'win32')).toEqual(['SHELL'])
  })
})
