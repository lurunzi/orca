import { defineFixture } from '../../component-fixtures/component-fixture'
import { NativeChatModelCombobox } from './NativeChatModelCombobox'

const CURSOR_CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'grok-4.7-high-fast', label: 'Grok 4.7' },
  { value: 'cursor-grok-4.6-high', label: 'Grok 4.6' },
  { value: 'composer-2.5-fast', label: 'Composer 2.5' },
  { value: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5' },
  { value: 'gemini-4-argon-medium', label: 'Gemini 4 Argon' },
  { value: 'gpt-5.6-sol-medium', label: 'GPT-5.6 Sol' },
  { value: 'claude-fable-5-1-high', label: 'Claude Fable 5.1' },
  { value: 'claude-opus-4-8-high', label: 'Claude Opus 4.8' },
  { value: 'gpt-5.2-high', label: 'GPT-5.2' },
  { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash' }
]

export const cursorGrouped = defineFixture({
  width: 384,
  render: () => (
    <div className="p-2">
      <NativeChatModelCombobox
        choices={CURSOR_CHOICES}
        currentValue="claude-opus-5-5-medium"
        readOnly={false}
        readOnlyReason={null}
        busy={false}
        onSelect={() => {}}
        agent="cursor"
      />
    </div>
  )
})

export const plain = defineFixture({
  width: 384,
  render: () => (
    <div className="p-2">
      <NativeChatModelCombobox
        choices={[
          { value: 'gpt-5.5', label: 'GPT-5.5' },
          { value: 'opus', label: 'Opus 4.8' }
        ]}
        currentValue="opus"
        readOnly={false}
        readOnlyReason={null}
        busy={false}
        onSelect={() => {}}
      />
    </div>
  )
})
