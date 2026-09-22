import { z } from 'zod'

import type { PipelineAction } from '@/lib/actions'
import { INJECTION_MODES, THREAD_STATUSES, type NewThread, type Thread } from '@/lib/db'

// Issue messages are `plot:validation.*` keys; the pane translates them.
export const threadDraftSchema = z.object({
  title: z.string().trim().min(1, 'titleRequired'),
  description: z.string(),
  category: z.string(),
  icon: z.string().nullable(),
  status: z.enum(THREAD_STATUSES),
  injectionMode: z.enum(INJECTION_MODES),
})
export type ThreadDraft = z.infer<typeof threadDraftSchema>

export const EMPTY_THREAD_DRAFT: ThreadDraft = {
  title: '',
  description: '',
  category: '',
  icon: null,
  status: 'pending',
  injectionMode: 'auto',
}

export function threadDraftFrom(row: Thread | null): ThreadDraft {
  if (row == null) return EMPTY_THREAD_DRAFT
  return {
    title: row.title,
    description: row.description ?? '',
    category: row.category ?? '',
    icon: row.icon,
    status: row.status,
    injectionMode: row.injectionMode,
  }
}

/** Free text is stored as `NULL` when blank, never `''`. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

type ThreadPatch = Partial<
  Pick<Thread, 'title' | 'description' | 'category' | 'icon' | 'status' | 'injectionMode'>
>

/**
 * The columns whose committed value differs from the draft; empty when nothing changed.
 * Compares normalized-to-normalized — a committed row can carry untrimmed free text
 * (classifier writes verbatim) that would otherwise diff against a merely-loaded draft.
 */
export function threadPatch(row: Thread, draft: ThreadDraft): ThreadPatch {
  const patch: ThreadPatch = {}
  const title = draft.title.trim()
  if (title !== row.title.trim()) patch.title = title
  const description = blankToNull(draft.description)
  if (description !== blankToNull(row.description ?? '')) patch.description = description
  const category = blankToNull(draft.category)
  if (category !== blankToNull(row.category ?? '')) patch.category = category
  if (draft.icon !== row.icon) patch.icon = draft.icon
  if (draft.status !== row.status) patch.status = draft.status
  if (draft.injectionMode !== row.injectionMode) patch.injectionMode = draft.injectionMode
  return patch
}

type ThreadActionArgs = {
  branchId: string
  /** Null in create mode. */
  row: Thread | null
  draft: ThreadDraft
  /** The row id — pre-generated in create mode. */
  id: string
  now: number
}

/** One create, one update, or nothing — always `user_edit`. */
export function threadActions({
  branchId,
  row,
  draft,
  id,
  now,
}: ThreadActionArgs): PipelineAction[] {
  if (row == null) {
    const entry: NewThread = {
      id,
      branchId,
      title: draft.title.trim(),
      description: blankToNull(draft.description),
      category: blankToNull(draft.category),
      icon: draft.icon,
      status: draft.status,
      injectionMode: draft.injectionMode,
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
      embeddingStale: 1,
      createdAt: now,
      updatedAt: now,
    }
    return [{ kind: 'createThread', source: 'user_edit', payload: { entry } }]
  }
  const patch = threadPatch(row, draft)
  if (Object.keys(patch).length === 0) return []
  return [{ kind: 'updateThread', source: 'user_edit', payload: { branchId, id: row.id, patch } }]
}
