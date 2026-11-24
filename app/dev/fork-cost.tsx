import { and, asc, count, desc, eq, gt, ne } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { forkBranch, forkSurvivorLists, planFork, type ForkResult } from '@/lib/actions'
import {
  BIND_CHUNK,
  db,
  deltas,
  runInTransaction,
  stories,
  storyEntries,
  type DbCtx,
} from '@/lib/db'

type StoryRow = { id: string; title: string; branchId: string | null; entries: number }

type ForkPoint = { label: string; entryId: string; position: number }

type Counts = { entries: number; deltas: number }

type PlanSize = {
  nextEntryId: string
  window: number
  set: number
  pruned: number
  prunedOutsideWindow: number
  reownedInWindow: number
  droppedJournals: number
  planMs: number
}

type Batch = { ms: number; ops: number }

type ForkCost = {
  point: ForkPoint
  /** Null when the fork entry is the narrative tail: no `B`, nothing to plan. */
  plan: PlanSize | null
  planError: string | null
  result: ForkResult
  totalMs: number
  batches: Batch[]
  child: Counts | null
}

type Report =
  | { storyTitle: string; parent: Counts; costs: ForkCost[] }
  | { storyTitle: string; error: string }

const appCtx: DbCtx = { db, runInTransaction }

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function msSince(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10
}

async function listStories(): Promise<StoryRow[]> {
  const rows = await db
    .select({ id: stories.id, title: stories.title, branchId: stories.currentBranchId })
    .from(stories)
    .orderBy(asc(stories.title))
  const perBranch = await db
    .select({ branchId: storyEntries.branchId, n: count() })
    .from(storyEntries)
    .groupBy(storyEntries.branchId)
  const entries = new Map(perBranch.map((r) => [r.branchId, r.n]))
  return rows.map((row) => ({
    ...row,
    entries: row.branchId === null ? 0 : (entries.get(row.branchId) ?? 0),
  }))
}

async function countsOn(branchId: string): Promise<Counts> {
  const [entryRow] = await db
    .select({ n: count() })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
  const [deltaRow] = await db
    .select({ n: count() })
    .from(deltas)
    .where(eq(deltas.branchId, branchId))
  return { entries: entryRow?.n ?? 0, deltas: deltaRow?.n ?? 0 }
}

async function forkPointsOf(branchId: string): Promise<ForkPoint[]> {
  const columns = { id: storyEntries.id, position: storyEntries.position }
  const [reply] = await db
    .select(columns)
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.kind, 'ai_reply')))
    .orderBy(asc(storyEntries.position))
    .limit(1)
  const [tail] = await db
    .select(columns)
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position))
    .limit(1)
  const points: ForkPoint[] = []
  if (reply) points.push({ label: 'earliest reply', entryId: reply.id, position: reply.position })
  if (tail) points.push({ label: 'tail', entryId: tail.id, position: tail.position })
  return points
}

async function nextEntryOf(branchId: string, position: number): Promise<string | null> {
  const [next] = await db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        ne(storyEntries.kind, 'system'),
        gt(storyEntries.position, position),
      ),
    )
    .orderBy(asc(storyEntries.position))
    .limit(1)
  return next?.id ?? null
}

// The fork's own plan; the write branch names a branch that never commits (only ids are read).
async function planSizeOf(branchId: string, point: ForkPoint): Promise<PlanSize | null> {
  const nextEntryId = await nextEntryOf(branchId, point.position)
  if (nextEntryId === null) return null
  const start = performance.now()
  const planned = await planFork(branchId, point.position, 'br_fork_cost_probe', appCtx)
  if (planned.status === 'rejected')
    throw new Error(`the plan refused (${planned.code}): ${planned.reason}`)
  if (planned.fork === null) return null
  const { swept, plan } = planned.fork
  const planMs = msSince(start)
  const lists = forkSurvivorLists(planned.fork)
  return {
    nextEntryId,
    window: swept.window.length,
    set: swept.set.rows.length,
    pruned: plan.prunedDeltas.length,
    prunedOutsideWindow: lists.prunedOutside.length,
    reownedInWindow: lists.reownedInside.length,
    droppedJournals: lists.droppedJournals.length,
    planMs,
  }
}

async function timeFork(
  parentBranchId: string,
  point: ForkPoint,
): Promise<Pick<ForkCost, 'result' | 'totalMs' | 'batches'>> {
  const batches: Batch[] = []
  const timed: DbCtx = {
    db,
    // Calls through before any await: the fork's swap re-check needs its batch posted that tick.
    runInTransaction: (ops) => {
      const start = performance.now()
      return runInTransaction(ops).then(() => {
        batches.push({ ms: msSince(start), ops: ops.length })
      })
    },
  }
  const start = performance.now()
  const result = await forkBranch(
    {
      parentBranchId,
      forkEntryId: point.entryId,
      name: `Fork cost: ${point.label}`,
      makeCurrent: false,
    },
    timed,
  )
  return { result, totalMs: msSince(start), batches }
}

async function measureStory(branchId: string): Promise<{ parent: Counts; costs: ForkCost[] }> {
  const parent = await countsOn(branchId)
  const costs: ForkCost[] = []
  for (const point of await forkPointsOf(branchId)) {
    let plan: PlanSize | null = null
    let planError: string | null = null
    try {
      plan = await planSizeOf(branchId, point)
    } catch (e) {
      planError = messageOf(e)
    }
    const timed = await timeFork(branchId, point)
    const child = timed.result.status === 'ok' ? await countsOn(timed.result.branchId) : null
    costs.push({ point, plan, planError, ...timed, child })
  }
  return { parent, costs }
}

function linesOf(cost: ForkCost, parent: Counts): string[] {
  const { point, plan, planError, result, totalMs, batches, child } = cost
  const lines = [`${point.label}: N ${point.entryId} at position ${point.position}`]
  if (planError !== null) {
    lines.push(`plan read failed: ${planError}`)
  } else if (plan === null) {
    lines.push('no B: the plan is empty')
  } else {
    const deltaBinds = plan.prunedOutsideWindow + plan.reownedInWindow
    lines.push(
      `B ${plan.nextEntryId}: window ${plan.window}, set ${plan.set}, pruned ${plan.pruned} ` +
        `(${plan.prunedOutsideWindow} outside the window), ${plan.reownedInWindow} re-owned in it, ` +
        `${plan.droppedJournals} journals dropped; binds ${deltaBinds} of ${BIND_CHUNK} (deltas), ` +
        `${plan.droppedJournals} of ${BIND_CHUNK} (journals); planned in ${plan.planMs} ms`,
    )
  }
  if (result.status !== 'ok') {
    lines.push(`refused (${result.code}): ${result.reason}; ${totalMs} ms`)
    return lines
  }
  const batch = batches.map((b) => `${b.ms} ms over ${b.ops} ops`).join(', ') || 'none'
  lines.push(`forked ${result.branchId}: whole call ${totalMs} ms; batch ${batch}`)
  if (child !== null) {
    const lacks = parent.deltas - child.deltas
    const pruned = planError === null ? (plan?.pruned ?? 0) : null
    const mismatch = pruned !== null && pruned !== lacks ? `; ✗ the plan prunes ${pruned}` : ''
    lines.push(
      `child: ${child.entries} entries, ${child.deltas} deltas; lacks ${lacks} of the parent's${mismatch}`,
    )
  }
  return lines
}

// One short line per fork: Android's logcat cuts a long line.
function logLinesOf(report: Report): string[] {
  const head = `[fork-cost] ${Platform.OS} ${report.storyTitle}`
  if ('error' in report) return [`${head}: ${report.error}`, '[fork-cost] done']
  return [
    `${head}: parent ${report.parent.entries} entries, ${report.parent.deltas} deltas`,
    ...report.costs.map((cost) => `${head}: ${linesOf(cost, report.parent).join(' | ')}`),
    '[fork-cost] done',
  ]
}

function ReportView({ report }: { report: Report }) {
  if ('error' in report)
    return (
      <Text size="sm" className="text-danger">
        {report.storyTitle}: {report.error}
      </Text>
    )
  return (
    <View className="gap-3">
      <Text size="sm">
        {report.storyTitle}: parent {report.parent.entries} entries, {report.parent.deltas} deltas
      </Text>
      {report.costs.map((cost) => (
        <View key={cost.point.label} className="gap-1 border-t border-border pt-2">
          {linesOf(cost, report.parent).map((line) => (
            <Text key={line} variant="muted" size="xs" selectable>
              {line}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

export default function ForkCostDevRoute() {
  const [storyRows, setStoryRows] = useState<StoryRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  useEffect(() => {
    listStories()
      .then(setStoryRows)
      .catch((e: unknown) => setListError(messageOf(e)))
  }, [])

  // On press only: every run adds two branches to the story.
  const measure = useCallback((row: StoryRow) => {
    const branchId = row.branchId
    if (branchId === null) return
    setRunningId(row.id)
    setReport(null)
    measureStory(branchId)
      .then((measured): Report => ({ storyTitle: row.title, ...measured }))
      .catch((e: unknown): Report => ({ storyTitle: row.title, error: messageOf(e) }))
      .then((next) => {
        for (const line of logLinesOf(next)) console.log(line)
        setReport(next)
      })
      .finally(() => setRunningId(null))
  }, [])

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-bg-base"
      contentContainerClassName="gap-4 p-4"
    >
      <Text size="lg">Fork cost — {Platform.OS}</Text>
      <Text variant="muted" size="sm">
        Forks the current branch of a story at its earliest reply and at its tail, timing the whole
        forkBranch call and its batch. Each run adds two branches to the story; a reseed clears
        them.
      </Text>
      {listError ? (
        <Text size="sm" className="text-danger">
          {listError}
        </Text>
      ) : null}
      {storyRows.map((row) => (
        <View key={row.id} className="flex-row items-center gap-2">
          <Text size="sm" className="flex-1">
            {row.title} · {row.branchId ?? 'no current branch'} · {row.entries} entries
          </Text>
          <Button
            variant="secondary"
            size="sm"
            accessibilityLabel={`Measure ${row.title}`}
            loading={runningId === row.id}
            disabled={runningId !== null || row.branchId === null}
            onPress={() => measure(row)}
          >
            <Text>Measure</Text>
          </Button>
        </View>
      ))}
      {runningId !== null ? (
        <Text variant="muted" size="sm">
          Measuring…
        </Text>
      ) : null}
      {report ? <ReportView report={report} /> : null}
    </ScrollView>
  )
}
