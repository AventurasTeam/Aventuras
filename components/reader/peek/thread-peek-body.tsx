import { View } from 'react-native'

import { THREAD_STATUS_TONE } from '@/components/plot/thread-row'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { InjectionModeChip } from '@/components/world/overview/overview-parts'
import type { Thread } from '@/lib/db'
import { t } from '@/lib/i18n'

/** reader-composer.md → State-field composition — thread and happening peek: read-only. */
export function ThreadPeekBody({ thread }: { thread: Thread }) {
  const category = thread.category?.trim()
  const description = thread.description?.trim()
  return (
    <View testID="thread-peek-body" className="gap-3">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Tag tone={THREAD_STATUS_TONE[thread.status]}>{t(`plot:status.${thread.status}`)}</Tag>
        <InjectionModeChip mode={thread.injectionMode} help="thread" />
        {category ? <Tag tone="soft">{category}</Tag> : null}
      </View>
      {description ? <Text size="sm">{description}</Text> : null}
    </View>
  )
}
