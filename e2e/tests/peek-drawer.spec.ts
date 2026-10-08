import { expect, test, type Page } from '@playwright/test'

import { currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { peek } from '../locators/peek'
import { plot } from '../locators/plot'
import { rail } from '../locators/rail'
import { reader } from '../locators/reader'
import { world } from '../locators/world'

// reader-composer.md → Peek drawer, at the seams only a running app reaches: the C5 write, the
// mounted reader re-deriving its lead, and the C6 routes into World and Plot. Per-kind bodies, the
// close paths and collapse-closes-peek are the peek stories' (docs/testing.md → Coverage).

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const SEEDED_LEAD = 'Kael'
const NEW_LEAD = 'Mira'
// Staged: its peek offers `Set as lead` disabled, and World files it under a collapsed tier.
const STAGED_CHARACTER = 'The Ashen Sage'
// Anchored to an entry in a closed chapter, so the rail files it under Earlier chapters.
const ANCHORED_HAPPENING = 'The alley ambush'
const REPLY_MARKER = 'E2E-PEEK-REPLY'

// Seeded ids under a substitutable prefix become `prefix_<uuid>` (docs/testing.md → Substitutable
// IDs must be real UUIDs), so every id the spec asserts is read by name or title.
async function entityId(page: Page, branchId: string, name: string): Promise<string> {
  const [[id]] = await queryApp(page, `SELECT id FROM entities WHERE branch_id = ? AND name = ?`, [
    branchId,
    name,
  ])
  return id as string
}

async function leadEntityId(page: Page): Promise<unknown> {
  const [[id]] = await queryApp(
    page,
    `SELECT json_extract(definition, '$.leadEntityId') FROM stories WHERE id = ?`,
    [HERO_STORY],
  )
  return id
}

async function countOf(page: Page, sql: string, params: unknown[]): Promise<number> {
  const [[n]] = await queryApp(page, sql, params)
  return Number(n)
}

// Serial suite, one app: each test starts on the reader the last returned to. That reader stays
// mounted under every World and Plot visit, so the last test's turn runs where the lead changed.
test.describe.serial('Peek drawer', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let branchId: string

  test.beforeAll(async () => {
    // A turn needs the mock LLM and an installed embedder; the model copy dominates.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(`${REPLY_MARKER} the rain answers.`)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a rail row opens the peek on that row, offering Set as lead', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    branchId = await currentBranchId(page, HERO_STORY)

    await rail.row(page, NEW_LEAD).click()
    await expect(peek.drawer(page, NEW_LEAD)).toBeVisible()
    await expect(peek.setLead(page, NEW_LEAD)).toBeVisible()
    await expect(peek.leadTag(page, NEW_LEAD)).toHaveCount(0)
  })

  test('Set as lead writes the lead in one press, and the rail badge moves', async () => {
    const page = app.window
    const mira = await entityId(page, branchId, NEW_LEAD)
    expect(await leadEntityId(page)).toBe(await entityId(page, branchId, SEEDED_LEAD))

    // One press and no confirm: a confirm would hold the write, and the drawer stays on the row.
    await peek.setLead(page, NEW_LEAD).click()
    await expect.poll(() => leadEntityId(page)).toBe(mira)
    await expect(peek.drawer(page, NEW_LEAD)).toBeVisible()
    await expect(peek.leadTag(page, NEW_LEAD)).toBeVisible()
    await expect(peek.setLead(page, NEW_LEAD)).toHaveCount(0)

    await peek.close(page, NEW_LEAD).click()
    await expect(peek.drawer(page, NEW_LEAD)).toHaveCount(0)
    await expect(rail.leadTag(page, NEW_LEAD)).toBeVisible()
    // The row first, or the zero count could pass with Kael's row never mounted.
    await expect(rail.row(page, SEEDED_LEAD)).toBeVisible()
    await expect(rail.leadTag(page, SEEDED_LEAD)).toHaveCount(0)
  })

  test("the Overview's visual line lands World on Identity, and back shows no peek", async () => {
    const page = app.window
    const mira = await entityId(page, branchId, NEW_LEAD)
    await rail.row(page, NEW_LEAD).click()
    await peek.region(page, NEW_LEAD, 'overview-visual').click()

    await page.waitForURL(new RegExp(`/world/${branchId}\\?kind=character&id=${mira}&tab=identity`))
    await expect(world.detailName(page)).toHaveText(NEW_LEAD)
    await expect(world.tab(page, 'identity')).toHaveAttribute('aria-selected', 'true')

    await chrome.back(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(rail.column(page)).toBeVisible()
    await expect(peek.drawer(page, NEW_LEAD)).toHaveCount(0)
  })

  test("a staged character's peek disables Set as lead, and Open in World panel reveals its row", async () => {
    const page = app.window
    const sage = await entityId(page, branchId, STAGED_CHARACTER)
    const staged = t('world:tiers.staged')
    // listCollapseStore is shared with World's list: the tier the reveal must open is shut going in.
    await expect(rail.tierHeader(page, staged)).toHaveAttribute('aria-expanded', 'false')

    await rail.entityChip(page, 'staged').click()
    await rail.row(page, STAGED_CHARACTER).click()
    await expect(
      peek.setLeadDisabled(page, STAGED_CHARACTER, t('world:detail.menu.setLeadInactive')),
    ).toBeVisible()
    await expect(peek.setLead(page, STAGED_CHARACTER)).toHaveCount(0)

    await peek.openInWorld(page, STAGED_CHARACTER).click()
    await page.waitForURL(new RegExp(`/world/${branchId}\\?kind=character&id=${sage}`))
    await expect(world.detailName(page)).toHaveText(STAGED_CHARACTER)
    await expect(world.tierHeader(page, staged)).toHaveAttribute('aria-expanded', 'true')
    await expect(world.row(page, STAGED_CHARACTER)).toHaveAttribute('aria-selected', 'true')
    await expect(world.row(page, STAGED_CHARACTER)).toBeInViewport()

    await chrome.back(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })

  test("a happening's peek shows its marker and counts, and Open in Plot panel lands it", async () => {
    const page = app.window
    const [[happeningId]] = await queryApp(
      page,
      `SELECT id FROM happenings WHERE branch_id = ? AND title = ?`,
      [branchId, ANCHORED_HAPPENING],
    )
    const [[position]] = await queryApp(
      page,
      `SELECT e.position FROM story_entries e JOIN happenings h
         ON e.branch_id = h.branch_id AND e.id = h.occurred_at_entry_id WHERE h.id = ?`,
      [happeningId],
    )
    const involved = await countOf(
      page,
      `SELECT count(*) FROM happening_involvements WHERE branch_id = ? AND happening_id = ?`,
      [branchId, happeningId],
    )
    const aware = await countOf(
      page,
      `SELECT count(*) FROM happening_awareness WHERE branch_id = ? AND happening_id = ?`,
      [branchId, happeningId],
    )
    // Zero would also match a peek that never read the link stores.
    expect(involved).toBeGreaterThan(0)
    expect(aware).toBeGreaterThan(0)

    await rail.categoryTrigger(page).click()
    await rail.categoryOption(page, 'happening').click()
    await rail.tierHeader(page, t('plot:buckets.earlier')).click()
    await rail.row(page, ANCHORED_HAPPENING).click()

    await expect(peek.region(page, ANCHORED_HAPPENING, 'happening-peek-body')).toContainText(
      t('common:entryRef', { n: Number(position) }),
    )
    // The counts line alone, so a description that happens to say "2 aware" can't satisfy it.
    const counts = peek.region(page, ANCHORED_HAPPENING, 'happening-peek-counts')
    await expect(counts).toContainText(t('reader:peek.involved', { count: involved }))
    await expect(counts).toContainText(t('reader:peek.aware', { count: aware }))

    await peek.openInPlot(page, ANCHORED_HAPPENING).click()
    await page.waitForURL(
      new RegExp(`/plot/${branchId}\\?kind=happening&id=${happeningId as string}`),
    )
    await expect(plot.subHeader(page)).toContainText(ANCHORED_HAPPENING)
    await expect(plot.row(page, ANCHORED_HAPPENING)).toHaveAttribute('aria-selected', 'true')

    await chrome.back(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })

  // The hero story wraps a Do turn in third person, so it names the lead as its subject.
  test('a Do turn in the reader that saw the change wraps with the new lead', async () => {
    const page = app.window
    await reader.modeTrigger(page).click()
    await reader.modeOption(page, 'do').click()
    await reader.composer(page).fill('draw the E2E-PEEK blade')
    await reader.send(page).click()

    await expect
      .poll(
        () =>
          countOf(
            page,
            `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' AND content LIKE ?`,
            [branchId, `%${REPLY_MARKER}%`],
          ),
        { timeout: 30_000 },
      )
      .toBe(1)
    const rows = await queryApp(
      page,
      `SELECT content FROM story_entries WHERE branch_id = ? AND kind = 'user_action' AND content LIKE '%E2E-PEEK blade%'`,
      [branchId],
    )
    expect(rows).toEqual([[`${NEW_LEAD} draws the E2E-PEEK blade.`]])
  })
})
