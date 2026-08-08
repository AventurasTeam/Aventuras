import type { RankerParams } from '@/lib/retrieval'

export class RankerParamsError extends Error {
  constructor(field: string, detail: string) {
    super(`ranker param ${field} ${detail}`)
    this.name = 'RankerParamsError'
  }
}

const inRange = (field: string, value: number, min: number, max: number): void => {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RankerParamsError(field, `must be within [${min}, ${max}], got ${value}`)
}

const eachNonNegative = (field: string, record: Readonly<Record<string, number>>): void => {
  for (const [key, value] of Object.entries(record)) inRange(`${field}.${key}`, value, 0, Infinity)
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
  inRange('chapterBoost', params.chapterBoost, 0, Infinity)
  inRange('preFilterTopN', params.preFilterTopN, 1, Infinity)
  for (const key of ['action', 'digest', 'prose'] as const)
    inRange(`weights.${key}`, params.weights[key], 0, Infinity)
  eachNonNegative('lambda', params.lambda)
  eachNonNegative('pinBoost', params.pinBoost)
  eachNonNegative('typeOverhead', params.typeOverhead)
}
