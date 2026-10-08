import type * as ReactModule from 'react'
import { vi, type Mock } from 'vitest'

const toastError: Mock = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

export { toastError }

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
