import {
  describeContextWindow,
  displayEstimate,
  type CapabilityHint,
  type ContextWindowFailure,
} from '@/lib/ai'
import { t } from '@/lib/i18n'

/** The source label copy prints after a window figure. */
export function windowSourceLabel(source: 'configured' | 'detected'): string {
  return t(`common:contextWindowSource.${source}`)
}

type WindowCopy =
  | { key: 'check'; values: { estimate: number; window: number; model: string; source: string } }
  | { key: 'provider'; values: { estimate: number; message: string } }

// null: a check failure without a window, which the check never writes, has no figure to print.
export function windowCopyOf(failure: ContextWindowFailure): WindowCopy | null {
  const estimate = displayEstimate(failure.estimate)
  if (failure.detectedBy === 'provider') {
    return {
      key: 'provider',
      values: {
        estimate,
        // Every surface follows the closing quote with its own period.
        message: (failure.detail?.trim() ? failure.detail : describeContextWindow(failure)).replace(
          /\.+\s*$/,
          '',
        ),
      },
    }
  }
  if (failure.window === null) return null
  return {
    key: 'check',
    values: {
      estimate,
      window: failure.window,
      model: failure.modelId,
      source: windowSourceLabel(failure.windowSource),
    },
  }
}

/** The **Prompt too large for the model's window** entry on a turn. */
export function turnContextWindowContent(failure: ContextWindowFailure): string {
  const copy = windowCopyOf(failure)
  return copy === null
    ? t('reader:systemEntry.failureMessage')
    : t(`reader:systemEntry.failure.contextWindow.${copy.key}`, copy.values)
}

/** A **Memory update failed** entry whose pass prompt was over the window. */
export function passContextWindowContent(failure: ContextWindowFailure): string {
  const copy = windowCopyOf(failure)
  return copy === null
    ? t('reader:systemEntry.failure.memory')
    : t(`reader:systemEntry.failure.memoryContextWindow.${copy.key}`, copy.values)
}

/** A **Chapter close failed** entry whose close prompt was over the window. */
export function closeContextWindowContent(failure: ContextWindowFailure): string {
  const copy = windowCopyOf(failure)
  return copy === null
    ? t('reader:systemEntry.failure.close')
    : t(`reader:systemEntry.failure.closeContextWindow.${copy.key}`, copy.values)
}

/** The hedged hint: a turn's replaces **LLM call failed**; a pass's or a close's follows its lead. */
export function capabilityHintContent(
  hint: CapabilityHint,
  surface: 'turn' | 'pass' | 'close',
): string {
  const values = { matched: hint.matched }
  switch (surface) {
    case 'turn':
      return t(`reader:systemEntry.failure.capabilityHint.${hint.capability}`, values)
    case 'pass':
      return t(`reader:systemEntry.failure.memoryCapabilityHint.${hint.capability}`, values)
    case 'close':
      return t(`reader:systemEntry.failure.closeCapabilityHint.${hint.capability}`, values)
  }
}
