import { expect, test, type Page } from '@playwright/test'

import { takeTurn, waitForTurnTerminal } from '../flows/turn'
import { currentBranchId, queryApp, tailMetadata } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm, type MockRequest } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setPiggybackMode,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// The per-turn writer creates the place a scene moves to and the item someone receives, in the
// turn's own action group (docs/memory/piggyback.md → New locations and items). What only a
// running app shows: the creates land in the delta log after the reply's own create, so a
// regenerate, which reverses from that create onward, takes them with it.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const HOLLOW = 'Veil’s Hollow'
const MARKET = 'The Drowned Market'
const STALLS = 'The Drowned Market Stalls'
const COMPASS = 'E2E brass compass'
const LANTERN = 'E2E tin lantern'

// Placeholders are allocated in the order the context's `entities` walk meets rows, and an
// update never reorders the store (lib/stores/factory/working-set-store.ts), so one read off a
// turn's prompt names the same row in the next turn's prompt while no entity is added between.
const HOLLOW_REF = /\[(l\d+)\] Veil’s Hollow/
// A memory block or the fallback roster brackets the id before the name; the narrative's scene
// list brackets it after.
// The negative lookbehind skips the state-emission example ("[c1] Kael"), which JSON.stringify
// leaves preceded by a quote.
const KAEL_REF = /(?<!")\[(c\d+)\] Kael\b|## Kael \[(c\d+)\]/

type Placeholders = { kael: string; hollow: string }

type EntityView = {
  id: string
  kind: string
  parent: string | null
  flag: number
  partner: string | null
  reason: string | null
}

const promptOf = (request: MockRequest): string => JSON.stringify(request.body)

function placeholderIn(prompt: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(prompt)
  const placeholder = match?.slice(1).find((group) => group !== undefined)
  if (placeholder === undefined) throw new Error(`${what} has no placeholder in the prompt`)
  return placeholder
}

function placeholdersIn(prompt: string): Placeholders {
  return {
    kael: placeholderIn(prompt, KAEL_REF, 'Kael'),
    hollow: placeholderIn(prompt, HOLLOW_REF, HOLLOW),
  }
}

async function entitiesNamed(page: Page, branchId: string, name: string): Promise<EntityView[]> {
  const rows = await queryApp(
    page,
    `SELECT id, kind, json_extract(state, '$.parent_location_id'), name_collision_flag,
            name_collision_partner_id, name_collision_reason
       FROM entities WHERE branch_id = ? AND name = ? ORDER BY created_at, id`,
    [branchId, name],
  )
  return rows.map(([id, kind, parent, flag, partner, reason]) => ({
    id: id as string,
    kind: kind as string,
    parent: (parent as string | null) ?? null,
    flag: Number(flag),
    partner: (partner as string | null) ?? null,
    reason: (reason as string | null) ?? null,
  }))
}

async function idOf(page: Page, branchId: string, name: string): Promise<string> {
  const rows = await entitiesNamed(page, branchId, name)
  expect(rows, `one ${name} on the branch`).toHaveLength(1)
  return rows[0].id
}

async function characterState(
  page: Page,
  branchId: string,
  characterId: string,
): Promise<{ inventory: string[]; locationId: string | null }> {
  const rows = await queryApp(
    page,
    `SELECT json_extract(state, '$.inventory'), json_extract(state, '$.current_location_id')
       FROM entities WHERE branch_id = ? AND id = ?`,
    [branchId, characterId],
  )
  const [inventory, locationId] = rows[0] ?? []
  return {
    inventory: typeof inventory === 'string' ? (JSON.parse(inventory) as string[]) : [],
    locationId: (locationId as string | null | undefined) ?? null,
  }
}

async function tailReply(
  page: Page,
  branchId: string,
): Promise<{ id: string; content: string } | undefined> {
  const rows = await queryApp(
    page,
    `SELECT id, content FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'
     ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  const row = rows[0]
  return row ? { id: row[0] as string, content: row[1] as string } : undefined
}

const inertNarrative = (marker: string) => `${marker} The rain keeps its own counsel.
<state>
  <scene_entities></scene_entities>
  <world_time_delta>0</world_time_delta>
</state>`

// A partial name of The Drowned Market under the same parent: created, flagged same-parent.
function creatingNarrative(ids: Placeholders): string {
  return `E2E-CREATES-T2 Behind the market a lane of patched awnings opens, and a stallholder presses a brass compass into Kael's palm.
<state>
  <scene_entities>${ids.kael}</scene_entities>
  <new_location handle="new:stalls" parent="${ids.hollow}" name="${STALLS}">a lane of patched awnings behind the market</new_location>
  <current_location>new:stalls</current_location>
  <world_time_delta>60</world_time_delta>
  <new_item handle="new:compass" name="${COMPASS}">a brass compass whose needle swings toward the Veil</new_item>
  <transfers>
    <item id="new:compass" to="${ids.kael}" slot="inventory" />
  </transfers>
</state>`
}

// The market's exact name under its own parent: reused, not created.
const fallbackCreates = ({ kael, hollow }: Placeholders) => ({
  sceneEntities: [kael],
  currentLocation: 'new:market',
  worldTimeDelta: 0,
  newLocations: [
    { handle: 'new:market', name: MARKET, description: 'stalls under canvas', parent: hollow },
  ],
  newItems: [{ handle: 'new:lantern', name: LANTERN, description: 'a dented tin lantern' }],
  transfers: { items: [{ id: 'new:lantern', slot: 'inventory', to: kael }], stackables: [] },
})

test.describe('turn creates — the tagged block', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn needs an installed embedder. Cold cache
    // downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(inertNarrative('E2E-CREATES-T1'))
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a turn creates a nested place and a held item, and regenerating it removes both', async () => {
    test.setTimeout(150_000)
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(app.window, HERO_STORY)
    const hollowId = await idOf(app.window, branchId, HOLLOW)
    const marketId = await idOf(app.window, branchId, MARKET)
    const kaelId = await idOf(app.window, branchId, 'Kael')

    let ids: Placeholders = { kael: '', hollow: '' }
    await test.step('an inert turn shows the placeholders on the map', async () => {
      await takeTurn(app.window, 'E2E-CREATES-U1 I wait under the awnings.', 'E2E-CREATES-T1')
      const narrative = mock.requests.findLast((r) => r.streamed)
      expect(narrative, 'a narrative call was made').toBeDefined()
      const prompt = promptOf(narrative!)
      expect(prompt).toContain('# Places')
      ids = placeholdersIn(prompt)
    })

    let stallsId = ''
    let compassId = ''
    let kaelBefore: Awaited<ReturnType<typeof characterState>> | undefined
    await test.step('the next turn creates the stalls and gives Kael the compass', async () => {
      kaelBefore = await characterState(app.window, branchId, kaelId)
      mock.setNarrative(creatingNarrative(ids))
      await takeTurn(app.window, 'E2E-CREATES-U2 I follow the stallholder.', 'E2E-CREATES-T2')

      await expect
        .poll(() => entitiesNamed(app.window, branchId, STALLS), { timeout: 15_000 })
        .toEqual([
          {
            id: expect.any(String),
            kind: 'location',
            parent: hollowId,
            flag: 1,
            partner: marketId,
            reason: 'same-parent',
          },
        ])
      stallsId = await idOf(app.window, branchId, STALLS)
      const compass = await entitiesNamed(app.window, branchId, COMPASS)
      expect(compass).toEqual([expect.objectContaining({ kind: 'item', flag: 0 })])
      compassId = compass[0].id

      const kael = await characterState(app.window, branchId, kaelId)
      expect(kael.inventory).toContain(compassId)
      expect(kael.locationId).toBe(stallsId)

      const metadata = await tailMetadata(app.window, branchId)
      expect(metadata?.currentLocationId).toBe(stallsId)
      expect(metadata?.stateReport?.newLocations).toEqual([
        expect.objectContaining({
          handle: 'new:stalls',
          outcome: 'created',
          id: stallsId,
          parent: hollowId,
        }),
      ])
      expect(metadata?.stateReport?.newItems).toEqual([
        expect.objectContaining({ handle: 'new:compass', outcome: 'created', id: compassId }),
      ])
    })

    await test.step('regenerating that reply removes both rows and every write naming them', async () => {
      const reply = await tailReply(app.window, branchId)
      expect(reply?.content).toContain('E2E-CREATES-T2')
      mock.setNarrative(inertNarrative('E2E-CREATES-T3'))
      await reader.regenEntry(app.window, reply!.id).click()
      // The new take committing is the barrier the absence checks below rely on.
      await expect
        .poll(async () => (await tailReply(app.window, branchId))?.content ?? '', {
          timeout: 30_000,
        })
        .toContain('E2E-CREATES-T3')
      await waitForTurnTerminal(app.window)

      expect(await entitiesNamed(app.window, branchId, STALLS)).toEqual([])
      expect(await entitiesNamed(app.window, branchId, COMPASS)).toEqual([])
      const kael = await characterState(app.window, branchId, kaelId)
      expect(kael).toEqual(kaelBefore)
    })
  })
})

test.describe('turn creates — the fallback classifier', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-CREATES-F1 The rain keeps its own counsel.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    // Piggyback off: every turn's state comes from the fallback classifier.
    setPiggybackMode(seeded.dbPath, HERO_STORY, 'off')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('the fallback creates an item and reuses an exact sibling place', async () => {
    test.setTimeout(120_000)
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(app.window, HERO_STORY)
    const marketId = await idOf(app.window, branchId, MARKET)
    const kaelId = await idOf(app.window, branchId, 'Kael')

    let ids: Placeholders = { kael: '', hollow: '' }
    await test.step('an inert turn shows the placeholders to the fallback', async () => {
      await takeTurn(app.window, 'E2E-CREATES-FU1 I wait by the stalls.', 'E2E-CREATES-F1')
      const fallback = mock.requests.findLast(
        (r) => !r.streamed && r.agent?.startsWith('per-turn-classifier') === true,
      )
      expect(fallback, 'the fallback classifier was called').toBeDefined()
      const prompt = promptOf(fallback!)
      expect(prompt).toContain('# Places')
      ids = placeholdersIn(prompt)
    })

    await test.step('the next turn creates the lantern and reuses the market', async () => {
      const reply = fallbackCreates(ids)
      // The seed asks for chips, so the call matches the suggestions shape; both are set so the
      // spec doesn't depend on which one a given turn takes.
      mock.setStructured('per-turn-classifier', reply)
      mock.setStructured('per-turn-classifier-suggestions', { ...reply, suggestions: [] })
      mock.setNarrative('E2E-CREATES-F2 A stallholder hands Kael a dented lantern.')
      await takeTurn(app.window, 'E2E-CREATES-FU2 I take the lantern.', 'E2E-CREATES-F2')

      await expect
        .poll(async () => (await tailMetadata(app.window, branchId))?.stateReport?.newItems, {
          timeout: 15_000,
        })
        .toEqual([expect.objectContaining({ handle: 'new:lantern', outcome: 'created' })])

      const lanternId = await idOf(app.window, branchId, LANTERN)
      expect(await entitiesNamed(app.window, branchId, MARKET), 'no second market').toHaveLength(1)
      const kael = await characterState(app.window, branchId, kaelId)
      expect(kael.inventory).toContain(lanternId)
      expect(kael.locationId).toBe(marketId)

      const metadata = await tailMetadata(app.window, branchId)
      expect(metadata?.stateReport?.layer).toBe('per_turn_classifier')
      expect(metadata?.currentLocationId).toBe(marketId)
      expect(metadata?.stateReport?.newLocations).toEqual([
        expect.objectContaining({ handle: 'new:market', outcome: 'reused', id: marketId }),
      ])
      expect(metadata?.stateReport?.newItems).toEqual([
        expect.objectContaining({ handle: 'new:lantern', outcome: 'created', id: lanternId }),
      ])
    })
  })
})
