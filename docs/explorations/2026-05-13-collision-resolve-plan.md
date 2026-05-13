# CollisionResolveDialog + CollisionListRow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `CollisionResolveDialog` and `CollisionListRow` per
[design](./2026-05-13-collision-resolve-design.md) (commit `aeab984`).

**Architecture:** Two compounds composing existing primitives. Pure
`computeDivergence` + pure merge `reducer` live in their own files
with vitest coverage. Dialog View is a single file with three body
modes (Merge / Rename / Keep) rendered inline. Strip compound wraps
shipped `ListRow` with a sibling warn-tinted strip outside the row's
`Pressable`. Each shipped compound lands with its inventory + spec
updates in the same commit.

**Tech Stack:** React 19 + RN 0.83 + Expo SDK 55 + RN Web + NativeWind
4 + Tailwind 3. Vitest for pure-module tests. Storybook
(react-native-web-vite) for visual coverage. Existing shipped
primitives: `Dialog`, `Select` (mode=`segment`), `Chip`, `Button`,
`Input`, `Text`, `ListRow`. No new dependencies.

---

## File map

```
components/compounds/
  collision-resolve-diff.ts          NEW — types + computeDivergence
  collision-resolve-diff.test.ts     NEW — vitest
  collision-resolve-machine.ts       NEW — merge reducer + types
  collision-resolve-machine.test.ts  NEW — vitest
  collision-resolve-dialog.tsx       NEW — view with three body modes
  collision-resolve-dialog.stories.tsx NEW — Storybook matrix
  collision-list-row.tsx             NEW — row + strip compound
  collision-list-row.stories.tsx     NEW — Storybook matrix

docs/ui/component-inventory.md       MODIFY (Tasks 4 + 5)
docs/followups.md                    MODIFY (Task 4)
```

## Task order rationale

1. **Diff module first** — types + `computeDivergence` are pure;
   no UI dependencies; defines the `EntitySummary` / `Resolution`
   types that everything else imports. TDD-friendly.
2. **Machine module second** — merge reducer depends on
   `DiffPayload` from Task 1. Also pure; TDD-friendly.
3. **Dialog view third** — composes Task 1 + Task 2 + existing
   primitives. Includes all three body modes inline.
4. **Dialog stories + inventory + followups** — same commit as
   the dialog ship per the `feedback_inventory_double_entry`
   memory rule (paraphrased: "drop build-ready / needs-design row
   in same commit as shipped row addition").
5. **Strip compound + stories + inventory** — separate commit
   because the strip is its own compound; ships with its own
   inventory delta (add shipped row + drop ListRow modifications-
   pending row + trim ListRow's trailing sentence).

Tasks 4 and 5 are independent — strip can ship before or after
dialog. Default order is dialog first because it's the more
complex piece.

---

## Task 1: Diff module + tests

**Files:**

- Create: `components/compounds/collision-resolve-diff.ts`
- Create: `components/compounds/collision-resolve-diff.test.ts`

### Step 1.1 — Stub the diff file with type declarations only

Create `components/compounds/collision-resolve-diff.ts`:

```ts
export type EntityKind = 'character' | 'location' | 'item' | 'faction'

export type EntityStatus = 'active' | 'staged' | 'retired'

export type InjectionMode = 'always' | 'on-relevance' | 'never'

export type ScalarField = 'name' | 'description' | 'status' | 'retiredReason' | 'injectionMode'

export type EntitySummary = {
  id: string
  kind: EntityKind
  createdAt: string
  name: string
  description?: string
  status: EntityStatus
  retiredReason?: string
  injectionMode: InjectionMode
  tags: string[]
  state: Record<string, unknown>
  relationCounts: {
    awarenessRows: number
    involvements: number
    inverseRefs: number
    embeddings: 0 | 1
    translationRows: number
  }
}

export type DiffPayload = {
  divergentScalars: ScalarField[]
  tags: { onlyInA: string[]; onlyInB: string[]; both: string[] } | null
  stateDivergent: boolean
}

export type Resolution =
  | {
      mode: 'merge'
      canonicalId: string
      fieldChoices: Record<ScalarField, 'A' | 'B'>
      finalTags: string[]
    }
  | {
      mode: 'rename'
      renames: Array<{ id: string; newName: string }>
    }
  | { mode: 'keep' }

// Fixed scalar order for stable rendering. Matches the spec's
// table column order in world.md → Merge.
export const SCALAR_FIELDS: ScalarField[] = [
  'name',
  'description',
  'status',
  'retiredReason',
  'injectionMode',
]

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  throw new Error('not implemented')
}
```

### Step 1.2 — Write the failing tests

Create `components/compounds/collision-resolve-diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { computeDivergence, type EntitySummary } from './collision-resolve-diff'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_a',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'on-relevance',
    tags: ['hero', 'sword'],
    state: { hp: 100 },
    relationCounts: {
      awarenessRows: 0,
      involvements: 0,
      inverseRefs: 0,
      embeddings: 1,
      translationRows: 0,
    },
    ...overrides,
  }
}

describe('computeDivergence', () => {
  describe('scalars', () => {
    it('returns empty divergentScalars when all match', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual([])
    })

    it('detects single divergent scalar', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b', description: 'A city guardsman.' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual(['description'])
    })

    it('detects multiple divergent scalars in fixed order', () => {
      const a = baseEntity()
      const b = baseEntity({
        id: 'ent_b',
        name: 'Kael the Bold',
        description: 'A city guardsman.',
        status: 'retired',
      })
      const diff = computeDivergence(a, b)
      // Order matches SCALAR_FIELDS, not input order
      expect(diff.divergentScalars).toEqual(['name', 'description', 'status'])
    })

    it('treats undefined description as divergent from a string', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b', description: undefined })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toContain('description')
    })

    it('treats two undefined retiredReasons as matching', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).not.toContain('retiredReason')
    })
  })

  describe('tags', () => {
    it('returns null when tag sets are identical (order-insensitive)', () => {
      const a = baseEntity({ tags: ['hero', 'sword'] })
      const b = baseEntity({ id: 'ent_b', tags: ['sword', 'hero'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toBeNull()
    })

    it('returns null when both tag sets are empty', () => {
      const a = baseEntity({ tags: [] })
      const b = baseEntity({ id: 'ent_b', tags: [] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toBeNull()
    })

    it('partitions onlyInA / onlyInB / both', () => {
      const a = baseEntity({ tags: ['hero', 'sword', 'noble'] })
      const b = baseEntity({ id: 'ent_b', tags: ['sword', 'guard'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toEqual({
        onlyInA: ['hero', 'noble'],
        onlyInB: ['guard'],
        both: ['sword'],
      })
    })

    it('sorts each partition alphabetically', () => {
      const a = baseEntity({ tags: ['zebra', 'apple'] })
      const b = baseEntity({ id: 'ent_b', tags: ['mango', 'banana'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toEqual({
        onlyInA: ['apple', 'zebra'],
        onlyInB: ['banana', 'mango'],
        both: [],
      })
    })
  })

  describe('state', () => {
    it('returns false when state objects deep-equal', () => {
      const a = baseEntity({ state: { hp: 100, mp: 50 } })
      const b = baseEntity({ id: 'ent_b', state: { mp: 50, hp: 100 } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(false)
    })

    it('returns true when scalars in state differ', () => {
      const a = baseEntity({ state: { hp: 100 } })
      const b = baseEntity({ id: 'ent_b', state: { hp: 80 } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns true when nested objects differ', () => {
      const a = baseEntity({ state: { stats: { str: 10 } } })
      const b = baseEntity({ id: 'ent_b', state: { stats: { str: 12 } } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns true when arrays differ', () => {
      const a = baseEntity({ state: { inventory: ['sword', 'shield'] } })
      const b = baseEntity({ id: 'ent_b', state: { inventory: ['sword'] } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('treats missing key as different from explicit undefined', () => {
      const a = baseEntity({ state: { hp: 100 } })
      const b = baseEntity({ id: 'ent_b', state: { hp: 100, mp: undefined } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns false when both states are empty', () => {
      const a = baseEntity({ state: {} })
      const b = baseEntity({ id: 'ent_b', state: {} })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(false)
    })
  })

  describe('combined', () => {
    it('reports all dimensions diverging at once', () => {
      const a = baseEntity({
        description: 'A',
        tags: ['x'],
        state: { hp: 100 },
      })
      const b = baseEntity({
        id: 'ent_b',
        description: 'B',
        tags: ['y'],
        state: { hp: 80 },
      })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual(['description'])
      expect(diff.tags).toEqual({ onlyInA: ['x'], onlyInB: ['y'], both: [] })
      expect(diff.stateDivergent).toBe(true)
    })

    it('reports truly identical entities cleanly', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual([])
      expect(diff.tags).toBeNull()
      expect(diff.stateDivergent).toBe(false)
    })
  })
})
```

### Step 1.3 — Run tests to verify they fail

Run: `pnpm vitest run components/compounds/collision-resolve-diff.test.ts`
Expected: All tests FAIL with `not implemented` error.

### Step 1.4 — Implement `computeDivergence`

Replace the stub in `collision-resolve-diff.ts`:

```ts
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  // Includes the missing-key vs explicit-undefined distinction:
  // if bKeys lacks a key that aKeys has, lengths differ and we
  // return false above. If both have the key but one's value is
  // undefined and the other is a non-undefined value, the
  // recursive deepEqual call returns false.
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

function diffScalar(a: EntitySummary, b: EntitySummary, field: ScalarField): boolean {
  return a[field] !== b[field]
}

export function computeDivergence(a: EntitySummary, b: EntitySummary): DiffPayload {
  const divergentScalars = SCALAR_FIELDS.filter((f) => diffScalar(a, b, f))

  const aTagSet = new Set(a.tags)
  const bTagSet = new Set(b.tags)
  const onlyInA = a.tags.filter((t) => !bTagSet.has(t)).sort()
  const onlyInB = b.tags.filter((t) => !aTagSet.has(t)).sort()
  const both = a.tags.filter((t) => bTagSet.has(t)).sort()
  const tags = onlyInA.length === 0 && onlyInB.length === 0 ? null : { onlyInA, onlyInB, both }

  const stateDivergent = !deepEqual(a.state, b.state)

  return { divergentScalars, tags, stateDivergent }
}
```

### Step 1.5 — Run tests to verify they pass

Run: `pnpm vitest run components/compounds/collision-resolve-diff.test.ts`
Expected: All tests PASS (17 tests).

### Step 1.6 — Typecheck + format

Run: `pnpm exec tsc --noEmit && pnpm exec prettier --check components/compounds/collision-resolve-diff.ts components/compounds/collision-resolve-diff.test.ts`
Expected: No errors.

If prettier reports unformatted files:
Run: `pnpm exec prettier --write components/compounds/collision-resolve-diff.ts components/compounds/collision-resolve-diff.test.ts`

### Step 1.7 — Commit

```bash
git add components/compounds/collision-resolve-diff.ts \
         components/compounds/collision-resolve-diff.test.ts
git commit -m "feat(compounds): collision-resolve-diff pure module + tests

Pure computeDivergence for entity-collision merge body. Partitions
scalar divergence (fixed-order), tag set diffs, and structural state
deep-equality. 17 vitest cases cover empty/single/multiple/identical
permutations plus tag ordering and state edge cases."
```

---

## Task 2: Merge reducer module + tests

**Files:**

- Create: `components/compounds/collision-resolve-machine.ts`
- Create: `components/compounds/collision-resolve-machine.test.ts`

### Step 2.1 — Stub the machine file

Create `components/compounds/collision-resolve-machine.ts`:

```ts
import type { DiffPayload, EntitySummary, ScalarField } from './collision-resolve-diff'

export type MergeState = {
  canonicalId: string
  fieldChoices: Record<ScalarField, 'A' | 'B'>
  deselectedTags: string[]
}

export type MergeAction =
  | { type: 'pick-canonical'; id: string; entityAId: string }
  | { type: 'pick-field'; field: ScalarField; side: 'A' | 'B' }
  | { type: 'toggle-tag'; tag: string }
  | {
      type: 'reset'
      diff: DiffPayload
      defaultCanonicalId: string
      entityA: EntitySummary
      entityB: EntitySummary
    }

export function initMergeState(
  diff: DiffPayload,
  defaultCanonicalId: string,
  entityA: EntitySummary,
  entityB: EntitySummary,
): MergeState {
  throw new Error('not implemented')
}

export function mergeReducer(state: MergeState, action: MergeAction): MergeState {
  throw new Error('not implemented')
}
```

`pick-canonical` carries `entityAId` so the reducer can compute the
new canonical's letter without entity references. A previous draft
of this plan tried to derive the side from
`state.fieldChoices[firstField]` — that breaks once the user has
already overridden a field via `pick-field`, because not every
choice encodes the canonical side anymore. Passing `entityAId`
through the action keeps the rebase deterministic regardless of
prior overrides.

`initMergeState` takes both entities because field-choice
initialization needs each field's value on each side to pick the
side that matches the canonical.

### Step 2.2 — Write the failing tests

Create `components/compounds/collision-resolve-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { computeDivergence, type EntitySummary } from './collision-resolve-diff'
import { initMergeState, mergeReducer, type MergeState } from './collision-resolve-machine'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_a',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'on-relevance',
    tags: ['hero', 'sword'],
    state: { hp: 100 },
    relationCounts: {
      awarenessRows: 0,
      involvements: 0,
      inverseRefs: 0,
      embeddings: 1,
      translationRows: 0,
    },
    ...overrides,
  }
}

describe('initMergeState', () => {
  it('sets canonicalId to defaultCanonicalId', () => {
    const a = baseEntity()
    const b = baseEntity({ id: 'ent_b', description: 'Different' })
    const state = initMergeState(computeDivergence(a, b), a.id, a, b)
    expect(state.canonicalId).toBe('ent_a')
  })

  it('initializes deselectedTags as empty', () => {
    const a = baseEntity()
    const b = baseEntity({ id: 'ent_b', tags: ['guard'] })
    const state = initMergeState(computeDivergence(a, b), a.id, a, b)
    expect(state.deselectedTags).toEqual([])
  })

  it('initializes fieldChoices to A for each divergent scalar when canonical=A', () => {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'B desc', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), a.id, a, b)
    expect(state.fieldChoices.description).toBe('A')
    expect(state.fieldChoices.status).toBe('A')
  })

  it('initializes fieldChoices to B for each divergent scalar when canonical=B', () => {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'B desc', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), b.id, a, b)
    expect(state.fieldChoices.description).toBe('B')
    expect(state.fieldChoices.status).toBe('B')
  })

  it('omits non-divergent fields from fieldChoices', () => {
    const a = baseEntity({ description: 'same', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'same', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), a.id, a, b)
    expect(state.fieldChoices).toEqual({ status: 'A' })
  })
})

describe('mergeReducer', () => {
  function setup() {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({
      id: 'ent_b',
      description: 'B desc',
      status: 'retired',
      tags: ['guard', 'sword'],
    })
    const diff = computeDivergence(a, b)
    const initial = initMergeState(diff, a.id, a, b)
    return { a, b, diff, initial }
  }

  describe('pick-canonical', () => {
    it('updates canonicalId', () => {
      const { initial, a } = setup()
      const next = mergeReducer(initial, { type: 'pick-canonical', id: 'ent_b', entityAId: a.id })
      expect(next.canonicalId).toBe('ent_b')
    })

    it('rebases all fieldChoices to the new canonical side', () => {
      const { initial, a } = setup()
      const next = mergeReducer(initial, { type: 'pick-canonical', id: 'ent_b', entityAId: a.id })
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('B')
    })

    it('rebases ALL fields even when one was overridden first', () => {
      // Regression: a previous draft derived "new side" from the
      // first field's current choice, which is wrong once
      // pick-field has overridden a field independently.
      const { initial, a } = setup()
      const overridden = mergeReducer(initial, {
        type: 'pick-field',
        field: 'description',
        side: 'B',
      })
      // Now choices = { description: 'B', status: 'A' }, canonical still 'A'
      const next = mergeReducer(overridden, {
        type: 'pick-canonical',
        id: 'ent_b',
        entityAId: a.id,
      })
      // After flipping canonical to B, both must be 'B' — the
      // canonical-pick is destructive to prior pick-field choices.
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('B')
    })

    it('preserves deselectedTags through a canonical flip', () => {
      const { initial, a } = setup()
      const withDeselect = mergeReducer(initial, { type: 'toggle-tag', tag: 'guard' })
      const next = mergeReducer(withDeselect, {
        type: 'pick-canonical',
        id: 'ent_b',
        entityAId: a.id,
      })
      expect(next.deselectedTags).toEqual(['guard'])
    })
  })

  describe('pick-field', () => {
    it('overrides one field without touching others', () => {
      const { initial } = setup()
      // canonical is A so both choices init to 'A'
      const next = mergeReducer(initial, {
        type: 'pick-field',
        field: 'description',
        side: 'B',
      })
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('A')
    })

    it('preserves canonicalId', () => {
      const { initial } = setup()
      const next = mergeReducer(initial, {
        type: 'pick-field',
        field: 'status',
        side: 'B',
      })
      expect(next.canonicalId).toBe(initial.canonicalId)
    })
  })

  describe('toggle-tag', () => {
    it('adds a tag to deselectedTags', () => {
      const { initial } = setup()
      const next = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      expect(next.deselectedTags).toEqual(['sword'])
    })

    it('removes a previously-deselected tag', () => {
      const { initial } = setup()
      const after1 = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      const after2 = mergeReducer(after1, { type: 'toggle-tag', tag: 'sword' })
      expect(after2.deselectedTags).toEqual([])
    })

    it('accumulates multiple deselects', () => {
      const { initial } = setup()
      const s1 = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      const s2 = mergeReducer(s1, { type: 'toggle-tag', tag: 'guard' })
      expect(new Set(s2.deselectedTags)).toEqual(new Set(['sword', 'guard']))
    })
  })

  describe('reset', () => {
    it('re-initializes state for new entities', () => {
      const { initial } = setup()
      const dirty: MergeState = {
        ...initial,
        canonicalId: 'ent_b',
        deselectedTags: ['sword'],
      }
      const newA = baseEntity({ id: 'ent_c', description: 'C' })
      const newB = baseEntity({ id: 'ent_d', description: 'D' })
      const newDiff = computeDivergence(newA, newB)
      const next = mergeReducer(dirty, {
        type: 'reset',
        diff: newDiff,
        defaultCanonicalId: newA.id,
        entityA: newA,
        entityB: newB,
      })
      expect(next.canonicalId).toBe('ent_c')
      expect(next.deselectedTags).toEqual([])
      expect(next.fieldChoices.description).toBe('A')
    })
  })
})
```

### Step 2.3 — Run tests to verify they fail

Run: `pnpm vitest run components/compounds/collision-resolve-machine.test.ts`
Expected: All tests FAIL with `not implemented` error.

### Step 2.4 — Implement `initMergeState` + `mergeReducer`

Replace the stubs in `collision-resolve-machine.ts`:

```ts
import type { DiffPayload, EntitySummary, ScalarField } from './collision-resolve-diff'

export type MergeState = {
  canonicalId: string
  fieldChoices: Record<ScalarField, 'A' | 'B'>
  deselectedTags: string[]
}

export type MergeAction =
  | { type: 'pick-canonical'; id: string; entityAId: string }
  | { type: 'pick-field'; field: ScalarField; side: 'A' | 'B' }
  | { type: 'toggle-tag'; tag: string }
  | {
      type: 'reset'
      diff: DiffPayload
      defaultCanonicalId: string
      entityA: EntitySummary
      entityB: EntitySummary
    }

function sideForCanonical(canonicalId: string, entityAId: string): 'A' | 'B' {
  return canonicalId === entityAId ? 'A' : 'B'
}

function fieldChoicesForCanonical(
  diff: DiffPayload,
  side: 'A' | 'B',
): Record<ScalarField, 'A' | 'B'> {
  const result: Partial<Record<ScalarField, 'A' | 'B'>> = {}
  for (const field of diff.divergentScalars) {
    result[field] = side
  }
  return result as Record<ScalarField, 'A' | 'B'>
}

export function initMergeState(
  diff: DiffPayload,
  defaultCanonicalId: string,
  entityA: EntitySummary,
  _entityB: EntitySummary,
): MergeState {
  const side = sideForCanonical(defaultCanonicalId, entityA.id)
  return {
    canonicalId: defaultCanonicalId,
    fieldChoices: fieldChoicesForCanonical(diff, side),
    deselectedTags: [],
  }
}

export function mergeReducer(state: MergeState, action: MergeAction): MergeState {
  switch (action.type) {
    case 'pick-canonical': {
      // Rebase every divergent scalar to the new canonical's side.
      // entityAId comes in via the action so we don't need entity
      // references in the reducer. Preserve deselectedTags (tag
      // choices are independent of canonical pick).
      const newSide = sideForCanonical(action.id, action.entityAId)
      const fields = Object.keys(state.fieldChoices) as ScalarField[]
      const nextChoices: Partial<Record<ScalarField, 'A' | 'B'>> = {}
      for (const f of fields) nextChoices[f] = newSide
      return {
        ...state,
        canonicalId: action.id,
        fieldChoices: nextChoices as Record<ScalarField, 'A' | 'B'>,
      }
    }
    case 'pick-field': {
      return {
        ...state,
        fieldChoices: { ...state.fieldChoices, [action.field]: action.side },
      }
    }
    case 'toggle-tag': {
      const has = state.deselectedTags.includes(action.tag)
      return {
        ...state,
        deselectedTags: has
          ? state.deselectedTags.filter((t) => t !== action.tag)
          : [...state.deselectedTags, action.tag],
      }
    }
    case 'reset': {
      return initMergeState(action.diff, action.defaultCanonicalId, action.entityA, action.entityB)
    }
  }
}
```

`pick-canonical` derives the new side from `action.entityAId`. This
keeps the reducer entity-free while supporting the case where the
user has already overridden a field via `pick-field` (the rebase is
destructive to those overrides — every divergent scalar resets to
the new canonical's side per the spec's "this side wins by default;
override per field if you want" rule).

### Step 2.5 — Run tests to verify they pass

Run: `pnpm vitest run components/compounds/collision-resolve-machine.test.ts`
Expected: All tests PASS (~15 tests).

### Step 2.6 — Typecheck + format

Run: `pnpm exec tsc --noEmit && pnpm exec prettier --write components/compounds/collision-resolve-machine.ts components/compounds/collision-resolve-machine.test.ts`
Expected: No errors.

### Step 2.7 — Commit

```bash
git add components/compounds/collision-resolve-machine.ts \
         components/compounds/collision-resolve-machine.test.ts
git commit -m "feat(compounds): collision-resolve merge reducer + tests

Pure reducer + initMergeState for the merge body's form state.
pick-canonical rebases every fieldChoice to the new canonical's
side using entityAId from the action — entity-free reducer that
still survives prior pick-field overrides. pick-field overrides
per-scalar, toggle-tag accumulates deselects, reset rebuilds for
new entity inputs. ~15 vitest cases."
```

---

## Task 3: Dialog view

**Files:**

- Create: `components/compounds/collision-resolve-dialog.tsx`

### Step 3.1 — Create the file with imports + main export

Create `components/compounds/collision-resolve-dialog.tsx`:

```tsx
import * as React from 'react'
import { Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import {
  computeDivergence,
  SCALAR_FIELDS,
  type DiffPayload,
  type EntitySummary,
  type Resolution,
  type ScalarField,
} from './collision-resolve-diff'
import {
  initMergeState,
  mergeReducer,
  type MergeAction,
  type MergeState,
} from './collision-resolve-machine'

type Mode = 'merge' | 'rename' | 'keep'

const SCALAR_LABELS: Record<ScalarField, string> = {
  name: 'Name',
  description: 'Description',
  status: 'Status',
  retiredReason: 'Retired reason',
  injectionMode: 'Injection mode',
}

type CollisionResolveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (resolution: Resolution) => Promise<void>
}

export function CollisionResolveDialog({
  open,
  onOpenChange,
  entityA,
  entityB,
  onResolve,
}: CollisionResolveDialogProps) {
  const [mode, setMode] = React.useState<Mode>('merge')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const diff = React.useMemo(() => computeDivergence(entityA, entityB), [entityA, entityB])

  async function handleSubmit(resolution: Resolution) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(resolution)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolution failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    // Gate dismissal while a resolution is in flight — matches
    // embedder-download's submitting-state contract.
    if (submitting && !nextOpen) return
    onOpenChange(nextOpen)
  }

  function handleModeChange(value: string) {
    if (submitting) return
    setMode(value as Mode)
    setError(null)
  }

  const modeOptions: SelectOption[] = [
    { value: 'merge', label: 'Merge into one' },
    { value: 'rename', label: 'Rename one' },
    { value: 'keep', label: 'Keep as distinct' },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{`⚠ Two ${entityA.kind}s named "${entityA.name}"`}</DialogTitle>
          <DialogDescription>
            Pick how to resolve this collision. Switching modes discards in-progress choices.
          </DialogDescription>
        </DialogHeader>

        <Select
          options={modeOptions}
          value={mode}
          onValueChange={handleModeChange}
          mode="segment"
          label="Resolution path"
        />

        {mode === 'merge' && (
          <MergeBody
            entityA={entityA}
            entityB={entityB}
            diff={diff}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
        {mode === 'rename' && (
          <RenameBody
            entityA={entityA}
            entityB={entityB}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
        {mode === 'keep' && (
          <KeepBody
            name={entityA.name}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { CollisionResolveDialogProps }
```

### Step 3.2 — Implement `MergeBody`

Append to `collision-resolve-dialog.tsx`:

```tsx
type MergeBodyProps = {
  entityA: EntitySummary
  entityB: EntitySummary
  diff: DiffPayload
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function MergeBody({
  entityA,
  entityB,
  diff,
  onSubmit,
  onCancel,
  submitting,
  error,
}: MergeBodyProps) {
  const [state, dispatch] = React.useReducer(mergeReducer, undefined, () =>
    initMergeState(diff, entityA.id, entityA, entityB),
  )

  // Reset reducer state when entities change (caller swaps inputs
  // mid-mount). Keyed by the entity id pair — stable while the
  // same collision pair is in view.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = React.useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    dispatch({
      type: 'reset',
      diff,
      defaultCanonicalId: entityA.id,
      entityA,
      entityB,
    })
  }

  const canonical = state.canonicalId === entityA.id ? entityA : entityB
  const nonCanonical = state.canonicalId === entityA.id ? entityB : entityA

  const canonicalOptions: SelectOption[] = [
    { value: entityA.id, label: `${entityA.name} · ${formatAgo(entityA.createdAt)}` },
    { value: entityB.id, label: `${entityB.name} · ${formatAgo(entityB.createdAt)}` },
  ]

  const finalTags = React.useMemo(() => {
    if (diff.tags == null) return [...entityA.tags].sort()
    const union = [...new Set([...entityA.tags, ...entityB.tags])].sort()
    return union.filter((t) => !state.deselectedTags.includes(t))
  }, [diff.tags, entityA.tags, entityB.tags, state.deselectedTags])

  function handleConfirm() {
    onSubmit({
      mode: 'merge',
      canonicalId: state.canonicalId,
      fieldChoices: state.fieldChoices,
      finalTags,
    })
  }

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text size="sm" variant="muted">
          Canonical (this row survives)
        </Text>
        <Select
          options={canonicalOptions}
          value={state.canonicalId}
          onValueChange={(id) => dispatch({ type: 'pick-canonical', id, entityAId: entityA.id })}
          mode="segment"
          label="Canonical"
        />
      </View>

      {diff.divergentScalars.length > 0 && (
        <View className="gap-2 rounded-md border border-border bg-bg-sunken p-3">
          <Text size="sm" variant="muted">
            Divergent fields
          </Text>
          {diff.divergentScalars.map((field) => (
            <FieldRow
              key={field}
              field={field}
              valueA={String(entityA[field] ?? '—')}
              valueB={String(entityB[field] ?? '—')}
              pick={state.fieldChoices[field]}
              onPick={(side) => dispatch({ type: 'pick-field', field, side })}
            />
          ))}
        </View>
      )}

      {diff.tags != null && (
        <View className="gap-2">
          <Text size="sm" variant="muted">
            Tags (click to remove from merge)
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {[...diff.tags.both, ...diff.tags.onlyInA, ...diff.tags.onlyInB].sort().map((tag) => {
              const deselected = state.deselectedTags.includes(tag)
              return (
                <Chip
                  key={tag}
                  selected={!deselected}
                  onPress={() => dispatch({ type: 'toggle-tag', tag })}
                >
                  <Text className={cn(deselected && 'line-through')}>{tag}</Text>
                </Chip>
              )
            })}
          </View>
        </View>
      )}

      {diff.stateDivergent && (
        <Text size="sm" variant="muted">
          `state` will follow the canonical row · edit on detail pane after merge.
        </Text>
      )}

      <View className="gap-1 rounded-md border border-border bg-bg-sunken p-3">
        <Text size="sm" variant="muted">
          Moves on merge ({nonCanonical.name} → {canonical.name})
        </Text>
        <Text size="sm">Awareness rows: {nonCanonical.relationCounts.awarenessRows}</Text>
        <Text size="sm">Involvements: {nonCanonical.relationCounts.involvements}</Text>
        <Text size="sm">Inverse refs: {nonCanonical.relationCounts.inverseRefs}</Text>
        <Text size="sm">Embeddings: {nonCanonical.relationCounts.embeddings}</Text>
        <Text size="sm">Translation rows: {nonCanonical.relationCounts.translationRows}</Text>
      </View>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting}>
          <Text>{submitting ? 'Merging…' : `Merge into ${canonical.name}`}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}

type FieldRowProps = {
  field: ScalarField
  valueA: string
  valueB: string
  pick: 'A' | 'B'
  onPick: (side: 'A' | 'B') => void
}

function FieldRow({ field, valueA, valueB, pick, onPick }: FieldRowProps) {
  return (
    <View className="gap-1">
      <Text size="sm" variant="muted">
        {SCALAR_LABELS[field]}
      </Text>
      <View className={Platform.select({ web: 'flex-row gap-2', default: 'gap-2' }) ?? 'gap-2'}>
        <RadioCard label={valueA} selected={pick === 'A'} onPress={() => onPick('A')} />
        <RadioCard label={valueB} selected={pick === 'B'} onPress={() => onPick('B')} />
      </View>
    </View>
  )
}

type RadioCardProps = {
  label: string
  selected: boolean
  onPress: () => void
}

function RadioCard({ label, selected, onPress }: RadioCardProps) {
  return (
    <Chip selected={selected} onPress={onPress} className="flex-1">
      <Text className={cn(selected && 'text-bg-base')}>{label}</Text>
    </Chip>
  )
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}
```

### Step 3.3 — Implement `RenameBody`

Append to `collision-resolve-dialog.tsx`:

```tsx
type RenameBodyProps = {
  entityA: EntitySummary
  entityB: EntitySummary
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function RenameBody({ entityA, entityB, onSubmit, onCancel, submitting, error }: RenameBodyProps) {
  const [nameA, setNameA] = React.useState(entityA.name)
  const [nameB, setNameB] = React.useState(entityB.name)

  // Reset names if entity inputs change. Keyed by id pair.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = React.useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    setNameA(entityA.name)
    setNameB(entityB.name)
  }

  const dirty = nameA !== entityA.name || nameB !== entityB.name

  function handleConfirm() {
    const renames: Array<{ id: string; newName: string }> = []
    if (nameA !== entityA.name) renames.push({ id: entityA.id, newName: nameA })
    if (nameB !== entityB.name) renames.push({ id: entityB.id, newName: nameB })
    onSubmit({ mode: 'rename', renames })
  }

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {entityA.id} · {formatAgo(entityA.createdAt)}
        </Text>
        <Input value={nameA} onChangeText={setNameA} editable={!submitting} />
      </View>
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {entityB.id} · {formatAgo(entityB.createdAt)}
        </Text>
        <Input value={nameB} onChangeText={setNameB} editable={!submitting} />
      </View>
      <Text size="sm" variant="muted">
        Change at least one name to clear the collision.
      </Text>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting || !dirty}>
          <Text>{submitting ? 'Saving…' : 'Save renames'}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}
```

### Step 3.4 — Implement `KeepBody`

Append to `collision-resolve-dialog.tsx`:

```tsx
type KeepBodyProps = {
  name: string
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function KeepBody({ name, onSubmit, onCancel, submitting, error }: KeepBodyProps) {
  function handleConfirm() {
    onSubmit({ mode: 'keep' })
  }
  return (
    <View className="gap-4">
      <Text size="sm" variant="muted">
        {`Both "${name}" entities will continue to exist with the same name. Retrieval treats them by id, but storyteller responses may conflate them in prose. Polymorphic naming is a documented v1 limitation — the schema doesn't enforce unique names. The flag clears; no other writes.`}
      </Text>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting}>
          <Text>{submitting ? 'Saving…' : 'Keep as distinct'}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}
```

### Step 3.5 — Typecheck + format

Run: `pnpm exec tsc --noEmit && pnpm exec prettier --write components/compounds/collision-resolve-dialog.tsx`
Expected: No errors.

Tokens used: `text-danger` (verified in
`components/compounds/form-row.tsx:95`). `bg-bg-sunken` /
`text-fg-muted` / `border-border` are the project's standard
neutral chrome tokens.

### Step 3.6 — Commit

```bash
git add components/compounds/collision-resolve-dialog.tsx
git commit -m "feat(compounds): CollisionResolveDialog view

Three body modes (merge / rename / keep) rendered inline. Merge
body owns the field-pick reducer + tag-deselect chips + relations
summary; rename body validates dirty-state; keep body is purely
confirmational. Promise-driven onResolve with submitting-state
dismissal gate matches embedder-download. No autodocs."
```

---

## Task 4: Dialog stories + inventory ship + followups

**Files:**

- Create: `components/compounds/collision-resolve-dialog.stories.tsx`
- Modify: `docs/ui/component-inventory.md`
- Modify: `docs/followups.md`

### Step 4.1 — Create the stories file

Create `components/compounds/collision-resolve-dialog.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { CollisionResolveDialog } from './collision-resolve-dialog'
import type { EntitySummary, Resolution } from './collision-resolve-diff'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_kael_1',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman drifting between cities.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'on-relevance',
    tags: ['hero', 'sword'],
    state: { hp: 100, mp: 30 },
    relationCounts: {
      awarenessRows: 12,
      involvements: 4,
      inverseRefs: 2,
      embeddings: 1,
      translationRows: 3,
    },
    ...overrides,
  }
}

const entityA = baseEntity()
const entityB = baseEntity({
  id: 'ent_kael_2',
  createdAt: new Date().toISOString(),
  description: 'A city guardsman posted at the eastern gate.',
  status: 'staged',
  tags: ['guard', 'sword'],
  state: { hp: 90, post: 'east-gate' },
  relationCounts: {
    awarenessRows: 1,
    involvements: 0,
    inverseRefs: 0,
    embeddings: 1,
    translationRows: 0,
  },
})

const resolveOk = async (r: Resolution) => {
  // eslint-disable-next-line no-console
  console.log('[story] resolved:', r)
}
const resolveLoading = () => new Promise<void>(() => {})
const resolveError = () => Promise.reject(new Error('Write failed (story stub)'))

function ControlledDialog({
  initialOpen = true,
  entityA: a,
  entityB: b,
  onResolve,
}: {
  initialOpen?: boolean
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (r: Resolution) => Promise<void>
}) {
  const [open, setOpen] = React.useState(initialOpen)
  return (
    <View>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        <Text>Open</Text>
      </Button>
      <CollisionResolveDialog
        open={open}
        onOpenChange={setOpen}
        entityA={a}
        entityB={b}
        onResolve={onResolve}
      />
    </View>
  )
}

const meta: Meta<typeof CollisionResolveDialog> = {
  title: 'Compounds/CollisionResolveDialog',
  component: CollisionResolveDialog,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof CollisionResolveDialog>

export const Default: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const MergeNoScalarDivergence: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['hero'] })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: ['guard'] })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeOnlyTagsDiffer: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['hero', 'sword'] })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: ['sword', 'guard'] })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeStateDivergent: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ state: { hp: 100 } })}
      entityB={baseEntity({ id: 'ent_kael_2', state: { hp: 80 } })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeNoDivergence: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity()}
      entityB={baseEntity({ id: 'ent_kael_2' })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeLongDescriptions: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({
        description:
          'A wandering swordsman drifting between cities, marked by old scars on his off-hand and the habit of speaking only when spoken to. Known to keep the company of stray dogs at every inn he passes through.',
      })}
      entityB={baseEntity({
        id: 'ent_kael_2',
        description:
          'A city guardsman posted at the eastern gate, terse and slow to anger; identified by the inverted phoenix sigil on his pauldron and the half-moon scar across his right eyebrow that the captain claims is from a tavern brawl, though Kael never confirms.',
      })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeCanonicalFlip: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const MergeLoading: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
}

export const MergeError: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveError} />,
}

export const RenameMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const RenameLoading: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
}

export const KeepMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const KeepLoading: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <ControlledDialog
            initialOpen={false}
            entityA={entityA}
            entityB={entityB}
            onResolve={resolveOk}
          />
        </View>
      ))}
    </View>
  ),
}
```

Note `RenameMode` / `KeepMode` stories don't auto-switch to those
modes — the user toggles the segment. If we want each mode to open
directly into its body, lift the `mode` state out of the dialog
into the story. We're not doing that here — the segment toggle is
already exercised by `Default`. Keep the matrix flat.

### Step 4.2 — Verify stories render

Run: `pnpm storybook` (in a separate terminal if not already running).

Manual verification:

- Navigate to `Compounds/CollisionResolveDialog/Default`. Confirm:
  - Dialog opens on "Open" click.
  - Header shows `⚠ Two characters named "Kael"`.
  - Mode segment shows three options; Merge is selected.
  - Canonical picker shows two segments with names + ago labels.
  - Toggling canonical flips the radio cards (description / status).
  - Tags chips render with hero / sword / guard; clicking strikes through.
  - Relations summary shows non-canonical's counts; flipping canonical updates them.
  - Confirm button reads `Merge into Kael` (or the canonical's name).
- Switch to Rename mode — two inputs, save disabled until one differs.
- Switch to Keep mode — confirmation paragraph + Keep as distinct button.
- Open `MergeLoading` story; click Merge — button shows `Merging…`, dismissal gated.
- Open `MergeError` story; click Merge — error text appears below relations, dialog stays open.
- Open `ThemeMatrix` — four cards render with their theme tokens; clicking "Open" inside one opens a dialog (portals to the global host; matches embedder-download behavior).

### Step 4.3 — Format + typecheck

Run: `pnpm exec tsc --noEmit && pnpm exec prettier --write components/compounds/collision-resolve-dialog.stories.tsx`
Expected: No errors.

### Step 4.4 — Update the component inventory

Modify `docs/ui/component-inventory.md`:

**(a) Add `CollisionResolveDialog` row to `Compounds — shipped`** (alphabetical position, before `EmbedderDownloadDialog` or after `CalendarPicker` — match existing alpha order):

Insert a new table row:

```
| CollisionResolveDialog | `components/compounds/` | Two-side collision resolution modal (Merge / Rename / Keep as distinct) for entity rows carrying `name_collision_flag`. Three body modes inline; merge body owns canonical pick + per-field radio + tag-deselect chips + relations summary; rename + keep bodies stateless or near-stateless. Pure View; Promise-driven `onResolve` driver wired by World consumer. Spec: [2026-05-13-collision-resolve-design.md](../explorations/2026-05-13-collision-resolve-design.md); resolution-write drivers pending — see [followups](../followups.md). |
```

**(b) Remove the `CollisionResolveDialog` row from `Compounds — needs design`** — delete lines 95-96 (the divider + row).

**(c) Trim ListRow's shipped row trailing sentence** — find the
`ListRow` row in `Compounds — shipped` and remove the trailing
sentence (verbatim from the inventory):

`Below-row collision strip extension pending — see Modifications pending.`

(In the inventory the "Modifications pending" text is an inline
anchor link to `#modifications-pending`; remove the whole
sentence including the link.) The strip will ship in Task 5 as
its own compound, not as a ListRow modification.

Run the grep first to find the exact line:

```bash
grep -n "ListRow" docs/ui/component-inventory.md
```

### Step 4.5 — Update followups

Modify `docs/followups.md`. Add a new `### CollisionResolveDialog`
section under the `## UX` heading (after the existing
`### EmbedderDownloadDialog` section at line 651):

```markdown
### CollisionResolveDialog

- **Real DB-write drivers per resolution path.** Merge / Rename /
  Keep drivers writing entities + happening_awareness +
  happening_involvements + translations deltas under a single
  `action_id`. World consumer (`app/(story)/world/...` route)
  wires these. Dialog ships with stub drivers in stories only.
- **Phone-tier prose clamp on merge body.** 3-line clamp +
  tap-to-expand on long descriptions per
  [`world.md → Merge`](./ui/screens/world/world.md#merge). Stories
  cover desktop wrap; phone tier deferred to v1 mobile pass.
```

### Step 4.6 — Verify lint + remark

Run: `pnpm lint:docs 2>&1 | grep -E "collision|inventory|followups" | grep -v poc-embedder`
Expected: No errors (warnings from vendored python markdown can be ignored).

### Step 4.7 — Commit

```bash
git add components/compounds/collision-resolve-dialog.stories.tsx \
         docs/ui/component-inventory.md \
         docs/followups.md
git commit -m "feat(compounds): ship CollisionResolveDialog

15-story matrix + ThemeMatrix per the design doc. Promoted from
needs-design to shipped in component-inventory; ListRow trailing
sentence trimmed because the strip moves to its own compound
(lands in next commit). Two followups recorded: real DB-write
drivers per resolution path, phone-tier prose clamp."
```

---

## Task 5: Strip compound + stories + inventory ship

**Files:**

- Create: `components/compounds/collision-list-row.tsx`
- Create: `components/compounds/collision-list-row.stories.tsx`
- Modify: `docs/ui/component-inventory.md`

### Step 5.1 — Create the strip compound

Create `components/compounds/collision-list-row.tsx`:

```tsx
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import { ListRow, type ListRowProps } from './list-row'

type CollisionListRowProps = {
  row: ListRowProps
  collision: {
    otherName: string
    onJumpToOther: () => void
    onResolve: () => void
  }
}

export function CollisionListRow({ row, collision }: CollisionListRowProps) {
  return (
    <View>
      <ListRow {...row} />
      <View
        accessibilityRole="region"
        accessibilityLabel="Collision warning"
        className={cn(
          // Warn-tinted strip — translucent warning fill via an
          // absolute overlay (the project's filled-warning pattern
          // — see `components/compounds/save-bar.tsx:116`). Left
          // border at warning color. Padding mirrors the row's
          // horizontal pad so the link aligns with the row's
          // primary text column.
          'relative flex-row items-center gap-3 overflow-hidden border-l-[3px] border-warning px-row-x-md py-row-y-sm',
        )}
      >
        <View
          aria-hidden
          pointerEvents="none"
          className="absolute inset-0 bg-warning opacity-[.12]"
        />
        <Pressable
          onPress={collision.onJumpToOther}
          accessibilityRole="link"
          className={cn('shrink', Platform.select({ web: 'cursor-pointer' }))}
        >
          <Text size="sm" className="underline">
            {`⚠ Collides with ${collision.otherName}`}
          </Text>
        </Pressable>
        <View className="ml-auto">
          <Button variant="secondary" onPress={collision.onResolve}>
            <Text>Resolve →</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}

export type { CollisionListRowProps }
```

Tokens used: `bg-warning` / `border-warning` (verified in
`components/compounds/save-bar.tsx:116`). The translucent overlay
pattern (`absolute inset-0 bg-warning opacity-[.12]` over a parent
with `relative overflow-hidden`) is the project's convention for
warn-tinted backgrounds — direct `bg-warning` is too saturated for
this surface.

### Step 5.2 — Create the stories file

Create `components/compounds/collision-list-row.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { CollisionListRow } from './collision-list-row'

const meta: Meta<typeof CollisionListRow> = {
  title: 'Compounds/CollisionListRow',
  component: CollisionListRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof CollisionListRow>

const baseRow = {
  label: 'Kael',
  description: 'A wandering swordsman.',
}

const baseCollision = {
  otherName: 'Kael',
  onJumpToOther: () => {},
  onResolve: () => {},
}

export const Default: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow row={baseRow} collision={baseCollision} />
    </View>
  ),
}

export const LongCollisionTarget: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={baseRow}
        collision={{
          ...baseCollision,
          otherName: 'Kael Vex of the Eastern Reaches',
        }}
      />
    </View>
  ),
}

export const WithKindIcon: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={{
          ...baseRow,
          leading: <EntityKindIcon kind="character" />,
        }}
        collision={baseCollision}
      />
    </View>
  ),
}

export const WithStatusPillSlot: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={{
          ...baseRow,
          leading: <EntityKindIcon kind="character" />,
          trailing: (
            <View className="rounded-sm bg-bg-sunken px-2 py-1">
              <Text size="xs" variant="muted">
                staged
              </Text>
            </View>
          ),
        }}
        collision={baseCollision}
      />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <CollisionListRow row={baseRow} collision={baseCollision} />
        </View>
      ))}
    </View>
  ),
}
```

### Step 5.3 — Verify stories render

Run: `pnpm storybook` (in a separate terminal if not already running).

Manual verification:

- Navigate to `Compounds/CollisionListRow/Default`. Confirm:
  - The row renders with label + description.
  - Below the row, a warn-tinted strip renders with
    `⚠ Collides with Kael` link + `Resolve →` button.
  - Strip's link is underlined; button is right-aligned.
- `LongCollisionTarget` — long name; the link doesn't push the
  button off-screen (button stays right-aligned thanks to
  `ml-auto`; link wraps or truncates).
- `WithKindIcon` — kind glyph appears in the row's leading slot.
- `WithStatusPillSlot` — pill renders in the row's trailing slot;
  strip still renders independently below.
- `ThemeMatrix` — all four themes render with their respective
  warn-tints.

### Step 5.4 — Format + typecheck

Run: `pnpm exec tsc --noEmit && pnpm exec prettier --write components/compounds/collision-list-row.tsx components/compounds/collision-list-row.stories.tsx`
Expected: No errors.

### Step 5.5 — Update the component inventory

Modify `docs/ui/component-inventory.md`:

**(a) Add `CollisionListRow` row to `Compounds — shipped`** (alpha
position, near `CollisionResolveDialog`):

```
| CollisionListRow | `components/compounds/` | Wraps shipped `ListRow` with a warn-tinted below-row collision strip carrying a `⚠ Collides with <other-name>` link and a `Resolve →` button. Strip is a sibling element outside the row's tap surface — own tap targets for link + button. World list-renderer's only call site at v1; pan-domain by contract so any future row-conditional warn extension can reuse the shape. Spec: [2026-05-13-collision-resolve-design.md](../explorations/2026-05-13-collision-resolve-design.md). |
```

**(b) Remove the entire `### Modifications pending` subsection**
along with its single ListRow row. The strip moved to its own
compound; ListRow itself ships unchanged. Drop the heading and the
introductory paragraph too — no other modifications-pending entries
exist today.

Run the grep first to find the exact section bounds:

```bash
grep -n "Modifications pending\|^## Layout shells" docs/ui/component-inventory.md
```

Delete from the `### Modifications pending` heading line through
the line immediately before `## Layout shells` (or whatever heading
follows).

### Step 5.6 — Verify lint + remark

Run: `pnpm lint:docs 2>&1 | grep -E "collision|inventory" | grep -v poc-embedder`
Expected: No errors.

### Step 5.7 — Commit

```bash
git add components/compounds/collision-list-row.tsx \
         components/compounds/collision-list-row.stories.tsx \
         docs/ui/component-inventory.md
git commit -m "feat(compounds): ship CollisionListRow

Wraps ListRow with a warn-tinted below-row strip carrying the
collision link and Resolve button. Strip sits outside the row's
Pressable — own tap targets for link + button. Inventory: added
shipped row + dropped the entire Modifications pending subsection
(ListRow itself ships unchanged; the strip moved to its own
compound)."
```

---

## Self-review checklist

After all five tasks land:

1. **Spec coverage check** — each section of
   `2026-05-13-collision-resolve-design.md` has a task:
   - Outcome (two compounds) → Tasks 3-5
   - Why separate compound → Task 5 implementation
   - File structure → Tasks 1-2-3-4-5 (one per file pair)
   - API shapes → Task 1 (types) + Task 3 (props)
   - Computational concerns → Tasks 1 + 2
   - Bodies → Task 3 (sub-steps for each)
   - Strip → Task 5
   - Storybook strategy → Tasks 4 + 5 (matrices)
   - Out of scope → not implemented (correct)
   - Followups → Task 4 (followups update)
   - Inventory delta → Tasks 4 + 5
   - Test surface → Tasks 1 + 2

2. **Type consistency check** —
   - `EntitySummary` shape matches across diff.ts, machine.ts, dialog.tsx, stories
   - `Resolution` discriminated union matches across diff.ts and onResolve consumers
   - `MergeState` / `MergeAction` types stable from machine.ts through dialog.tsx
   - `ScalarField` order matches `SCALAR_FIELDS` constant

3. **Placeholder scan** — no TBD, no "implement later", every
   step shows code. ✓

## Out-of-scope reminders

These items live in the design doc's "Out of scope" section and
must NOT be implemented in this plan:

- World top-bar `⚠ N need review` pill (depends on StatusPill)
- Collapsed-accordion `⚠ N` badge
- 3+ collision iteration logic
- Disabled-while-generating gating on the `Resolve →` button
- Mobile phone-tier prose clamp + tap-to-expand
