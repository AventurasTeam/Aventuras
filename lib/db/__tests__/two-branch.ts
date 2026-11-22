import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { eq, getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from 'drizzle-orm/sqlite-core'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { registerAllDomains } from '@/lib/actions/delta/registrations'
import { reverseCloseForRerun } from '@/lib/actions/delta/rerun-journal'
import { writeSystemEntry } from '@/lib/actions/story-entries/system-entry'
import type { PipelineAction } from '@/lib/actions/types'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import {
  assets,
  branches,
  dbSchema,
  pipelineRuns,
  stories,
  storyEntries,
  type CharacterState,
  type DbCtx,
  type NewEntity,
} from '@/lib/db'
import { captureInput } from '@/lib/probe/__tests__/fixtures'
import { writeProbeCapture } from '@/lib/probe/writer'

import type { createTestDb } from './test-db'

export type TestDb = Awaited<ReturnType<typeof createTestDb>>
export type BranchTable = SQLiteTable & { branchId: SQLiteColumn }

/** Every dbSchema table with a branchId column except pipeline_runs, whose run_id key is global. */
export const CLONED_TABLES: readonly BranchTable[] = (
  Object.values(dbSchema) as SQLiteTable[]
).filter(
  (table): table is BranchTable => table !== pipelineRuns && 'branchId' in getTableColumns(table),
)

const quoted = (name: string): string => `"${name}"`

function columnNames(table: SQLiteTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name)
}

function primaryKeyNames(table: SQLiteTable): string[] {
  const { primaryKeys, columns } = getTableConfig(table)
  const key = primaryKeys[0]?.columns ?? columns.filter((column) => column.primary)
  if (key.length === 0) throw new Error(`two-branch: ${getTableName(table)} has no primary key`)
  return key.map((column) => column.name)
}

function insertBranchRow(sqlite: DatabaseSync, from: string, to: string): void {
  const names = columnNames(branches)
  const params: SQLInputValue[] = []
  const select = names.map((name) => {
    if (name === 'id' || name === 'name') {
      params.push(to)
      return '?'
    }
    if (name === 'parent_branch_id') return '"id"'
    if (name === 'fork_entry_id') return 'NULL'
    return quoted(name)
  })
  sqlite
    .prepare(
      `INSERT INTO "branches" (${names.map(quoted).join(', ')}) SELECT ${select.join(', ')}
       FROM "branches" WHERE "id" = ? AND NOT EXISTS (SELECT 1 FROM "branches" WHERE "id" = ?)`,
    )
    .run(...params, from, to)
}

function copyRows(sqlite: DatabaseSync, table: BranchTable, from: string, to: string): void {
  const name = quoted(getTableName(table))
  const branchColumn = table.branchId.name
  const columns = columnNames(table)
  const select = columns.map((column) => (column === branchColumn ? '?' : quoted(column)))
  sqlite
    .prepare(
      `INSERT INTO ${name} (${columns.map(quoted).join(', ')}) SELECT ${select.join(', ')}
       FROM ${name} WHERE ${quoted(branchColumn)} = ?`,
    )
    .run(to, from)
}

/**
 * Copies `from`'s rows onto `to` as a branch copy does: `branch_id` flipped, every other column,
 * JSON text included, as stored, so a copied payload still names `from`. Inserts `to`'s branches
 * row when absent; copies no pipeline_runs row and no vector.
 */
export function cloneBranch(sqlite: DatabaseSync, from: string, to: string): void {
  if (sqlite.prepare('SELECT 1 FROM "branches" WHERE "id" = ?').get(from) === undefined)
    throw new Error(`cloneBranch: no branch ${from}`)
  sqlite.exec('BEGIN')
  try {
    insertBranchRow(sqlite, from, to)
    for (const table of CLONED_TABLES) copyRows(sqlite, table, from, to)
    sqlite.exec('COMMIT')
  } catch (e) {
    sqlite.exec('ROLLBACK')
    throw e
  }
}

/** SQL table name → that branch's rows, ordered by primary key. */
export type BranchSnapshot = Record<string, Record<string, unknown>[]>

/** Rows as stored: SQL column names, JSON as its text, blobs as bytes. */
export function branchSnapshot(sqlite: DatabaseSync, branchId: string): BranchSnapshot {
  const snapshot: BranchSnapshot = {}
  for (const table of CLONED_TABLES) {
    const name = getTableName(table)
    const order = primaryKeyNames(table).map(quoted).join(', ')
    snapshot[name] = sqlite
      .prepare(
        `SELECT * FROM ${quoted(name)} WHERE ${quoted(table.branchId.name)} = ? ORDER BY ${order}`,
      )
      .all(branchId) as Record<string, unknown>[]
  }
  return snapshot
}

export type CopyFixture = {
  storyId: 's_two'
  branchId: 'br_a'
  /** The character whose delete captured a relationship and an awareness row. */
  deletedCharacterId: string
  deleteActionId: string
  systemEntryId: string
  probeCaptureIds: readonly [string, string]
  journalActionId: string
  runId: string
}

const STORY_ID = 's_two'
const BRANCH_ID = 'br_a'
const AT = 1_767_225_600_000
const OPENING_ID = 'ent_two_open'
const USER_ENTRY_ID = 'ent_two_wade'
const REPLY_ID = 'ent_two_reply'
const ROOK_ID = 'char_two_rook'
const MIRA_ID = 'char_two_mira'
const TAMSIN_ID = 'char_two_tamsin'
const HAPPENING_ID = 'hap_two_ford'
const CHAPTER_ID = 'chap_two'
const ASSET_ID = 'asset_two_map'
const DELETE_ACTION_ID = 'act_two_delete'
const RERUN_ACTION_ID = 'act_two_rerun'
const RUN_ID = 'run_two_rerun'
const CAPTURE_IDS = ['pc_two_1', 'pc_two_2'] as const

const MIRA_STATE: CharacterState = {
  visual: { attire: "a drover's oilskin" },
  traits: ['patient'],
  drives: [],
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const metadata = (worldTime: number) => ({ sceneEntities: [], currentLocationId: null, worldTime })

const character = (id: string, name: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: BRANCH_ID,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: AT + 3,
  updatedAt: AT + 3,
  ...over,
})

/**
 * Story `s_two`, branch `br_a`: a row in every cloned table, a turn, a pass's world, a user's
 * edits, a close, a character delete whose payload captured one relationship and one awareness
 * row, then a finished re-run of that close whose journal stands and whose group heads the log,
 * two captures, and a trailing system entry. No vectors.
 */
export async function seedCopyFixture(t: TestDb): Promise<CopyFixture> {
  registerAllDomains()
  const ctx: DbCtx = { db: t.db, runInTransaction: t.runInTransaction }
  const land = async (
    actionId: string,
    entryId: string | null,
    actions: readonly PipelineAction[],
  ): Promise<void> => {
    for (const action of actions) {
      const result = await applyDeltaAction({ action, actionId, branchId: BRANCH_ID, entryId }, ctx)
      if (result.status !== 'ok')
        throw new Error(`seedCopyFixture: ${actionId} refused ${action.kind}: ${result.reason}`)
    }
  }

  await t.db
    .insert(stories)
    .values({ id: STORY_ID, title: 'The Ford', createdAt: AT, updatedAt: AT })
  await t.db
    .insert(branches)
    .values({ id: BRANCH_ID, storyId: STORY_ID, name: 'main', createdAt: AT })
  await t.db
    .insert(assets)
    .values({ id: ASSET_ID, kind: 'image', filePath: `assets/${ASSET_ID}.png`, createdAt: AT })
  // Story creation writes the opening and logs no delta for it.
  await t.db.insert(storyEntries).values({
    id: OPENING_ID,
    branchId: BRANCH_ID,
    position: 1,
    kind: 'opening',
    content: 'The river ran high the week Mira reached the ford.',
    metadata: metadata(0),
    createdAt: AT,
  })

  await land('act_two_turn', USER_ENTRY_ID, [
    {
      kind: 'createStoryEntry',
      source: 'user_edit',
      payload: {
        entry: {
          id: USER_ENTRY_ID,
          branchId: BRANCH_ID,
          position: 2,
          kind: 'user_action',
          content: 'I wade in after Rook.',
          metadata: metadata(1),
          createdAt: AT + 1,
        },
      },
    },
  ])
  await land('act_two_turn', REPLY_ID, [
    {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id: REPLY_ID,
          branchId: BRANCH_ID,
          position: 3,
          kind: 'ai_reply',
          content: 'The ford gives way under Rook, and Tamsin hauls him out by the collar.',
          metadata: metadata(1),
          createdAt: AT + 2,
        },
      },
    },
  ])

  await land('act_two_pass', REPLY_ID, [
    {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character(ROOK_ID, 'Rook') },
    },
    {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: {
        entry: character(MIRA_ID, 'Mira', {
          description: 'A drover who knows the ford.',
          keywords: ['the drover'],
          state: MIRA_STATE,
        }),
      },
    },
    {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character(TAMSIN_ID, 'Tamsin') },
    },
    {
      kind: 'createLore',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: 'lore_two_ford',
          branchId: BRANCH_ID,
          title: 'The Harrow ford',
          body: 'Shallow in summer, a drowning in spring.',
          keywords: ['ford'],
          injectionMode: 'auto',
          createdAt: AT + 3,
          updatedAt: AT + 3,
        },
      },
    },
    {
      kind: 'createThread',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: 'thr_two_crossing',
          branchId: BRANCH_ID,
          title: 'Get the herd across',
          description: 'Mira must move the herd before the river rises again.',
          status: 'active',
          injectionMode: 'auto',
          createdAt: AT + 3,
          updatedAt: AT + 3,
        },
      },
    },
    {
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: HAPPENING_ID,
          branchId: BRANCH_ID,
          title: 'The ford gives way',
          description: 'Rook goes under at the ford and Tamsin pulls him out.',
          createdAt: AT + 3,
          updatedAt: AT + 3,
        },
      },
    },
    {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: 'hinv_two_mira',
          branchId: BRANCH_ID,
          happeningId: HAPPENING_ID,
          entityId: MIRA_ID,
          role: 'witness',
        },
      },
    },
    {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH_ID,
        happeningId: HAPPENING_ID,
        characterId: ROOK_ID,
        proseEntryId: null,
      },
    },
    {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH_ID,
        happeningId: HAPPENING_ID,
        characterId: MIRA_ID,
        proseEntryId: null,
      },
    },
    {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH_ID,
        subjectId: ROOK_ID,
        objectId: MIRA_ID,
        kind: 'owes a debt',
        proseEntryId: null,
      },
    },
    {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: BRANCH_ID,
        subjectId: MIRA_ID,
        objectId: TAMSIN_ID,
        kind: 'sister',
        proseEntryId: null,
      },
    },
  ])

  await land('act_two_user', null, [
    {
      kind: 'createBranchEraFlip',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'era_two_thaw',
          branchId: BRANCH_ID,
          atWorldtime: 1,
          eraName: 'The Long Thaw',
          createdAt: AT + 4,
        },
      },
    },
    {
      kind: 'createTranslation',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'tr_two_ford',
          branchId: BRANCH_ID,
          targetKind: 'lore',
          targetId: 'lore_two_ford',
          field: 'title',
          language: 'es',
          translatedText: 'El vado de Harrow',
          createdAt: AT + 4,
          updatedAt: AT + 4,
        },
      },
    },
    {
      kind: 'createEntryAsset',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'ea_two_map',
          branchId: BRANCH_ID,
          entryId: REPLY_ID,
          assetId: ASSET_ID,
          role: 'illustration',
          position: 0,
        },
      },
    },
  ])

  await land('act_two_close', REPLY_ID, [
    {
      kind: 'createChapter',
      source: 'chapter_close',
      payload: {
        entry: {
          id: CHAPTER_ID,
          branchId: BRANCH_ID,
          sequenceNumber: 1,
          title: 'The Ford',
          summary: 'Rook goes under at the ford, and Tamsin pulls him out.',
          theme: 'debts paid in water',
          keywords: ['ford', 'rook'],
          startEntryId: OPENING_ID,
          endEntryId: REPLY_ID,
          tokenCount: 64,
          closedAt: AT + 5,
          createdAt: AT + 5,
          updatedAt: AT + 5,
        },
      },
    },
    {
      kind: 'createLore',
      source: 'chapter_close',
      payload: {
        entry: {
          id: 'lore_two_debt',
          branchId: BRANCH_ID,
          title: "Rook's debt",
          body: 'Rook owes Mira his life.',
          injectionMode: 'auto',
          createdAt: AT + 5,
          updatedAt: AT + 5,
        },
      },
    },
  ])

  await land(DELETE_ACTION_ID, null, [
    { kind: 'deleteEntity', source: 'user_edit', payload: { branchId: BRANCH_ID, id: ROOK_ID } },
  ])

  // A finished re-run of the close: its journal stands for a CTRL-Z, as it does after any re-run.
  await t.db.insert(pipelineRuns).values({
    runId: RUN_ID,
    kind: CHAPTER_CLOSE_KIND,
    actionId: RERUN_ACTION_ID,
    storyId: STORY_ID,
    branchId: BRANCH_ID,
    startedAt: AT + 6,
  })
  await reverseCloseForRerun(
    { branchId: BRANCH_ID, chapterId: CHAPTER_ID, actionId: RERUN_ACTION_ID },
    ctx,
  )
  await land(RERUN_ACTION_ID, REPLY_ID, [
    {
      kind: 'createLore',
      source: 'chapter_close',
      payload: {
        entry: {
          id: 'lore_two_oath',
          branchId: BRANCH_ID,
          title: "Mira's oath",
          body: 'Mira swore to see the herd across.',
          injectionMode: 'auto',
          createdAt: AT + 7,
          updatedAt: AT + 7,
        },
      },
    },
    {
      kind: 'updateChapter',
      source: 'chapter_close',
      payload: {
        branchId: BRANCH_ID,
        id: CHAPTER_ID,
        patch: {
          closeReport: {
            version: 1,
            actionId: RERUN_ACTION_ID,
            calls: [],
            stopped: [],
            noToolCalls: true,
          },
        },
      },
    },
  ])
  await t.db
    .update(pipelineRuns)
    .set({ finishedAt: AT + 8, outcome: 'completed' })
    .where(eq(pipelineRuns.runId, RUN_ID))

  for (const [i, id] of CAPTURE_IDS.entries()) {
    const written = await writeProbeCapture(
      { runInTransaction: t.runInTransaction },
      captureInput({ id, branchId: BRANCH_ID, targetEntryId: REPLY_ID, capturedAt: AT + 9 + i }),
    )
    if (written !== 'written') throw new Error(`seedCopyFixture: capture ${id} ${written}`)
  }
  const systemEntryId = await writeSystemEntry(
    { branchId: BRANCH_ID, content: 'The reply stopped short. Retry to continue.' },
    ctx,
  )

  return {
    storyId: STORY_ID,
    branchId: BRANCH_ID,
    deletedCharacterId: ROOK_ID,
    deleteActionId: DELETE_ACTION_ID,
    systemEntryId,
    probeCaptureIds: CAPTURE_IDS,
    journalActionId: RERUN_ACTION_ID,
    runId: RUN_ID,
  }
}
