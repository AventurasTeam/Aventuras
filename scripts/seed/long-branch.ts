import { DEFAULT_CALENDAR_ID } from '@/lib/calendar'
import { countTokens } from '@/lib/tokens'

import { chunked } from '../../lib/db/bind-limit'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'
import { remapSeedIds } from '../../lib/db/devtools/seed-ids'
import { branches, chapters as chaptersTable, stories, storyEntries } from '../../lib/db/schema'
import { storyDefinitionSchema } from '../../lib/db/stories/story-config-schema'
import { STORY_SETTINGS_DEFAULTS } from '../../lib/db/stories/story-settings-defaults'
import { entryMetadataSchema } from '../../lib/db/story-entries/entry-metadata'
import type { NewBranch, NewChapter, NewStory, NewStoryEntry } from '../../lib/db/types'

// The chapter counts bench/fixture.ts prices against; its long-branch test keeps the two equal.
export const LONG_BRANCH_SCALES = [20, 60] as const
export const ENTRIES_PER_CHAPTER = 132
export const LONG_BRANCH_STEP_ROWS = 500

export const longBranchId = (chapters: number): string => `br_long_${chapters}`

const OPEN_ENTRIES = 14
const REPLY_SENTENCES = 12
const WORLD_TIME_STEP_S = 600

// Fixed epoch, so a rebuilt file is byte-stable: 2026-01-01T00:00:00Z, as the seed dataset's.
const BASE = 1_767_225_600_000
const MIN = 60_000
const DAY = 86_400_000

const SENTENCES = [
  'The ferry came in low against the morning, its rail hung with wet rope and the smell of tar and old river mud.',
  'Nobody on the landing looked up, which told her more about the town than any of the letters she had carried here.',
  'He counted the coins twice and then a third time, slower, as if the sum might soften under his thumb if he waited.',
  'Fog sat on the water in long grey shelves, and the far bank came and went behind it like a thought half remembered.',
  'She had learned to read a room by its quietest person, and in this room that was the boy mending nets by the door.',
  'The bell at the toll house rang twice for the hour and once more for no reason that anyone there could have named.',
  'Somewhere under the floorboards the tide was working at the pilings, patient and tireless, the way debts always are.',
  'They ate without speaking, tearing the black bread by hand, and the lamp between them burned down to a blue thread.',
  'His ledger was older than he was, its first pages written in a hand that nobody left in Greywater could still read.',
  'The dockmaster smiled with the left half of his face and kept the right half for the men who owed him money.',
  'By noon the rain had thinned to a mist that did not fall so much as hang there, waiting to see what she would do.',
  'A gull walked the length of the rail and stared at them with the flat attention of a creditor reading a late notice.',
  'The rope burned through her gloves as the barge swung out, and for a moment the whole river pulled against her arms.',
  'He told the story badly on purpose, leaving out the only part that mattered, and watched to see who would notice.',
  'Behind the chandler’s shop a stair went down to the water, its steps worn hollow by four hundred years of wet boots.',
  'The letter was in her mother’s writing, which was impossible, and it named a day that had not yet come round again.',
  'Lanterns came on along the far quay one at a time, as though someone were walking the bank and lighting each by hand.',
  'She kept her voice level and her hands where they could be seen, and let the silence do what an argument never could.',
  'The old pilot spat over the side, considered the colour of the current, and said they would not be crossing tonight.',
  'What the harbour board called a survey was a man with a lead weight, a bad knee and a very particular sense of humour.',
  'Water ran down the inside of the walls in thin bright lines, and the map on the table had begun to curl at its edges.',
  'They had buried the last ferryman on the wrong bank, the story went, and the river had been collecting on it since.',
  'He laughed at that, too loudly, and the sound went out across the slack water and did not come back to him at all.',
  'At the end of the jetty someone had set out two chairs, facing the current, and neither of them was quite dry yet.',
]

const ACTIONS = [
  'I ask the dockmaster who paid for the crossing, and I keep my eyes on his hands while he decides how to answer me.',
  'I walk the length of the jetty and count the chairs again, then sit down in the wet one and wait for someone to object.',
  'I take the ledger from under his elbow, open it at the oldest page I can find, and read the first name aloud to the room.',
  'I go down the worn stair behind the chandler’s shop, one hand on the wall, and listen for the tide under the boards.',
  'I show her the letter and say nothing at all, and I watch her face for the moment she recognises her mother’s hand.',
  'I offer the old pilot double his fee to cross tonight, and when he refuses I ask him what he saw in the water today.',
]

const QUERIES = [
  'who paid for the crossing',
  'the letter in her mother’s writing',
  'the last ferryman buried on the wrong bank',
  'what the harbour board surveyed',
  'the dockmaster’s debts',
  'the two chairs on the jetty',
  'the ledger’s first pages',
]

const TITLE_OPENERS = ['Low', 'Slack', 'Grey', 'Late', 'Second', 'Cold', 'Long', 'Far']
const TITLE_NOUNS = ['Water', 'Crossing', 'Ledger', 'Landing', 'Tide', 'Reckoning', 'Current']
const THEMES = ['debt and inheritance', 'what the river keeps', 'old names', 'the price of passage']
const KEYWORDS = ['ferry', 'ledger', 'tide', 'dockmaster', 'jetty', 'letter', 'pilot', 'greywater']

function sentences(seed: number, count: number): string[] {
  // 5 is coprime with the pool's 24, so a count under 24 never repeats a sentence.
  return Array.from({ length: count }, (_, i) => SENTENCES[(seed * 7 + i * 5) % SENTENCES.length]!)
}

function replyContent(position: number): string {
  const paragraphs = position % 4 === 1 ? 4 : 3
  const perParagraph = REPLY_SENTENCES / paragraphs
  const picked = sentences(position, REPLY_SENTENCES)
  return Array.from({ length: paragraphs }, (_, p) => {
    const [first, ...rest] = picked.slice(p * perParagraph, (p + 1) * perParagraph)
    return [p === 1 ? `*${first}*` : first, ...rest].join(' ')
  }).join('\n\n')
}

function entryContent(position: number, kind: NewStoryEntry['kind']): string {
  return kind === 'user_action' ? ACTIONS[(position / 2) % ACTIONS.length]! : replyContent(position)
}

/** 1-based; null past the last chapter. Position 1 plus the next 132 make up chapter 1. */
function chapterOfPosition(position: number, chapters: number): number | null {
  const chapter = Math.max(1, Math.ceil((position - 1) / ENTRIES_PER_CHAPTER))
  return chapter <= chapters ? chapter : null
}

const chapterStart = (k: number): number => (k === 1 ? 1 : (k - 1) * ENTRIES_PER_CHAPTER + 2)
const chapterEnd = (k: number): number => k * ENTRIES_PER_CHAPTER + 1

const entryIdAt = (chapters: number, position: number): string =>
  `entry_long_${chapters}_${String(position).padStart(4, '0')}`

// The substitution layer rewrites only prefix_<uuid> ids (testing.md → Fixture + seed contract).
const chapterIdOf = (chapters: number, k: number): string =>
  remapSeedIds(`chap_long_${chapters}_${k}`)

function entryRow(chapters: number, position: number, t0: number) {
  const kind: NewStoryEntry['kind'] =
    position === 1 ? 'opening' : position % 2 === 0 ? 'user_action' : 'ai_reply'
  const content = entryContent(position, kind)
  const chapter = chapterOfPosition(position, chapters)
  return {
    id: entryIdAt(chapters, position),
    branchId: longBranchId(chapters),
    position,
    kind,
    content,
    contentTokens: countTokens(content),
    chapterId: chapter === null ? null : chapterIdOf(chapters, chapter),
    metadata: entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      // An action inherits the reply before it (generation-context.ts); the opening has no reply.
      worldTime: Math.floor((position - 1) / 2) * WORLD_TIME_STEP_S,
      ...(kind === 'ai_reply'
        ? {
            model: 'seed/narrative',
            tokens: { prompt: 4_000 + position, completion: 340 },
            reasoning: sentences(position + 11, 8).join(' '),
            summary: sentences(position + 19, 2).join(' '),
            retrievalQueries: [0, 1, 2].map((i) => QUERIES[(position + i) % QUERIES.length]),
          }
        : {}),
    }),
    createdAt: t0 + position * MIN,
  } satisfies NewStoryEntry
}

function chapterRow(chapters: number, k: number, t0: number, tokenCount: number): NewChapter {
  const closedAt = t0 + chapterEnd(k) * MIN
  return {
    id: chapterIdOf(chapters, k),
    branchId: longBranchId(chapters),
    sequenceNumber: k,
    title: `${TITLE_OPENERS[k % TITLE_OPENERS.length]} ${TITLE_NOUNS[k % TITLE_NOUNS.length]}`,
    summary: sentences(k * 13, 3).join(' '),
    theme: THEMES[k % THEMES.length]!,
    keywords: [0, 1, 2, 3].map((i) => KEYWORDS[(k + i) % KEYWORDS.length]!),
    startEntryId: entryIdAt(chapters, chapterStart(k)),
    endEntryId: entryIdAt(chapters, chapterEnd(k)),
    tokenCount,
    closedAt,
    embeddingStale: 0,
    createdAt: closedAt,
    updatedAt: closedAt,
  }
}

export function buildLongBranchSteps(chapters: number): SeedStep[] {
  const storyId = `story_long_${chapters}`
  const branchId = longBranchId(chapters)
  const t0 = BASE + (20 + chapters) * DAY
  const tail = chapterEnd(chapters) + OPEN_ENTRIES

  const story: NewStory = {
    id: storyId,
    title: `Long branch, ${chapters} chapters`,
    description: 'A measure fixture: full-length prose over a long closed history.',
    status: 'active',
    lastOpenedAt: t0 + 3 * MIN,
    definition: storyDefinitionSchema.parse({
      mode: 'creative',
      leadEntityId: null,
      narration: 'third',
      genre: { label: 'literary', promptBody: 'Write in the literary tradition.' },
      tone: { label: 'patient', promptBody: 'Keep a patient tone.' },
      setting: 'the river town of Greywater',
      calendarSystemId: DEFAULT_CALENDAR_ID,
      worldTimeOrigin: { year: 1247, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
    createdAt: t0,
    updatedAt: t0 + 3 * MIN,
    currentBranchId: branchId,
  }
  const branch: NewBranch = {
    id: branchId,
    storyId,
    parentBranchId: null,
    forkEntryId: null,
    name: 'Main',
    createdAt: t0,
    // Parked at the tail, so a Send owes no catch-up pass.
    classifierStatus: {
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: tail,
    },
  }
  const entries = Array.from({ length: tail }, (_, i) => entryRow(chapters, i + 1, t0))
  const tokensIn = new Map<string, number>()
  for (const e of entries) {
    if (e.chapterId) tokensIn.set(e.chapterId, (tokensIn.get(e.chapterId) ?? 0) + e.contentTokens)
  }
  const chapterRows = Array.from({ length: chapters }, (_, i) =>
    chapterRow(chapters, i + 1, t0, tokensIn.get(chapterIdOf(chapters, i + 1)) ?? 0),
  )

  return [
    { name: 'stories', table: stories, rows: [story] },
    { name: 'branches', table: branches, rows: [branch] },
    ...chunked(entries, LONG_BRANCH_STEP_ROWS).map((rows) => ({
      name: 'story_entries',
      table: storyEntries,
      rows,
    })),
    { name: 'chapters', table: chaptersTable, rows: chapterRows },
  ]
}
