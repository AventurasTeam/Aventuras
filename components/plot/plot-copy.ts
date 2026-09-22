import type { OverflowMenuEntry } from '@/components/compounds/overflow-menu'
import type { SelectOption } from '@/components/ui/select'
import { t } from '@/lib/i18n'
import type { PlotKind } from '@/lib/list-modules'

import { PLOT_ICON_KEYS } from './plot-icon'

const VALIDATION_KEYS = [
  'titleRequired',
  'timeAnchorExclusive',
  'duplicateEntity',
  'duplicateCharacter',
  'entityRequired',
  'characterRequired',
] as const
type ValidationKey = (typeof VALIDATION_KEYS)[number]

function isValidationKey(message: string): message is ValidationKey {
  return (VALIDATION_KEYS as readonly string[]).includes(message)
}

/** A draft-schema issue message (a key) → its text; unknown messages pass through. */
export function validationText(message: string): string {
  return isValidationKey(message) ? t(`plot:validation.${message}`) : message
}

export function issueLabel(message: string | undefined): string | undefined {
  return message == null ? undefined : validationText(message)
}

const THREAD_FIELD_LABEL: Record<string, () => string> = {
  title: () => t('plot:fields.title'),
  description: () => t('plot:fields.description'),
  category: () => t('plot:fields.category'),
  icon: () => t('plot:fields.icon'),
  status: () => t('plot:fields.status'),
  injectionMode: () => t('plot:fields.injectionMode'),
}

const HAPPENING_FIELD_LABEL: Record<string, () => string> = {
  ...THREAD_FIELD_LABEL,
  commonKnowledge: () => t('plot:fields.commonKnowledge'),
  occurredAtEntryId: () => t('plot:fields.occurredAt'),
  temporal: () => t('plot:fields.temporal'),
  involvements: () => t('plot:detail.tabs.involvements'),
  awareness: () => t('plot:detail.tabs.awareness'),
}

/** Save-bar labels are user-recognizable field names (save-sessions.md → Save bar). */
export function threadFieldLabel(field: string): string {
  return THREAD_FIELD_LABEL[field]?.() ?? field
}

export function happeningFieldLabel(field: string): string {
  return HAPPENING_FIELD_LABEL[field]?.() ?? field
}

/** Plot's detail-head `⋯` menu: export (disabled), view raw JSON (live), delete (disabled). */
export function plotMenuEntries(kind: PlotKind, onViewJson: () => void): OverflowMenuEntry[] {
  return [
    {
      key: 'export',
      label:
        kind === 'thread'
          ? t('plot:detail.menu.exportThread')
          : t('plot:detail.menu.exportHappening'),
      disabled: true,
      disabledReason: t('plot:detail.menu.exportReason'),
      onPress: () => {},
    },
    { key: 'json', label: t('plot:detail.menu.viewJson'), onPress: onViewJson },
    {
      key: 'delete',
      label:
        kind === 'thread'
          ? t('plot:detail.menu.deleteThread')
          : t('plot:detail.menu.deleteHappening'),
      destructive: true,
      disabled: true,
      disabledReason: t('plot:detail.menu.deleteReason'),
      onPress: () => {},
    },
  ]
}

/** The icon dropdown: none, the catalog, and the row's own key when it is not in the catalog. */
export function plotIconOptions(current: string | null): SelectOption[] {
  const keys =
    current != null && !PLOT_ICON_KEYS.includes(current)
      ? [current, ...PLOT_ICON_KEYS]
      : PLOT_ICON_KEYS
  return [
    { value: '', label: t('plot:fields.iconNone') },
    ...keys.map((key) => ({ value: key, label: key })),
  ]
}
