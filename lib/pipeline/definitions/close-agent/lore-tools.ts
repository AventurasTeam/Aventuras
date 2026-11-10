import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { lore, type Lore, type NewLore } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { dedupeTerms, newTerms, normalizeTerm } from '@/lib/keyword-terms'

import { fieldVerdicts } from './entity-write'
import { restatedText, sentText, TEXT_BOUNDS, type SentText } from './fields'
import type { CloseIds } from './ids'
import { handleInTerm, turnHandleIn, turnInTextReason } from './text-checks'
import {
  sameValue,
  writeToolSchema,
  type LostField,
  type PlannedAction,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'

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

export const UPDATE_LORE_SHAPE = {
  id: z
    .string()
    .describe('The lore row, by its id as shown (lo1, lo2…). Read it with read_row first.'),
  title: z
    .string()
    .optional()
    .describe("The row's title, rewritten whole. Leave it out to keep it."),
  body: z
    .string()
    .optional()
    .describe(
      "The row's body, rewritten whole with what the chapter adds or corrects. Leave it out to keep it.",
    ),
  category: z
    .string()
    .optional()
    .describe("The row's category, rewritten whole. Leave it out to keep it."),
  keywords: z
    .strictObject({
      add: z
        .array(z.string())
        .optional()
        .describe('Terms the prose uses for the row that its keywords lack.'),
      remove: z
        .array(z.string())
        .optional()
        .describe('Terms an AI added that no longer fit; never one the user added.'),
    })
    .optional()
    .describe('Keywords to add or remove; the others stay as they are.'),
}

type UpdateArgs = z.output<WriteToolSchema<typeof UPDATE_LORE_SHAPE>>
type LoreText = 'title' | 'body' | 'category'
type SentLoreText = { field: LoreText; text: SentText }
type SentKeywords = { add: readonly string[]; remove: readonly string[] }

const LORE_TEXT: readonly LoreText[] = ['title', 'body', 'category']

const NOTHING_SENT =
  'nothing to write: send a title, a body, a category or keywords to add or remove'

const bodyGrowthReason = (length: number, stored: number): string =>
  `body is ${length} characters: a body over ${LORE_BODY_LIMIT} may grow the stored one (${stored}) by at most ${LORE_BODY_LIMIT}, so send a shorter one`

const keywordInBothReason = (term: string): string =>
  `"${term}" is in both add and remove: send each term in one list`

// Never cut: a body over the bound is refused, so a user's long body is never shortened.
function sentBody(value: string | undefined): SentText | undefined {
  if (value === undefined || value.trim() === '') return undefined
  return { sent: value, bounded: value.trim() }
}

function sentLoreText(args: UpdateArgs, field: LoreText): SentText | undefined {
  return field === 'body' ? sentBody(args.body) : sentText(args[field], 'title')
}

function sentKeywords(value: UpdateArgs['keywords']): SentKeywords | undefined {
  const add = dedupeTerms(value?.add ?? [])
  const remove = dedupeTerms(value?.remove ?? [])
  return add.length === 0 && remove.length === 0 ? undefined : { add, remove }
}

/** The list as setLoreKeywords would leave it: the stored terms less the removals, then the adds. */
function plannedKeywords(stored: readonly string[], { add, remove }: SentKeywords): string[] {
  const removing = new Set(remove.map(normalizeTerm))
  return [...stored.filter((term) => !removing.has(normalizeTerm(term))), ...newTerms(stored, add)]
}

function keywordsRefusal({ add, remove }: SentKeywords, ids: CloseIds): string | undefined {
  const removing = new Set(remove.map(normalizeTerm))
  const both = add.find((term) => removing.has(normalizeTerm(term)))
  if (both !== undefined) return keywordInBothReason(both)
  const held = firstTermHandle([...add, ...remove], ids)
  return held === undefined ? undefined : termHandleReason(held.term, held.handle)
}

function textRefusal(
  field: LoreText,
  text: string,
  stored: Lore,
  ids: CloseIds,
): string | undefined {
  const handle = turnHandleIn(text, ids)
  if (handle !== undefined) return turnInTextReason(handle)
  if (field !== 'body') return undefined
  const storedLength = (stored.body ?? '').length
  // Over the stored length plus the bound is over the bound too, so this one test holds both.
  return text.length > storedLength + LORE_BODY_LIMIT
    ? bodyGrowthReason(text.length, storedLength)
    : undefined
}

const proposedText = (sent: readonly SentLoreText[]): Record<string, unknown> =>
  Object.fromEntries(sent.map(({ field, text }) => [field, text.bounded]))

async function readLoreRow(ctx: WriteContext, id: string): Promise<Lore | undefined> {
  const [row] = await ctx.db
    .select()
    .from(lore)
    .where(and(eq(lore.branchId, ctx.branchId), eq(lore.id, id)))
    .limit(1)
  return row
}

/** chapter-close.md → 3a "Existing rows too": one row's text and keywords, past precedence. */
async function planUpdateLore(args: UpdateArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id } = args
  const sent = LORE_TEXT.flatMap((field): SentLoreText[] => {
    const text = sentLoreText(args, field)
    return text === undefined ? [] : [{ field, text }]
  })
  const keywords = sentKeywords(args.keywords)
  const row = await readLoreRow(ctx, id)
  const rows: ReportRow[] = [{ table: 'lore', id, name: row?.title ?? ctx.ids.nameOfId(id) ?? '' }]
  if (row === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposedText(sent) }
  if (sent.length === 0 && keywords === undefined)
    return { kind: 'refused', reason: NOTHING_SENT, rows }

  // Restated before the guard, so a restated protected field reads ok, not skipped (C11).
  const changed = sent.filter(({ field, text }) => !restatedText(row[field], text))
  const planned = keywords === undefined ? undefined : plannedKeywords(row.keywords, keywords)
  const keywordRefusal = keywords === undefined ? undefined : keywordsRefusal(keywords, ctx.ids)
  const keywordsSent =
    planned !== undefined && (keywordRefusal !== undefined || !sameValue(planned, row.keywords))
  const values: Record<string, unknown> = {
    ...proposedText(changed),
    ...(keywordsSent ? { keywords: planned } : {}),
  }
  if (changed.length === 0 && !keywordsSent)
    return { kind: 'write', actions: [], lost: [], rows, values: {} }

  const verdicts = (await ctx.guard([{ table: 'lore', id }])).row('lore', id)
  const lost: LostField[] = []
  const wanted: Partial<Record<LoreText, string>> = {}
  const textVerdicts = fieldVerdicts(
    verdicts,
    changed.map(({ field }) => field),
  )
  for (const [index, { field, text }] of changed.entries()) {
    const verdict = textVerdicts[index]!
    if (!verdict.free) {
      lost.push({ field, row: id, kind: 'protected', reason: verdict.reason })
      continue
    }
    const refusal = textRefusal(field, text.bounded, row, ctx.ids)
    if (refusal !== undefined) lost.push({ field, row: id, kind: 'refused', reason: refusal })
    else wanted[field] = text.bounded
  }

  const actions: PlannedAction[] = []
  if (Object.keys(wanted).length > 0)
    actions.push({
      action: {
        kind: 'updateLore',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id, patch: wanted, proseEntryId: ctx.proseEntryId },
      },
      fields: Object.keys(wanted),
      row: id,
    })
  if (keywordsSent && keywords !== undefined) {
    // The handler judges each term against the user's edits; only a later turn's list skips whole.
    if (verdicts.laterTurnWrote('keywords'))
      lost.push({ field: 'keywords', row: id, kind: 'protected', reason: CLOSE_REASON.laterTurn })
    else if (keywordRefusal !== undefined)
      lost.push({ field: 'keywords', row: id, kind: 'refused', reason: keywordRefusal })
    else
      actions.push({
        action: {
          kind: 'setLoreKeywords',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id,
            add: [...keywords.add],
            remove: [...keywords.remove],
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: ['keywords'],
        row: id,
      })
  }
  return { kind: 'write', actions, lost, rows, values }
}

/** chapter-close.md → 3a: an existing row extended or corrected, its keywords by setLoreKeywords. */
export const updateLoreTool: WriteTool<typeof UPDATE_LORE_SHAPE> = {
  kind: 'write',
  name: 'update_lore',
  description: `Extend or correct a lore row from this chapter's turns, the user's rows included: its title, body or category rewritten whole, and keywords added or removed. Read the row with read_row first, and send only what changes. A body over ${LORE_BODY_LIMIT} characters lands only by growing the stored body by at most ${LORE_BODY_LIMIT}. Never remove a keyword the user added.`,
  schema: writeToolSchema(UPDATE_LORE_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['lore_'] } },
  plan: planUpdateLore,
}
