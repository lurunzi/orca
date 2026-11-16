import React from 'react'
import { cn } from '@/lib/class-names'

/** Label of an entry that stays visible although its target's host cannot run it. */
export function UnavailableEntryLabel({
  unavailable = true,
  className,
  children
}: {
  unavailable?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  if (!unavailable) {
    return className ? <span className={className}>{children}</span> : <>{children}</>
  }
  return <span className={cn('text-muted-foreground line-through', className)}>{children}</span>
}

/** Trailing reason on a menu item whose target's host cannot run it. */
export function UnavailableEntryMenuHint({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{children}</span>
}

/** Inline reason beside or below a labelled control whose target's host cannot run it. */
export function UnavailableEntryReason({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return <span className={cn('text-xs text-muted-foreground', className)}>{children}</span>
}
