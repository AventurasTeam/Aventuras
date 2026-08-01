import { PROSE_EXTRACT_TOP_K } from './constants'
import type { NameKeywordIndex } from './name-index'
import { extractProse } from './prose-extract'
import type { QueryPresence } from './types'

export type QueryStackInput = {
  userAction: string
  sceneEntityNames: readonly string[]
  currentLocationName: string | null
  activeThreadTitles: readonly string[]
  eraName: string | null
  /** One-sentence enrichment off the piggyback trailing block; null when absent. */
  piggybackSummary: string | null
  /** The last narrative entry's prose; '' on a cold start. */
  lastNarrativeContent: string
  index: NameKeywordIndex
}

/** `source` labels the query for the probe capture (`CaptureQuery.source`). */
export type QuerySpec = {
  text: string
  source: 'user_action' | 'structural_digest' | 'prose_extract'
  sentenceScores?: number[]
}

export type QueryStack = {
  q1: QuerySpec
  q2: QuerySpec
  q3: QuerySpec
  presence: QueryPresence
  /** Present queries only, in Q1/Q2/Q3 order — the batched embed input. */
  embedTexts: string[]
}

const trimmed = (s: string | null): string => s?.trim() ?? ''
const nonEmpty = (s: string): boolean => s !== ''

function structuralDigest(i: QueryStackInput): string {
  const scene = [...i.sceneEntityNames, i.currentLocationName].map(trimmed).filter(nonEmpty)
  const threads = i.activeThreadTitles.map(trimmed).filter(nonEmpty)
  const era = trimmed(i.eraName)
  const summary = trimmed(i.piggybackSummary)
  return [
    ...(scene.length > 0 ? [`${scene.join(', ')}.`] : []),
    ...(threads.length > 0 ? [`Active threads: ${threads.join(', ')}.`] : []),
    ...(nonEmpty(era) ? [`Era: ${era}.`] : []),
    // Optional by design: retrieval must not degrade on a turn whose piggyback
    // trailing block failed to parse (retrieval.md → Q2).
    ...(nonEmpty(summary) ? [summary] : []),
  ].join('\n')
}

export function buildQueryStack(input: QueryStackInput): QueryStack {
  const q1: QuerySpec = { text: input.userAction.trim(), source: 'user_action' }
  const q2: QuerySpec = { text: structuralDigest(input), source: 'structural_digest' }

  const extract = extractProse(input.lastNarrativeContent, input.index, PROSE_EXTRACT_TOP_K)
  const q3: QuerySpec = {
    text: extract.text,
    source: 'prose_extract',
    sentenceScores: extract.scores,
  }

  // An empty query is marked absent rather than embedded: the ranker
  // re-normalizes the blend weights over the present queries, so carrying one
  // would instead spend a weighted similarity term on noise.
  const presence: QueryPresence = [q1.text !== '', q2.text !== '', q3.text !== '']

  const embedTexts = [q1, q2, q3].filter((_, i) => presence[i]).map((q) => q.text)

  return { q1, q2, q3, presence, embedTexts }
}

/** Re-expand a batched embed result back onto the Q1/Q2/Q3 slots. */
export function distributeQueryVectors(
  vectors: readonly Float32Array[],
  presence: QueryPresence,
): [Float32Array | null, Float32Array | null, Float32Array | null] {
  const out: [Float32Array | null, Float32Array | null, Float32Array | null] = [null, null, null]
  let next = 0
  for (let i = 0; i < 3; i++) if (presence[i]) out[i] = vectors[next++] ?? null
  return out
}
