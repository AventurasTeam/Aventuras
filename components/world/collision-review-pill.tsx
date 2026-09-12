import { Tag } from '@/components/ui/tag'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

type CollisionReviewPillProps = {
  count: number
  onPress: () => void
}

// world.md → Surfacing.
export function CollisionReviewPill({ count, onPress }: CollisionReviewPillProps) {
  const isPhone = useTier() === 'phone'
  if (count === 0) return null
  const label = t('world:collision.needReview', { count })
  return (
    <Tag tone="warning" accessibilityLabel={label} onPress={onPress}>
      {isPhone ? `⚠ ${count}` : `⚠ ${label}`}
    </Tag>
  )
}

export type { CollisionReviewPillProps }
