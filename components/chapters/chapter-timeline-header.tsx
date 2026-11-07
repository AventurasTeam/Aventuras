import type { ReactElement } from 'react'

import { Text } from '@/components/ui/text'

import { timelineHeader } from './chapter-copy'

/** `Chapters · <N> closed + 1 in progress`: the open region always counts as one more. */
export function ChapterTimelineHeader({ closedCount }: { closedCount: number }): ReactElement {
  return (
    <Text size="sm" variant="muted" className="px-1">
      {timelineHeader(closedCount)}
    </Text>
  )
}
