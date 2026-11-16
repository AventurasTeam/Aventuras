import type { ChapterDeletePreview } from '@/lib/actions'
import { t } from '@/lib/i18n'

/**
 * What reversing a close's work takes, as the chapter delete confirm lists it
 * (chapter-timeline.md → Delete a chapter); the reader's undo of a close reads the same lines. A
 * count at zero is left out: a close can land with no agent writes.
 */
export function chapterImpactLines({
  createdLore,
  otherChanges,
}: Pick<ChapterDeletePreview, 'createdLore' | 'otherChanges'>): string[] {
  const lines: string[] = []
  if (createdLore.count > 0)
    lines.push(
      createdLore.userEdited
        ? t('chapters:deleteConfirm.loreEdited', { count: createdLore.count })
        : t('chapters:deleteConfirm.lore', { count: createdLore.count }),
    )
  if (otherChanges > 0)
    lines.push(t('chapters:deleteConfirm.otherChanges', { count: otherChanges }))
  return lines
}
