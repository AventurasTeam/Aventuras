import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'

import { STORY_SETTINGS_DEFAULTS } from '@/lib/db'
import type { QueryAll } from '@/lib/retrieval'

/**
 * The one synthetic branch every bench in this folder prices against, so
 * retrieval.md → Per-turn cost budget and probe.md → Capture cost quote the
 * same pool rather than two fixtures that merely sound alike.
 */
export const MODEL_ID = 'bench-model'
export const BRANCH = 'br_bench'

export type Scale = { label: string; happenings: number; awareness: number; chapters: number }

export const SCALES: Scale[] = [
  { label: '1200h / 3000aw', happenings: 1200, awareness: 3000, chapters: 20 },
  { label: '3600h / 9000aw', happenings: 3600, awareness: 9000, chapters: 40 },
  { label: '6000h / 15000aw', happenings: 6000, awareness: 15000, chapters: 60 },
]

/** The top of the projected range — the scale both cost docs quote. */
export const TOP_SCALE: Scale = SCALES[SCALES.length - 1]!

const ENTITIES = 120
const LORE = 80
const THREADS = 40
const ENTRIES_PER_CHAPTER = 30

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function unitVector(dim: number, rand: () => number): Float32Array {
  const v = new Float32Array(dim)
  let norm = 0
  for (let i = 0; i < dim; i += 1) {
    v[i] = rand() * 2 - 1
    norm += v[i]! * v[i]!
  }
  const inv = 1 / Math.sqrt(norm)
  for (let i = 0; i < dim; i += 1) v[i]! *= inv
  return v
}

// Independent random unit vectors are near-orthogonal in 384 dims, so every
// score lands under the 0.15 budget-fill floor and NOTHING is ever selected —
// a pass that measures pool assembly and then skips the work seating does.
// Topic centroids give the pool a realistic similarity spread instead.
const TOPICS = 12

export function topical(
  centroids: Float32Array[],
  topic: number,
  rand: () => number,
  mix: number,
): Float32Array {
  const base = centroids[topic % centroids.length]!
  const noise = unitVector(base.length, rand)
  const v = new Float32Array(base.length)
  let norm = 0
  for (let i = 0; i < base.length; i += 1) {
    v[i] = base[i]! * mix + noise[i]! * (1 - mix)
    norm += v[i]! * v[i]!
  }
  const inv = 1 / Math.sqrt(norm)
  for (let i = 0; i < base.length; i += 1) v[i]! *= inv
  return v
}

const WORDS =
  'gate keep hill smuggler market lantern rain ledger scar coin oath river tower ash bell rope salt'.split(
    ' ',
  )

export function prose(rand: () => number, words: number): string {
  const out: string[] = []
  for (let i = 0; i < words; i += 1) out.push(WORDS[Math.floor(rand() * WORDS.length)]!)
  return out.join(' ')
}

function migrateInto(sqlite: DatabaseSync): void {
  const dir = 'lib/db/migrations'
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim()
      if (trimmed !== '') sqlite.exec(trimmed)
    }
  }
}

export type Fixture = {
  sqlite: DatabaseSync
  sceneCharacterIds: string[]
  centroids: Float32Array[]
  entryIds: string[]
  dir: string
}

export function build(scale: Scale, dim: number): Fixture {
  // File-backed, not :memory: — the pass is read-heavy and an in-memory db
  // prices away the page-cache and I/O the desktop app actually pays.
  const dir = mkdtempSync(join(tmpdir(), 'retrieval-bench-'))
  const sqlite = new DatabaseSync(join(dir, 'bench.db'), { allowExtension: true })
  sqlite.loadExtension(getLoadablePath())
  migrateInto(sqlite)
  for (const kind of [
    'entities_vec',
    'lore_vec',
    'happenings_vec',
    'threads_vec',
    'chapter_summaries_vec',
  ]) {
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${kind}_${dim} USING vec0(
      pk text primary key, branch_id text partition key, model_id text, id text,
      +source_hash text, embedding float[${dim}]);`)
  }

  const rand = seededRandom(42)
  const centroids = Array.from({ length: TOPICS }, () => unitVector(dim, rand))
  let topic = 0
  const nextVec = (): Float32Array => topical(centroids, topic++, rand, 0.7)
  const now = Date.now()
  sqlite.exec('BEGIN')
  sqlite
    .prepare(
      `INSERT INTO stories (id, title, description, tags, cover_asset_id, accent_color, status, favorite, last_opened_at, definition, settings, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'st_bench',
      'Bench',
      null,
      '[]',
      null,
      null,
      'active',
      0,
      null,
      '{}',
      JSON.stringify(STORY_SETTINGS_DEFAULTS),
      now,
      now,
    )
  sqlite
    .prepare(
      `INSERT INTO branches (id, story_id, parent_branch_id, fork_entry_id, name, created_at, classifier_status)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(BRANCH, 'st_bench', null, null, 'main', now, null)

  const insertVec = (table: string): ((id: string, vec: Float32Array) => void) => {
    const stmt = sqlite.prepare(
      `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?,?,?,?,?,?)`,
    )
    return (id, vec) =>
      stmt.run(`${BRANCH}:${id}:${MODEL_ID}`, BRANCH, MODEL_ID, id, 'h', new Uint8Array(vec.buffer))
  }

  const entityVec = insertVec(`entities_vec_${dim}`)
  const entStmt = sqlite.prepare(
    `INSERT INTO entities (id, branch_id, kind, name, description, status, retired_reason, injection_mode, name_collision_flag, state, tags, embedding_stale, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const sceneCharacterIds: string[] = []
  for (let i = 0; i < ENTITIES; i += 1) {
    const id = `char_${String(i).padStart(6, '0')}`
    const kind = i === 0 ? 'location' : 'character'
    entStmt.run(
      id,
      BRANCH,
      kind,
      `Name${i}`,
      prose(rand, 25),
      'active',
      null,
      'auto',
      0,
      '{}',
      '[]',
      0,
      now,
      now,
    )
    entityVec(id, nextVec())
    if (i > 0 && i <= 3) sceneCharacterIds.push(id)
  }

  const loreVec = insertVec(`lore_vec_${dim}`)
  const loreStmt = sqlite.prepare(
    `INSERT INTO lore (id, branch_id, title, body, category, tags, keywords, injection_mode, priority, embedding_stale, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (let i = 0; i < LORE; i += 1) {
    const id = `lore_${String(i).padStart(6, '0')}`
    loreStmt.run(id, BRANCH, `Lore${i}`, prose(rand, 40), null, '[]', '[]', 'auto', 0, 0, now, now)
    loreVec(id, nextVec())
  }

  const threadVec = insertVec(`threads_vec_${dim}`)
  const threadStmt = sqlite.prepare(
    `INSERT INTO threads (id, branch_id, title, description, category, icon, status, injection_mode, triggered_at_entry_id, resolved_at_entry_id, embedding_stale, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (let i = 0; i < THREADS; i += 1) {
    const id = `thr_${String(i).padStart(6, '0')}`
    threadStmt.run(
      id,
      BRANCH,
      `Thread${i}`,
      prose(rand, 20),
      null,
      null,
      'pending',
      'auto',
      null,
      null,
      0,
      now,
      now,
    )
    threadVec(id, nextVec())
  }

  const chapterVec = insertVec(`chapter_summaries_vec_${dim}`)
  const chapStmt = sqlite.prepare(
    `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme, keywords, start_entry_id, end_entry_id, token_count, closed_at, embedding_stale, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const entryStmt = sqlite.prepare(
    `INSERT INTO story_entries (id, branch_id, position, kind, content, chapter_id, metadata, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
  const entryIds: string[] = []
  let position = 0
  for (let c = 0; c < scale.chapters; c += 1) {
    const chapterId = `chp_${String(c).padStart(6, '0')}`
    const entryId = (offset: number): string =>
      `ent_${String(c * ENTRIES_PER_CHAPTER + offset).padStart(7, '0')}`
    chapStmt.run(
      chapterId,
      BRANCH,
      c + 1,
      `Chapter ${c}`,
      prose(rand, 60),
      prose(rand, 8),
      '[]',
      entryId(0),
      entryId(ENTRIES_PER_CHAPTER - 1),
      1000,
      now,
      0,
      now,
      now,
    )
    chapterVec(chapterId, nextVec())
    for (let e = 0; e < ENTRIES_PER_CHAPTER; e += 1) {
      const entryId = `ent_${String(position).padStart(7, '0')}`
      entryStmt.run(entryId, BRANCH, position, 'ai_reply', prose(rand, 120), chapterId, null, now)
      entryIds.push(entryId)
      position += 1
    }
  }

  const happeningVec = insertVec(`happenings_vec_${dim}`)
  const hapStmt = sqlite.prepare(
    `INSERT INTO happenings (id, branch_id, title, description, category, icon, temporal, occurred_at_entry_id, common_knowledge, embedding_stale, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const happeningIds: string[] = []
  for (let i = 0; i < scale.happenings; i += 1) {
    const id = `hap_${String(i).padStart(7, '0')}`
    hapStmt.run(
      id,
      BRANCH,
      `Happening ${i}`,
      prose(rand, 45),
      null,
      null,
      null,
      entryIds[i % entryIds.length]!,
      0,
      0,
      now,
      now,
    )
    happeningVec(id, nextVec())
    happeningIds.push(id)
  }

  const awStmt = sqlite.prepare(
    `INSERT INTO happening_awareness (id, branch_id, happening_id, character_id, learned_at_entry_id, decay_resistance, retrieval_count, source)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
  const seen = new Set<string>()
  let written = 0
  for (let i = 0; written < scale.awareness; i += 1) {
    const happeningId = happeningIds[i % happeningIds.length]!
    const characterId = `char_${String((Math.floor(i / happeningIds.length) % (ENTITIES - 1)) + 1).padStart(6, '0')}`
    const key = `${characterId}:${happeningId}`
    if (seen.has(key)) continue
    seen.add(key)
    awStmt.run(
      `haw_${String(written).padStart(7, '0')}`,
      BRANCH,
      happeningId,
      characterId,
      null,
      null,
      0,
      'classifier',
    )
    written += 1
  }
  sqlite.exec('COMMIT')

  return { sqlite, sceneCharacterIds, centroids, entryIds, dir }
}

/**
 * The deps / params pair a bench feeds runRetrieval. `chapterBudget: 'off'`
 * zeroes the chapter budget, which seats no chapter and so switches the
 * chapter-range admission path off entirely.
 */
export function passInputs(
  { sqlite, sceneCharacterIds, centroids }: Fixture,
  dim: number,
  chapterBudget: 'on' | 'off' = 'on',
) {
  const queryAll: QueryAll = async (sql, params) =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )
  const rand = seededRandom(7)
  // Each query sits near a different topic, so the three of them together
  // reach a realistic slice of the pool rather than all of it or none.
  const queryVectors = [0, 0, 0].map((t) => topical(centroids, t, rand, 0.9))

  const deps = {
    queryAll,
    embedTexts: async (texts: string[]) => ({
      vectors: texts.map((_, i) => queryVectors[i % 3]!),
      dim,
    }),
    loadStaleRows: async () => [],
    embedRows: async () => [],
    runInTransaction: async () => {},
  }
  const params = {
    branchId: BRANCH,
    modelId: MODEL_ID,
    dim,
    budgets: {
      ...STORY_SETTINGS_DEFAULTS.retrievalBudgets,
      ...(chapterBudget === 'off' ? { chapters: 0 } : {}),
    },
    query: {
      userAction: prose(rand, 20),
      eraName: null,
      piggybackSummary: null,
      lastNarrativeContent: prose(rand, 150),
    },
    sceneCharacterIds,
    sceneEntityIds: sceneCharacterIds,
    currentLocationId: 'char_000000',
    recentProse: prose(rand, 200),
  }
  return { deps, params }
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}
