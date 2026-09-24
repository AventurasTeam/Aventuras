import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import type { DbCtx } from '@/lib/db'
import { BIND_CHUNK, storyEntries } from '@/lib/db'
import { excerpt, stripMarkup } from '@/lib/text'

import type { EntryIndex, EntryRef } from './types'

const EXCERPT_SOURCE_CHARS = 200
// Bounded, not whole content: a story of rich entries can send every row to the wider read.
const WIDE_SOURCE_CHARS = 8000
// Hermes strips at ~250 ns/char, so the wide read scans this much past any preamble first.
const NEAR_SOURCE_CHARS = 600
const ENTRY_EXCERPT_CHARS = 120

type SourceHead = { head: string; afterCut: string; truncated: number }

function sourceHead(chars: number) {
  return {
    head: sql<string>`substr(${storyEntries.content}, 1, ${chars})`,
    // The character right after the cut: whitespace (or absent, past the end) means the
    // head's last word is whole; anything else means the cut landed mid-word.
    afterCut: sql<string>`substr(${storyEntries.content}, ${chars + 1}, 1)`,
    truncated: sql<number>`length(${storyEntries.content}) > ${chars}`,
  }
}

// Drops a trailing partial word so the forced ellipsis follows a whole word. Only meaningful
// when the cut landed mid-word (see afterCut) — a head ending in whitespace has none to drop.
// A head with no earlier word (unspaced scripts) stays whole: a hard cut beats an empty excerpt.
function dropTrailingPartialWord(head: string): string {
  if (head === '' || /\s$/.test(head)) return head
  const lastBreak = head.search(/\s\S*$/)
  const kept = lastBreak === -1 ? '' : head.slice(0, lastBreak)
  return kept.trim() === '' ? head : kept
}

function preview(source: SourceHead): { excerpt: string; readFurther: boolean } {
  const truncated = Boolean(source.truncated)
  const cutMidWord = truncated && source.afterCut !== '' && !/\s/.test(source.afterCut)
  // Stripped first: the raw head's tags hide where its words break.
  const prose = stripMarkup(source.head)
  const head = cutMidWord ? dropTrailingPartialWord(prose) : prose
  const text = excerpt(head, ENTRY_EXCERPT_CHARS) ?? ''
  const filled = Array.from(prose.replace(/\s+/g, ' ').trim()).length > ENTRY_EXCERPT_CHARS
  // excerpt() collapses whitespace after the truncation cut, so a short result doesn't prove a
  // short source — force the ellipsis excerpt() has no way to know it owes.
  const needsEllipsis = truncated && text !== '' && !text.endsWith('…')
  return {
    excerpt: needsEllipsis ? `${text}…` : text,
    // A literal `<` in the preview may be a tag the cut left unfinished.
    readFurther: truncated && (!filled || text.includes('<')),
  }
}

const HIDDEN_OPEN = /\s*<(style|script)(?=[\s/>])/iy

// End of the leading style and script blocks — a rich entry's preamble, skipped by index rather
// than stripped. The length when one never closes: the reader hides the rest.
function hiddenPrefixEnd(text: string): number {
  let at = 0
  for (;;) {
    HIDDEN_OPEN.lastIndex = at
    const tag = HIDDEN_OPEN.exec(text)?.[1].toLowerCase()
    if (tag == null) return at
    let close = text.indexOf('</', HIDDEN_OPEN.lastIndex)
    while (close !== -1 && text.slice(close + 2, close + 2 + tag.length).toLowerCase() !== tag)
      close = text.indexOf('</', close + 2)
    const end = close === -1 ? -1 : text.indexOf('>', close)
    if (end === -1) return text.length
    at = end + 1
  }
}

function widePreview(source: SourceHead): string {
  const start = hiddenPrefixEnd(source.head)
  const cut = start + NEAR_SOURCE_CHARS
  const near = preview({
    head: source.head.slice(start, cut),
    afterCut: source.head.charAt(cut) || source.afterCut,
    truncated: Number(source.head.length > cut || Boolean(source.truncated)),
  })
  if (!near.readFurther || source.head.length <= cut) return near.excerpt
  return preview({ ...source, head: source.head.slice(start) }).excerpt
}

async function readWideExcerpts(
  ids: readonly string[],
  database: DbCtx['db'],
): Promise<Map<string, string>> {
  const excerpts = new Map<string, string>()
  // Chunked: a story of rich entries can flag every row.
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const rows = await database
      .select({ id: storyEntries.id, ...sourceHead(WIDE_SOURCE_CHARS) })
      .from(storyEntries)
      .where(inArray(storyEntries.id, ids.slice(i, i + BIND_CHUNK)))
    for (const r of rows) excerpts.set(r.id, widePreview(r))
  }
  return excerpts
}

/**
 * Every non-system entry of the branch, newest first. System entries are deleted at the next
 * submit, so nothing may anchor to one. Bypasses the entries store's trailing window
 * (recent-window.ts) — older anchors still need this full read.
 */
export async function readEntryIndex(branchId: string, database: DbCtx['db']): Promise<EntryRef[]> {
  const rows = await database
    .select({
      id: storyEntries.id,
      position: storyEntries.position,
      kind: storyEntries.kind,
      chapterId: storyEntries.chapterId,
      ...sourceHead(EXCERPT_SOURCE_CHARS),
    })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position))
  const previews = rows.map(preview)
  const wide = await readWideExcerpts(
    rows.filter((_, i) => previews[i].readFurther).map((r) => r.id),
    database,
  )
  return rows.map((r, i) => ({
    id: r.id,
    position: r.position,
    kind: r.kind,
    chapterId: r.chapterId,
    excerpt: wide.get(r.id) ?? previews[i].excerpt,
  }))
}

export function indexEntryRefs(rows: readonly EntryRef[]): EntryIndex {
  return new Map(rows.map((r) => [r.id, r]))
}
