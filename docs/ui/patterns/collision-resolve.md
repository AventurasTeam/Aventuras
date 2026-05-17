# Collision resolution

Two co-designed compounds that together surface and resolve
`name_collision_flag` on entity rows. The feature spec — what
collisions are, when the flag fires, what each resolution writes —
lives in
[`world.md → Collision review and entity merge`](../screens/world/world.md#collision-review-and-entity-merge).
This doc settles the **compound shapes**: component split, API,
merge-body state machine, diff computation.

- **`CollisionListRow`** — wraps the shipped
  [`ListRow`](../component-inventory.md#compounds--shipped) with
  a below-row warn-tinted collision strip carrying a `Resolve →`
  button and a jump-to-other link. ListRow itself stays unchanged.
- **`CollisionResolveDialog`** — three-body-mode modal
  (Merge / Rename / Keep as distinct) built on the `Dialog`
  primitive. Pure View; caller supplies an async `onResolve` driver.

## Why a separate compound, not a ListRow extension

The
[entity row indicators rule](./entity.md#entity-row-indicators--four-orthogonal-channels)
fixes four orthogonal channels on the pan-domain row (lead badge,
status pill, scene-presence, recently-classified). The collision
strip is a different shape: a row-conditional **below-row appendage**
with its own tap targets — not a slot, not a tint, not a stripe.
Adding it as a fifth channel on ListRow would conflate two concerns:
ListRow stays a single Pressable with internal slots, and the strip
is a sibling element outside that Pressable.

Composition wins:

- ListRow's pan-domain shape stays unchanged. Every other consumer
  (Plot, Story Settings, Memory Probe, Story List) imports the same
  primitive untouched.
- The wrapping compound owns the warn-tint contract for the strip
  and the Resolve button — concerns that don't belong on a generic
  list row.
- At v1 the only call site is the World list-renderer's flagged-row
  branch. Consumers without collision flags use plain ListRow.
- Naming stays pan-domain (`CollisionListRow`, not
  `EntityCollisionRow`): the strip's contract isn't entity-specific
  even if v1 only fires for entities. Lore's immunity to the flag is
  enforced at the call site, not in the type system.

## `CollisionResolveDialog`

### Dialog props

```ts
type CollisionResolveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityA: EntitySummary // older by createdAt; default canonical
  entityB: EntitySummary // newer; the flagged row in v1
  onResolve: (resolution: Resolution) => Promise<void>
}
```

The caller sorts by `createdAt` before passing, matching the spec's
"older = default canonical" rule. The dialog never reorders
internally — caller data is the source of truth.

### Entity projection

```ts
type EntitySummary = {
  id: string
  kind: 'character' | 'location' | 'item' | 'faction'
  createdAt: string // ISO
  name: string
  description?: string
  status: EntityStatus
  retiredReason?: string
  injectionMode: InjectionMode
  tags: string[]
  state: Record<string, unknown> // whole-side; no per-field diff in v1
  relationCounts: {
    awarenessRows: number
    involvements: number
    inverseRefs: number
    embeddings: 0 | 1
    translationRows: number
  }
}
```

Each side carries its own `relationCounts`. The merge body's
relations-summary block shows the **non-canonical**'s counts (the
ones that will move on merge), so toggling canonical flips the
displayed counts to the other side.

`state` is opaque (`Record<string, unknown>`). The dialog only
deep-equals it to decide whether to render the inline note
("follows the canonical row · edit on detail pane after merge").
Per-field traversal inside `state` is out of scope per the v1
limitation in
[`world.md → Merge`](../screens/world/world.md#merge).

### Resolution shape

```ts
type Resolution =
  | {
      mode: 'merge'
      canonicalId: string
      fieldChoices: Record<ScalarField, 'A' | 'B'>
      finalTags: string[]
    }
  | {
      mode: 'rename'
      renames: Array<{ id: string; newName: string }> // 1 or 2 entries
    }
  | { mode: 'keep' }

type ScalarField = 'name' | 'description' | 'status' | 'retiredReason' | 'injectionMode'
```

`fieldChoices` only carries entries for fields that diverge.
Identical-on-both-sides fields stay implicit (caller writes
canonical's value unconditionally). `finalTags` is the union after
the user's deselects are applied — empty array is allowed (entity
becomes untagged).

The rename array is sparse: only entities whose name actually
changed are included. Validation enforces that at least one entry
is present.

### Divergence computation

`computeDivergence` is pure:

```ts
type DiffPayload = {
  divergentScalars: ScalarField[]
  tags: { onlyInA: string[]; onlyInB: string[]; both: string[] } | null
  stateDivergent: boolean
}
```

- **Scalars** — strict equality (`===`). `description` is not
  whitespace-normalized. The right way to converge cosmetic
  whitespace differences is to edit one side in the detail pane,
  not paper over divergence at the dialog level.
- **Tags** — partitioned into `onlyInA` / `onlyInB` / `both`.
  `null` when both sides have identical tag sets (order-independent).
- **State** — structural deep-equal: sort keys, compare leaves.

`divergentScalars` preserves a fixed field order
(name, description, status, retiredReason, injectionMode) for stable
rendering — order isn't data-dependent.

### Merge reducer

```ts
type MergeState = {
  canonicalId: string
  fieldChoices: Record<ScalarField, 'A' | 'B'>
  deselectedTags: string[]
}

type MergeAction =
  | { type: 'pick-canonical'; id: string }
  | { type: 'pick-field'; field: ScalarField; side: 'A' | 'B' }
  | { type: 'toggle-tag'; tag: string }
  | { type: 'reset'; diff: DiffPayload; defaultCanonicalId: string }
```

Transition rules:

- **`pick-canonical`** — rebases `fieldChoices`: every divergent
  scalar resets to the new canonical's side. Matches user
  expectation ("this side wins by default; override per field"),
  and keeps the relations-summary's "loser → canonical" framing
  consistent.
- **`pick-field`** — overrides a single scalar without touching the
  canonical or other choices.
- **`toggle-tag`** — adds or removes a tag from `deselectedTags`.
  `finalTags` is derived in the view as `union - deselectedTags`
  (sorted).
- **`reset`** — re-initializes on entity-input change. Defensive;
  in practice the dialog is keyed by entity ids so unmount handles
  most cases.

Initial state: `canonicalId` = `defaultCanonicalId`, `fieldChoices`
sets each field to whichever side matches the canonical, and
`deselectedTags = []`.

### Submit-enabled rules

- **Merge** — always enabled once the canonical is picked. Init
  defaults canonical to A, so this is true from open. The user
  cannot get stuck in an un-submittable state.
- **Rename** — enabled when at least one of the two name inputs
  differs from its current value
  (`a !== entityA.name || b !== entityB.name`).
- **Keep** — always enabled.

### Bodies

**Merge** renders in order:

1. **Canonical picker** — segment toggle (Select primitive in
   segment mode) with two options:
   `<A.name> · <ago(A.createdAt)>` /
   `<B.name> · <ago(B.createdAt)>`. The `(canonical)` suffix
   appears on the selected side.
2. **Divergent-field table** — one row per divergent scalar.
   Each row: field label · radio for A's value · radio for B's
   value. Identical fields are omitted entirely. Empty when no
   scalars diverge.
3. **Tag union** (when `diff.tags != null`) — single row labeled
   "Tags". Renders all tags from the union as chips; each chip has
   an inline `×` to deselect. Deselected chips render in a
   strikethrough / dimmed variant and can be re-selected.
4. **State JSON note** (when `stateDivergent` is true) — inline
   muted text: "`state` will follow the canonical row · edit on
   detail pane after merge."
5. **Relations summary** — read-only block showing non-canonical's
   counts: "Awareness rows: N · Involvements: N · Inverse refs: N ·
   Embeddings: N · Translation rows: N." Counts re-derive when
   canonical flips.
6. **Footer** — `[ Cancel ]` · `[ Merge into <canonical-name> ]`.
   The primary button echoes the canonical pick so the destructive
   direction is obvious.

**Rename** — two stacked text inputs, one per entity, labeled with
the entity id and age (`ent_kael_1 · 12 turns ago`). Each input
initialized to the entity's current name. Inline help: "Change at
least one name to clear the collision." Footer:
`[ Cancel ]` · `[ Save renames ]`.

**Keep as distinct** — single muted paragraph (verbatim from
[`world.md → Keep as distinct`](../screens/world/world.md#keep-as-distinct)),
footer: `[ Cancel ]` · `[ Keep as distinct ]`.

## `CollisionListRow`

### Strip compound props

```ts
type CollisionListRowProps = {
  row: ListRowProps // forwarded verbatim
  collision: {
    otherName: string
    onJumpToOther: () => void
    onResolve: () => void
  }
}
```

Forwarding `ListRowProps` verbatim keeps the row's contract intact.
The strip is rendered as a sibling `<View>` below the row's
`<Pressable>` — outside its tap surface so the strip's own buttons
own their tap targets cleanly.

### Strip render

The compound stacks two children:

1. `<ListRow {...row} />` — the existing primitive, untouched.
2. `<View>` strip — `Tag tone="warning"` overlay surface, padded,
   with two children:
   - `<Pressable onPress={collision.onJumpToOther}>` rendering
     `⚠ Collides with <otherName>` (link styling, underlined).
   - `<Button>` labeled `Resolve →` (compact / secondary variant),
     wired to `collision.onResolve`.

The strip's tap surfaces are separate from the row's `Pressable`.
On phone, the strip's two children stack vertically if the layout
overflows; on tablet+ they sit on one row with the link taking
remaining width.

### Accessibility

The strip is its own region: `accessibilityRole="region"`,
`accessibilityLabel="Collision warning"`. Screen readers announce
row + region as siblings.

## Out of scope

- **World top-bar `⚠ N need review` pill** — screen chrome. Covered
  by
  [`generation-status-pill.md → Open items`](./generation-status-pill.md#open-items)
  (the `Tag tone="warning"` extension that unblocks it now ships
  per [`chips.md → Tag tone vocabulary`](./chips.md#tag--tone-vocabulary)).
- **Collapsed-accordion `⚠ N` badge** — screen chrome on the World
  accordion groups.
- **3+ collision iteration** — multi-way collision orchestration is
  the caller's responsibility. The dialog handles 2-side merges
  only per
  [`world.md → Authorship and 3+ collisions`](../screens/world/world.md#authorship-and-3-collisions).
- **Disabled-while-generating gating on the `Resolve →` button** —
  the caller passes `row.disabled` through; the dialog and strip
  are unaware of generation state. The
  [edit-restrictions rule](../principles.md#edit-restrictions-during-in-flight-generation)
  is enforced at the World consumer.

## Open items

- **Real DB-write drivers per resolution path.** Merge / Rename /
  Keep drivers writing entities + happening_awareness +
  happening_involvements + translations deltas under a single
  `action_id`. World consumer (`app/(story)/world/...` route) wires
  these. Dialog ships with stub drivers in stories only.
- **Phone-tier prose clamp on merge body.** 3-line clamp +
  tap-to-expand on long descriptions per
  [`world.md → Merge`](../screens/world/world.md#merge). Stories
  cover desktop wrap; phone tier deferred to v1 mobile pass.
