import type { StoryDefinition, StoryEntry, StoryMode, Thread, ThreadStatus } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { oneLine } from '@/lib/text'
import { leadMarks, leadStampOf, type LeadMark } from '@/lib/world'

/** A row of the close's range, which never reads a `system` entry. */
export type CloseRangeEntry = Readonly<
  Omit<StoryEntry, 'kind'> & { kind: Exclude<StoryEntry['kind'], 'system'> }
>

export type OpenThreadStatus = Extract<ThreadStatus, 'pending' | 'active'>

/** A chapter call's mark: no id, since the call has no id map. */
export type ChapterLeadMark =
  | { name: string; id?: never; gone?: never; none?: never }
  | { gone: true; none?: never }
  | { none: true; gone?: never }

/** The metadata call's and a part's `chapter` context: less the close- and merge-only ones. No ids. */
export type ChapterContext = {
  entries: {
    position: number
    kind: CloseRangeEntry['kind']
    content: string
    leadMark?: ChapterLeadMark
  }[]
  previousChapterSummary: string | null
  threads: { title: string; status: OpenThreadStatus }[]
  mode: StoryMode
  lead: { name: string; id?: never } | null
  narration: StoryDefinition['narration']
}

type ThreadLine = Pick<Thread, 'title' | 'status'>

// chapter-close.md → Phase 2: the open threads, those pending or active.
export const OPEN_THREAD_STATUSES: ReadonlySet<ThreadStatus> = new Set<OpenThreadStatus>([
  'pending',
  'active',
])

export const isOpen = <T extends ThreadLine>(
  thread: T,
): thread is T & { status: OpenThreadStatus } => OPEN_THREAD_STATUSES.has(thread.status)

/** The merge call's `chapter` context, for a chapter closed in parts. No ids, no mode. */
export type ChapterMergeContext = {
  partSummaries: string[]
  previousChapterSummary: string | null
  threads: { title: string; status: OpenThreadStatus }[]
}

const openThreadLines = (threads: readonly ThreadLine[]): ChapterContext['threads'] =>
  threads.filter(isOpen).map((t) => ({ title: oneLine(t.title), status: t.status }))

// The call renders with no id map, so a raw id would reach the pack: the mark keeps the name.
function byName(mark: LeadMark | undefined): ChapterLeadMark | undefined {
  if (mark === undefined || !('id' in mark)) return mark
  return { name: mark.name }
}

/**
 * The metadata call's context: the range as narrated, each run's first entry marked where the lead
 * changed (walked from `lead`), prior summary, open threads, mode, the lead by name, the narration.
 */
export function buildChapterContext(input: {
  entries: readonly CloseRangeEntry[]
  previousChapterSummary: string | null
  threads: readonly ThreadLine[]
  mode: StoryMode
  lead: { id: string; name: string } | null
  narration: StoryDefinition['narration']
  nameOf: (id: string) => string | undefined
}): ChapterContext {
  const marks = leadMarks(
    input.entries.map((e) => leadStampOf(e)),
    input.lead?.id ?? null,
    input.nameOf,
  )
  return {
    entries: input.entries.map((e, i) => {
      const leadMark = byName(marks[i])
      return {
        position: e.position,
        kind: e.kind,
        content: promptProse(e),
        // Absent, not null, on an unmarked entry: an unmarked entry carries no leadMark key.
        ...(leadMark === undefined ? {} : { leadMark }),
      }
    }),
    previousChapterSummary: input.previousChapterSummary,
    threads: openThreadLines(input.threads),
    mode: input.mode,
    lead: input.lead == null ? null : { name: input.lead.name },
    narration: input.narration,
  }
}

/** The merge call's context: each part's summary in order, the prior summary, the open threads. */
export function buildChapterMergeContext(input: {
  partSummaries: readonly string[]
  previousChapterSummary: string | null
  threads: readonly ThreadLine[]
}): ChapterMergeContext {
  return {
    partSummaries: [...input.partSummaries],
    previousChapterSummary: input.previousChapterSummary,
    threads: openThreadLines(input.threads),
  }
}

/** A close's mark: the id is the close handle. */
export type CloseLeadMark =
  | { id: string; name: string; gone?: never; none?: never }
  | { gone: true; none?: never }
  | { none: true; gone?: never }

/** A turn as a close task shows it (VARIABLES.chapter → closeTurns). */
export type CloseTurn = {
  handle: string
  kind: CloseRangeEntry['kind']
  content: string
  leadMark?: CloseLeadMark
}

/**
 * A close task's turns: each entry's prose under the turn handle the run registered for it, and a
 * mark where its lead changes, walked from `namedLeadId`; a marked character takes `show`'s handle.
 */
export function buildCloseTurns(
  entries: readonly CloseRangeEntry[],
  handleOf: (entryId: string) => string | undefined,
  marks: {
    namedLeadId: string | null
    nameOf: (id: string) => string | undefined
    show: (id: string, name: string) => string
  },
): CloseTurn[] {
  const leadMarkOf = leadMarks(
    entries.map((entry) => leadStampOf(entry)),
    marks.namedLeadId,
    marks.nameOf,
  )
  return entries.map((entry, i) => {
    const handle = handleOf(entry.id)
    // A turn shown without its handle is one no write can cite.
    if (handle === undefined) throw new Error(`close turns: entry ${entry.id} has no turn handle`)
    const turn: CloseTurn = { handle, kind: entry.kind, content: promptProse(entry) }
    const mark = leadMarkOf[i]
    if (mark === undefined) return turn
    // Shown as the turns are built, before the part's first render, so its tasks share the handle.
    return {
      ...turn,
      leadMark: 'id' in mark ? { id: marks.show(mark.id, mark.name), name: mark.name } : mark,
    }
  })
}
