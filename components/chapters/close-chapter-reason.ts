import { t } from '@/lib/i18n'

/**
 * Why the popover's and the in-progress card's close is disabled: a run in flight outranks an
 * open region with no reply to end on (C10). Undefined leaves it enabled.
 */
export function closeChapterReason(
  gateReason: string | undefined,
  canClose: boolean,
): string | undefined {
  if (gateReason != null) return gateReason
  return canClose ? undefined : t('chapters:closeNoReply')
}
