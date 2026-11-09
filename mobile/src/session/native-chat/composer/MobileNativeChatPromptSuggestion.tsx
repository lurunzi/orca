import { Pressable, Text, View } from 'react-native'
import { colors, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'

export function MobileNativeChatPromptSuggestion({
  text,
  onAccept,
  onDismiss
}: {
  text: string
  onAccept: () => void
  onDismiss: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.composer.useSuggestion', 'Use suggestion: {{text}}', { text })}
        accessibilityHint={t('chat.composer.useSuggestionHint', 'Fills the draft without sending')}
        onPress={onAccept}
        style={styles.suggestion}
      >
        <Text style={styles.text} numberOfLines={1}>
          {text}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('chat.composer.dismissSuggestion', 'Dismiss suggestion')}
        onPress={onDismiss}
        hitSlop={spacing.sm}
        style={styles.dismiss}
      >
        <Text style={styles.text}>×</Text>
      </Pressable>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  row: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  suggestion: { flex: 1, padding: spacing.xs },
  dismiss: { padding: spacing.xs },
  text: { color: colors.textMuted, fontSize: typography.bodySize }
}))
