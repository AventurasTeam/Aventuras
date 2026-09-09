import { settingsCount } from '@/lib/settings-number'

import { matchTerms, normalizeTerm } from './name-index'
import { filterEntityPool, filterLorePool, type EntityRow, type LoreRow } from './pools'
import { tokenCost, type RankTypeInput } from './ranker'
import { entityRenderedText, loreRenderedText } from './rendered-text'
import {
  type InjectedRow,
  type KeywordInjection,
  type RankerParams,
  type RetrievalType,
} from './types'

/**
 * What runRetrieval reads off `stories.settings.keywordRetrieval`. Declared here, not
 * imported from lib/db, so retrieval does not follow whatever else that blob grows.
 * `scanEntries` is absent — the phase spends it before the pass starts.
 */
export type KeywordRetrievalSettings = {
  mode: 'boost' | 'inject'
  budgetShare: number
  cascade: boolean
  cascadeMaxDepth: number
}

/** An entity with the two columns the keyword path reads beyond EntityRow. */
type InjectableEntity = EntityRow & { keywords: readonly string[]; priority: number }
/** LoreRow already carries `priority`; only `keywords` is extra. */
type InjectableLore = LoreRow & { keywords: readonly string[] }

export type KeywordInjectionInput = {
  settings: KeywordRetrievalSettings
  entities: readonly InjectableEntity[]
  lore: readonly InjectableLore[]
  /** Every id the structural floor seated — already in the prompt, never injected. */
  floorIds: ReadonlySet<string>
  /** Un-classified buffer prose, for Layer-A same-name suppression. */
  recentProse: string
  /** The haystack (retrieval.md → Keyword scan surface). */
  scanText: string
  budgets: Record<RetrievalType, number>
  params: RankerParams
  /** Injected so this stays pure, matching the ranker's own countTokens seam. */
  countTokens: (text: string) => number
}

/** The two types canon admits: both need a curated keyword set AND an ordering key. */
type Injectable = Extract<RetrievalType, 'entities' | 'lore'>
const INJECTABLE: readonly Injectable[] = ['entities', 'lore']

/** Only `entities` and `lore` are ever non-empty; canon keeps the other three on `boost`. */
export type KeywordInjections = Record<RetrievalType, KeywordInjection[]>

// A literal, not a built-up Record: a type added to RETRIEVAL_TYPES is a build
// error here rather than an undefined list rankAll would seat nothing from.
const empty = (): KeywordInjections => ({
  entities: [],
  lore: [],
  happenings: [],
  threads: [],
  chapters: [],
})

// Hardening against settings that never went through storySettingsSchema: out of
// range, budgetShare silently starves or floods one partition.
const toShare = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

// A non-finite budget makes `used + cost > cap` false for every row, so the cap would
// not cap at all; 0 matches every other reader's seat-nothing direction.
const toCap = (budget: number, share: number): number =>
  Number.isFinite(budget) ? Math.max(0, budget) * share : 0

const toDepth = (settings: KeywordRetrievalSettings): number =>
  settings.cascade ? settingsCount(settings.cascadeMaxDepth, 1) : 1

// Code units, never localeCompare: the host locale would make which rows seat
// device-dependent, and case-only ties fall to SQLite's read order — hence the id key.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const byOverflowOrder = (a: KeywordInjection, b: KeywordInjection): number =>
  b.priority - a.priority ||
  cmp(normalizeTerm(a.row.displayName), normalizeTerm(b.row.displayName)) ||
  cmp(a.row.id, b.row.id)

type Matchable = { row: InjectedRow; priority: number; terms: readonly string[] }

function matchable(input: KeywordInjectionInput): Record<Injectable, Matchable[]> {
  // The same filters the ranker pools run (retrieval.md → Keyword injection).
  // Not `embedding_stale`: it gates vector validity, and this path reads no vector.
  const entities = filterEntityPool(input.entities, {
    floorIds: input.floorIds,
    recentProse: input.recentProse,
  })
  const lore = filterLorePool(input.lore, input.floorIds)

  return {
    entities: entities.map((r) => ({
      row: {
        kind: 'entity' as const,
        id: r.id,
        displayName: r.name,
        renderedText: entityRenderedText(r),
      },
      priority: r.priority,
      // Canon: "Keyword on `name` and `entities.keywords`" — the name has no column,
      // hence prepended. De-duped so a name also listed as a keyword is not two hits.
      terms: [...new Set([r.name, ...r.keywords].map(normalizeTerm))],
    })),
    lore: lore.map((r) => ({
      row: {
        kind: 'lore' as const,
        id: r.id,
        displayName: r.title,
        renderedText: loreRenderedText(r),
      },
      priority: r.priority,
      // Lore's title is deliberately absent: canon's surface is `lore.keywords`
      // alone, and the ranked path's kwHits(r.keywords) says the same.
      terms: [...new Set(r.keywords.map(normalizeTerm))],
    })),
  }
}

/**
 * retrieval.md → Keyword injection. Matches the scan surface against entity and lore
 * keyword sets and returns the rows a hit seats, capped per type at `budgetShare` of
 * that type's allocation. Cut rows are returned too, carrying `seated: false`. Empty
 * under `mode='boost'` — the default — without touching the tokenizer.
 */
export function buildKeywordInjections(input: KeywordInjectionInput): KeywordInjections {
  const out = empty()
  if (input.settings.mode !== 'inject') return out

  const share = toShare(input.settings.budgetShare)
  // Per type, matching the hard partitions already in force: an unused keyword
  // allowance in one type does not migrate to another.
  const caps: Record<Injectable, number> = {
    entities: toCap(input.budgets.entities, share),
    lore: toCap(input.budgets.lore, share),
  }
  const used: Record<Injectable, number> = { entities: 0, lore: 0 }
  const costInput: Pick<RankTypeInput, 'params' | 'countTokens'> = {
    params: input.params,
    countTokens: input.countTokens,
  }

  const pools = matchable(input)
  const visited = new Set<string>()
  let haystack = input.scanText

  for (let depth = 1; depth <= toDepth(input.settings); depth++) {
    const seatedThisDepth: string[] = []

    for (const type of INJECTABLE) {
      const hits: KeywordInjection[] = []
      for (const m of pools[type]) {
        if (visited.has(m.row.id)) continue
        const terms = matchTerms(haystack, m.terms)
        if (terms.length === 0) continue
        hits.push({
          row: m.row,
          terms,
          priority: m.priority,
          tokensEstimated: tokenCost(m.row.renderedText, type, costInput),
          seated: false,
        })
      }
      hits.sort(byOverflowOrder)

      for (const hit of hits) {
        // Marked whether or not it seats: a cut row re-offered deeper would take a
        // second probe entry and, on a cycle, be re-tried until the allowance ran out.
        visited.add(hit.row.id)
        // `continue`, not `break` — canon's budget fill tries smaller rows
        // rather than stopping at the first that does not fit.
        if (used[type] + hit.tokensEstimated > caps[type]) {
          out[type].push(hit)
          continue
        }
        used[type] += hit.tokensEstimated
        out[type].push({ ...hit, seated: true })
        seatedThisDepth.push(hit.row.renderedText)
      }
    }

    // Seated rows only: an unseated row is not in the prompt, so its text is not
    // "an injected row's own text" to rescan.
    if (seatedThisDepth.length === 0) break
    haystack = seatedThisDepth.join('\n')
  }

  return out
}
