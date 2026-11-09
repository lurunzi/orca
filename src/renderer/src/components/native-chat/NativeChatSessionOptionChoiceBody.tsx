export function NativeChatSessionOptionChoiceBody(props: {
  label: string
  suffix?: string | null
  description?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 py-0.5">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="truncate">{props.label}</span>
        {props.suffix ? (
          <span className="shrink-0 text-xs text-muted-foreground">{props.suffix}</span>
        ) : null}
      </div>
      {props.description ? (
        <div className="text-xs font-normal text-balance text-muted-foreground">
          {props.description}
        </div>
      ) : null}
    </div>
  )
}
