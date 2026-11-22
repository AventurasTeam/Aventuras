import type { ResolveModelConfig } from '@/lib/ai'
import type { ChapterPartCut } from '@/lib/chapters'

import { CloseIds } from './close-agent/ids'
import type { CloseLedger, CloseRange } from './intermediates'
import type { PhaseContext, PhaseFailure } from '../types'

// The close's own keys, read and written only through the accessors below.
const RANGE_KEY = 'closeRange'
const PARTS_KEY = 'closeParts'
const LEDGER_KEY = 'closeLedger'
const IDS_KEY = 'closeIds'
const CLUSTERS_KEY = 'closeClusters'
const FLOOR_KEY = 'closeFloor'
const MODEL_CONFIG_KEY = 'closeModelConfig'

export function setCloseRange(intermediates: Record<string, unknown>, range: CloseRange): void {
  intermediates[RANGE_KEY] = range
}

export function closeRangeOf(
  intermediates: Readonly<Record<string, unknown>>,
): CloseRange | undefined {
  return intermediates[RANGE_KEY] as CloseRange | undefined
}

/** The range, or the failure a close phase returns without one. */
export function requireCloseRange(
  ctx: Pick<PhaseContext, 'intermediates'>,
): CloseRange | PhaseFailure {
  return (
    closeRangeOf(ctx.intermediates) ?? {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    }
  )
}

/** The metadata phase's cut of the range (chapter-close.md → Parts), part 1 first. */
export function setCloseParts(
  intermediates: Record<string, unknown>,
  parts: readonly ChapterPartCut[],
): void {
  intermediates[PARTS_KEY] = parts
}

export function closePartsOf(
  intermediates: Readonly<Record<string, unknown>>,
): readonly ChapterPartCut[] | undefined {
  return intermediates[PARTS_KEY] as readonly ChapterPartCut[] | undefined
}

/** The parts, or the failure the agent phase returns without them. */
export function requireCloseParts(
  ctx: Pick<PhaseContext, 'intermediates'>,
): readonly ChapterPartCut[] | PhaseFailure {
  return (
    closePartsOf(ctx.intermediates) ?? {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close parts' },
    }
  )
}

/** The agent's ledger, which `report` writes as `close_report`; absent until the agent seeds it. */
export function closeLedgerOf(
  intermediates: Readonly<Record<string, unknown>>,
): CloseLedger | undefined {
  return intermediates[LEDGER_KEY] as CloseLedger | undefined
}

/** The live ledger, seeded `{ calls: [], stopped: [], noToolCalls: true }` on first call. */
export function seedCloseLedger(intermediates: Record<string, unknown>): CloseLedger {
  const seeded = closeLedgerOf(intermediates)
  if (seeded) return seeded
  const ledger: CloseLedger = { calls: [], stopped: [], noToolCalls: true }
  intermediates[LEDGER_KEY] = ledger
  return ledger
}

/** The run's one id map, created on first call, so a row keeps its handle across tasks and parts. */
export function closeIdsOf(intermediates: Record<string, unknown>): CloseIds {
  const held = intermediates[IDS_KEY]
  if (held instanceof CloseIds) return held
  const ids = new CloseIds()
  intermediates[IDS_KEY] = ids
  return ids
}

/** chapter-close.md → 3e: the clusters the range embed found, for the Happenings task's start. */
export function setCloseClusters(
  intermediates: Record<string, unknown>,
  clusters: readonly (readonly string[])[],
): void {
  intermediates[CLUSTERS_KEY] = clusters
}

/** Happening id clusters the range embed found; [] when none or not run. */
export function closeClustersOf(
  intermediates: Record<string, unknown>,
): readonly (readonly string[])[] {
  return (intermediates[CLUSTERS_KEY] as readonly (readonly string[])[] | undefined) ?? []
}

/** The cluster the range embed put `happeningId` in; undefined when none. */
export function closeClusterOf(
  intermediates: Record<string, unknown>,
  happeningId: string,
): readonly string[] | undefined {
  return closeClustersOf(intermediates).find((cluster) => cluster.includes(happeningId))
}

/** A re-run's floor, parked by `reversal`: the highest log position its reversal left. */
export function setCloseFloor(intermediates: Record<string, unknown>, floor: number): void {
  intermediates[FLOOR_KEY] = floor
}

/** Undefined on a close, which reverses nothing. */
export function closeFloorOf(intermediates: Readonly<Record<string, unknown>>): number | undefined {
  return intermediates[FLOOR_KEY] as number | undefined
}

/** C2 → metadata: the lore-mgmt config whose window cut the parts; later calls run on it. */
export function setCloseModelConfig(
  intermediates: Record<string, unknown>,
  config: ResolveModelConfig,
): void {
  intermediates[MODEL_CONFIG_KEY] = config
}

/** The parked config, or the failure the agent phase returns without it. */
export function requireCloseModelConfig(
  ctx: Pick<PhaseContext, 'intermediates'>,
): ResolveModelConfig | PhaseFailure {
  return (
    (ctx.intermediates[MODEL_CONFIG_KEY] as ResolveModelConfig | undefined) ?? {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close model config' },
    }
  )
}
