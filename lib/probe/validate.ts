import type { RankerParams, RetrievalType } from '@/lib/retrieval'
import { TYPE_OF_KIND } from '@/lib/retrieval'

export class RankerParamsError extends Error {
  constructor(field: string, detail: string) {
    super(`ranker param ${field} ${detail}`)
    this.name = 'RankerParamsError'
  }
}

// A decoded capture is JSON.parse'd through an unchecked cast, so a key a
// current record type promises can genuinely be absent at runtime (an older
// capture predating a tunable, JSON dropping an undefined). Walking this
// canonical list rather than Object.entries(record) means a missing key reads
// as undefined, not as an absence the loop never visits.
const RETRIEVAL_TYPES: readonly RetrievalType[] = Object.values(TYPE_OF_KIND)

const inRange = (field: string, value: number, min: number, max: number): void => {
  // NaN and a missing key both fail every relational comparison below, so
  // range checks alone would silently accept them; isFinite is the only guard
  // that catches "value absent or non-numeric" rather than "value out of bounds".
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RankerParamsError(field, `must be within [${min}, ${max}], got ${value}`)
}

const requireInteger = (field: string, value: number): void => {
  if (!Number.isInteger(value))
    throw new RankerParamsError(field, `must be an integer, got ${value}`)
}

const eachNonNegative = (field: string, record: Readonly<Record<RetrievalType, number>>): void => {
  for (const type of RETRIEVAL_TYPES) inRange(`${field}.${type}`, record[type], 0, Infinity)
}

/**
 * The ranker defends pinSignal and chaptersOld inline (ranker.ts) because they
 * arrive unvalidated from the probe's per-row override; the ten params here
 * share that source — a stored capture, not code — and get nothing. Code
 * cannot retune them (the constants are frozen), so this runs wherever a
 * capture's params snapshot re-enters the ranker.
 */
export function assertRankerParams(params: RankerParams): void {
  // 0 makes every type select nothing; above 1 inverts the diversity penalty.
  inRange('lambdaDiv', params.lambdaDiv, Number.EPSILON, 1)
  inRange('tauRevive', params.tauRevive, 0, 1)
  inRange('minScoreThreshold', params.minScoreThreshold, 0, 1)
  inRange('kwBoost', params.kwBoost, 0, Infinity)
  // Floor at 1, not 0: it's a multiplier applied to a boosted score, so (0, 1)
  // demotes a chapter match instead of lifting it — the same inversion a
  // negative pinBoost commits against a pin.
  inRange('chapterBoost', params.chapterBoost, 1, Infinity)
  inRange('preFilterTopN', params.preFilterTopN, 1, Infinity)
  requireInteger('preFilterTopN', params.preFilterTopN)
  for (const key of ['action', 'digest', 'prose'] as const)
    inRange(`weights.${key}`, params.weights[key], 0, Infinity)
  eachNonNegative('lambda', params.lambda)
  eachNonNegative('pinBoost', params.pinBoost)
  eachNonNegative('typeOverhead', params.typeOverhead)
}
