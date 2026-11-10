import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { lore, type NewLore } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'

import { TEXT_BOUNDS } from './fields'
import type { CloseIds } from './ids'
import { handleInTerm, turnHandleIn, turnInTextReason } from './text-checks'
import {
  writeToolSchema,
  type LostField,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'

/** chapter-close.md → 3a: the creates a close lands, across its parts; no setting for it yet (M7.1). */
export const LORE_CREATE_CAP = 3
/** The embedder's whole-text bound (clampEmbeddedText's body). A close's body is refused, never cut. */
export const LORE_BODY_LIMIT = 1_200

/** C4's stable reasons for a create refused whole; each answer's note says what to do. */
export const LORE_REFUSAL = {
  titleBlank: 'title-blank',
  bodyBlank: 'body-blank',
  cap: 'lore-cap',
  titleTaken: 'title-taken',
} as const

const CREATE_LORE = 'create_lore'

const NOTE = {
  titleBlank: 'Give the row a title: the name the story uses for the rule or thing.',
  bodyBlank:
    'Give the row a body: how the thing works or what it is, as the cited turns establish it.',
  cap: `This close has created ${LORE_CREATE_CAP} lore rows, its limit: extend or correct an existing row with update_lore instead.`,
} as const

// The full id, which the model's answer swaps for the handle the plan just showed.
const titleTakenNote = (id: string): string =>
  `${id} already holds this title: read it with read_row, then extend or correct it with update_lore instead of creating a second row.`

const bodyOverLimitReason = (length: number): string =>
  `body is ${length} characters, over the limit of ${LORE_BODY_LIMIT}: state the rule in fewer words`

/** A keyword holding a handle, which names nothing past this close. */
const termHandleReason = (term: string, handle: string): string =>
  `the keyword "${term}" holds ${handle}, an id: a keyword is a word the prose uses, never an id`

function firstTermHandle(
  terms: readonly string[],
  ids: CloseIds,
): { term: string; handle: string } | undefined {
  for (const term of terms) {
    const handle = handleInTerm(term, ids)
    if (handle !== undefined) return { term, handle }
  }
  return undefined
}

/** A lore row on the branch whose title is `title`, trimmed and case-folded. */
async function loreTitled(
  ctx: WriteContext,
  title: string,
): Promise<{ id: string; title: string } | undefined> {
  const key = normalizeTerm(title)
  const rows = await ctx.db
    .select({ id: lore.id, title: lore.title })
    .from(lore)
    .where(eq(lore.branchId, ctx.branchId))
    .orderBy(asc(lore.id))
  return rows.find((row) => normalizeTerm(row.title) === key)
}

export const CREATE_LORE_SHAPE = {
  title: z.string().describe('The name the story uses for the rule or thing.'),
  body: z
    .string()
    .describe(
      `How it works or what it is, as the cited turns establish it: at most ${LORE_BODY_LIMIT} characters.`,
    ),
  category: z
    .string()
    .optional()
    .describe('A freeform kind, such as magic-system, religion or faction-charter.'),
  keywords: z
    .array(z.string())
    .optional()
    .describe('The names and words the prose uses for it, which bring the row into later prompts.'),
}

type CreateArgs = z.output<WriteToolSchema<typeof CREATE_LORE_SHAPE>>

/** chapter-close.md → 3a: a new row the chapter establishes, as it would be stored, or refused. */
async function planCreateLore(args: CreateArgs, ctx: WriteContext): Promise<WritePlan> {
  // Minted first: a refused create keeps an id in the review (C4).
  const id = generateId('lore')
  const title = TEXT_BOUNDS.title(args.title)
  const body = args.body.trim()
  const category = args.category === undefined ? null : TEXT_BOUNDS.title(args.category) || null
  const keywords = dedupeTerms(args.keywords ?? [])
  const rows: ReportRow[] = [{ table: 'lore', id, name: title }]
  const values: Record<string, unknown> = {
    title,
    body,
    ...(category === null ? {} : { category }),
    ...(keywords.length === 0 ? {} : { keywords }),
  }
  const refused = (reason: string, note?: string): WritePlan => ({
    kind: 'refused',
    reason,
    rows,
    values,
    ...(note === undefined ? {} : { note }),
  })

  if (title === '') return refused(LORE_REFUSAL.titleBlank, NOTE.titleBlank)
  if (body === '') return refused(LORE_REFUSAL.bodyBlank, NOTE.bodyBlank)
  if (ctx.landedCalls(CREATE_LORE) >= LORE_CREATE_CAP) return refused(LORE_REFUSAL.cap, NOTE.cap)
  const holder = await loreTitled(ctx, title)
  if (holder !== undefined) {
    ctx.ids.show(holder.id, holder.title)
    return refused(LORE_REFUSAL.titleTaken, titleTakenNote(holder.id))
  }
  if (body.length > LORE_BODY_LIMIT) return refused(bodyOverLimitReason(body.length))
  const handle = turnHandleIn(title, ctx.ids) ?? turnHandleIn(body, ctx.ids)
  if (handle !== undefined) return refused(turnInTextReason(handle))

  const lost: LostField[] = []
  const categoryHandle = category === null ? undefined : turnHandleIn(category, ctx.ids)
  if (categoryHandle !== undefined)
    lost.push({
      field: 'category',
      row: 'lore',
      kind: 'refused',
      reason: turnInTextReason(categoryHandle),
    })
  const termHandle = firstTermHandle(keywords, ctx.ids)
  if (termHandle !== undefined)
    lost.push({
      field: 'keywords',
      row: 'lore',
      kind: 'refused',
      reason: termHandleReason(termHandle.term, termHandle.handle),
    })
  const landingCategory = categoryHandle === undefined ? category : null
  const landingKeywords = termHandle === undefined ? keywords : []
  const now = Date.now()
  const entry: NewLore = {
    id,
    branchId: ctx.branchId,
    title,
    body,
    category: landingCategory,
    keywords: landingKeywords,
    priority: 0,
    injectionMode: 'auto',
    tags: [],
    embeddingStale: 1,
    createdAt: now,
    updatedAt: now,
  }
  return {
    kind: 'write',
    actions: [
      {
        action: { kind: 'createLore', source: 'chapter_close', payload: { entry } },
        fields: [
          'title',
          'body',
          ...(landingCategory === null ? [] : ['category']),
          ...(landingKeywords.length === 0 ? [] : ['keywords']),
        ],
        row: 'lore',
      },
    ],
    lost,
    rows,
    values,
    createdId: id,
  }
}

/** chapter-close.md → 3a: a lore row the chapter establishes, cited, under the cap, with a body. */
export const createLoreTool: WriteTool<typeof CREATE_LORE_SHAPE> = {
  kind: 'write',
  name: CREATE_LORE,
  description: `Create a lore row for what the chapter's turns establish: a world-rule, magic system, religion, faction charter, cosmology or term whose working or meaning the prose explains, not one it merely mentions. At most ${LORE_CREATE_CAP} per chapter, so when a row already holds the rule, extend or correct it with update_lore instead. Always a body, of at most ${LORE_BODY_LIMIT} characters. Keywords are the names and words the prose uses for it.`,
  schema: writeToolSchema(CREATE_LORE_SHAPE),
  ids: {},
  plan: planCreateLore,
}
