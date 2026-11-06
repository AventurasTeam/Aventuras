import type { StoryEntry, StoryMode, Thread, ThreadStatus } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { oneLine } from '@/lib/text'

/** The `chapter` group's context (VARIABLES.chapter). No ids, so no placeholder map. */
export type ChapterContext = {
  entries: { position: number; kind: StoryEntry['kind']; content: string }[]
  previousChapterSummary: string | null
  threads: { title: string; status: ThreadStatus }[]
  mode: StoryMode
}

// chapter-close.md → Phase 2 reads the active threads; a pending one is as open.
const OPEN_THREAD_STATUSES: ReadonlySet<ThreadStatus> = new Set(['pending', 'active'])

/** The metadata call's context: the range as narrated, prior summary, open threads, mode. */
export function buildChapterContext(input: {
  entries: readonly StoryEntry[]
  previousChapterSummary: string | null
  threads: readonly Pick<Thread, 'title' | 'status'>[]
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
      .filter((t) => OPEN_THREAD_STATUSES.has(t.status))
      .map((t) => ({ title: oneLine(t.title), status: t.status })),
    mode: input.mode,
  }
}
