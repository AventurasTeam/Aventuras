import { Star } from 'lucide-react-native'

import { Icon } from '@/components/ui/icon'
import { Tag } from '@/components/ui/tag'
import { t } from '@/lib/i18n'
import type { LeadLabel } from '@/lib/world'

/** patterns/entity.md → Entity row indicators: the lead badge, wherever a character is surfaced. */
export function LeadTag({ label }: { label: LeadLabel }) {
  return (
    <Tag
      tone="accent"
      leading={<Icon as={Star} aria-hidden size="sm" className="fill-accent-fg" />}
    >
      {t(`world:lead.${label}`)}
    </Tag>
  )
}
