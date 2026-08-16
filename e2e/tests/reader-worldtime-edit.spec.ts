import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Retime an entry from its world-time footer — the seam unit tests can't reach:
// the Popover form's recomputed seconds travel renderer → IPC → SQLite as one
// user_edit delta, and undo prunes it again. No LLM involved. See
// docs/testing.md → Coverage.

// Seed contract (lib/db/devtools/seed-dataset.ts → heroEntries): the hero branch
// holds 72 entries at `worldTime = (position - 1) * 3` seconds; position 1 is the
// opening, every 12th is a `system` row, and the rest alternate user_action (even)
// / ai_reply (odd). So the last ai_reply sits at position 71 — 72 is a system row,
// which renders no footer — and the decoration walk's predecessor for it is
// position 70, the last editable-kind row before it.
const TARGET_ID = 'entry_hero_0071'
const PREVIOUS_ID = 'entry_hero_0070'
const SEEDED_WORLD_TIME = 210 // (71 - 1) * 3
const PREVIOUS_WORLD_TIME = 207 // (70 - 1) * 3

// The seeded story's calendarSystemId (`cal_default`) is absent from
// lib/calendar's registry, so the reader resolves it through the earth-gregorian
// fallback: one second per base unit, tiers year/month/day/hour/minute/second,
// origin `{ year: 1247, day: 1 }` = 1247-01-01 00:00:00. 210 s past that origin
// is 00:03:30, so rewriting the minute tier 3 → 1 leaves 1*60 + 30 seconds —
// below the predecessor's 207 (the indicator fires) and above 0 (not a
// flashback, which is never flagged).
const SEEDED_MINUTE = '3'
const SEEDED_SECOND = '30'
const EDITED_MINUTE = '1'
const EDITED_WORLD_TIME = 90

test.describe('reader — edit an entry world time', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  async function worldTimeOf(entryId: string): Promise<number> {
    const rows = await queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.worldTime') FROM story_entries WHERE id = ?`,
      [entryId],
    )
    // The seeded ids above are the one constant the preconditions below can't
    // check by value; without this a renamed id scheme (or an N_HERO under 71)
    // surfaces as an anonymous `undefined[0]` TypeError from in here.
    if (rows.length === 0)
      throw new Error(`worldTimeOf: no story_entries row for ${entryId} — seed drift?`)
    return rows[0][0] as number
  }

  // The edit's own delta shape (lib/actions/story-entries/world-time.ts): one
  // op=update row, source user_edit, anchored on the edited entry. Filtering on
  // source keeps a background classifier pass — which anchors ai_classifier rows
  // on the same entry — out of the count.
  // Keep the entry_id predicate: it is the only assertion anywhere that pins the
  // survival anchor, so a regression to a null anchor fails the count below.
  async function editDeltaCount(entryId: string): Promise<number> {
    const rows = await queryApp(
      app.window,
      `SELECT count(*) FROM deltas WHERE entry_id = ? AND op = 'update' AND source = 'user_edit'`,
      [entryId],
    )
    return rows[0][0] as number
  }

  test('footer edit writes one delta and flags the break; undo reverses both', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // Pin the fixture the expectations above are derived from: a drifted seed
    // must fail here rather than silently re-derive them.
    expect(await worldTimeOf(TARGET_ID)).toBe(SEEDED_WORLD_TIME)
    expect(await worldTimeOf(PREVIOUS_ID)).toBe(PREVIOUS_WORLD_TIME)
    expect(await editDeltaCount(TARGET_ID)).toBe(0)

    await reader.row(app.window, TARGET_ID).scrollIntoViewIfNeeded()

    // A no-change save writes nothing — guarded twice (tuple equality in the
    // form, seconds equality in the action).
    await reader.worldTimeFooter(app.window, TARGET_ID).click()
    await expect(reader.worldTimeDialog(app.window)).toBeVisible()
    // The form really mounted on this entry's seeded time, so the Save below is
    // a genuine untouched save and not a click into an overlay that never opened.
    await expect(reader.worldTimeNumericField(app.window, 'Minute')).toHaveValue(SEEDED_MINUTE)
    await expect(reader.worldTimeNumericField(app.window, 'Second')).toHaveValue(SEEDED_SECOND)
    await expect(reader.worldTimeSave(app.window)).toBeEnabled()
    await reader.worldTimeSave(app.window).click()
    await expect(reader.worldTimeDialog(app.window)).toBeHidden()

    // Read straight away, so on its own this only catches a synchronous write.
    // The binding proof that the no-change save landed nothing is the exact
    // `toBe(1)` in the next phase.
    expect(await editDeltaCount(TARGET_ID)).toBe(0)
    expect(await worldTimeOf(TARGET_ID)).toBe(SEEDED_WORLD_TIME)

    // A real edit writes exactly one delta and moves the stored seconds.
    await reader.worldTimeFooter(app.window, TARGET_ID).click()
    await expect(reader.worldTimeDialog(app.window)).toBeVisible()
    await reader.worldTimeNumericField(app.window, 'Minute').fill(EDITED_MINUTE)
    await expect(reader.worldTimeNumericField(app.window, 'Minute')).toHaveValue(EDITED_MINUTE)
    await reader.worldTimeSave(app.window).click()
    // An inverted success signal would leave this open forever; without the
    // assertion that only surfaces later as an unexplained click timeout.
    await expect(reader.worldTimeDialog(app.window)).toBeHidden()

    await expect.poll(() => worldTimeOf(TARGET_ID), { timeout: 15_000 }).toBe(EDITED_WORLD_TIME)
    // Exactly one: a second row would mean the no-change save wrote after all.
    expect(await editDeltaCount(TARGET_ID)).toBe(1)
    await expect(reader.monotonicityIndicator(app.window, TARGET_ID)).toBeVisible()

    // Undo restores the seconds and prunes the delta with them.
    await reader.actionsTrigger(app.window).click()
    await reader.undoRow(app.window).click()
    await expect.poll(() => worldTimeOf(TARGET_ID), { timeout: 15_000 }).toBe(SEEDED_WORLD_TIME)
    expect(await editDeltaCount(TARGET_ID)).toBe(0)
    await expect(reader.monotonicityIndicator(app.window, TARGET_ID)).toHaveCount(0)
  })
})
