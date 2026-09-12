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
  return (
    <Tag tone="warning" onPress={onPress}>
      {isPhone ? `⚠ ${count}` : `⚠ ${t('world:collision.needReview', { count })}`}
    </Tag>
  )
}

export type { CollisionReviewPillProps }
