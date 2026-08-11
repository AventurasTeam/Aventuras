/**
 * What merging two records the classifier minted for one subject would write.
 *
 * A **plan**, not a result: every field is described with where its value came from and
 * whether the rows disagreed, so the user sees the write before it happens and settles the
 * disagreements. The first version returned a finished object and silently preferred the
 * primary field by field, which lost a description the moment both rows had one — and put
 * `status` outside the user's reach entirely, so a merge could mark a living character dead
 * whichever row was picked.
 *
 * The rules that survive as defaults are only the ones a machine can justify:
 *
 * - a field only one row has is that row's, and is not a decision;
 * - lists (traits, aliases, keywords) are unioned, so nothing is dropped;
 * - everything else defaults to the row the user chose to keep, and is **marked** as a
 *   conflict when the rows disagree.
 *
 * There is deliberately no "the newer row wins": `characters`, `locations` and `items` have
 * no creation timestamp, so which of two conflicting values is more recent is a question
 * the data cannot answer.
 *
 * Plain TypeScript: no store, no database.
 */

import type { Character, Entry, Item, Location } from '$lib/types'

/** Where a field's value came from, which is what the preview shows next to it. */
export type FieldOrigin =
  | 'only' // one row had it; nothing to decide
  | 'agreed' // every row that had it said the same thing
  | 'union' // lists, merged; nothing is lost
  | 'conflict' // the rows disagree and one has to be picked

export interface MergeCandidate {
  /** Name of the record this value came from, so the choice is legible. */
  from: string
  value: unknown
  display: string
}

export interface MergeField {
  key: string
  label: string
  origin: FieldOrigin
  candidates: MergeCandidate[]
  /** Index into `candidates`, or `APPEND` for "keep both, one after the other". */
  chosen: number
  /** Whether joining the candidates end to end is meaningful. Long text only. */
  appendable: boolean
  /** What a union field resolves to. Unused for the other origins. */
  unionValue?: unknown
  display: string
}

/** `chosen` value meaning "concatenate every candidate rather than pick one". */
export const APPEND = -1

export interface MergePlan {
  primaryId: string
  /** Names of the records this merge consumes, for the confirmation line. */
  absorbing: string[]
  fields: MergeField[]
}

const isEmpty = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && !v.trim()) ||
  (Array.isArray(v) && v.length === 0)

interface Source {
  name: string
  value: unknown
}

/**
 * One scalar field across the sources.
 *
 * The primary comes first, so when the rows disagree its value is the pre-selected one —
 * "keep this record" is the choice the user already made, and the preview lets them
 * override it per field rather than making it mean something different per field.
 */
function scalarField(
  key: string,
  label: string,
  sources: Source[],
  options: { appendable?: boolean; format?: (v: unknown) => string } = {},
): MergeField {
  const format = options.format ?? ((v: unknown) => String(v ?? ''))
  const filled = sources.filter((s) => !isEmpty(s.value))

  // Deduplicated by value, not by what it renders as: two different portraits both read
  // as "image", and collapsing them would hide a choice rather than settle it.
  const candidates: MergeCandidate[] = []
  for (const source of filled) {
    if (!candidates.some((c) => c.value === source.value)) {
      candidates.push({ from: source.name, value: source.value, display: format(source.value) })
    }
  }

  const origin: FieldOrigin =
    candidates.length === 0
      ? 'only'
      : candidates.length === 1
        ? filled.length > 1
          ? 'agreed'
          : 'only'
        : 'conflict'

  return {
    key,
    label,
    origin,
    candidates,
    chosen: candidates.length > 0 ? 0 : APPEND,
    appendable: (options.appendable ?? false) && candidates.length > 1,
    display: candidates[0]?.display ?? '—',
  }
}

/** A list field: every value from every source, deduplicated. Nothing to decide. */
function unionField(key: string, label: string, sources: Source[]): MergeField {
  const merged = [...new Set(sources.flatMap((s) => (s.value as string[] | undefined) ?? []))]
  return {
    key,
    label,
    origin: 'union',
    candidates: [],
    chosen: APPEND,
    appendable: false,
    unionValue: merged,
    display: merged.length > 0 ? merged.join(', ') : '—',
  }
}

/** Objects merged key by key, the primary winning where two rows fill the same key. */
function objectUnionField(key: string, label: string, sources: Source[]): MergeField {
  const merged = Object.assign(
    {},
    ...sources.map((s) => (s.value as Record<string, unknown> | undefined) ?? {}).reverse(),
  ) as Record<string, unknown>
  const filled = Object.entries(merged).filter(([, v]) => !isEmpty(v))
  return {
    key,
    label,
    origin: 'union',
    candidates: [],
    chosen: APPEND,
    appendable: false,
    unionValue: Object.fromEntries(filled),
    display: filled.length > 0 ? filled.map(([k, v]) => `${k}: ${v}`).join(', ') : '—',
  }
}

const sourcesOf = <T>(records: T[], name: (r: T) => string, value: (r: T) => unknown): Source[] =>
  records.map((r) => ({ name: name(r), value: value(r) }))

/** The primary first, then the rest in the order they were listed. */
function order<T extends { id: string }>(primary: T, others: T[]): T[] {
  return [primary, ...others.filter((o) => o.id !== primary.id)]
}

export function planCharacterMerge(primary: Character, others: Character[]): MergePlan {
  const all = order(primary, others)
  const src = (value: (c: Character) => unknown) => sourcesOf(all, (c) => c.name, value)

  return {
    primaryId: primary.id,
    absorbing: all.slice(1).map((c) => c.name),
    fields: [
      scalarField(
        'description',
        'Description',
        src((c) => c.description),
        { appendable: true },
      ),
      // No special case for `self`: the protagonist is never offered as a merge candidate,
      // so a plan can neither gain nor lose the marker.
      scalarField(
        'relationship',
        'Relationship',
        src((c) => c.relationship),
        { appendable: true },
      ),
      // A plain conflict like any other. It used to take any non-`active` value from any
      // row, which read as "never resurrect" and worked out as "the user cannot say".
      scalarField(
        'status',
        'Status',
        src((c) => c.status),
      ),
      unionField(
        'traits',
        'Traits',
        src((c) => c.traits),
      ),
      objectUnionField(
        'visualDescriptors',
        'Appearance',
        src((c) => c.visualDescriptors),
      ),
      scalarField(
        'portrait',
        'Portrait',
        src((c) => c.portrait),
        {
          format: () => 'image',
        },
      ),
    ],
  }
}

export function planLocationMerge(primary: Location, others: Location[]): MergePlan {
  const all = order(primary, others)
  const src = (value: (l: Location) => unknown) => sourcesOf(all, (l) => l.name, value)
  return {
    primaryId: primary.id,
    absorbing: all.slice(1).map((l) => l.name),
    fields: [
      scalarField(
        'description',
        'Description',
        src((l) => l.description),
        { appendable: true },
      ),
      scalarField(
        'visited',
        'Visited',
        src((l) => (l.visited ? true : null)),
        {
          format: () => 'yes',
        },
      ),
    ],
  }
}

export function planItemMerge(primary: Item, others: Item[]): MergePlan {
  const all = order(primary, others)
  const src = (value: (i: Item) => unknown) => sourcesOf(all, (i) => i.name, value)
  return {
    primaryId: primary.id,
    absorbing: all.slice(1).map((i) => i.name),
    fields: [
      scalarField(
        'description',
        'Description',
        src((i) => i.description),
        { appendable: true },
      ),
      scalarField(
        'quantity',
        'Quantity',
        src((i) => i.quantity),
      ),
    ],
  }
}

export function planEntryMerge(primary: Entry, others: Entry[]): MergePlan {
  const all = order(primary, others)
  const src = (value: (e: Entry) => unknown) => sourcesOf(all, (e) => e.name, value)
  return {
    primaryId: primary.id,
    absorbing: all.slice(1).map((e) => e.name),
    fields: [
      scalarField(
        'description',
        'Description',
        src((e) => e.description),
        { appendable: true },
      ),
      scalarField(
        'hiddenInfo',
        'Hidden info',
        src((e) => e.hiddenInfo),
        { appendable: true },
      ),
      // The absorbed names join the aliases: that is what stops the same duplicate being
      // re-created, and what makes the entry match when the story uses that form.
      unionField(
        'aliases',
        'Aliases',
        sourcesOf(
          all,
          (e) => e.name,
          (e) => [...(e.aliases ?? []), ...(e.id === primary.id ? [] : [e.name])],
        ),
      ),
      unionField(
        'keywords',
        'Keywords',
        src((e) => e.injection.keywords),
      ),
    ],
  }
}

/** Separator for an appended text field, matching how the lorebook already joins prose. */
const APPEND_SEPARATOR = '\n\n'

/**
 * Join the candidates, skipping any whose text the result already carries.
 *
 * Two rows for one subject often repeat each other outright — the classifier copies a
 * description forward when it mints the second. It is also what makes a merge safe to
 * re-run after a partial failure, where the primary already holds the joined text.
 */
function appendCandidates(candidates: MergeCandidate[]): string {
  const parts: string[] = []
  for (const candidate of candidates) {
    const text = String(candidate.value).trim()
    if (!text || parts.some((p) => p.includes(text))) continue
    parts.push(text)
  }
  return parts.join(APPEND_SEPARATOR)
}

/** What the plan writes, once its conflicts are settled. */
export function applyMergePlan(plan: MergePlan): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const field of plan.fields) {
    if (field.origin === 'union') {
      out[field.key] = field.unionValue
      continue
    }
    // No row had a value, so the merge has nothing to say about this field and omits it
    // rather than writing `null` over it. The distinction is not cosmetic: `visited` and
    // `status` are non-nullable, and the update is a `Partial<T>` — a key that is absent
    // leaves the record alone, a key set to `null` overwrites it with something the type
    // does not allow.
    if (field.candidates.length === 0) continue
    if (field.chosen === APPEND) {
      out[field.key] = appendCandidates(field.candidates)
      continue
    }
    out[field.key] = field.candidates[field.chosen]?.value ?? field.candidates[0].value
  }

  return out
}

/** Whether anything in this plan still needs the user to choose. */
export function hasConflicts(plan: MergePlan): boolean {
  return plan.fields.some((f) => f.origin === 'conflict')
}
