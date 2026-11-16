import { describe, expect, it } from 'vitest'
import { ClaudeChildWorkDecoder } from './claude-child-work-decoder'

function system(subtype: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { type: 'system', subtype, session_id: 'provider-1', uuid: crypto.randomUUID(), ...fields }
}

describe('Claude child-work decoder', () => {
  it('names the agent a background shell runs, keeping it a stoppable command', () => {
    const decoder = new ClaudeChildWorkDecoder()
    decoder.observe({
      type: 'assistant',
      session_id: 'provider-1',
      uuid: 'assistant-1',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_agy',
            name: 'Bash',
            input: {
              command: 'cd ../fixture && agy -p "Build the calibration fixture" --model flash',
              run_in_background: true
            }
          }
        ]
      }
    })
    decoder.observe(
      system('task_started', {
        task_id: 'agy-1',
        tool_use_id: 'toolu_agy',
        task_type: 'local_bash',
        description: 'Run Flash worker A: calibration fixture',
        is_backgrounded: true
      })
    )
    expect(decoder.drain(500)).toMatchObject([
      { type: 'live', child: { kind: 'command', agentType: 'antigravity', stoppable: true } }
    ])
  })
})
