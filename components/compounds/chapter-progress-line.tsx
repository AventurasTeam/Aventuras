import type { ReactElement } from 'react'

import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/**
 * A chapter's progress counts, with `Ready to close` after them once it can close. One paragraph:
 * a text-width label beside it would drop its last word on Android.
 */
export function ChapterProgressLine({
  counts,
  ready,
}: {
  counts: string
  ready: boolean
}): ReactElement {
  return (
    <Text size="xs" variant="muted">
      {counts}
      {ready ? (
        <>
          {' · '}
          <Text size="xs" variant="default" className="font-medium">
            {t('chapters:readyToClose')}
          </Text>
        </>
      ) : null}
    </Text>
  )
}
