import {
  describeContextWindow,
  displayEstimate,
  type CapabilityHint,
  type ContextWindowFailure,
} from '@/lib/ai'
import { t } from '@/lib/i18n'

/** The source label copy prints after a window figure. */
export function windowSourceLabel(source: ContextWindowFailure['windowSource']): string {
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
        message: failure.detail?.trim() ? failure.detail : describeContextWindow(failure),
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

/** The hedged hint that replaces **LLM call failed** or **Memory update failed**. */
export function capabilityHintContent(hint: CapabilityHint, surface: 'turn' | 'pass'): string {
  return surface === 'turn'
    ? t(`reader:systemEntry.failure.capabilityHint.${hint.capability}`, { matched: hint.matched })
    : t(`reader:systemEntry.failure.memoryCapabilityHint.${hint.capability}`, {
        matched: hint.matched,
      })
}
