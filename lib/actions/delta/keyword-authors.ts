import { and, asc, eq, or, sql } from 'drizzle-orm'

import { deltas, type Delta } from '@/lib/db'
import { newTerms, normalizeTerm } from '@/lib/keyword-terms'

import { isUserOriginatedSource, type DbCtx, type DeltaSource, type ProseEntryId } from '../types'
import { userEditsSinceProse } from './user-precedence'

/** Who added a live keyword: a delta's source, or `unlogged` when no delta accounts for it. */
export type KeywordAuthor = DeltaSource | 'unlogged'

function termKeys(terms: unknown): Set<string> {
  const keys = new Set<string>()
  if (!Array.isArray(terms)) return keys
  for (const term of terms) {
    if (typeof term !== 'string') continue
    const key = normalizeTerm(term)
    if (key !== '') keys.add(key)
  }
  return keys
}

// The row's creates, and each update whose undo payload holds the list it replaced. A delete's
// payload is the whole row, keywords included, so the op is what keeps it out.
async function keywordDeltas(ctx: DbCtx, branchId: string, table: 'entities' | 'lore', id: string) {
  return ctx.db
    .select({ op: deltas.op, source: deltas.source, undoPayload: deltas.undoPayload })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, table),
        eq(deltas.targetId, id),
        or(
          eq(deltas.op, 'create'),
          and(
            eq(deltas.op, 'update'),
            sql`json_type(${deltas.undoPayload}, '$.keywords') = 'array'`,
          ),
        ),
      ),
    )
    .orderBy(asc(deltas.logPosition))
}

/**
 * Normalized live term → who added it (retrieval.md → Keywords schema): the latest update whose
 * list before lacks the term, else the create. An undone update has left the log, so its term
 * falls back to the latest earlier keyword update still in the log, else the create's source.
 */
export async function keywordAuthors(
  ctx: DbCtx,
  branchId: string,
  table: 'entities' | 'lore',
  id: string,
  live: readonly string[],
): Promise<ReadonlyMap<string, KeywordAuthor>> {
  const rows = await keywordDeltas(ctx, branchId, table, id)
  const created = rows.findLastIndex((row) => row.op === 'create')
  const createdBy: KeywordAuthor = created === -1 ? 'unlogged' : rows[created].source
  const updates = rows.slice(created + 1)
  const before = updates.map((update) => termKeys(update.undoPayload?.keywords))
  const liveKeys = termKeys(live)
  const authors = new Map<string, KeywordAuthor>()
  for (const key of liveKeys) {
    const adder = updates.findLastIndex((_, i) => !before[i].has(key))
    authors.set(key, adder === -1 ? createdBy : updates[adder].source)
  }
  return authors
}

/** The normalized live terms a close may not remove: the user's, or unlogged. */
export async function protectedKeywordTerms(
  ctx: DbCtx,
  branchId: string,
  table: 'entities' | 'lore',
  id: string,
  live: readonly string[],
): Promise<ReadonlySet<string>> {
  const guarded = new Set<string>()
  for (const [key, author] of await keywordAuthors(ctx, branchId, table, id, live))
    if (author === 'unlogged' || isUserOriginatedSource(author)) guarded.add(key)
  return guarded
}

/** `keyword-user-added: <term>` — a removal of a term the user added. */
export function keywordUserAddedReason(term: string): string {
  return `keyword-user-added: ${term}`
}

/**
 * `keyword-pairs-flag: <term> (pairs this row with <other>, …)` — a removal that would break a
 * live flag's pair, naming the open question (entities only).
 */
export function keywordPairsFlagReason(term: string, other: string): string {
  return `keyword-pairs-flag: ${term} (pairs this row with ${other}, an open question for the user)`
}

// Matched only against terms the live list lacks, so a hit is one the user removed.
export function priorTerms(edits: readonly Delta[]): Set<string> {
  const terms = new Set<string>()
  for (const edit of edits) {
    const prior = edit.undoPayload?.keywords
    if (!Array.isArray(prior)) continue
    for (const term of prior) if (typeof term === 'string') terms.add(normalizeTerm(term))
  }
  return terms
}

/** A close's keyword edit, planned against the live list. */
export type KeywordEdit =
  /** A removal names a term the user added, or one no delta accounts for. */
  | { kind: 'user-term'; term: string }
  /** Nothing to write; `userDropped` when every add was a term the user removed after the prose. */
  | { kind: 'unchanged'; userDropped: boolean }
  /** `next`: the kept terms in stored order, then the adds. */
  | { kind: 'changed'; next: string[]; removed: string[] }

/**
 * cadence.md → User edits and classifier writes: adds are the terms the list lacks, less any the
 * user removed after the prose; removals match by `normalizeTerm`, every spelling alike, and a term
 * the list lacks is ignored.
 */
export async function planKeywordEdit(
  ctx: DbCtx,
  row: { table: 'entities' | 'lore'; branchId: string; id: string; keywords: readonly string[] },
  edit: { add: readonly string[]; remove: readonly string[]; proseEntryId: ProseEntryId },
): Promise<KeywordEdit> {
  const { table, branchId, id, keywords } = row
  const fresh = newTerms(keywords, edit.add)
  const userRemoved =
    fresh.length > 0 && edit.proseEntryId !== null
      ? priorTerms(await userEditsSinceProse(ctx, branchId, table, id, edit.proseEntryId))
      : new Set<string>()
  const added = fresh.filter((term) => !userRemoved.has(normalizeTerm(term)))
  const dropped = new Set(edit.remove.map(normalizeTerm).filter((key) => key !== ''))
  const removed = keywords.filter((term) => dropped.has(normalizeTerm(term)))
  if (removed.length > 0) {
    const guarded = await protectedKeywordTerms(ctx, branchId, table, id, keywords)
    const term = removed.find((stored) => guarded.has(normalizeTerm(stored)))
    if (term !== undefined) return { kind: 'user-term', term }
  }
  if (added.length === 0 && removed.length === 0)
    return { kind: 'unchanged', userDropped: fresh.length > 0 }
  return {
    kind: 'changed',
    next: [...keywords.filter((term) => !dropped.has(normalizeTerm(term))), ...added],
    removed,
  }
}
