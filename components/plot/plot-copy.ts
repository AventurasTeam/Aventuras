import type { OverflowMenuEntry } from '@/components/compounds/overflow-menu'
import type { SelectOption } from '@/components/ui/select'
import { PLOT_REJECTION } from '@/lib/actions'
import { t } from '@/lib/i18n'
import type { PlotKind } from '@/lib/list-modules'
import { isPlotIssue, type HappeningDraft, type PlotIssue, type ThreadDraft } from '@/lib/plot'

import { PLOT_ICON_KEYS } from './plot-icon'

/** A draft-schema issue message (a key) → its text; unknown messages pass through. */
export function validationText(message: string): string {
  return isPlotIssue(message) ? t(`plot:validation.${message}`) : message
}

export function issueLabel(message: string | undefined): string | undefined {
  return message == null ? undefined : validationText(message)
}

/** A refused save's user-facing text; the actions' own reasons are developer strings. */
export function saveRejectionText(code: string | undefined): string {
  return code === PLOT_REJECTION.inFlight ? t('plot:save.inFlight') : t('plot:save.failed')
}

export function saveFailureText(): string {
  return t('plot:save.failed')
}

/** The category Autocomplete's create-tail row. */
export function categoryTailLabel(value: string): string {
  return t('plot:fields.categoryAdd', { value })
}

const SHARED_FIELD_LABEL = {
  title: () => t('plot:fields.title'),
  description: () => t('plot:fields.description'),
  category: () => t('plot:fields.category'),
  icon: () => t('plot:fields.icon'),
}

// Exhaustive per draft: a new draft field fails typecheck until it has a label.
const THREAD_FIELD_LABEL: Record<keyof ThreadDraft, () => string> = {
  ...SHARED_FIELD_LABEL,
  status: () => t('plot:fields.status'),
  injectionMode: () => t('plot:fields.injectionMode'),
}

const HAPPENING_FIELD_LABEL: Record<keyof HappeningDraft, () => string> = {
  ...SHARED_FIELD_LABEL,
  commonKnowledge: () => t('plot:fields.commonKnowledge'),
  occurredAtEntryId: () => t('plot:fields.occurredAt'),
  temporal: () => t('plot:fields.temporal'),
  involvements: () => t('plot:detail.tabs.involvements'),
  awareness: () => t('plot:detail.tabs.awareness'),
}

function labelFrom(labels: Record<string, () => string>, field: string): string {
  return Object.hasOwn(labels, field) ? labels[field]() : field
}

/** Save-bar labels are user-recognizable field names (save-sessions.md → Save bar). */
export function threadFieldLabel(field: string): string {
  return labelFrom(THREAD_FIELD_LABEL, field)
}

export function happeningFieldLabel(field: string): string {
  return labelFrom(HAPPENING_FIELD_LABEL, field)
}

const LINK_ISSUE_TAB: Partial<Record<PlotIssue, 'involvements' | 'awareness'>> = {
  duplicateEntity: 'involvements',
  entityRequired: 'involvements',
  duplicateCharacter: 'awareness',
  characterRequired: 'awareness',
  decayRange: 'awareness',
}

/** A link-row issue names its tab: it may sit elsewhere or behind the common-knowledge notice. */
export function happeningIssueText(message: string): string {
  const text = validationText(message)
  const tab = isPlotIssue(message) ? LINK_ISSUE_TAB[message] : undefined
  return tab == null
    ? text
    : t('plot:validation.inTab', { tab: happeningFieldLabel(tab), issue: text })
}

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

// Radix Select throws on an empty-string item value, so "no icon" needs a key of its own.
const NO_ICON = '__none__'

/** The icon dropdown: none, the catalog, and the row's own key when it is not in the catalog. */
export function plotIconOptions(current: string | null): SelectOption[] {
  const keys =
    current != null && current !== '' && !PLOT_ICON_KEYS.includes(current)
      ? [current, ...PLOT_ICON_KEYS]
      : PLOT_ICON_KEYS
  return [
    { value: NO_ICON, label: t('plot:fields.iconNone') },
    ...keys.map((key) => ({ value: key, label: key })),
  ]
}

/** A draft `icon` → the dropdown's value. */
export function iconOptionValue(icon: string | null): string {
  return icon == null || icon === '' ? NO_ICON : icon
}

/** The dropdown's value → a draft `icon`. */
export function iconFromOption(value: string): string | null {
  return value === NO_ICON ? null : value
}
