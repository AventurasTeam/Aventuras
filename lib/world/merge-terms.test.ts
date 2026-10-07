import { describe, expect, it } from 'vitest'

import {
  computeDivergence,
  keywordUnion,
  selectedTerms,
  type EntitySummary,
  type TermPartition,
} from '@/components/compounds/collision-resolve-diff'
import { dedupeTerms, normalizeTerm } from '@/lib/keyword-terms'

import { cleanList } from './draft-text'
import { mergedTerms, type MergeDeselections } from './merge-terms'

type Terms = { tags: string[]; keywords: string[] }

const NONE: MergeDeselections = { deselectedTags: [], deselectedKeywords: [] }

describe('mergedTerms', () => {
  it("keeps the canonical's terms in stored order, then the other row's additions sorted", () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: ['watch', 'guard'], keywords: ['the sergeant', 'Brannoc'] },
          other: { tags: ['smuggler', 'guard', 'Alpha'], keywords: ['the river gate', 'Amber'] },
        },
        NONE,
      ),
    ).toStrictEqual({
      tags: ['watch', 'guard', 'Alpha', 'smuggler'],
      keywords: ['the sergeant', 'Brannoc', 'Amber', 'the river gate'],
    })
  })

  it("keeps a shared keyword once, in the canonical's first spelling", () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: [], keywords: [' The Courier ', 'the courier'] },
          other: { tags: [], keywords: ['THE COURIER', 'grey wolf'] },
        },
        NONE,
      ).keywords,
    ).toStrictEqual(['The Courier', 'grey wolf'])
  })

  it('drops deselected tags by their trimmed text and keywords by their normalized key', () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: ['guard', 'watch'], keywords: ['the guard', 'Sergeant'] },
          other: { tags: ['captain', 'Guard'], keywords: ['Captain Brannoc', 'the gate'] },
        },
        { deselectedTags: [' watch', 'Guard'], deselectedKeywords: ['sergeant', 'THE GATE'] },
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain Brannoc'] })
  })

  it('cleans blank, padded and repeated terms on either row', () => {
    expect(
      mergedTerms(
        {
          canonical: { tags: [' guard', '', 'guard'], keywords: ['  ', 'the guard '] },
          other: { tags: ['captain ', 'captain', ' '], keywords: ['', ' Captain'] },
        },
        NONE,
      ),
    ).toStrictEqual({ tags: ['guard', 'captain'], keywords: ['the guard', 'Captain'] })
  })
})

function summary(id: string, terms: Terms): EntitySummary {
  return {
    id,
    kind: 'character',
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Brannoc',
    status: 'active',
    injectionMode: 'auto',
    priority: 0,
    tags: terms.tags,
    keywords: terms.keywords,
    state: {},
    relationCounts: {
      awarenessRows: 0,
      involvements: 0,
      relationships: 0,
      joiningRelationship: false,
      inverseRefs: 0,
      embeddings: 0,
      translationRows: 0,
      unheldItems: 0,
      overlap: { awareness: 0, involvements: 0, relationships: 0, holdersLosingItem: 0 },
    },
  }
}

/** The lists CollisionResolveDialog submits today, as the merge planner then cleaned them. */
function dialogWrites(
  a: EntitySummary,
  b: EntitySummary,
  canonicalId: string,
  deselected: MergeDeselections,
): Terms {
  const canonical = canonicalId === a.id ? a : b
  const diff = computeDivergence(a, b)
  const termUnion = (partition: TermPartition) =>
    partition == null ? [] : [...partition.both, ...partition.onlyInA, ...partition.onlyInB].sort()
  const finalTags =
    diff.tags == null
      ? canonical.tags
      : selectedTerms({
          own: canonical.tags,
          offered: termUnion(diff.tags),
          deselected: [...deselected.deselectedTags],
          keyOf: (tag) => tag,
        })
  const finalKeywords =
    diff.keywords == null
      ? canonical.keywords
      : selectedTerms({
          own: dedupeTerms(canonical.keywords),
          offered: keywordUnion(diff.keywords, canonical.keywords),
          deselected: deselected.deselectedKeywords.map(normalizeTerm),
          keyOf: normalizeTerm,
        })
  return { tags: [...new Set(cleanList(finalTags))], keywords: dedupeTerms(finalKeywords) }
}

describe('mergedTerms matches what the collision dialog submits', () => {
  const fixtures: { name: string; a: Terms; b: Terms; deselected: MergeDeselections[] }[] = [
    {
      name: 'disjoint lists',
      a: { tags: ['watch', 'guard'], keywords: ['the sergeant', 'Brannoc'] },
      b: { tags: ['smuggler', 'Alpha', 'beta'], keywords: ['the river gate', 'Amber'] },
      deselected: [
        NONE,
        { deselectedTags: ['guard', 'beta'], deselectedKeywords: [] },
        { deselectedTags: [], deselectedKeywords: ['brannoc', 'the river gate'] },
      ],
    },
    {
      name: 'a shared keyword spelled differently, a shared tag',
      a: { tags: ['guard', 'watch'], keywords: ['The Courier', 'grey wolf'] },
      b: { tags: ['watch', 'courier'], keywords: ['the courier', 'Amber', 'brannoc'] },
      deselected: [
        NONE,
        { deselectedTags: ['watch'], deselectedKeywords: ['the courier'] },
        { deselectedTags: ['courier'], deselectedKeywords: ['grey wolf', 'amber'] },
      ],
    },
    {
      name: 'the same lists in another order',
      a: { tags: ['b', 'a'], keywords: ['Kael', 'the guard'] },
      b: { tags: ['a', 'b'], keywords: ['the guard', 'kael'] },
      deselected: [NONE],
    },
    {
      name: 'one side empty',
      a: { tags: [], keywords: [] },
      b: { tags: ['captain'], keywords: ['Captain Brannoc', 'the captain'] },
      deselected: [NONE, { deselectedTags: ['captain'], deselectedKeywords: ['the captain'] }],
    },
  ]

  for (const { name, a, b, deselected } of fixtures)
    for (const canonicalId of ['a', 'b'])
      it.each(deselected)(`${name}, canonical ${canonicalId}, deselected %o`, (picks) => {
        const sideA = summary('a', a)
        const sideB = summary('b', b)
        const [canonical, other] = canonicalId === 'a' ? [a, b] : [b, a]
        expect(mergedTerms({ canonical, other }, picks)).toStrictEqual(
          dialogWrites(sideA, sideB, canonicalId, picks),
        )
      })
})
