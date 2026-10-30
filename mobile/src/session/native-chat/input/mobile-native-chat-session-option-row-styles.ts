import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'

export const sessionOptionRowStyles = themedStyleSheet(() => ({
  unavailableLabel: {
    textDecorationLine: 'line-through'
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.composerControl
  },
  pillText: {
    flexShrink: 1,
    fontSize: typography.bodySize
  },
  pillPrimary: {
    color: colors.textPrimary,
    fontWeight: '500'
  },
  pillMutedText: {
    color: colors.textMuted
  },
  pressed: {
    opacity: 0.7
  },
  caption: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs
  },
  rowMarker: {
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    minHeight: 50,
    alignItems: 'center',
    borderRadius: radii.card,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xs
  },
  rowSelected: {
    borderColor: colors.textSecondary,
    backgroundColor: colors.composerControl
  },
  rowGrouped: {
    marginBottom: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent'
  },
  rowDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.composerBorder
  },
  labelDisabled: {
    color: colors.textSecondary
  },
  rowBody: {
    flex: 1,
    gap: 2
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  rowDescription: {
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  summaryRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm
  },
  summaryLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  summaryValue: {
    maxWidth: 160,
    color: colors.textSecondary,
    fontSize: typography.bodySize
  }
}))
