import { z } from 'zod'

import type { PipelineAction } from '@/lib/actions'
import { INJECTION_MODES, type Lore, type NewLore } from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'

import { blankToNull, cleanList, sameList } from './draft-text'
import { prioritySchema } from './entity-draft'
import { WORLD_ISSUE } from './issues'

// world.md → Required body: the Body tab and create mode share this rule.
export const loreDraftSchema = z.object({
  title: z.string().trim().min(1, WORLD_ISSUE.titleRequired),
  body: z.string().trim().min(1, WORLD_ISSUE.bodyRequired),
  category: z.string(),
  injectionMode: z.enum(INJECTION_MODES),
  priority: prioritySchema,
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
})
export type LoreDraft = z.infer<typeof loreDraftSchema>

export const EMPTY_LORE_DRAFT: Readonly<LoreDraft> = Object.freeze({
  title: '',
  body: '',
  category: '',
  injectionMode: 'auto',
  priority: 0,
  keywords: [],
  tags: [],
})

export function loreDraftFrom(row: Lore | null): LoreDraft {
  // New lists: the freeze is shallow, so a spread alone would share the constant's arrays.
  if (row == null) return { ...EMPTY_LORE_DRAFT, keywords: [], tags: [] }
  return {
    title: row.title,
    body: row.body ?? '',
    category: row.category ?? '',
    injectionMode: row.injectionMode,
    priority: row.priority,
    keywords: [...row.keywords],
    tags: [...row.tags],
  }
}

type LorePatch = Partial<
  Pick<Lore, 'title' | 'body' | 'category' | 'injectionMode' | 'priority' | 'keywords' | 'tags'>
>

/** Columns whose committed value differs from the draft, compared normalized to normalized. */
function lorePatch(row: Lore, draft: LoreDraft): LorePatch {
  const patch: LorePatch = {}
  const title = draft.title.trim()
  if (title !== row.title.trim()) patch.title = title
  const body = draft.body.trim()
  if (body !== (row.body ?? '').trim()) patch.body = body
  const category = blankToNull(draft.category)
  if (category !== blankToNull(row.category ?? '')) patch.category = category
  if (draft.injectionMode !== row.injectionMode) patch.injectionMode = draft.injectionMode
  if (draft.priority !== row.priority) patch.priority = draft.priority
  // Deduped under normalizeTerm: padding and repeats aren't edits, but a re-cased term is.
  const keywords = dedupeTerms(draft.keywords)
  if (!sameList(keywords, dedupeTerms(row.keywords))) patch.keywords = keywords
  const tags = cleanList(draft.tags)
  if (!sameList(tags, cleanList(row.tags))) patch.tags = tags
  return patch
}

type LoreActionArgs = {
  branchId: string
  /** Null in create mode. */
  row: Lore | null
  draft: LoreDraft
  /** The row id — pre-generated in create mode. */
  id: string
  now: number
}

/** One create, one update, or nothing — always `user_edit`. */
export function loreActions({ branchId, row, draft, id, now }: LoreActionArgs): PipelineAction[] {
  if (row == null) {
    const entry: NewLore = {
      id,
      branchId,
      title: draft.title.trim(),
      body: draft.body.trim(),
      category: blankToNull(draft.category),
      injectionMode: draft.injectionMode,
      priority: draft.priority,
      keywords: dedupeTerms(draft.keywords),
      tags: cleanList(draft.tags),
      embeddingStale: 1,
      createdAt: now,
      updatedAt: now,
    }
    return [{ kind: 'createLore', source: 'user_edit', payload: { entry } }]
  }
  const patch = lorePatch(row, draft)
  if (Object.keys(patch).length === 0) return []
  return [{ kind: 'updateLore', source: 'user_edit', payload: { branchId, id: row.id, patch } }]
}
