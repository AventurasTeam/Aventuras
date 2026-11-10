import { eq } from 'drizzle-orm'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { __resetRegistrationGuard, registerAllDomains } from '@/lib/actions/delta/registrations'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import type { GenerateStructuredResult } from '@/lib/ai'
import {
  branches,
  STORY_SETTINGS_DEFAULTS,
  stories,
  storyDefinitionSchema,
  storyEntries,
  type DbCtx,
  type EntryMetadata,
  type StoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { hydrateAppSettings, resetAllStores } from '@/lib/stores'
import { countTokens } from '@/lib/tokens'

import type { ChapterMetadata } from '../chapter-metadata-schema'

export type CloseFixture = {
  ctx: DbCtx
  storyId: string
  branchId: string
  /** Every entry in position order, the opening first. */
  entries: readonly { id: string; kind: StoryEntry['kind']; position: number }[]
  /** The ai_reply ids, in position order. */
  replyIds: readonly string[]
}

// Not 's1': registerStoreOnlyRun parks another story's run under that id.
const STORY_ID = 'story_close'
const BRANCH_ID = 'br_close'
const BASE = 1_767_225_600_000

const OPENING =
  'Rain had followed Wren from the coast for three days, and the letter in her satchel had not grown any lighter. The ferry town of Harrow sat low on the river, its lamps already lit against the dusk.'

const ACTIONS = [
  'I tie the mare outside the inn and shake the rain from my hood.',
  'I ask the innkeeper whether the ferry still runs at night.',
  'I go down to the landing and look for the ferryman.',
  'I show him the seal on the letter and ask his price.',
  'I pay the silver and climb into the boat.',
  'I keep my hand on the satchel and watch the far bank.',
  'I ask him who keeps the far bank now.',
  'I step onto the jetty and thank him for the crossing.',
  'I follow the lantern light up toward the toll house.',
  'I tell the guard I carry a letter for the reeve of Low Ashby.',
  'I take the road east before the guard can change his mind.',
  'I stop at the milestone and read the direction on the letter again.',
]

const REPLIES = [
  'The inn is warm and loud with drovers. A boy takes the mare without being asked, and the innkeeper watches you over a row of tankards as if she has been expecting someone like you.',
  'She shrugs. The ferry runs when old Tobin says it runs, and tonight he has been drinking since noon. If you want the crossing, she says, you will have to find him at the landing and talk him into it.',
  'The landing is a black line of planks over black water. Tobin sits on an upturned barrel with a pipe that has gone out, and he does not look up until your boots are on his planks.',
  'He squints at the wax and spits into the river. A courier seal means a courier purse, he says, and names a price that would buy the boat twice over.',
  'The boat rocks as you settle. Tobin pushes off with a pole as long as a mast, and the lamps of the town shrink behind you until they are only a smear of gold on the rain.',
  'Halfway across, a light moves on the far bank and then goes out. Tobin sees it too. He says nothing, but he poles a little faster, and the boat swings wide of the usual landing.',
  'The Syndicate, he says, since the spring. They tax the ferry, the road and the bread, and they do not like letters they have not read first.',
  'Tobin grunts and is already pushing off. The jetty smells of tar and wet rope, and somewhere above you a door bangs shut in the wind.',
  'The toll house is a squat stone box with one lit window. A guard in a Syndicate sash steps out with a lantern raised and asks your business in a voice that has asked it many times tonight.',
  'He lifts the lantern to your face, then to the seal. For a long moment he weighs the letter against the trouble it would bring him, and then he steps aside.',
  'The road east climbs out of the river mist into open country. Behind you the toll house door opens again, and a second lantern starts down toward the landing.',
  'The milestone reads Low Ashby, nine miles. The letter is addressed in a cramped hand to the reeve, and beneath the seal someone has pressed a second, smaller mark you do not recognise.',
]

/** A metadata reply in prose, for `generateStructured` mocks. */
export const METADATA_REPLY: ChapterMetadata = {
  title: 'The Crossing at Harrow',
  summary:
    'Wren reaches the ferry town of Harrow and talks the ferryman Tobin into a night crossing. On the far bank she learns the Syndicate holds the road, and a toll guard lets her pass with the sealed letter still unread.',
  theme: 'a guarded passage',
  keywords: ['harrow', 'ferry', 'tobin', 'syndicate', 'letter'],
}

export function metadataReplyResult(): GenerateStructuredResult<ChapterMetadata> {
  return { status: 'ok', value: METADATA_REPLY, recoverable: [] }
}

// lore-mgmt and the classifier on separate profiles, so a test can tell whose timeout bounds a call.
const MODELS = {
  providers: [
    {
      id: 'prov_close',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://localhost:4319/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'prof_close_lore',
      kind: 'agent',
      name: 'Lore',
      modelRef: { providerId: 'prov_close', modelId: 'lore-model' },
      timeout: 120,
    },
    {
      id: 'prof_close_classifier',
      kind: 'agent',
      name: 'Classifier',
      modelRef: { providerId: 'prov_close', modelId: 'classifier-model' },
      timeout: 300,
    },
  ],
  assignments: { 'lore-mgmt': 'prof_close_lore', classifier: 'prof_close_classifier' },
  defaultProviderId: 'prov_close',
  diagnostics: { enabled: false, debug_level_enabled: false },
}

/** MODELS with a window on lore-mgmt's model, as a user's override on its provider sets one. */
function modelsWithLoreWindow(tokens: number) {
  return {
    ...MODELS,
    providers: MODELS.providers.map((provider) => ({
      ...provider,
      contextWindowOverrides: { 'lore-model': tokens },
    })),
  }
}

/**
 * A lore-mgmt window whose half is one token under the stored counts of the first `entryCount`
 * entries openCloseFixture writes: those entries cut into two parts, the last turn alone.
 */
export function twoPartWindow(entryCount: number): number {
  const counts = [countTokens(OPENING)]
  for (let turn = 0; counts.length < entryCount; turn++)
    counts.push(
      countTokens(ACTIONS[turn % ACTIONS.length]!),
      countTokens(REPLIES[turn % REPLIES.length]!),
    )
  const total = counts.slice(0, entryCount).reduce((sum, tokens) => sum + tokens, 0)
  return 2 * (total - 1)
}

// loadOpenStory refuses a definition or settings its schemas reject.
const DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  leadEntityId: null,
  narration: 'third',
  genre: { label: 'Road story', promptBody: 'A courier crossing a river country.' },
  tone: { label: 'Watchful', promptBody: 'Spare and quiet.' },
  setting: 'A river country under a new toll.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

const entryIdAt = (position: number): string => `entry_close_${String(position).padStart(3, '0')}`

const metadataAt = (position: number): EntryMetadata => ({
  sceneEntities: [],
  currentLocationId: null,
  worldTime: position * 60,
})

async function writeTurnEntry(
  ctx: DbCtx,
  actionId: string,
  entry: { position: number; kind: 'user_action' | 'ai_reply'; content: string },
): Promise<string> {
  const id = entryIdAt(entry.position)
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createStoryEntry',
        source: entry.kind === 'user_action' ? 'user_edit' : 'ai_classifier',
        payload: {
          entry: {
            id,
            branchId: BRANCH_ID,
            position: entry.position,
            kind: entry.kind,
            content: entry.content,
            chapterId: null,
            metadata: metadataAt(entry.position),
            createdAt: BASE + entry.position,
          },
        },
      },
      actionId,
      branchId: BRANCH_ID,
      // As a turn logs them: the action unanchored, the reply anchored on itself.
      entryId: entry.kind === 'ai_reply' ? id : null,
    },
    ctx,
  )
  if (result.status !== 'ok')
    throw new Error(`close fixture: entry ${id} refused: ${result.reason}`)
  return id
}

/** Writes the fixture branch's classifier status; `running` with no pass live holds the branch. */
export async function setClassifierStatus(
  f: Pick<CloseFixture, 'ctx' | 'branchId'>,
  status: { state: 'idle' | 'running'; processedThrough: number },
): Promise<void> {
  await f.ctx.db
    .update(branches)
    .set({ classifierStatus: { lastSuccessAt: null, lastError: null, ...status } })
    .where(eq(branches.id, f.branchId))
}

/**
 * Resets every store, then opens a story whose branch holds an opening written as create-story
 * writes it (no delta) and `turns` action/reply pairs created through the action layer, each pair
 * under one action id. Every entry is counted from prose and the watermark sits at the tail.
 * Leaves the pipeline registry and the event bus alone, and fakes no model.
 */
export async function openCloseFixture(opts?: {
  turns?: number
  /** lore-mgmt's window, so a close over the fixture cuts into parts. */
  loreWindow?: number
}): Promise<CloseFixture> {
  const turns = opts?.turns ?? 6
  resetAllStores()
  // Past the latch: a test that cleared the delta registry would otherwise leave chapters
  // unregistered, and undoTargetOf throws on an unregistered table.
  __resetRegistrationGuard()
  registerAllDomains()
  const { db, runInTransaction } = await createTestDb()
  const ctx: DbCtx = { db, runInTransaction }
  await db.insert(stories).values({
    id: STORY_ID,
    title: 'The Crossing',
    status: 'active',
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
    createdAt: BASE,
    updatedAt: BASE,
    currentBranchId: BRANCH_ID,
  })
  await db
    .insert(branches)
    .values({ id: BRANCH_ID, storyId: STORY_ID, name: 'main', createdAt: BASE })

  const openingId = entryIdAt(1)
  await db.insert(storyEntries).values({
    id: openingId,
    branchId: BRANCH_ID,
    position: 1,
    kind: 'opening',
    content: OPENING,
    contentTokens: countTokens(OPENING),
    chapterId: null,
    metadata: metadataAt(1),
    createdAt: BASE + 1,
  })
  const entries: CloseFixture['entries'][number][] = [
    { id: openingId, kind: 'opening', position: 1 },
  ]
  for (let turn = 0; turn < turns; turn++) {
    const actionId = `act_close_turn_${turn + 1}`
    const position = 2 * turn + 2
    const action = ACTIONS[turn % ACTIONS.length]!
    const reply = REPLIES[turn % REPLIES.length]!
    entries.push({
      id: await writeTurnEntry(ctx, actionId, { position, kind: 'user_action', content: action }),
      kind: 'user_action',
      position,
    })
    entries.push({
      id: await writeTurnEntry(ctx, actionId, {
        position: position + 1,
        kind: 'ai_reply',
        content: reply,
      }),
      kind: 'ai_reply',
      position: position + 1,
    })
  }

  // No public writer exists, and running a pass to move it would need a model.
  await db
    .update(branches)
    .set({
      classifierStatus: {
        state: 'idle',
        lastSuccessAt: null,
        lastError: null,
        processedThrough: entries.at(-1)!.position,
      },
    })
    .where(eq(branches.id, BRANCH_ID))

  const models = opts?.loreWindow === undefined ? MODELS : modelsWithLoreWindow(opts.loreWindow)
  const hydrated = await hydrateAppSettings(async () => models)
  if (hydrated.status !== 'ok')
    throw new Error(`close fixture: settings refused: ${hydrated.error}`)
  const opened = await loadOpenStory(BRANCH_ID, ctx)
  if (opened.status !== 'ok') throw new Error(`close fixture: story did not open: ${opened.status}`)

  return {
    ctx,
    storyId: STORY_ID,
    branchId: BRANCH_ID,
    entries,
    replyIds: entries.filter((e) => e.kind === 'ai_reply').map((e) => e.id),
  }
}
