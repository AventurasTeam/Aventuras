import type { Story as StoryRow } from '@/lib/db'

import { formatRelativeTime } from './relative-time'

export type StoryCardVM = {
  id: string
  title: string
  description: string | null
  genreLabel: string | null
  mode: 'adventure' | 'creative'
  accentColor: string | null
  favorited: boolean
  archived: boolean
  isDraft: boolean
  chapterLabel: string | null
  lastOpenedRelative: string
}

// Drafts carry a partial/null `definition` that fails strict storyDefinitionSchema;
// the card only needs mode + genre.label, read defensively. Strict parse is 2.7's open path.
type LooseDefinition = { mode?: 'adventure' | 'creative'; genre?: { label?: string | null } | null }

export function toStoryCardVM(row: StoryRow, nowSec: number): StoryCardVM {
  const def = (row.definition ?? null) as LooseDefinition | null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genreLabel: def?.genre?.label ?? null,
    mode: def?.mode ?? 'creative',
    accentColor: row.accentColor,
    favorited: row.favorite === 1,
    archived: row.status === 'archived',
    isDraft: row.status === 'draft',
    chapterLabel: null,
    lastOpenedRelative: formatRelativeTime(row.lastOpenedAt, nowSec),
  }
}
