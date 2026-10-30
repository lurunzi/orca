import { Pressable, Switch, Text, View } from 'react-native'
import { Check, ChevronRight, ShieldAlert, type LucideIcon } from 'lucide-react-native'
import { colors } from '../../../theme/mobile-theme'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import {
  sessionOptionValueMarker,
  type SessionOptionDescriptor,
  type SessionOptionValueMarker,
  type SessionOptionValue
} from '../../../../../src/shared/native-chat/input/native-chat-session-options'
import {
  nativeChatSessionChoiceLabel,
  nativeChatSessionOptionActionLabel,
  nativeChatSessionOptionLabel
} from '../../../../../src/shared/native-chat-session-option-labels'
import { sayMobileNativeChatSessionOption as say } from './native-chat-session-option-copy'
import { sessionOptionRowStyles as styles } from './mobile-native-chat-session-option-row-styles'

export function SessionOptionCaption({ children }: { children: string }): React.JSX.Element {
  useMobileColorScheme()
  return <Text style={styles.caption}>{children}</Text>
}

export function ModelPill({
  primary,
  secondary,
  warning,
  icon: Icon,
  accessibleName,
  disabled,
  onPress
}: {
  primary: string
  secondary: string | null
  warning: boolean
  icon?: LucideIcon
  accessibleName: string
  disabled: boolean
  onPress: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const PillIcon = Icon ?? (warning ? ShieldAlert : undefined)
  return (
    <Pressable
      accessibilityLabel={accessibleName}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.pill, pressed && !disabled && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      {PillIcon ? (
        <PillIcon
          size={15}
          color={warning ? colors.statusAmber : disabled ? colors.textMuted : colors.textSecondary}
          strokeWidth={2.2}
        />
      ) : null}
      {!Icon ? (
        <Text style={styles.pillText} numberOfLines={1} ellipsizeMode="tail">
          <Text style={[styles.pillPrimary, disabled && styles.pillMutedText]}>{primary}</Text>
          {secondary ? <Text style={styles.pillMutedText}>{`  ${secondary}`}</Text> : null}
        </Text>
      ) : null}
    </Pressable>
  )
}

function ChoiceRow({
  label,
  description,
  selected,
  disabled,
  grouped,
  divided,
  onPress,
  labelColor
}: {
  label: string
  description?: string
  selected: boolean
  disabled: boolean
  grouped: boolean
  divided: boolean
  onPress: () => void
  labelColor?: string
}): React.JSX.Element {
  useMobileColorScheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[
        styles.row,
        grouped && styles.rowGrouped,
        selected && styles.rowSelected,
        divided && styles.rowDivided
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowLabel,
            disabled && !selected && styles.labelDisabled,
            labelColor ? { color: labelColor } : null
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text style={styles.rowDescription} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={18} color={colors.textPrimary} strokeWidth={2.4} /> : null}
    </Pressable>
  )
}

function ToggleRow({
  label,
  checked,
  marker,
  disabled,
  unavailable,
  grouped,
  onToggle
}: {
  label: string
  checked: boolean
  marker: SessionOptionValueMarker | null
  disabled: boolean
  unavailable: boolean
  grouped: boolean
  onToggle: (next: boolean) => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  return (
    <View style={[styles.row, grouped && styles.rowGrouped]}>
      <View style={styles.rowBody}>
        <Text
          style={[
            styles.rowLabel,
            disabled && styles.labelDisabled,
            unavailable && styles.unavailableLabel
          ]}
        >
          {label}
        </Text>
      </View>
      {marker ? (
        <Text style={styles.rowMarker}>
          {marker === 'default'
            ? t('chat.sessionOptionRows.defaultMarker', 'Default')
            : t('chat.sessionOptionRows.notReportedMarker', 'Not reported')}
        </Text>
      ) : null}
      <Switch
        accessibilityLabel={label}
        value={checked}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
        thumbColor={colors.textPrimary}
      />
    </View>
  )
}

function ActionRow({
  label,
  disabled,
  grouped,
  onPress
}: {
  label: string
  disabled: boolean
  grouped: boolean
  onPress: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.row, grouped && styles.rowGrouped]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && styles.labelDisabled]}>{label}</Text>
      </View>
    </Pressable>
  )
}

export function SessionOptionSummaryRow({
  label,
  value,
  valueColor,
  disabled,
  divided,
  onPress
}: {
  label: string
  value: string
  valueColor?: string
  disabled: boolean
  divided: boolean
  onPress?: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={`${label}, ${value}`}
        style={[styles.summaryRow, divided && styles.rowDivided]}
      >
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    )
  }
  return (
    <Pressable
      accessibilityLabel={`${label}, ${value}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.summaryRow,
        divided && styles.rowDivided,
        pressed && !disabled && styles.pressed
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.summaryLabel, disabled && styles.labelDisabled]}>{label}</Text>
      <Text
        style={[styles.summaryValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <ChevronRight size={16} color={colors.textMuted} strokeWidth={2.2} />
    </Pressable>
  )
}

export function DescriptorRows({
  descriptor,
  disabled,
  grouped = false,
  onSetOption,
  onInvokeAction,
  choiceLabelColor
}: {
  descriptor: SessionOptionDescriptor
  disabled: boolean
  grouped?: boolean
  onSetOption: (value: SessionOptionValue) => void
  onInvokeAction: () => void
  choiceLabelColor?: (value: string) => string | undefined
}): React.JSX.Element {
  useMobileTranslation()
  const locked = disabled || !descriptor.settable
  // Why: flip-only and agent-picker options are actions, not values or radio choices.
  if (descriptor.action) {
    return (
      <ActionRow
        label={nativeChatSessionOptionActionLabel(descriptor, say)}
        disabled={locked}
        grouped={grouped}
        onPress={onInvokeAction}
      />
    )
  }
  // An unknown baseline still renders a switch; the source marker prevents implying the value was confirmed.
  if (descriptor.kind.type === 'boolean') {
    return (
      <ToggleRow
        label={nativeChatSessionOptionLabel(descriptor, say)}
        unavailable={!descriptor.settable}
        checked={descriptor.kind.currentValue}
        marker={sessionOptionValueMarker(descriptor)}
        disabled={locked}
        grouped={grouped}
        onToggle={(next) => onSetOption(next)}
      />
    )
  }
  const { currentValue, choices } = descriptor.kind
  return (
    <>
      {choices.map((choice, index) => (
        <ChoiceRow
          key={choice.value}
          label={nativeChatSessionChoiceLabel(choice, say, descriptor.id)}
          description={choice.description}
          selected={choice.value === currentValue}
          disabled={locked}
          grouped={grouped}
          divided={grouped && index < choices.length - 1}
          onPress={() => onSetOption(choice.value)}
          labelColor={choiceLabelColor?.(choice.value)}
        />
      ))}
    </>
  )
}
