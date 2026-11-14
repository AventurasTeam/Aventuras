import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import {
  USER_EDITED_SINCE_PROSE,
  type GuardRow,
  type PipelineAction,
  type RowGuard,
} from '@/lib/actions/types'
import {
  chunked,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  storyEntries,
  type Happening,
} from '@/lib/db'
import { generateId } from '@/lib/ids'

import { restatedText, sentText } from './fields'
import {
  AWARENESS_FIELDS,
  changedAwarenessFields,
  earlierAnchor,
  foldMergeLinks,
  type AwarenessField,
  type LinkRows,
  type MergeFold,
  type PositionOf,
} from './happening-fold'
import { keyedReason } from './reason-key'
import { turnHandleIn, turnInTextReason } from './text-checks'
import {
  DELETE_PATH,
  protectedField,
  writeToolSchema,
  type LostField,
  type PlannedAction,
  type ProtectionReason,
  type ReportRow,
  type ToolContext,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'
import { userDeletedHappeningLink } from '../../runtime/action-port'

export const MERGE_HAPPENINGS_SHAPE = {
  keep: z.string().describe('The happening to keep, by its id as shown (hp1, hp2…).'),
  absorb: z
    .array(z.string())
    .describe(
      "The happenings of keep's cluster that record the same event, by id: each is folded into keep and deleted.",
    ),
  title: z
    .string()
    .optional()
    .describe(
      "keep's title, rewritten whole to cover the merged happenings. Leave it out to keep its title.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      'keep\'s description, rewritten whole as a composite of what the merged happenings each said ("X happened, then Y"). Leave it out to keep its description, as when an absorbed happening only repeats keep.',
    ),
}

type MergeArgs = z.output<WriteToolSchema<typeof MERGE_HAPPENINGS_SHAPE>>
type HappeningText = Partial<Pick<MergeArgs, 'title' | 'description'>>
type HappeningPatch = Extract<PipelineAction, { kind: 'updateHappening' }>['payload']['patch']
type AwarenessPayload = Extract<PipelineAction, { kind: 'upsertHappeningAwareness' }>['payload']
type FoldedAwareness = MergeFold['awareness'][number]

const NO_LINKS: LinkRows = { involvements: [], awareness: [] }

export const MERGE_REFUSAL = {
  emptyAbsorb: keyedReason(
    'merge-absorb-empty',
    'absorb is empty: name the happenings to fold into keep',
  ),
  keepAbsorbed: keyedReason(
    'merge-keep-absorbed',
    'keep is also in absorb: keep one happening and absorb the others',
  ),
  repeated: keyedReason(
    'merge-repeated',
    'absorb names a happening twice: name each happening once',
  ),
  outsideCluster: keyedReason(
    'merge-outside-cluster',
    "absorb names a happening outside keep's cluster: merge only happenings listed in one cluster",
  ),
  closeWrote: keyedReason(
    'merge-close-wrote',
    'this close already wrote a happening in absorb, and absorbing it would block undoing the close: keep that happening instead',
  ),
  closeWroteNoKeep: keyedReason(
    'merge-close-wrote-no-keep',
    'this close already wrote more than one of these happenings, so they cannot be merged in this close: leave them apart',
  ),
} as const

// 3e: candidates come only from one cluster the range embed found, so a merge never reaches across.
function mergeShapeFault(
  keep: string,
  absorb: readonly string[],
  cluster: readonly string[] | undefined,
): string | undefined {
  if (absorb.length === 0) return MERGE_REFUSAL.emptyAbsorb
  if (absorb.includes(keep)) return MERGE_REFUSAL.keepAbsorbed
  if (new Set(absorb).size !== absorb.length) return MERGE_REFUSAL.repeated
  if (absorb.some((id) => cluster?.includes(id) !== true)) return MERGE_REFUSAL.outsideCluster
  return undefined
}

/** The branch's happenings among `ids`, by id; an id with no row is absent. */
export async function readHappenings(
  ctx: Pick<ToolContext, 'db' | 'branchId'>,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Happening>> {
  const rows = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, ctx.branchId), inArray(happenings.id, [...new Set(ids)])))
  return new Map(rows.map((row) => [row.id, row]))
}

// A gone row keeps the name the model was shown it by.
function happeningRows(
  ctx: WriteContext,
  ids: readonly string[],
  stored: ReadonlyMap<string, Happening>,
): ReportRow[] {
  return [...new Set(ids)].map((id) => ({
    table: 'happenings',
    id,
    name: stored.get(id)?.title ?? ctx.ids.nameOfId(id) ?? '',
  }))
}

/** Each merge row's involvements and awareness, ordered by id, so the fold's first role is stable. */
async function readLinks(
  ctx: WriteContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, LinkRows>> {
  const wanted = [...new Set(ids)]
  const involvements = await ctx.db
    .select({
      id: happeningInvolvements.id,
      happeningId: happeningInvolvements.happeningId,
      entityId: happeningInvolvements.entityId,
      role: happeningInvolvements.role,
    })
    .from(happeningInvolvements)
    .where(
      and(
        eq(happeningInvolvements.branchId, ctx.branchId),
        inArray(happeningInvolvements.happeningId, wanted),
      ),
    )
    .orderBy(asc(happeningInvolvements.id))
  const awareness = await ctx.db
    .select({
      id: happeningAwareness.id,
      happeningId: happeningAwareness.happeningId,
      characterId: happeningAwareness.characterId,
      learnedAtEntryId: happeningAwareness.learnedAtEntryId,
      decayResistance: happeningAwareness.decayResistance,
      retrievalCount: happeningAwareness.retrievalCount,
      source: happeningAwareness.source,
    })
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.branchId, ctx.branchId),
        inArray(happeningAwareness.happeningId, wanted),
      ),
    )
    .orderBy(asc(happeningAwareness.id))
  return new Map(
    wanted.map((happeningId): [string, LinkRows] => [
      happeningId,
      {
        involvements: involvements
          .filter((row) => row.happeningId === happeningId)
          .map(({ id, entityId, role }) => ({ id, entityId, role })),
        awareness: awareness
          .filter((row) => row.happeningId === happeningId)
          .map(
            ({ id, characterId, learnedAtEntryId, decayResistance, retrievalCount, source }) => ({
              id,
              characterId,
              learnedAtEntryId,
              decayResistance,
              retrievalCount,
              source,
            }),
          ),
      },
    ]),
  )
}

// generation-pipeline.md → Reverse-replay: redo refuses an update plus a delete of one row under one
// action, so a row this close wrote, itself or via a link, can be kept but never absorbed.
async function closeWroteHappenings(
  ctx: WriteContext,
  links: ReadonlyMap<string, LinkRows>,
): Promise<ReadonlySet<string>> {
  const ownerOf = new Map<string, string>()
  for (const [happeningId, rows] of links) {
    ownerOf.set(`happenings:${happeningId}`, happeningId)
    for (const { id } of rows.involvements) ownerOf.set(`happening_involvements:${id}`, happeningId)
    for (const { id } of rows.awareness) ownerOf.set(`happening_awareness:${id}`, happeningId)
  }
  const targetIds = [...ownerOf.keys()].map((key) => key.slice(key.indexOf(':') + 1))
  const written = new Set<string>()
  for (const ids of chunked(targetIds)) {
    const hits = await ctx.db
      .selectDistinct({ table: deltas.targetTable, id: deltas.targetId })
      .from(deltas)
      .where(
        and(
          eq(deltas.branchId, ctx.branchId),
          eq(deltas.actionId, ctx.actionId),
          inArray(deltas.targetTable, [
            'happenings',
            'happening_involvements',
            'happening_awareness',
          ]),
          inArray(deltas.targetId, ids),
        ),
      )
    for (const { table, id } of hits) {
      const owner = ownerOf.get(`${table}:${id}`)
      if (owner !== undefined) written.add(owner)
    }
  }
  return written
}

async function entryPositions(
  ctx: WriteContext,
  entryIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const positions = new Map<string, number>()
  for (const ids of chunked([...new Set(entryIds)])) {
    const rows = await ctx.db
      .select({ id: storyEntries.id, position: storyEntries.position })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, ctx.branchId), inArray(storyEntries.id, ids)))
    for (const { id, position } of rows) positions.set(id, position)
  }
  return positions
}

// 3e on keep's own row: the text sent, the earliest anchor, and common knowledge if any merged row
// has it, each only where it differs. A keep with no anchor keeps its time: every clustered row
// has one, and sending one beside a temporal would break happenings_mutual_excl.
function keepPatch(
  kept: Happening,
  absorbed: readonly Happening[],
  text: HappeningText,
  positionOf: PositionOf,
): HappeningPatch {
  const anchor =
    kept.occurredAtEntryId === null
      ? null
      : absorbed.reduce<string | null>(
          (earliest, row) => earlierAnchor(earliest, row.occurredAtEntryId, positionOf),
          kept.occurredAtEntryId,
        )
  const commonKnowledge =
    kept.commonKnowledge !== 1 && absorbed.some((row) => row.commonKnowledge === 1)
  return {
    ...text,
    ...(anchor !== null && anchor !== kept.occurredAtEntryId ? { occurredAtEntryId: anchor } : {}),
    ...(commonKnowledge ? { commonKnowledge: 1 as const } : {}),
  }
}

function mergeRows(id: string, links: ReadonlyMap<string, LinkRows>): GuardRow[] {
  const { involvements, awareness } = links.get(id) ?? NO_LINKS
  return [
    { table: 'happenings', id },
    ...involvements.map(
      ({ id: link }): GuardRow => ({ table: 'happening_involvements', id: link }),
    ),
    ...awareness.map(({ id: link }): GuardRow => ({ table: 'happening_awareness', id: link })),
  ]
}

// chapter-close.md → 3e, as set_pin in 3d: a pin the user ever set is theirs whatever turn is cited.
const PIN: AwarenessField = 'decayResistance'

// C11: a later turn's write on any row of the merge, link rows included, skips it whole; then the
// user's edit of an absorbed row or its link rows (a deleted one included), a pin they ever set on
// an absorbed row, or an edit of a field the merge writes on keep. keep's own link rows lose
// nothing to a merge: the group's per-field precedence keeps a user's value.
function mergeProtection(
  guard: RowGuard,
  keep: string,
  absorb: readonly string[],
  links: ReadonlyMap<string, LinkRows>,
  fields: readonly string[],
  absorbedLinkDeleted: boolean,
): ProtectionReason | undefined {
  const verdicts = ({ table, id }: GuardRow) => guard.row(table, id)
  const rowsOf = (id: string) => mergeRows(id, links)
  if ([keep, ...absorb].flatMap(rowsOf).some((row) => verdicts(row).laterTurnTouched()))
    return CLOSE_REASON.laterTurn
  const absorbedPins = absorb.flatMap((id) => (links.get(id) ?? NO_LINKS).awareness)
  if (
    absorbedLinkDeleted ||
    absorb.flatMap(rowsOf).some((row) => verdicts(row).userTouched()) ||
    absorbedPins.some(({ id }) => guard.row('happening_awareness', id).userEverWrote(PIN)) ||
    fields.some((field) => guard.row('happenings', keep).userWrote(field))
  )
    return USER_EDITED_SINCE_PROSE
  return undefined
}

// A deleted link row is in no guard's rows: the guard reads the rows that stand.
async function userDeletedLinkOn(ctx: WriteContext, ids: readonly string[]): Promise<boolean> {
  for (const happeningId of ids)
    if (
      await userDeletedHappeningLink(
        { branchId: ctx.branchId, happeningId, proseEntryId: ctx.proseEntryId },
        { db: ctx.db },
      )
    )
      return true
  return false
}

// PlannedAction.row: a link's character, shown with its name so the answer's handle has one.
async function showLinkCharacters(ctx: WriteContext, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return
  const rows = await ctx.db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), inArray(entities.id, wanted)))
  for (const { id, name } of rows) ctx.ids.show(id, name)
}

function awarenessPayload(
  ctx: WriteContext,
  keep: string,
  folded: FoldedAwareness,
  fields: readonly AwarenessField[],
): AwarenessPayload {
  const sends = (field: AwarenessField): boolean => fields.includes(field)
  return {
    branchId: ctx.branchId,
    characterId: folded.characterId,
    happeningId: keep,
    ...(sends('learnedAtEntryId') ? { learnedAtEntryId: folded.learnedAtEntryId } : {}),
    ...(sends('decayResistance') ? { decayResistance: folded.decayResistance } : {}),
    ...(sends('retrievalCount') ? { retrievalCount: folded.retrievalCount } : {}),
    ...(sends('source') ? { source: folded.source } : {}),
    proseEntryId: ctx.proseEntryId,
  }
}

/**
 * The fold as writes on keep's links, each under its character. On a pair keep already holds, a
 * column the user wrote after the prose, or a pin they ever set, is named and not sent: the
 * handler would keep the first silently and overwrite the second.
 */
function linkWrites(
  ctx: WriteContext,
  keep: string,
  fold: MergeFold,
  kept: LinkRows,
  guard: RowGuard,
): { actions: PlannedAction[]; lost: LostField[] } {
  const actions: PlannedAction[] = []
  const lost: LostField[] = []
  for (const { entityId, role } of fold.involvements)
    actions.push({
      action: {
        kind: 'createHappeningInvolvement',
        source: 'chapter_close',
        payload: {
          entry: {
            id: generateId('hinv'),
            branchId: ctx.branchId,
            happeningId: keep,
            entityId,
            role,
          },
          proseEntryId: ctx.proseEntryId,
        },
      },
      fields: ['entityId'],
      row: entityId,
    })
  const pairs = new Map(kept.awareness.map((row) => [row.characterId, row]))
  for (const folded of fold.awareness) {
    const stored = pairs.get(folded.characterId)
    const changed: readonly AwarenessField[] =
      stored === undefined ? AWARENESS_FIELDS : changedAwarenessFields(stored, folded)
    const verdicts = stored === undefined ? undefined : guard.row('happening_awareness', stored.id)
    const userKept: readonly AwarenessField[] =
      verdicts === undefined
        ? []
        : changed.filter(
            (field) =>
              verdicts.userWrote(field) || (field === PIN && verdicts.userEverWrote(field)),
          )
    for (const field of userKept)
      lost.push(protectedField(field, folded.characterId, USER_EDITED_SINCE_PROSE))
    const sent = changed.filter((field) => !userKept.includes(field))
    if (sent.length === 0) continue
    actions.push({
      action: {
        kind: 'upsertHappeningAwareness',
        source: 'chapter_close',
        payload: awarenessPayload(ctx, keep, folded, sent),
      },
      fields: stored === undefined ? ['characterId'] : sent,
      row: folded.characterId,
    })
  }
  return { actions, lost }
}

async function planMergeHappenings(args: MergeArgs, ctx: WriteContext): Promise<WritePlan> {
  const { keep, absorb } = args
  const title = sentText(args.title, 'title')
  const description = sentText(args.description, 'description')
  const proposed: HappeningText = {
    ...(title === undefined ? {} : { title: title.bounded }),
    ...(description === undefined ? {} : { description: description.bounded }),
  }
  const named = [keep, ...absorb]
  const fault = mergeShapeFault(keep, absorb, ctx.clusterOf(keep))
  if (fault !== undefined)
    return {
      kind: 'refused',
      reason: fault,
      rows: happeningRows(ctx, named, new Map()),
      values: proposed,
    }

  const stored = await readHappenings(ctx, named)
  const rows = happeningRows(ctx, named, stored)
  const kept = stored.get(keep)
  const absorbed = absorb.flatMap((id) => stored.get(id) ?? [])
  if (kept === undefined || absorbed.length < absorb.length)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }

  const wanted: HappeningText = {
    ...(title === undefined || restatedText(kept.title, title) ? {} : { title: title.bounded }),
    ...(description === undefined || restatedText(kept.description, description)
      ? {}
      : { description: description.bounded }),
  }
  const links = await readLinks(ctx, named)
  const written = await closeWroteHappenings(ctx, links)
  // Advice names the keeps the close-wrote rule allows; the row guard may still skip one.
  const landing = named.filter(
    (id) => written.size === 0 || (written.size === 1 && written.has(id)),
  )
  if (landing.length === 0)
    return { kind: 'refused', reason: MERGE_REFUSAL.closeWroteNoKeep, rows, values: wanted }
  if (!landing.includes(keep))
    return {
      kind: 'refused',
      reason: MERGE_REFUSAL.closeWrote,
      rows,
      values: wanted,
      note: `Send ${landing.join(' or ')} as keep.`,
    }

  const anchors = [
    ...[kept, ...absorbed].map((row) => row.occurredAtEntryId),
    ...[...links.values()].flatMap(({ awareness }) => awareness.map((row) => row.learnedAtEntryId)),
  ].filter((id): id is string => id !== null)
  const positions = await entryPositions(ctx, anchors)
  const positionOf: PositionOf = (entryId) => positions.get(entryId)
  const patch = keepPatch(kept, absorbed, wanted, positionOf)
  const fields = Object.keys(patch)
  const guard = await ctx.guard(named.flatMap((id) => mergeRows(id, links)))
  const protection = mergeProtection(
    guard,
    keep,
    absorb,
    links,
    fields,
    await userDeletedLinkOn(ctx, absorb),
  )
  if (protection !== undefined)
    return {
      kind: 'write',
      actions: [],
      // The deletes are lost too, so a skipped merge with no text reads skipped, not ok.
      lost: [
        ...fields.map((field) => protectedField(field, keep, protection)),
        ...absorb.map((id) => protectedField(DELETE_PATH, id, protection)),
      ],
      rows,
      values: patch,
    }
  // Refused whole, not dropped: once the merge lands, no tool could resend keep's new text.
  const handle = [wanted.title, wanted.description]
    .map((text) => (text === undefined ? undefined : turnHandleIn(text, ctx.ids)))
    .find((found) => found !== undefined)
  if (handle !== undefined)
    return { kind: 'refused', reason: turnInTextReason(handle), rows, values: wanted }

  const keptLinks = links.get(keep) ?? NO_LINKS
  const fold = foldMergeLinks(
    keptLinks,
    absorb.map((id) => links.get(id) ?? NO_LINKS),
    positionOf,
  )
  await showLinkCharacters(ctx, [
    ...fold.involvements.map(({ entityId }) => entityId),
    ...fold.awareness.map(({ characterId }) => characterId),
  ])
  const carried = linkWrites(ctx, keep, fold, keptLinks, guard)
  const actions: PlannedAction[] = []
  if (fields.length > 0)
    actions.push({
      action: {
        kind: 'updateHappening',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id: keep, patch, proseEntryId: ctx.proseEntryId },
      },
      fields,
      row: keep,
    })
  actions.push(...carried.actions)
  for (const id of absorb)
    actions.push({
      action: {
        kind: 'deleteHappening',
        source: 'chapter_close',
        payload: { branchId: ctx.branchId, id },
      },
      fields: [DELETE_PATH],
      row: id,
    })
  return {
    kind: 'write',
    actions,
    lost: carried.lost,
    rows,
    // C4: keep's derived anchor and common knowledge are new values too, beside its text.
    values: patch,
    survivor: { table: 'happenings', id: keep },
  }
}

/** chapter-close.md → 3e: a cluster's duplicates folded into keep, as one group that lands whole. */
export const mergeHappeningsTool: WriteTool<typeof MERGE_HAPPENINGS_SHAPE> = {
  kind: 'write',
  name: 'merge_happenings',
  description:
    "Merge happenings of one cluster that record the same event: keep one and absorb the others, which are deleted. keep takes the earliest turn among them, everyone involved in any of them, each character's knowledge of any of them, and common knowledge if any had it. For a composite, send keep's description, and its title if it no longer covers them, rewritten whole; for a duplicate that only repeats keep, send neither. keep and absorb come from one cluster. Merge everything that records one event in one call; never in a chain.",
  schema: writeToolSchema(MERGE_HAPPENINGS_SHAPE),
  ids: {
    keep: { shape: 'single', prefixes: ['hap_'] },
    absorb: { shape: 'array', prefixes: ['hap_'] },
  },
  plan: planMergeHappenings,
}
