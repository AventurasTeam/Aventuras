import type { DatabaseSync } from 'node:sqlite'

import { createTestDb } from '@/lib/db/__tests__/test-db'
import { buildQueryStack, countTokens, rankPerType, RANKER_DEFAULTS } from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'

import type { CaptureWriteInput } from '../writer'

// Every scored field distinct: a same-valued pair (0, false, 0.605 == 0.605)
// would let a transposed field mapping in candidateOf pass toEqual anyway.
export const loreCandidate = {
  kind: 'lore' as const,
  id: 'lo_1',
  displayName: 'The drowned archive',
  renderedText: 'Ledgers are kept below the waterline, where the tide reads them first.',
  sims: [0.95, 0.9, 0.85] as const,
  vector: Float32Array.from([1, 0]),
  chaptersOld: 3,
  pinSignal: 0.4,
  keywordHits: ['tide'],
  embeddingStale: true,
}

// Priced with the real tokenizer, not a stand-in: a captured payload stamps
// tokenizer: o200k_base, so a fixture priced any other way would make the
// capture internally inconsistent with its own declared vocabulary.
export const loreBundle = () =>
  rankPerType([loreCandidate], 'lore', 10_000, {
    params: RANKER_DEFAULTS,
    chapterRanges: new Map(),
    countTokens,
  })

export const queryStack = () =>
  buildQueryStack({
    userAction: 'Mira opens the ledger and reads the tide marks aloud.',
    sceneEntityNames: ['Mira'],
    currentLocationName: 'The drowned archive',
    activeThreadTitles: [],
    eraName: null,
    piggybackSummary: null,
    lastNarrativeContent: 'A courier arrived at dusk carrying nothing but an empty seal case.',
    index: { entityNames: new Set(['mira']), loreKeywords: new Set() },
  })

export const successOutcome = () =>
  retrievalSuccess({ bundles: { lore: loreBundle() }, queries: queryStack() })

export const settings = {
  retrievalBudgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  fullChapterInBuffer: false,
  partialChapterBuffer: 2,
  protectedBuffer: 1,
}

// Two stories. st_1 gets two branches — the FIFO trim is per story, so it
// must be exercised across them or a per-branch trim would pass. st_2 exists
// so the trim's story scoping itself is exercised: without it, evicting
// st_1's overflow could reach across into st_2's captures.
export function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO stories (id, title, created_at, updated_at)
      VALUES ('st_1', 'Tidewater', 1000, 1000), ('st_2', 'Ashfall', 1000, 1000);
    INSERT INTO branches (id, story_id, name, created_at)
      VALUES ('br_a', 'st_1', 'main', 1000), ('br_b', 'st_1', 'fork', 1000),
             ('br_c', 'st_2', 'main', 1000);
  `)
}

/** A fresh test db with `seed` already applied — every probe test wants both. */
export async function seededDb() {
  const db = await createTestDb()
  seed(db.sqlite)
  return db
}

// Callers override only what they're testing.
export const captureInput = (overrides: Partial<CaptureWriteInput> = {}): CaptureWriteInput => ({
  id: 'pc_1',
  branchId: 'br_a',
  targetEntryId: 'ent_1',
  chapterId: null,
  capturedAt: 1000,
  embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
  mode: 'light',
  appGateOn: true,
  storyGateOn: true,
  params: RANKER_DEFAULTS,
  settings,
  promptBufferTokens: 0,
  outcome: successOutcome(),
  ...overrides,
})
