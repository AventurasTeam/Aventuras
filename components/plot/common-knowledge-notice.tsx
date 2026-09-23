import { EmptyState } from '@/components/ui/empty-state'
import { t } from '@/lib/i18n'

/** plot.md → Common-knowledge interaction: replaces the Awareness body, no add affordance. */
export function CommonKnowledgeNotice() {
  return <EmptyState title={t('plot:awareness.ckTitle')} subtext={t('plot:awareness.ckBody')} />
}
