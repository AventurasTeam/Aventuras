import { expect, test } from '@playwright/test'

import { addCastRow } from '../flows/wizard-cast'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

// The slice's headline evidence: five cast rows spanning all four kinds,
// mixing active and staged status, committed through the real wizard Finish
// path. Drives entirely through the UI; asserts entirely against the DB
// (docs/testing.md → Selector strategy, Tier 1).
//
// What the assertions below actually prove: every committed row — active and
// staged alike — lands with the right kind/status, ends up embedded, and is
// left clean (embedding_stale = 0); and the committed lead resolves to the
// active character, never the staged one. They do NOT prove the embed call is
// batched rather than per-row — embedRowsToVecOps (lib/embedder/service.ts)
// emits the same per-row upsert + stale-clear ops either way, so a DB read
// can't tell the two apart. Contract C5's real coverage is
// create-story.test.ts's "embeds the whole cast and lore in one batched
// call, not one per row". Also uncovered here: the opening's sceneEntities
// filter (this spec types the opening by hand, so it's always empty — see
// finish.test.ts) and each kind's per-kind `state` shape (untouched despite
// "all four kinds").
test.describe('create-story wizard — mixed cast', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  const STORY = {
    title: 'The Nine Wells Accord',
    opening: 'Rain filled the wells before anyone remembered filling them.',
  }
  const LEAD = { kind: 'character', name: 'Kestrel Vane' } as const
  const LOCATION = { kind: 'location', name: 'The Sable Archive' } as const
  const ITEM = { kind: 'item', name: 'Brass Chronometer' } as const
  const FACTION = { kind: 'faction', name: 'The Quiet League' } as const
  const STAGED_CHARACTER = { kind: 'character', name: 'Mira Fenwick' } as const

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ;({ userDataDir } = createSeededUserDataDir())
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('commits a five-row mixed cast with an active lead and a staged character', async () => {
    await home.newStory(app.window).click()
    await expect(wizard.modeOption(app.window, 'adventure')).toBeVisible({ timeout: 15_000 })

    // Step 1 — adventure mode surfaces the lead-required notice.
    await wizard.modeOption(app.window, 'adventure').click()
    await wizard.next(app.window).click()
    // Step 2 — calendar defaults are valid.
    await wizard.next(app.window).click()
    // Step 3 — World, passed through empty; this spec's payload is Cast.
    await wizard.next(app.window).click()

    // Step 4 — Cast. Five rows across all four kinds: a lead character, a
    // location, an item, a faction, and a second character left staged.
    const leadId = await addCastRow(app.window, LEAD.kind)
    await wizard.castName(app.window, leadId).fill(LEAD.name)
    await wizard.setAsLead(app.window, leadId).click()

    const locationId = await addCastRow(app.window, LOCATION.kind)
    await wizard.castName(app.window, locationId).fill(LOCATION.name)

    const itemId = await addCastRow(app.window, ITEM.kind)
    await wizard.castName(app.window, itemId).fill(ITEM.name)

    const factionId = await addCastRow(app.window, FACTION.kind)
    await wizard.castName(app.window, factionId).fill(FACTION.name)

    const stagedId = await addCastRow(app.window, STAGED_CHARACTER.kind)
    await wizard.castName(app.window, stagedId).fill(STAGED_CHARACTER.name)
    await wizard.castStatusOption(app.window, stagedId, 'staged').click()

    await wizard.next(app.window).click()

    // Step 5 — opening + title are the remaining Finish requirements.
    await expect(wizard.opening(app.window)).toBeVisible()
    await wizard.opening(app.window).fill(STORY.opening)
    await wizard.title(app.window).fill(STORY.title)
    await wizard.finish(app.window).click()

    await app.window.waitForURL(/\/reader-composer\//, { timeout: 30_000 })

    const storyRows = await queryApp(
      app.window,
      `SELECT current_branch_id, status FROM stories WHERE title = ?`,
      [STORY.title],
    )
    expect(storyRows.length, 'exactly one story with the title').toBe(1)
    const [branchId, storyStatus] = storyRows[0] as [string, string]
    expect(storyStatus, 'story committed active').toBe('active')

    // The two-character trap this spec sets up (one active, one staged) is
    // pointless unless something reads which one actually became the lead.
    // createStoryWithBranch's guard only requires leadEntityId to match SOME
    // cast character — the staged one qualifies — so a wrong-lead commit
    // (activeLead exists precisely to forbid this) would pass every check
    // above and still slip through unnoticed without this assertion.
    const definitionRows = await queryApp(
      app.window,
      `SELECT json_extract(definition, '$.leadEntityId') FROM stories WHERE title = ?`,
      [STORY.title],
    )
    expect(
      (definitionRows[0] as [string])[0],
      'committed definition.leadEntityId points at the active lead, not the staged character',
    ).toBe(leadId)

    const expected = [
      { ...LEAD, status: 'active' },
      { ...LOCATION, status: 'active' },
      { ...ITEM, status: 'active' },
      { ...FACTION, status: 'active' },
      { ...STAGED_CHARACTER, status: 'staged' },
    ]

    // All five rows landed on the branch with the right kind/status/name —
    // a dropped or misclassified row (e.g. a staged row silently filtered
    // out of the commit batch) fails here.
    const entityRows = (await queryApp(
      app.window,
      `SELECT id, kind, name, status FROM entities WHERE branch_id = ?`,
      [branchId],
    )) as [string, string, string, string][]
    expect(entityRows.length, 'all five cast rows committed').toBe(5)
    for (const row of expected) {
      const match = entityRows.find(([, , name]) => name === row.name)
      expect(match, `entity row for ${row.name}`).toBeDefined()
      const [, kind, , status] = match ?? []
      expect(kind, `${row.name} kind`).toBe(row.kind)
      expect(status, `${row.name} status`).toBe(row.status)
    }

    // Branch-wide count alongside the per-id checks below: five entities and
    // five vec rows, so an orphan vec row can't slip past a per-id check that
    // only ever looks for a match, never counts the total.
    const vecCountRows = await queryApp(
      app.window,
      `SELECT count(*) FROM entities_vec_384 WHERE branch_id = ?`,
      [branchId],
    )
    expect((vecCountRows[0] as [number])[0], 'exactly five embedded rows on the branch').toBe(5)

    // Every committed row — active and staged alike — got a real embedding;
    // no per-status path drops a row.
    for (const [id] of entityRows) {
      const vecRows = await queryApp(
        app.window,
        `SELECT count(*) FROM entities_vec_384 WHERE id = ? AND branch_id = ?`,
        [id, branchId],
      )
      expect((vecRows[0] as [number])[0], `entity ${id} has a stored embedding`).toBe(1)
    }

    // No committed row is left dirty. entities insert with embeddingStale: 1,
    // and the embed splice clears it per row (create-story.ts) — a row the
    // splice missed (e.g. filtered out by status) would leave this nonzero.
    const staleRows = await queryApp(
      app.window,
      `SELECT count(*) FROM entities WHERE branch_id = ? AND embedding_stale = 1`,
      [branchId],
    )
    expect((staleRows[0] as [number])[0], 'no entity left with embedding_stale = 1').toBe(0)
  })
})
