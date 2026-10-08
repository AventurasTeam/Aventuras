import { View } from 'react-native'

import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { ChipRow, InjectionModeChip } from '@/components/world/overview/overview-parts'
import type { Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import { chipPreview } from '@/lib/world'

/** reader-composer.md → State-field composition — lore peek: no priority, nothing editable. */
export function LorePeekBody({ lore }: { lore: Lore }) {
  const category = lore.category?.trim()
  const hasChips = lore.injectionMode !== 'auto' || !!category
  const tags = chipPreview(lore.tags, lore.tags.length)
  return (
    <View testID="lore-peek-body" className="gap-3">
      {hasChips ? (
        <View testID="lore-peek-chips" className="flex-row flex-wrap items-center gap-1.5">
          <InjectionModeChip mode={lore.injectionMode} />
          {category ? <Tag tone="soft">{category}</Tag> : null}
        </View>
      ) : null}
      <Text size="sm" numberOfLines={10} testID="lore-peek-text">
        {lore.body}
      </Text>
      {tags.shown.length > 0 ? (
        <View className="gap-1">
          <Text size="xs" variant="muted" className="font-medium uppercase tracking-wide">
            {t('reader:peek.tags')}
          </Text>
          <ChipRow preview={tags} />
        </View>
      ) : null}
    </View>
  )
}
