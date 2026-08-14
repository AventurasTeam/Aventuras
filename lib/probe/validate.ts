import type { ProbeCapturePayload } from '@/lib/db'
import type { RankerParams, RetrievalType } from '@/lib/retrieval'
import { RETRIEVAL_TYPES } from '@/lib/retrieval'

export class CaptureShapeError extends Error {
  readonly field: string

  constructor(field: string, detail: string) {
    super(`capture payload ${field} ${detail}`)
    this.name = 'CaptureShapeError'
    this.field = field
  }
}

export class RankerParamsError extends Error {
  readonly field: string
  readonly detail: string

  constructor(field: string, detail: string) {
    super(`ranker param ${field} ${detail}`)
    this.name = 'RankerParamsError'
    this.field = field
    this.detail = detail
  }
}

const requireObject = (field: string, value: unknown): void => {
  if (value === null || typeof value !== 'object')
    throw new RankerParamsError(
      field,
      `must be an object, got ${value === null ? 'null' : typeof value}`,
    )
}

const inRange = (field: string, value: number, min: number, max: number): void => {
  if (!Number.isFinite(value))
    throw new RankerParamsError(field, `must be a finite number, got ${value}`)
  if (value < min || value > max)
    throw new RankerParamsError(field, `must be within [${min}, ${max}], got ${value}`)
}

const requireInteger = (field: string, value: number): void => {
  if (!Number.isInteger(value))
    throw new RankerParamsError(field, `must be an integer, got ${value}`)
}

// A decoded capture is JSON.parse'd through an unchecked cast, so a key — or
// a whole record — a current type promises can genuinely be absent at
// runtime (an older capture predating a tunable); left unguarded it reaches
// the ranker's decay exponent as NaN instead of failing here.
const eachNonNegative = (field: string, record: Readonly<Record<RetrievalType, number>>): void => {
  requireObject(field, record)
  for (const type of RETRIEVAL_TYPES) inRange(`${field}.${type}`, record[type], 0, Infinity)
}

const typeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

const requirePlainObject = (field: string, value: unknown): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new CaptureShapeError(field, `must be an object, got ${typeOf(value)}`)
}

/**
 * Structural, not a schema: a decoded capture is a cast over JSON.parse, and
 * every container a consumer indexes into has to be proven present before the
 * cast is honest — a truncated payload otherwise reaches replayType as a
 * TypeError on `pools[type]`, too late for the list path to classify the row as
 * corrupt. Field-level drift stays tolerated on purpose (probe.md → Reading an
 * older capture): a capture that cannot be opened cannot be deleted either.
 * `failure_reason` is deliberately absent from the checks — a pre-v2 payload
 * carries the marker only on the row, and read.ts backfills it.
 */
export function assertCaptureShape(decoded: unknown): asserts decoded is ProbeCapturePayload {
  requirePlainObject('root', decoded)
  const payload = decoded as Record<string, unknown>

  requirePlainObject('params', payload.params)
  requirePlainObject('pools', payload.pools)
  const pools = payload.pools as Record<string, unknown>
  for (const type of RETRIEVAL_TYPES) {
    if (!Array.isArray(pools[type]))
      throw new CaptureShapeError(`pools.${type}`, `must be an array, got ${typeOf(pools[type])}`)
  }
  if (!Array.isArray(payload.queries) || payload.queries.length !== 3)
    throw new CaptureShapeError('queries', 'must be a three-query stack')
  // Required-and-nullable, so `undefined` is rejected rather than defaulted:
  // replayType never sees the row, and an absent marker reads there as a
  // failure. A payload predating the field is refused, not silently replayed.
  if (payload.failure_reason !== null && typeof payload.failure_reason !== 'string')
    throw new CaptureShapeError(
      'failure_reason',
      `must be a string or null, got ${typeOf(payload.failure_reason)}`,
    )
}

/**
 * The ranker defends pinSignal and chaptersOld inline (ranker.ts) because they
 * arrive unvalidated from the probe's per-row override; the ten params here
 * share that source — a stored capture, not code — and get nothing. Code
 * cannot retune them (the constants are frozen), so this runs wherever a
 * capture's params snapshot re-enters the ranker.
 */
export function assertRankerParams(params: RankerParams): void {
  requireObject('params', params)
  // 0 makes every type select nothing; above 1 inverts the diversity penalty.
  inRange('lambdaDiv', params.lambdaDiv, Number.EPSILON, 1)
  inRange('tauRevive', params.tauRevive, 0, 1)
  inRange('minScoreThreshold', params.minScoreThreshold, 0, 1)
  inRange('kwBoost', params.kwBoost, 0, Infinity)
  // Floor at 1: it's a multiplier applied to a boosted score, so (0, 1)
  // demotes a chapter match instead of lifting it — the same inversion a
  // negative pinBoost commits against a pin.
  inRange('chapterBoost', params.chapterBoost, 1, Infinity)
  inRange('preFilterTopN', params.preFilterTopN, 1, Infinity)
  requireInteger('preFilterTopN', params.preFilterTopN)
  requireObject('weights', params.weights)
  for (const key of ['action', 'digest', 'prose'] as const)
    inRange(`weights.${key}`, params.weights[key], 0, Infinity)
  eachNonNegative('lambda', params.lambda)
  eachNonNegative('pinBoost', params.pinBoost)
  eachNonNegative('typeOverhead', params.typeOverhead)
}
