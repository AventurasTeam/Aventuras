import { sql, type SQL } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { db, execRaw, queryRows, runInTransaction, vecCopyStatement, type SqlOp } from '@/lib/db'

type Check = { label: string; result?: string; error?: string }

const CHECKS: [string, SQL][] = [
  ['sqlite-vec version', sql`select vec_version() as v`],
  ['tables', sql`select name from sqlite_master where type = 'table' order by name`],
  ['app_settings singleton', sql`select id, diagnostics from app_settings`],
]

async function runChecks(): Promise<Check[]> {
  const out: Check[] = []
  for (const [label, query] of CHECKS) {
    try {
      const rows = await db.all(query)
      out.push({ label, result: JSON.stringify(rows) })
    } catch (e) {
      out.push({ label, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

// Outside isVecFamilyTable's pattern, so no swap, sweep or story delete reaches them.
const PROBE_VEC = 'zz_copy_probe_vec'
const PROBE_SRC = 'zz_copy_probe_src'
const PROBE_FROM = 'zz_copy_probe_from'
const PROBE_INTO = 'zz_copy_probe_into'
const PROBE_TMP = 'zz_copy_probe_tmp'
const PROBE_A = 'probe_a'
const PROBE_B = 'probe_b'

type ProbeVector = { id: string; pk: string; modelId: string; sourceHash: string; values: number[] }

// v2's key predates the model segment; v3's source row is on probe_a alone, so it stays behind.
const PROBE_VECTORS: ProbeVector[] = [
  { id: 'v1', pk: 'probe_a:v1:m1', modelId: 'm1', sourceHash: 'h1', values: [1, 0, 0, 0] },
  { id: 'v2', pk: 'probe_a:v2', modelId: 'm2', sourceHash: 'h2', values: [0, 1, 0, 0] },
  { id: 'v3', pk: 'probe_a:v3:m1', modelId: 'm1', sourceHash: 'h3', values: [0, 0, 1, 0] },
]

const PROBE_SOURCE_ROWS: [branchId: string, id: string][] = [
  [PROBE_A, 'v1'],
  [PROBE_A, 'v2'],
  [PROBE_A, 'v3'],
  [PROBE_B, 'v1'],
  [PROBE_B, 'v2'],
]

type Outcome = { failures: string[]; detail: unknown }

function bytesOf(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer)
}

function hexOf(values: number[]): string {
  return Array.from(bytesOf(values), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function dropTables(names: readonly string[]): Promise<void> {
  for (const name of names) await execRaw(`DROP TABLE IF EXISTS ${name}`)
}

async function readVersions(): Promise<string> {
  const [[sqliteVersion, vecVersion]] = await queryRows(
    'SELECT sqlite_version() AS sqlite_v, vec_version() AS vec_v',
    [],
  )
  return `sqlite ${String(sqliteVersion)}, sqlite-vec ${String(vecVersion)}`
}

function readProbePartition(branchId: string): Promise<unknown[][]> {
  return queryRows(
    `SELECT pk, model_id, id, source_hash, hex(embedding) AS embedding_hex FROM ${PROBE_VEC}
      WHERE branch_id = ? ORDER BY id`,
    [branchId],
  )
}

async function vectorCopyProbe(): Promise<Outcome> {
  await execRaw(`CREATE VIRTUAL TABLE ${PROBE_VEC} USING vec0(
	pk text primary key,
	branch_id text partition key,
	model_id text,
	id text,
	+source_hash text,
	embedding float[4]
)`)
  await execRaw(`CREATE TABLE ${PROBE_SRC} (branch_id text NOT NULL, id text NOT NULL)`)
  const seed: SqlOp[] = [
    ...PROBE_VECTORS.map((v) => ({
      sql: `INSERT INTO ${PROBE_VEC} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [v.pk, PROBE_A, v.modelId, v.id, v.sourceHash, bytesOf(v.values)],
    })),
    ...PROBE_SOURCE_ROWS.map(([branchId, id]) => ({
      sql: `INSERT INTO ${PROBE_SRC} (branch_id, id) VALUES (?, ?)`,
      params: [branchId, id],
    })),
  ]
  await runInTransaction(seed)
  const sourceBefore = await readProbePartition(PROBE_A)

  await runInTransaction([
    vecCopyStatement(
      { vecTable: PROBE_VEC, sourceTable: PROBE_SRC },
      { from: PROBE_A, to: PROBE_B },
    ),
  ])

  const copied = await readProbePartition(PROBE_B)
  const sourceAfter = await readProbePartition(PROBE_A)
  const knnIds = (
    await queryRows(
      `SELECT id FROM ${PROBE_VEC} WHERE embedding MATCH ? AND k = 3 AND branch_id = ?`,
      [bytesOf([1, 0, 0, 0]), PROBE_B],
    )
  )
    .map(([id]) => String(id))
    .sort()
  const expected = PROBE_VECTORS.filter((v) => v.id !== 'v3').map((v) => [
    `${PROBE_B}:${v.id}:${v.modelId}`,
    v.modelId,
    v.id,
    v.sourceHash,
    hexOf(v.values),
  ])
  const failures: string[] = []
  if (sourceBefore.length !== PROBE_VECTORS.length) failures.push('the seed did not land')
  if (!same(copied, expected)) failures.push('copied rows differ in key, columns or bytes')
  if (!same(sourceAfter, sourceBefore)) failures.push('the source partition changed')
  if (!same(knnIds, ['v1', 'v2'])) failures.push('a KNN on the new partition missed the copies')
  return { failures, detail: { copied, knnIds } }
}

async function tempTableProbe(): Promise<Outcome> {
  await execRaw(`CREATE TABLE ${PROBE_FROM} (id text NOT NULL, label text NOT NULL)`)
  await execRaw(`CREATE TABLE ${PROBE_INTO} (id text NOT NULL, label text NOT NULL)`)
  await execRaw(
    `INSERT INTO ${PROBE_FROM} (id, label) VALUES ('t1', 'one'), ('t2', 'two'), ('t3', 'three')`,
  )

  await runInTransaction([
    { sql: `CREATE TEMP TABLE ${PROBE_TMP} (id text NOT NULL, label text NOT NULL)`, params: [] },
    {
      sql: `INSERT INTO ${PROBE_TMP} (id, label) SELECT id, label FROM ${PROBE_FROM} WHERE id != ?`,
      params: ['t3'],
    },
    { sql: `INSERT INTO ${PROBE_INTO} (id, label) SELECT id, label FROM ${PROBE_TMP}`, params: [] },
    { sql: `DROP TABLE ${PROBE_TMP}`, params: [] },
  ])

  const moved = await queryRows(`SELECT id, label FROM ${PROBE_INTO} ORDER BY id`, [])
  const leftover = await queryRows('SELECT name FROM sqlite_temp_master WHERE name = ?', [
    PROBE_TMP,
  ])
  const failures: string[] = []
  if (
    !same(moved, [
      ['t1', 'one'],
      ['t2', 'two'],
    ])
  ) {
    failures.push('rows moved through the temp table differ')
  }
  if (leftover.length !== 0) failures.push('the temp table outlived its batch')
  return { failures, detail: { moved } }
}

// Drops its scratch tables first, so a run that threw midway can't fail the next one.
async function scratchCheck(
  label: string,
  versions: string,
  scratch: readonly string[],
  probe: () => Promise<Outcome>,
): Promise<Check> {
  let passed = false
  let text: string
  try {
    await dropTables(scratch)
    const { failures, detail } = await probe()
    const body = `${versions}; ${JSON.stringify(detail)}`
    passed = failures.length === 0
    text = passed ? body : `${failures.join('; ')}; ${body}`
  } catch (e) {
    text = `${versions}; threw: ${messageOf(e)}`
  }
  try {
    await dropTables(scratch)
  } catch (e) {
    return { label, error: `${text}; dropping the scratch tables threw: ${messageOf(e)}` }
  }
  return passed ? { label, result: text } : { label, error: text }
}

async function runBranchCopyChecks(): Promise<Check[]> {
  const out: Check[] = []
  let versions: string
  try {
    versions = await readVersions()
    out.push({ label: 'branch copy: versions', result: versions })
  } catch (e) {
    versions = 'versions unread'
    out.push({ label: 'branch copy: versions', error: messageOf(e) })
  }
  const probes: [string, readonly string[], () => Promise<Outcome>][] = [
    ['branch copy: vector statement', [PROBE_VEC, PROBE_SRC], vectorCopyProbe],
    ['branch copy: temp table in one batch', [PROBE_TMP, PROBE_FROM, PROBE_INTO], tempTableProbe],
  ]
  for (const [label, scratch, probe] of probes) {
    out.push(await scratchCheck(label, versions, scratch, probe))
  }
  return out
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <>
      {checks.map((c) => (
        <View key={c.label} className="gap-1">
          <Text size="sm">{c.label}</Text>
          <Text variant="muted" size="xs">
            {c.error ? `✗ ${c.error}` : `✓ ${c.result}`}
          </Text>
        </View>
      ))}
    </>
  )
}

export default function DbCheckDevRoute() {
  const [checks, setChecks] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [copyChecks, setCopyChecks] = useState<Check[]>([])
  const [copyRunning, setCopyRunning] = useState(false)

  const run = useCallback(() => {
    setRunning(true)
    runChecks()
      .then(setChecks)
      .finally(() => setRunning(false))
  }, [])

  // On press only: Fast Refresh re-runs effects, racing a second run over the same scratch tables.
  const runCopy = useCallback(() => {
    setCopyRunning(true)
    runBranchCopyChecks()
      .then(setCopyChecks)
      .finally(() => setCopyRunning(false))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-bg-base"
      contentContainerClassName="gap-4 p-4"
    >
      <Text size="lg">DB check — {Platform.OS}</Text>
      <Button variant="secondary" onPress={run} loading={running}>
        <Text>Re-run checks</Text>
      </Button>
      <CheckList checks={checks} />
      <Button variant="secondary" onPress={runCopy} loading={copyRunning}>
        <Text>Branch copy checks</Text>
      </Button>
      <CheckList checks={copyChecks} />
    </ScrollView>
  )
}
