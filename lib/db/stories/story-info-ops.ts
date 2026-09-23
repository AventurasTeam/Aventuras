import { z } from 'zod'

import { HEX_COLOR } from '@/lib/hex-color'

import type { SqlOp, Story } from '../types'

/**
 * The library-shaped `stories` columns Story Settings → About edits. `draft` is
 * not a reachable status here: the wizard owns that transition.
 */
export const storyInfoPatchSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().nullable(),
    tags: z.array(z.string().trim().min(1)),
    accentColor: z.string().regex(HEX_COLOR).nullable(),
    status: z.enum(['active', 'archived']),
    favorite: z.boolean(),
  })
  .partial()
  .strict()

export type StoryInfoPatch = z.infer<typeof storyInfoPatchSchema>

/** What the About tab renders and diffs against. */
export type StoryInfo = Pick<
  Story,
  'title' | 'description' | 'tags' | 'accentColor' | 'status' | 'favorite'
>

const COLUMN: Record<keyof StoryInfoPatch, string> = {
  title: 'title',
  description: 'description',
  tags: 'tags',
  accentColor: 'accent_color',
  status: 'status',
  favorite: 'favorite',
}

function bind(key: keyof StoryInfoPatch, value: unknown): unknown {
  if (key === 'tags') return JSON.stringify(value)
  if (key === 'favorite') return value ? 1 : 0
  return value
}

/**
 * One key-scoped UPDATE, mirroring `setSettingsKeysOps`: only the keys passed
 * are written, so an unchanged column spread in can still lose a concurrent edit.
 *
 * @throws on an unknown key, an empty title, a `draft` status, or a non-hex accent.
 */
export function setStoryInfoOps(storyId: string, patch: StoryInfoPatch, nowMs: number): SqlOp[] {
  const validated = storyInfoPatchSchema.parse(patch)
  const entries = (Object.entries(validated) as [keyof StoryInfoPatch, unknown][]).filter(
    ([, value]) => value !== undefined,
  )
  if (entries.length === 0) return []
  const assignments = entries.map(([key]) => `${COLUMN[key]} = ?`).join(', ')
  return [
    {
      sql: `UPDATE stories SET ${assignments}, updated_at = ? WHERE id = ?`,
      params: [...entries.map(([key, value]) => bind(key, value)), nowMs, storyId],
    },
  ]
}
