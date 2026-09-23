import { EmptyState } from '@/components/ui/empty-state'
import { t } from '@/lib/i18n'

/** The History tab's body until the delta-log view for a row exists. */
export function PlotHistoryPlaceholder() {
  return (
    <EmptyState
      title={t('plot:detail.historyPlaceholder')}
      subtext={t('plot:detail.historyPlaceholderBody')}
    />
  )
}
