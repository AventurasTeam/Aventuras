/** 3e: a merge joins no source past this; a longer source already stored stands whole. */
export const MERGED_SOURCE_MAX = 120

const SOURCE_SEPARATOR = '; '

/** One happening's link rows as a merge reads them. */
export type LinkRows = {
  involvements: readonly { id: string; entityId: string; role: string | null }[]
  awareness: readonly {
    id: string
    characterId: string
    learnedAtEntryId: string | null
    decayResistance: number | null
    retrievalCount: number
    source: string | null
  }[]
}

/** What a merge writes onto keep's links: the involvements to create, the awareness to upsert. */
export type MergeFold = {
  involvements: readonly { entityId: string; role: string | null }[]
  awareness: readonly {
    characterId: string
    learnedAtEntryId: string | null
    decayResistance: number | null
    retrievalCount: number
    source: string | null
  }[]
}

type AwarenessRow = LinkRows['awareness'][number]
type FoldedAwareness = MergeFold['awareness'][number]
/** A field the fold writes on a character's awareness of keep. */
export type AwarenessField = Exclude<keyof FoldedAwareness, 'characterId'>

// A Record, so a field the fold gains fails to compile until it's listed here.
const FOLDED_FIELDS: Record<AwarenessField, true> = {
  learnedAtEntryId: true,
  decayResistance: true,
  retrievalCount: true,
  source: true,
}
export const AWARENESS_FIELDS = Object.keys(FOLDED_FIELDS) as readonly AwarenessField[]

/** An entry's position on the branch; undefined for an entry off it. */
export type PositionOf = (entryId: string) => number | undefined

// 3e: earliest by entry position. An anchor with no position loses to one with, null to both; a
// tie keeps `a`, so keep's own anchor stands.
export function earlierAnchor(
  a: string | null,
  b: string | null,
  positionOf: PositionOf,
): string | null {
  if (a === null) return b
  if (b === null) return a
  const atA = positionOf(a)
  const atB = positionOf(b)
  if (atB === undefined) return a
  if (atA === undefined) return b
  return atB < atA ? b : a
}

// 3e: the highest decay_resistance; an unset one ranks below any value.
function higherDecay(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/**
 * Distinct sources in first-seen order, joined with `; `. The first stands whole; a later one joins
 * only while the join stays within MERGED_SOURCE_MAX, so a merge never cuts a stored source.
 */
function joinedSources(sources: readonly (string | null)[]): string | null {
  let joined: string | null = null
  const held = new Set<string>()
  for (const source of sources) {
    if (source === null) continue
    const text = source.trim()
    if (text === '' || held.has(text)) continue
    if (joined === null) joined = source
    else {
      const next: string = `${joined}${SOURCE_SEPARATOR}${text}`
      if (next.length > MERGED_SOURCE_MAX) continue
      joined = next
    }
    held.add(text)
    for (const part of text.split(SOURCE_SEPARATOR)) held.add(part.trim())
  }
  return joined
}

function foldedAwareness(
  characterId: string,
  rows: readonly AwarenessRow[],
  positionOf: PositionOf,
): FoldedAwareness {
  return {
    characterId,
    learnedAtEntryId: rows.reduce<string | null>(
      (earliest, row) => earlierAnchor(earliest, row.learnedAtEntryId, positionOf),
      null,
    ),
    decayResistance: rows.reduce<number | null>(
      (highest, row) => higherDecay(highest, row.decayResistance),
      null,
    ),
    retrievalCount: rows.reduce((sum, row) => sum + row.retrievalCount, 0),
    source: joinedSources(rows.map((row) => row.source)),
  }
}

/** The fields where a fold differs from the awareness row it lands on. */
export function changedAwarenessFields(
  stored: AwarenessRow,
  folded: FoldedAwareness,
): AwarenessField[] {
  return AWARENESS_FIELDS.filter((field) => stored[field] !== folded[field])
}

/**
 * 3e's mechanical merge of link rows onto keep: an involvement for each entity keep lacks, with the
 * first absorbed row's role; one awareness per character across keep and the absorbed rows. A
 * character only keep holds, or a fold restating keep's row, writes nothing.
 */
export function foldMergeLinks(
  keep: LinkRows,
  absorbed: readonly LinkRows[],
  positionOf: PositionOf,
): MergeFold {
  const involved = new Set(keep.involvements.map(({ entityId }) => entityId))
  const involvements: { entityId: string; role: string | null }[] = []
  for (const rows of absorbed)
    for (const { entityId, role } of rows.involvements) {
      if (involved.has(entityId)) continue
      involved.add(entityId)
      involvements.push({ entityId, role })
    }

  const kept = new Map(keep.awareness.map((row) => [row.characterId, row]))
  const carried = new Map<string, AwarenessRow[]>()
  for (const rows of absorbed)
    for (const row of rows.awareness)
      carried.set(row.characterId, [...(carried.get(row.characterId) ?? []), row])
  const awareness: FoldedAwareness[] = []
  for (const [characterId, rows] of carried) {
    const stored = kept.get(characterId)
    const folded = foldedAwareness(
      characterId,
      stored === undefined ? rows : [stored, ...rows],
      positionOf,
    )
    if (stored === undefined || changedAwarenessFields(stored, folded).length > 0)
      awareness.push(folded)
  }
  return { involvements, awareness }
}
