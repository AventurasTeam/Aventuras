import type { QuerySlot, QueryTextPresence } from './types'

export type QueryStackInput = {
  userAction: string
  sceneEntityNames: readonly string[]
  currentLocationName: string | null
  activeThreadTitles: readonly string[]
  eraName: string | null
  /** `metadata.summary` off the last AI-authored entry; null when absent. */
  piggybackSummary: string | null
  /** `metadata.retrievalQueries` off the same row Q3 reads. */
  emittedQueries?: readonly string[]
}

/** `source` labels the query for the probe capture (`CaptureQuery.source`). */
export type QuerySource =
  | 'user_action'
  | 'structural_digest'
  | 'piggyback_summary'
  | 'classifier_emitted'

export type QuerySpec = { text: string; source: QuerySource }

/** Which blend weight each source's query draws on. */
export const QUERY_SLOT_OF_SOURCE = {
  user_action: 'action',
  structural_digest: 'digest',
  piggyback_summary: 'summary',
  classifier_emitted: 'direct',
} as const satisfies Record<QuerySource, QuerySlot>

/** retrieval.md → Q4: capped at three, and the cap is a cost decision. */
export const MAX_EMITTED_QUERIES = 3
/**
 * retrieval.md → Q3 and Q4. One cap for both emitted slots. A retrieval ask is
 * phrase-shaped; a summary is one sentence. Query-build only — `metadata.summary`
 * and `metadata.retrievalQueries` persist uncapped for the reader.
 */
const MAX_QUERY_CHARS = 200

export type QueryStack = {
  /** Q1, Q2, Q3, then one per emitted Q4. Empty `text` means the slot is absent. */
  specs: readonly QuerySpec[]
  slots: readonly QuerySlot[]
  presence: QueryTextPresence
  /** Present queries only, in slot order — the batched embed input. */
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

// retrieval.md → Q4: identical strings would split the pooled weight and cost a
// KNN pass each for one signal; an oversized one is capped, not left to truncation.
function emittedSpecs(raw: readonly string[]): QuerySpec[] {
  const seen = new Set<string>()
  const out: QuerySpec[] = []
  for (const candidate of raw) {
    const text = candidate.trim().slice(0, MAX_QUERY_CHARS)
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push({ text, source: 'classifier_emitted' })
    if (out.length === MAX_EMITTED_QUERIES) break
  }
  return out
}

export function buildQueryStack(input: QueryStackInput): QueryStack {
  // An absent fixed slot is recorded but not embedded: the probe renders it, and
  // the blend re-normalizes over the present ones rather than spending a share on noise.
  const specs: QuerySpec[] = [
    { text: input.userAction.trim(), source: 'user_action' },
    { text: structuralDigest(input), source: 'structural_digest' },
    {
      text: trimmed(input.piggybackSummary).slice(0, MAX_QUERY_CHARS),
      source: 'piggyback_summary',
    },
    ...emittedSpecs(input.emittedQueries ?? []),
  ]
  const slots = specs.map((q) => QUERY_SLOT_OF_SOURCE[q.source])
  const presence = specs.map((q) => nonEmpty(q.text))
  const embedTexts = specs.filter((_, i) => presence[i]).map((q) => q.text)

  return { specs, slots, presence, embedTexts }
}

/** Re-expand a batched embed result back onto the stack's slots. */
export function distributeQueryVectors(
  vectors: readonly Float32Array[],
  presence: QueryTextPresence,
): (Float32Array | null)[] {
  const out: (Float32Array | null)[] = presence.map(() => null)
  let next = 0
  for (let i = 0; i < presence.length; i++) if (presence[i]) out[i] = vectors[next++] ?? null
  return out
}
