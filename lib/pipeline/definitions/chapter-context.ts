import type { StoryEntry, StoryMode, Thread, ThreadStatus } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { oneLine } from '@/lib/text'

/** A row of the close's range, which never reads a `system` entry. */
export type CloseRangeEntry = Readonly<
  Omit<StoryEntry, 'kind'> & { kind: Exclude<StoryEntry['kind'], 'system'> }
>

type OpenThreadStatus = Extract<ThreadStatus, 'pending' | 'active'>

/** The metadata call's `chapter` context: VARIABLES.chapter less the close-only ones. No ids. */
export type ChapterContext = {
  entries: { position: number; kind: CloseRangeEntry['kind']; content: string }[]
  previousChapterSummary: string | null
  threads: { title: string; status: OpenThreadStatus }[]
  mode: StoryMode
}

type ThreadLine = Pick<Thread, 'title' | 'status'>

// chapter-close.md → Phase 2: the open threads, those pending or active.
const OPEN_THREAD_STATUSES: ReadonlySet<ThreadStatus> = new Set<OpenThreadStatus>([
  'pending',
  'active',
])

const isOpen = (thread: ThreadLine): thread is ThreadLine & { status: OpenThreadStatus } =>
  OPEN_THREAD_STATUSES.has(thread.status)

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
    threads: input.threads
      .filter(isOpen)
      .map((t) => ({ title: oneLine(t.title), status: t.status })),
    mode: input.mode,
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
