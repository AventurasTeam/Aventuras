/**
 * Duplicate candidate detection for lore management.
 *
 * Noticing that two entries are the same subject is done here, in code and before the
 * call, so the agent is handed a worklist instead of a flat list of names it has to spot
 * the duplicates in unprompted — which it reliably did not.
 *
 * These are **candidates**, never verdicts: "Guard Captain" and "Guard" may or may not be
 * one entry, and only a model reading both descriptions can say. The agent resolves each
 * group by merging it or by calling `keep_separate` on it.
 *
 * Deliberately lenient, because being wrong here costs one question. `create_entry`'s
 * hard refusal uses `foldName` instead, where being wrong costs a lost entry.
 *
 * Plain TypeScript with no store or SDK imports, so it is testable on its own.
 */

import { foldName } from '$lib/utils/text'

/** The minimum an entry needs to look like for this module to compare it. */
export interface DuplicateCandidateInput {
  name: string
  aliases?: string[]
  type: string
}

export interface DuplicateGroup {
  /** Indices into the array that was passed in, ascending. */
  indices: number[]
  /** The names at those indices, in the same order. */
  names: string[]
  /** Why they were grouped — shown to the agent, since it changes how suspicious to be. */
  reason: DuplicateReason
}

export type DuplicateReason = 'same-name' | 'shared-alias' | 'contained' | 'similar'

/**
 * How far apart two names may be spelled and still be the same name.
 *
 * One edit is plausible drift on a name long enough for it — "Kaelen"/"Kaelan" — and on a
 * four-letter name it is a different name: "Mara"/"Sara". Two edits only once the name is
 * long enough that two differences are still a small share of it.
 */
function allowedEdits(length: number): number {
  if (length >= 9) return 2
  if (length >= 5) return 1
  return 0
}

/** A worklist is only useful if it can be read; past this the prompt is the problem. */
const MAX_GROUPS = 20

/**
 * Leading articles carry no identity: "The Citadel" and "Citadel" are one place.
 *
 * Articles only. The nobiliary particles `de`, `du`, `di`, `van` are *not* here: they sit
 * inside surnames, so stripping them makes "De Luca" and "Luca" one candidate.
 */
const LEADING_ARTICLES = new Set([
  'the',
  'a',
  'an',
  'il',
  'lo',
  'la',
  'le',
  'gli',
  'i',
  'un',
  'uno',
  'una',
  'el',
  'los',
  'las',
  'les',
  'der',
  'die',
  'das',
])

/**
 * Fold a name to what identity survives spelling: no case, no accents, no punctuation, no
 * leading article. "L'Élu, il Prescelto" and "Elu il Prescelto" are the same key.
 *
 * The apostrophe is a separator here, unlike in `foldName`, which joins across it. That is
 * the difference between the two questions: `foldName` asks whether two spellings are one
 * name, where `Vor'koth` and `Vorkoth` plainly are; this asks what a name's identity is
 * once its articles are gone, and `L'` is an article welded to the word after it. Splitting
 * it is what lets the rule below drop it.
 */
export function normalizeName(raw: string): string {
  const folded = foldName(raw.replace(/['’‘ʼ`]/gu, ' '))

  const tokens = folded.split(' ').filter(Boolean)
  // A single letter in front is an elision the punctuation pass split off — the "l" of
  // "L'Élu", the "d" of "D'Artagnan" — and carries no more identity than a written article.
  while (tokens.length > 1 && (LEADING_ARTICLES.has(tokens[0]) || tokens[0].length === 1)) {
    tokens.shift()
  }
  return tokens.join(' ')
}

function tokensOf(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean)
}

/**
 * Levenshtein distance, capped: anything past `max` is reported as `max + 1`.
 *
 * The cap is what makes this cheap on a large lorebook — every pair of entries is compared,
 * and the answer needed is "within two edits or not", never the exact figure.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previous = current
  }
  return previous[b.length]
}

/** Whether two normalized names are within the drift allowed at their length. */
function isSpellingDrift(a: string, b: string): boolean {
  const allowed = allowedEdits(Math.min(a.length, b.length))
  if (allowed === 0) return false
  return editDistance(a, b, allowed) <= allowed
}

interface Normalized {
  type: string
  /** Every name this entry answers to, the entry's own first. Precomputed: every pair is compared. */
  keys: string[]
  keySet: Set<string>
  /** The tokens of each key, in the same order. */
  tokens: string[][]
}

/**
 * Whether one name is the other with more words around it, which is what makes "Kaelen"
 * and "Kaelen the Bold" one candidate.
 *
 * Whole tokens on both sides, so this is boundary-aware by construction: "Ren" is a token
 * of "Ren Wald" and is not a token of "Renwald". That is why there is no length floor here
 * — a floor would only rule out the short *whole* names this is meant to catch, while the
 * substring noise it was aimed at ("Ren" inside "Renwald") cannot arise in the first place.
 *
 * A token may also match by the drift allowed at its length, so a name that was both
 * extended and misspelled is still caught.
 *
 * Each longer token answers for one shorter token and no more. Without that, a name whose
 * own tokens repeat — or near-repeat, once drift is allowed — is "contained" in a longer
 * name that carries the word once, which is not what containment means.
 */
function isContained(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length === 0 || shorter.length >= longer.length) return false

  const taken = new Array<boolean>(longer.length).fill(false)
  return shorter.every((token) => {
    // The exact hit first: the edit distance is the expensive half of this module and most
    // tokens are carried over unchanged.
    let at = longer.findIndex((other, i) => !taken[i] && other === token)
    if (at === -1) at = longer.findIndex((other, i) => !taken[i] && isSpellingDrift(token, other))
    if (at === -1) return false
    taken[at] = true
    return true
  })
}

/**
 * Why these two might be one entry, or null if there is no reason to think so.
 *
 * Order matters: the strongest reason wins, because it is what the agent is shown and a
 * "same-name" pair deserves less deliberation than a "contained" one.
 *
 * Containment and drift run over **every form against every form**, not just the two
 * primary names: an alias is extended and misspelled exactly like a name, and comparing
 * only the names missed "Kaelen" against an entry called "Kaelan the Bold".
 */
function pairReason(a: Normalized, b: Normalized): DuplicateReason | null {
  if (a.keys.length === 0 || b.keys.length === 0) return null

  if (a.keys[0] === b.keys[0]) return 'same-name'

  for (const key of a.keySet) {
    if (b.keySet.has(key)) return 'shared-alias'
  }

  // Beyond exact naming, only entries of the same kind are worth comparing: a location and
  // a character sharing a word are a namesake, not a duplicate.
  if (a.type !== b.type) return null

  for (const aTokens of a.tokens) {
    for (const bTokens of b.tokens) {
      if (isContained(aTokens, bTokens)) return 'contained'
    }
  }

  for (const aKey of a.keys) {
    for (const bKey of b.keys) {
      if (isSpellingDrift(aKey, bKey)) return 'similar'
    }
  }

  return null
}

const REASON_RANK: Record<DuplicateReason, number> = {
  'same-name': 0,
  'shared-alias': 1,
  contained: 2,
  similar: 3,
}

/**
 * Group entries that may be duplicates of one another.
 *
 * Grouping is transitive — if A matches B and B matches C, all three are one group — so a
 * name that drifted across three spellings is one item of work rather than three pairs.
 */
export function findDuplicateGroups(entries: DuplicateCandidateInput[]): DuplicateGroup[] {
  const normalized: Normalized[] = entries.map((entry) => {
    const name = normalizeName(entry.name)
    const aliases = (entry.aliases ?? []).map(normalizeName).filter(Boolean)
    // An entry whose name folds to nothing is not compared at all: the empty string is
    // equal to every other empty string, and two names this module cannot read are not
    // two names it may declare the same.
    const keys = name ? [...new Set([name, ...aliases])] : []
    return {
      type: entry.type,
      keys,
      keySet: new Set(keys),
      tokens: keys.map(tokensOf),
    }
  })

  // Union-find over the pairs, so transitive matches collapse into one group.
  const parent = normalized.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const reasons = new Map<number, DuplicateReason>()

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const reason = pairReason(normalized[i], normalized[j])
      if (!reason) continue
      const rootI = find(i)
      const rootJ = find(j)
      const existing = [reasons.get(rootI), reasons.get(rootJ), reason].filter(
        (r): r is DuplicateReason => r !== undefined,
      )
      const best = existing.sort((x, y) => REASON_RANK[x] - REASON_RANK[y])[0]
      if (rootI !== rootJ) parent[rootJ] = rootI
      reasons.set(find(i), best)
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < normalized.length; i++) {
    const root = find(i)
    if (!reasons.has(root)) continue
    const members = groups.get(root)
    if (members) members.push(i)
    else groups.set(root, [i])
  }

  return [...groups.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([root, indices]) => ({
      indices,
      names: indices.map((i) => entries[i].name),
      reason: reasons.get(root) ?? 'similar',
    }))
    .sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.indices[0] - b.indices[0])
    .slice(0, MAX_GROUPS)
}

const REASON_LABELS: Record<DuplicateReason, string> = {
  'same-name': 'identical names',
  'shared-alias': 'shared name or alias',
  contained: 'one name contains the other',
  similar: 'near-identical spelling',
}

/**
 * One line per group, in the index form every lorebook tool takes.
 *
 * `consumed` drops the members a merge or a delete has already taken. A group stays open
 * while two of its members are left, and reprinting the dead indices alongside them offers
 * the agent an index every tool will refuse. It is required rather than optional so that
 * `groups.map(formatDuplicateGroup)` cannot compile: that hands the map's index across as
 * the set.
 */
export function formatDuplicateGroup(group: DuplicateGroup, consumed: ReadonlySet<number>): string {
  const members = group.indices
    .map((index, n) => ({ index, name: group.names[n] }))
    .filter(({ index }) => !consumed.has(index))
    .map(({ index, name }) => `[${index}] ${name}`)
    .join(' | ')
  return `${members} — ${REASON_LABELS[group.reason]}`
}

/**
 * Whether naming `named` settles this group.
 *
 * Every member has to be accounted for: closing on one shared index dismissed neighbouring
 * groups nobody had looked at. A `consumed` index counts as accounted for, and that half is
 * why this lives next to `formatDuplicateGroup` — the listing hides those indices, so a rule
 * that demanded them back would leave every group that survived a merge or a delete
 * impossible to close, with the agent refused for an index it was never shown.
 */
export function groupIsSettledBy(
  group: DuplicateGroup,
  named: ReadonlySet<number>,
  consumed: ReadonlySet<number>,
): boolean {
  return group.indices.every((i) => named.has(i) || consumed.has(i))
}
