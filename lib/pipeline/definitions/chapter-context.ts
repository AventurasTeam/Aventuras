import type { StoryEntry, StoryMode, Thread, ThreadStatus } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { oneLine } from '@/lib/text'

/** A row of the close's range, which never reads a `system` entry. */
export type CloseRangeEntry = Readonly<
  Omit<StoryEntry, 'kind'> & { kind: Exclude<StoryEntry['kind'], 'system'> }
>

export type OpenThreadStatus = Extract<ThreadStatus, 'pending' | 'active'>

/** The metadata call's and a part's `chapter` context: less the close- and merge-only ones. No ids. */
export type ChapterContext = {
  entries: { position: number; kind: CloseRangeEntry['kind']; content: string }[]
  previousChapterSummary: string | null
  threads: { title: string; status: OpenThreadStatus }[]
  mode: StoryMode
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

/** The metadata call's context: the range as narrated, prior summary, open threads, mode. */
export function buildChapterContext(input: {
  entries: readonly CloseRangeEntry[]
  previousChapterSummary: string | null
  threads: readonly ThreadLine[]
  mode: StoryMode
}): ChapterContext {
  return {
    entries: input.entries.map((e) => ({
      position: e.position,
      kind: e.kind,
      content: promptProse(e),
    })),
    previousChapterSummary: input.previousChapterSummary,
    threads: openThreadLines(input.threads),
    mode: input.mode,
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

/** A turn as a close task shows it (VARIABLES.chapter → closeTurns). */
export type CloseTurn = { handle: string; kind: CloseRangeEntry['kind']; content: string }

/** A close task's turns: each entry's prose under the turn handle the run registered for it. */
export function buildCloseTurns(
  entries: readonly CloseRangeEntry[],
  handleOf: (entryId: string) => string | undefined,
): CloseTurn[] {
  return entries.map((entry) => {
    const handle = handleOf(entry.id)
    // A turn shown without its handle is one no write can cite.
    if (handle === undefined) throw new Error(`close turns: entry ${entry.id} has no turn handle`)
    return { handle, kind: entry.kind, content: promptProse(entry) }
  })
}
