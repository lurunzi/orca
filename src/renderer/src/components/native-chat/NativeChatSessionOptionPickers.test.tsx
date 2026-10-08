// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type * as ReactModule from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) => {
    if (!values) {
      return fallback
    }
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      fallback
    )
  }
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react') as typeof ReactModule
  return {
    DropdownMenu: ({
      children,
      defaultOpen
    }: {
      children: React.ReactNode
      defaultOpen?: boolean
    }) => (
      <div data-testid="dropdown-root" data-open={defaultOpen ? 'true' : 'false'}>
        {children}
      </div>
    ),
    DropdownMenuTrigger: ({
      children,
      disabled
    }: {
      children: React.ReactNode
      disabled?: boolean
    }) => <div data-disabled={disabled || undefined}>{children}</div>,
    DropdownMenuContent: ({
      children,
      side,
      collisionPadding
    }: {
      children: React.ReactNode
      side?: string
      collisionPadding?: number
    }) => (
      <div
        data-testid="session-option-menu"
        data-side={side}
        data-collision-padding={collisionPadding}
      >
        {children}
      </div>
    ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    // Forwards role/aria-* and hands onSelect an event: the switch rows set both,
    // and preventDefault is how a toggle keeps the menu open.
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      onSelect?: (event: { preventDefault: () => void }) => void
    }) => (
      <button
        {...rest}
        disabled={disabled}
        onClick={() => onSelect?.({ preventDefault: () => {} })}
      >
        {children}
      </button>
    ),
    // Why: exercises value binding + onValueChange contract the real Radix
    // group provides; selected value is exposed via data-radio-value.
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange,
      'aria-label': ariaLabel
    }: {
      children: React.ReactNode
      value?: string
      onValueChange?: (value: string) => void
      'aria-label'?: string
    }) => (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        data-radio-value={value ?? ''}
        data-on-value-change={onValueChange ? '1' : '0'}
      >
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) {
            return child
          }
          const props = child.props as {
            value?: string
            disabled?: boolean
            children?: React.ReactNode
          }
          const selected = props.value !== undefined && props.value === value
          return (
            <button
              key={props.value}
              role="radio"
              aria-checked={selected}
              disabled={props.disabled}
              data-value={props.value}
              data-state={selected ? 'checked' : 'unchecked'}
              onClick={() => {
                if (props.value !== undefined) {
                  onValueChange?.(props.value)
                }
              }}
            >
              {props.children}
            </button>
          )
        })}
      </div>
    ),
    DropdownMenuRadioItem: ({
      children,
      disabled,
      value
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) => (
      // Why: parent RadioGroup mock reads `value` via Children.map — keep it on
      // props even though native span has no value attribute.
      <span
        data-radio-item
        data-disabled={disabled || undefined}
        {...({ value } as Record<string, string>)}
      >
        {children}
      </span>
    )
  }
})

import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'

const surface = {
  getSnapshot: vi.fn(() => []),
  setOption: vi.fn(),
  invokeAction: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}

function model(overrides: Partial<SessionOptionDescriptor> = {}): SessionOptionDescriptor {
  return {
    id: 'model',
    label: 'Model',
    category: 'model',
    kind: {
      type: 'select',
      currentValue: 'opus',
      choices: [
        { value: 'opus', label: 'Opus 4.8' },
        { value: 'sonnet', label: 'Sonnet 5' }
      ]
    },
    valueSource: 'applied',
    transport: 'catalog',
    settable: true,
    ...overrides
  }
}

const EFFORT_CHOICES = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' }
]

const effort: SessionOptionDescriptor = {
  id: 'effort',
  label: 'Effort',
  category: 'thought_level',
  kind: { type: 'select', currentValue: 'high', choices: EFFORT_CHOICES },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
}

/** A select with nothing picked. Only a select can be in this shape: it renders
 *  "nothing selected" truthfully, which is why the boolean kind requires a value. */
const unknownEffort: SessionOptionDescriptor = {
  ...effort,
  kind: { type: 'select', choices: EFFORT_CHOICES },
  valueSource: 'unknown'
}

const fast: SessionOptionDescriptor = {
  id: 'fastMode',
  label: 'Fast mode',
  category: 'mode',
  kind: { type: 'boolean', currentValue: true },
  valueSource: 'applied',
  transport: 'catalog',
  settable: true
}

const CURSOR_MODEL_CHOICES = [
  { value: 'gpt-5.3-codex', label: 'Codex 5.3' },
  { value: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low' },
  { value: 'gpt-5.3-codex-high', label: 'Codex 5.3 High' },
  { value: 'gpt-5.6-sol-high', label: 'GPT-5.6 Sol 1M High' },
  { value: 'gpt-5.6-sol-xhigh', label: 'GPT-5.6 Sol 1M Extra High' },
  { value: 'gpt-5.6-sol-high-fast', label: 'GPT-5.6 Sol 1M High Fast' },
  { value: 'gpt-5.6-sol-xhigh-fast', label: 'GPT-5.6 Sol 1M Extra High Fast' }
]

afterEach(() => cleanup())

describe('NativeChatSessionOptionPickers', () => {
  it('opens the native picker requested by a structured slash command', async () => {
    const { rerender } = render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), effort]}
        isWorking={false}
        pickerRequest={null}
      />
    )

    rerender(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), effort]}
        isWorking={false}
        pickerRequest={{ id: 'model', sequence: 1 }}
      />
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Model Opus 4.8' })
          .closest('[data-testid="dropdown-root"]')
          ?.getAttribute('data-open')
      ).toBe('true')
    )

    rerender(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), effort]}
        isWorking={false}
        pickerRequest={{ id: 'effort', sequence: 2 }}
      />
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Effort High' })
          .closest('[data-testid="dropdown-root"]')
          ?.getAttribute('data-open')
      ).toBe('true')
    )
  })

  it('prefers collision-aware upward placement for model and option menus', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), effort]}
        isWorking={false}
      />
    )

    const menus = screen.getAllByTestId('session-option-menu')
    expect(menus).toHaveLength(2)
    for (const menu of menus) {
      expect(menu.getAttribute('data-side')).toBe('top')
      expect(menu.getAttribute('data-collision-padding')).toBe('8')
    }
  })

  it('renders model and joined option labels, and hides an empty options pill', () => {
    const { rerender } = render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), effort, fast]}
        isWorking={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Model Opus 4.8' }).textContent).toContain('Opus 4.8')
    expect(screen.getByRole('button', { name: 'Model Opus 4.8' }).textContent).not.toContain(
      'Model:'
    )
    expect(screen.getByRole('button', { name: 'Effort High · Fast' }).textContent).toContain(
      'High · Fast'
    )
    expect(
      screen
        .getByRole('button', { name: 'Model Opus 4.8' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'Effort High · Fast' })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)

    rerender(
      <NativeChatSessionOptionPickers surface={surface} snapshot={[model()]} isWorking={false} />
    )
    expect(screen.queryByRole('button', { name: /Effort/ })).toBeNull()
  })

  it('names a lone unknown effort control explicitly', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), unknownEffort]}
        isWorking={false}
      />
    )

    expect(screen.getByRole('button', { name: 'Effort' }).textContent).toContain('Effort')
  })

  it('queues a mid-turn pick and applies it once the turn ends', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, setOption }
    const { rerender } = render(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[model(), effort]}
        isWorking
      />
    )
    expect(
      screen
        .getByRole('button', { name: 'Model Opus 4.8' })
        .parentElement?.getAttribute('data-disabled')
    ).toBeNull()

    screen.getByRole('radio', { name: 'Sonnet 5' }).click()

    expect(await screen.findByRole('button', { name: 'Model Sonnet 5' })).not.toBeNull()
    expect(screen.getByText('Applies after this turn')).not.toBeNull()
    expect(setOption).not.toHaveBeenCalled()

    rerender(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[model(), effort]}
        isWorking={false}
      />
    )
    await waitFor(() => expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'sonnet'))
  })

  it('keeps terminal actions blocked while the agent is working', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model({ action: { type: 'agent-picker' } })]}
        isWorking
      />
    )
    expect(
      screen.getByText('Choose in agent picker…').closest('button')?.hasAttribute('disabled')
    ).toBe(true)
  })

  it('does not duplicate titles for unknown values or misname generic controls', () => {
    const { rerender } = render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[
          model({
            kind: { type: 'select', choices: [] },
            valueSource: 'unknown'
          }),
          unknownEffort
        ]}
        isWorking={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('Model')
    expect(screen.getByRole('button', { name: 'Model' }).textContent).not.toContain('Model: Model')
    expect(screen.getByRole('button', { name: 'Effort' }).textContent).not.toContain(
      'Effort: Effort'
    )

    rerender(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model(), fast]}
        isWorking={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Session options Fast' }).textContent).toContain(
      'Fast'
    )
    expect(screen.queryByRole('button', { name: /^Effort/ })).toBeNull()
  })

  // The terminal transport typed the value at the agent and has not read it back,
  // so the pill says so; the structured transport's own per-turn report is the
  // confirmation, which makes the same hedge transient noise there.
  it('hedges a dispatched value the terminal transport produced', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model({ valueSource: 'dispatched', transport: 'catalog' })]}
        isWorking={false}
      />
    )
    expect(screen.getByText('Model')).not.toBeNull()
    expect(screen.getAllByText('Sent to the agent — not confirmed').length).toBeGreaterThan(0)
  })

  it('does not hedge a dispatched value the structured transport produced', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model({ valueSource: 'dispatched', transport: 'agent-session' })]}
        isWorking={false}
      />
    )
    expect(screen.getByText('Model')).not.toBeNull()
    expect(screen.queryByText(/not confirmed/)).toBeNull()
  })

  it.each(['catalog'] as const)(
    'does not hedge a reported value on the %s transport',
    (transport) => {
      render(
        <NativeChatSessionOptionPickers
          surface={surface}
          snapshot={[model({ valueSource: 'reported', transport })]}
          isWorking={false}
        />
      )
      expect(screen.getByText('Model')).not.toBeNull()
      expect(screen.queryByText(/not confirmed/)).toBeNull()
    }
  )

  it.each([
    { choices: [] },
    {
      choices: [
        { value: 'gpt-5.5', label: 'GPT-5.5' },
        { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }
      ]
    }
  ])('renders agent-picker routes even without catalog choices: %j', async ({ choices }) => {
    const invokeAction = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, invokeAction }
    render(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[
          model({
            kind: {
              type: 'select',
              choices
            },
            valueSource: 'unknown',
            action: { type: 'agent-picker' }
          })
        ]}
        isWorking={false}
      />
    )
    expect(screen.getByRole('button', { name: 'Choose in agent picker…' })).not.toBeNull()
    expect(screen.queryByText('GPT-5.5')).toBeNull()
    expect(screen.queryByText('GPT-5.2 Codex')).toBeNull()
    screen.getByRole('button', { name: 'Choose in agent picker…' }).click()
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('model'))
  })

  it.each([
    [
      "the table's words for a host's refusal, not its message",
      new RuntimeRpcCallError({
        id: 'request-1',
        ok: false,
        error: {
          code: 'runtime_error',
          message: 'agent_session_journal_unreadable',
          data: {
            refusal: {
              code: 'agent_session_journal_unreadable',
              details: { reason: 'journalCorrupt' }
            }
          }
        },
        _meta: { runtimeId: 'runtime-1' }
      }),
      "Unable to load this chat. The setting wasn't changed."
    ],
    [
      "a local surface's own sentence",
      new Error('The terminal did not accept the command.'),
      'The terminal did not accept the command.'
    ]
  ])('describes a failed option change with %s', async (_label, error, description) => {
    toastError.mockClear()
    const invokeAction = vi.fn().mockRejectedValue(error)
    render(
      <NativeChatSessionOptionPickers
        surface={{ ...surface, invokeAction }}
        snapshot={[
          model({
            kind: { type: 'select', choices: [{ value: 'gpt-5.5', label: 'GPT-5.5' }] },
            valueSource: 'unknown',
            action: { type: 'agent-picker' }
          })
        ]}
        isWorking={false}
      />
    )
    screen.getByRole('button', { name: 'Choose in agent picker…' }).click()
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledExactlyOnceWith('Could not update option', {
        description
      })
    )
  })

  it('uses a Toggle action for unknown flip-only options via invokeAction', async () => {
    const invokeAction = vi.fn().mockResolvedValue({ snapshot: [] })
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, setOption, invokeAction }
    render(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[
          model(),
          {
            ...fast,
            kind: { type: 'boolean', currentValue: false },
            valueSource: 'unknown',
            action: { type: 'toggle-command' }
          }
        ]}
        isWorking={false}
      />
    )
    expect(screen.getByText('Toggle fast mode')).not.toBeNull()
    expect(screen.queryByText('On')).toBeNull()
    expect(screen.queryByText('Off')).toBeNull()
    screen.getByText('Toggle fast mode').click()
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('fastMode'))
    expect(setOption).not.toHaveBeenCalled()
  })

  it('uses one switch row for a boolean option without inventing a selection', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, setOption }
    const { rerender } = render(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[
          model(),
          {
            ...fast,
            kind: { type: 'boolean', currentValue: true },
            valueSource: 'applied',
            action: undefined
          }
        ]}
        isWorking={false}
      />
    )
    expect(screen.queryByText('Toggle fast mode')).toBeNull()
    // One control, not an On/Off pair, and the row carries the label itself.
    expect(screen.queryByRole('radio', { name: 'On' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Off' })).toBeNull()
    const fastSwitch = screen.getByRole('switch', { name: 'Fast mode' })
    expect(fastSwitch.getAttribute('aria-checked')).toBe('true')
    expect(
      fastSwitch.querySelector('[data-slot="switch-indicator"]')?.getAttribute('data-state')
    ).toBe('checked')
    // The label is not duplicated by a separate group header.
    expect(screen.getAllByText('Fast mode')).toHaveLength(1)
    fastSwitch.click()
    await waitFor(() => expect(setOption).toHaveBeenCalledWith('fastMode', false))

    setOption.mockClear()
    rerender(
      <NativeChatSessionOptionPickers
        surface={liveSurface}
        snapshot={[
          model(),
          {
            id: 'thinking',
            label: 'Thinking',
            category: 'mode',
            // What the producer now emits for an unreported `thinking`: the
            // catalog default, with provenance still saying nothing confirmed it.
            kind: { type: 'boolean', currentValue: true },
            valueSource: 'unknown',
            transport: 'catalog',
            settable: true
          }
        ]}
        isWorking={false}
      />
    )
    // The producer resolves the value, so the row renders it instead of a caption
    // apologising for a switch that had already collapsed to off.
    expect(screen.queryByText('Current value unknown')).toBeNull()
    const thinkingSwitch = screen.getByRole('switch', { name: 'Thinking' })
    expect(thinkingSwitch.getAttribute('aria-checked')).toBe('true')
    thinkingSwitch.click()
    await waitFor(() => expect(setOption).toHaveBeenCalledWith('thinking', false))
  })

  // The switch row is the label and the switch, whatever said the value; no provenance caption.
  it.each([
    { valueSource: 'unknown', transport: 'agent-session' },
    { valueSource: 'default', transport: 'catalog' },
    { valueSource: 'reported', transport: 'agent-session' }
  ] as const)('shows a $valueSource boolean as its switch alone', ({ valueSource, transport }) => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[
          model(),
          { ...fast, kind: { type: 'boolean', currentValue: false }, valueSource, transport }
        ]}
        isWorking={false}
      />
    )
    const control = screen.getByRole('switch', { name: 'Fast mode' })
    expect(control.textContent).toBe('Fast mode')
    expect(control.hasAttribute('aria-describedby')).toBe(false)
    expect(screen.queryByText('Not reported')).toBeNull()
    expect(screen.queryByText('Default')).toBeNull()
  })

  it('tooltips a dispatched option pill with the category alone', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[
          model(),
          {
            id: 'thinking',
            label: 'Thinking',
            category: 'mode',
            kind: { type: 'boolean', currentValue: true },
            valueSource: 'dispatched',
            transport: 'catalog',
            settable: true
          }
        ]}
        isWorking={false}
      />
    )
    expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sent to the agent — not confirmed').length).toBeGreaterThan(0)
  })

  it('splits CLI-listed effort tiers into a model row and a tier pill', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const tiered = model({
      kind: {
        type: 'select',
        currentValue: 'flash-medium',
        choices: [
          { value: 'flash-high', label: 'Flash (High)' },
          { value: 'flash-medium', label: 'Flash (Medium)' },
          { value: 'pro-high', label: 'Pro (High)' },
          { value: 'pro-low', label: 'Pro (Low)' },
          { value: 'sonnet', label: 'Sonnet (Thinking)' }
        ]
      }
    })
    render(
      <NativeChatSessionOptionPickers
        surface={{ ...surface, setOption }}
        snapshot={[tiered]}
        isWorking={false}
      />
    )

    expect(screen.getByRole('button', { name: 'Model Flash' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Effort Medium' })).not.toBeNull()
    const models = within(screen.getByRole('radiogroup', { name: 'Model' }))
    expect(models.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'Flash',
      'Pro',
      'Sonnet (Thinking)'
    ])
    expect(models.getByRole('radio', { name: 'Flash', checked: true })).not.toBeNull()
    const tiers = screen.getByRole('radiogroup', { name: 'Effort' })
    expect([...tiers.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      'High',
      'Medium'
    ])

    within(tiers).getByRole('radio', { name: 'High' }).click()
    await waitFor(() => expect(setOption).toHaveBeenCalledWith('model', 'flash-high'))
  })

  it.each([
    ['flash-low', 'Pro', 'pro-low'],
    ['flash-medium', 'Pro', 'pro-high'],
    ['flash-medium', 'Sonnet (Thinking)', 'sonnet'],
    ['sonnet', 'Pro', 'pro-high']
  ])('switches %s to %s using model id %s', async (currentValue, label, expected) => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    render(
      <NativeChatSessionOptionPickers
        surface={{ ...surface, setOption }}
        snapshot={[
          model({
            kind: {
              type: 'select',
              currentValue,
              choices: [
                { value: 'flash-high', label: 'Flash (High)' },
                { value: 'flash-medium', label: 'Flash (Medium)' },
                { value: 'flash-low', label: 'Flash (Low)' },
                { value: 'pro-high', label: 'Pro (High)' },
                { value: 'pro-low', label: 'Pro (Low)' },
                { value: 'sonnet', label: 'Sonnet (Thinking)' }
              ]
            }
          })
        ]}
        isWorking={false}
      />
    )
    within(screen.getByRole('radiogroup', { name: 'Model' }))
      .getByRole('radio', { name: label })
      .click()
    await waitFor(() => expect(setOption).toHaveBeenCalledExactlyOnceWith('model', expected))
  })

  it('queues a model switch and then changes only the new model effort', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, setOption }
    const snapshot = [
      model({
        kind: {
          type: 'select',
          currentValue: 'flash-medium',
          choices: [
            { value: 'flash-high', label: 'Flash (High)' },
            { value: 'flash-medium', label: 'Flash (Medium)' },
            { value: 'pro-high', label: 'Pro (High)' },
            { value: 'pro-low', label: 'Pro (Low)' }
          ]
        }
      })
    ]
    const { rerender } = render(
      <NativeChatSessionOptionPickers surface={liveSurface} snapshot={snapshot} isWorking={true} />
    )
    within(screen.getByRole('radiogroup', { name: 'Model' }))
      .getByRole('radio', { name: 'Pro' })
      .click()
    expect(await screen.findByRole('button', { name: 'Model Pro' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Effort High' })).not.toBeNull()
    const effortChoices = within(screen.getByRole('radiogroup', { name: 'Effort' }))
    expect(effortChoices.queryByRole('radio', { name: 'Medium' })).toBeNull()
    effortChoices.getByRole('radio', { name: 'Low' }).click()
    expect(await screen.findByRole('button', { name: 'Effort Low' })).not.toBeNull()
    expect(setOption).not.toHaveBeenCalled()
    rerender(
      <NativeChatSessionOptionPickers surface={liveSurface} snapshot={snapshot} isWorking={false} />
    )
    await waitFor(() => expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'pro-low'))
  })

  it.each([false, true])(
    'changes Cursor effort without losing Fast (working: %s)',
    async (isWorking) => {
      const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
      const liveSurface = { ...surface, setOption }
      const snapshot = [
        model({
          kind: {
            type: 'select',
            currentValue: 'gpt-5.6-sol-high-fast',
            choices: CURSOR_MODEL_CHOICES
          }
        })
      ]
      const { rerender } = render(
        <NativeChatSessionOptionPickers
          surface={liveSurface}
          snapshot={snapshot}
          isWorking={isWorking}
        />
      )
      const models = within(screen.getByRole('radiogroup', { name: 'Model' }))
      expect(models.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
        'Codex 5.3',
        'GPT-5.6 Sol 1M',
        'GPT-5.6 Sol 1M Fast'
      ])
      expect(
        models.getByRole('radio', { name: 'GPT-5.6 Sol 1M Fast', checked: true })
      ).not.toBeNull()
      within(screen.getByRole('radiogroup', { name: 'Effort' }))
        .getByRole('radio', { name: 'Extra high' })
        .click()
      if (isWorking) {
        expect(await screen.findByRole('button', { name: 'Effort Extra high' })).not.toBeNull()
        expect(setOption).not.toHaveBeenCalled()
        rerender(
          <NativeChatSessionOptionPickers
            surface={liveSurface}
            snapshot={snapshot}
            isWorking={false}
          />
        )
      }
      await waitFor(() =>
        expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'gpt-5.6-sol-xhigh-fast')
      )
    }
  )

  it('keeps one native effort control for Cursor seed models and carries its effort to another model', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    render(
      <NativeChatSessionOptionPickers
        surface={{ ...surface, setOption }}
        snapshot={[
          model({
            kind: { type: 'select', currentValue: 'gpt-5.3-codex', choices: CURSOR_MODEL_CHOICES }
          }),
          effort
        ]}
        isWorking={false}
      />
    )
    expect(screen.getAllByRole('radiogroup', { name: 'Effort' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Effort/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Effort High' })).not.toBeNull()
    within(screen.getByRole('radiogroup', { name: 'Model' }))
      .getByRole('radio', { name: 'GPT-5.6 Sol 1M' })
      .click()
    await waitFor(() =>
      expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'gpt-5.6-sol-high')
    )
  })

  it('replaces queued Cursor seed options with the final variant id', async () => {
    const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
    const liveSurface = { ...surface, setOption }
    const snapshot = [
      model({
        kind: { type: 'select', currentValue: 'gpt-5.3-codex', choices: CURSOR_MODEL_CHOICES }
      }),
      effort,
      fast
    ]
    const { rerender } = render(
      <NativeChatSessionOptionPickers surface={liveSurface} snapshot={snapshot} isWorking={true} />
    )
    within(screen.getByRole('radiogroup', { name: 'Effort' }))
      .getByRole('radio', { name: 'Low' })
      .click()
    expect(await screen.findByRole('button', { name: 'Effort Low · Fast' })).not.toBeNull()
    within(screen.getByRole('radiogroup', { name: 'Model' }))
      .getByRole('radio', { name: 'GPT-5.6 Sol 1M Fast' })
      .click()
    expect(await screen.findByRole('button', { name: 'Model GPT-5.6 Sol 1M Fast' })).not.toBeNull()
    expect(screen.getAllByRole('radiogroup', { name: 'Effort' })).toHaveLength(1)
    expect(screen.queryByRole('switch', { name: 'Fast mode' })).toBeNull()
    within(screen.getByRole('radiogroup', { name: 'Effort' }))
      .getByRole('radio', { name: 'Extra high' })
      .click()
    expect(await screen.findByRole('button', { name: 'Effort Extra high' })).not.toBeNull()
    expect(setOption).not.toHaveBeenCalled()
    rerender(
      <NativeChatSessionOptionPickers surface={liveSurface} snapshot={snapshot} isWorking={false} />
    )
    await waitFor(() =>
      expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'gpt-5.6-sol-xhigh-fast')
    )
  })

  it.each([false, true])(
    'selects a model before its effort when the current model is unknown (working: %s)',
    async (isWorking) => {
      const setOption = vi.fn().mockResolvedValue({ snapshot: [] })
      const liveSurface = { ...surface, setOption }
      const unknown = model({
        valueSource: 'unknown',
        kind: {
          type: 'select',
          currentValue: 'account-high',
          choices: [
            { value: 'account-high', label: 'Flash (High)' },
            { value: 'account-medium', label: 'Flash (Medium)' },
            { value: 'account-low', label: 'Flash (Low)' }
          ]
        }
      })
      const { rerender } = render(
        <NativeChatSessionOptionPickers
          surface={liveSurface}
          snapshot={[unknown]}
          isWorking={isWorking}
        />
      )
      expect(screen.getByRole('button', { name: 'Model' })).not.toBeNull()
      expect(screen.queryByRole('button', { name: /^Effort/ })).toBeNull()
      expect(screen.queryByRole('radio', { checked: true })).toBeNull()
      const choices = within(screen.getByRole('radiogroup', { name: 'Model' }))
      expect(choices.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Flash'])
      choices.getByRole('radio', { name: 'Flash' }).click()
      if (!isWorking) {
        await waitFor(() =>
          expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'account-high')
        )
        rerender(
          <NativeChatSessionOptionPickers
            surface={liveSurface}
            snapshot={[{ ...unknown, valueSource: 'applied' }]}
            isWorking={false}
          />
        )
        setOption.mockClear()
      }
      expect(await screen.findByRole('button', { name: 'Effort High' })).not.toBeNull()
      within(screen.getByRole('radiogroup', { name: 'Effort' }))
        .getByRole('radio', { name: 'Low' })
        .click()
      if (isWorking) {
        expect(await screen.findByRole('button', { name: 'Effort Low' })).not.toBeNull()
        expect(setOption).not.toHaveBeenCalled()
        rerender(
          <NativeChatSessionOptionPickers
            surface={liveSurface}
            snapshot={[unknown]}
            isWorking={false}
          />
        )
      }
      await waitFor(() => expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'account-low'))
    }
  )
})
