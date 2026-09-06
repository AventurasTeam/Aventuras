import type { QueryTextPresence } from './types'

export type QueryStackInput = {
  userAction: string
  sceneEntityNames: readonly string[]
  currentLocationName: string | null
  activeThreadTitles: readonly string[]
  eraName: string | null
  /** `metadata.summary` off the last AI-authored entry; null when absent. */
  piggybackSummary: string | null
}

/** `source` labels the query for the probe capture (`CaptureQuery.source`). */
export type QuerySource = 'user_action' | 'structural_digest' | 'piggyback_summary'

export type QuerySpec = { text: string; source: QuerySource }

export type QueryStack = {
  q1: QuerySpec
  q2: QuerySpec
  q3: QuerySpec
  presence: QueryTextPresence
  /** Present queries only, in Q1/Q2/Q3 order — the batched embed input. */
  embedTexts: string[]
}

const trimmed = (s: string | null): string => s?.trim() ?? ''
const nonEmpty = (s: string): boolean => s !== ''

function structuralDigest(input: QueryStackInput): string {
  const scene = [...input.sceneEntityNames, input.currentLocationName].map(trimmed).filter(nonEmpty)
  const threads = input.activeThreadTitles.map(trimmed).filter(nonEmpty)
  const era = trimmed(input.eraName)
  // docs/memory/retrieval.md → Q2: Structural digest. Every line is conditional, so an
  // all-empty one is the empty string — Q2 reads absent and spends none of the blend.
  return [
    ...(scene.length > 0 ? [`${scene.join(', ')}.`] : []),
    ...(threads.length > 0 ? [`Active threads: ${threads.join(', ')}.`] : []),
    ...(nonEmpty(era) ? [`Era: ${era}.`] : []),
  ].join('\n')
}

export function buildQueryStack(input: QueryStackInput): QueryStack {
  const q1: QuerySpec = { text: input.userAction.trim(), source: 'user_action' }
  const q2: QuerySpec = { text: structuralDigest(input), source: 'structural_digest' }
  const q3: QuerySpec = { text: trimmed(input.piggybackSummary), source: 'piggyback_summary' }

  // An empty query is marked absent rather than embedded: the ranker
  // re-normalizes the blend weights over the present queries, so carrying one
  // would instead spend a weighted similarity term on noise.
  const presence: QueryTextPresence = [nonEmpty(q1.text), nonEmpty(q2.text), nonEmpty(q3.text)]

  const embedTexts = [q1, q2, q3].filter((_, i) => presence[i]).map((q) => q.text)

  return { q1, q2, q3, presence, embedTexts }
}

/** Re-expand a batched embed result back onto the Q1/Q2/Q3 slots. */
export function distributeQueryVectors(
  vectors: readonly Float32Array[],
  presence: QueryTextPresence,
): [Float32Array | null, Float32Array | null, Float32Array | null] {
  const out: [Float32Array | null, Float32Array | null, Float32Array | null] = [null, null, null]
  let next = 0
  for (let i = 0; i < 3; i++) if (presence[i]) out[i] = vectors[next++] ?? null
  return out
}
