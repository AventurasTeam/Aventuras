import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS, type TemplateId } from '..'

// memory/chapter-close.md → Phase 2, classifier.md → What the classifier writes. Written out: the
// test pins the bundled wording, not whatever the constant holds.
const RULE =
  'Tell it in the third person, naming each character as the prose does and the lead by name: never "I" or "you" outside quoted speech, whatever person the story is narrated in, since it is recalled later under whatever lead the story has then.'

const LEAD = { id: 'c1', name: 'Jim' }

const CHAPTER = {
  entries: [
    { position: 1, kind: 'user_action', content: 'I ask the captain about the map.' },
    { position: 2, kind: 'ai_reply', content: 'The captain laughs and pockets the map.' },
  ],
  previousChapterSummary: null,
  threads: [],
  mode: 'adventure',
  lead: { name: LEAD.name },
  narration: 'first',
}

const MERGE = {
  partSummaries: ['Jim asks the captain about the map.', 'The captain pockets the map.'],
  previousChapterSummary: null,
  threads: [],
}

const PERIODIC = {
  turns: [
    {
      handle: 't1',
      kind: 'ai_reply',
      content: 'I ask the captain about the map.',
      scene: ['c1'],
      location: null,
    },
  ],
  entities: [
    {
      id: 'c1',
      name: 'Jim',
      kind: 'character',
      status: 'active',
      description: 'A cabin boy.',
      keywords: [],
    },
  ],
  places: [],
  placesUnplaced: [],
  happenings: [],
  threads: [],
  relationships: [],
  mode: 'adventure',
  mentionedPlaces: false,
  lead: LEAD,
}

const HAPPENINGS = {
  mode: 'adventure',
  lead: LEAD,
  closeHappeningClusters: [],
  closeWritesSoFar: '',
}

type Half = 'system' | 'user'
type Case = [
  name: string,
  id: TemplateId,
  context: Record<string, unknown>,
  half: Half,
  expected: string,
]

const CASES: Case[] = [
  [
    'the chapter metadata call',
    TEMPLATE_IDS.chapterMetadata,
    CHAPTER,
    'system',
    `- Summary. Two to four sentences telling what happened in this chapter, in order: who did what, what changed, and where it left things. Name characters and places as the prose names them. ${RULE} Later chapters recall this one through its summary alone, so keep what the story will need.\n`,
  ],
  [
    "a part's call",
    TEMPLATE_IDS.chapterMetadataPart,
    CHAPTER,
    'system',
    `- Summary. Three to five sentences telling what happened in this part, in order: who did what, what changed, and where it left things. Name characters and places as the prose names them. ${RULE} The chapter's summary is made from these, so keep what the story will need.\n`,
  ],
  [
    'the merge call',
    TEMPLATE_IDS.chapterMetadataMerge,
    MERGE,
    'system',
    `- Summary. Two to four sentences telling what happened across the whole chapter, in order: who did what, what changed, and where it left things. Name characters and places as the summaries name them. ${RULE} Later chapters recall this one through its summary alone, so keep what the story will need.\n`,
  ],
  [
    'the periodic classifier',
    TEMPLATE_IDS.periodicClassifier,
    PERIODIC,
    'system',
    `so that a character recalling it later has the scene to recall. ${RULE} Another event is another happening: one at another time or place, or one the turns only recount.\n`,
  ],
  [
    'the Happenings task',
    TEMPLATE_IDS.closeHappenings,
    HAPPENINGS,
    'user',
    `send keep's description rewritten whole to hold what each said ("X happened, then Y"), and a title when keep's no longer covers them. ${RULE}\n- Delete a duplicate`,
  ],
]

describe('the third-person rule', () => {
  it.each(CASES)(
    '%s states it where it asks for the summary or the description',
    (_name, id, context, half, expected) => {
      expect(renderTemplate(id, context)[half]).toContain(expected)
    },
  )

  // A close task's shared instructions stay free of it, so every other close task's system half
  // renders as before.
  it.each(CASES)('%s keeps it out of its other half', (_name, id, context, half) => {
    const other: Half = half === 'system' ? 'user' : 'system'
    expect(renderTemplate(id, context)[other]).not.toContain(RULE)
  })

  it.each(CASES)("%s no longer tells it in the narration's person", (_name, id, context) => {
    const { system, user } = renderTemplate(id, context)
    for (const half of [system, user]) {
      expect(half).not.toContain('own person')
      expect(half).not.toContain('person they are told in')
      expect(half).not.toContain('so does the summary')
    }
  })
})
