import { z } from 'zod'

// chapter-close.md → Phase 1's output. Plain, so the mock's block match holds; each call refines it
// over its own turn ids.
export const chapterBoundarySchema = z.object({
  end_entry_id: z.string().describe('The turn id (t1, t2…) of the candidate the chapter ends on.'),
  rationale: z.string().describe('One sentence on why the chapter ends there.'),
})

export type ChapterBoundaryReply = z.infer<typeof chapterBoundarySchema>

/** The schema the call parses with: the same JSON Schema, refused unless it names one of `handles`. */
export function refineBoundaryReply(handles: ReadonlySet<string>): z.ZodType<ChapterBoundaryReply> {
  return chapterBoundarySchema.refine((reply) => handles.has(reply.end_entry_id), {
    path: ['end_entry_id'],
    error: `end_entry_id must be one of the listed turns: ${[...handles].join(', ')}`,
  })
}
