# Collision resolution

Two co-designed compounds that together surface and resolve
`name_collision_flag` on entity rows. The feature spec — what
collisions are, when the flag fires, what each resolution writes —
lives in
[`world.md → Collision review and entity merge`](../screens/world/world.md#collision-review-and-entity-merge).
This doc settles the **compound shapes**: component split, API,
merge-body state machine, diff computation.

Used by:

- [World panel](../screens/world/world.md#collision-review-and-entity-merge)
  — entity rows surface the collision flag; the Resolve action
  routes through `CollisionResolveDialog`.

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
  entityB: EntitySummary // newer
  /** Rejects with an Error whose message is user-facing text; the dialog shows it inline. */
  onResolve: (resolution: Resolution) => Promise<void>
  /** Set while a write is gated (a turn in flight): every submit disables and shows it. */
  blockedReason?: string
}
```

The caller sorts by `createdAt` before passing, matching the spec's
"older = default canonical" rule. The dialog never reorders
internally — caller data is the source of truth.

### Entity projection

```ts
type EntitySummary = {
  id: string
  kind: EntityKind // from lib/db, as are Entity and InjectionMode
  createdAt: string // ISO
  name: string
  description?: string
  status: Entity['status']
  retiredReason?: string
  injectionMode: InjectionMode
  priority: number
  tags: string[]
  keywords: string[]
  state: Record<string, unknown> // whole-side; no per-field diff in v1
  relationCounts: {
    awarenessRows: number
    involvements: number
    /** This side's relationship rows except the one joining the pair. */
    relationships: number
    /** A relationship row joins the two sides; the merge drops it. */
    joiningRelationship: boolean
    /** Holders that will drop the item count; the pair partner doesn't. */
    inverseRefs: number
    embeddings: 0 | 1
    /** Dropped with the merge: the entity's translations and its relationships'. */
    translationRows: number
    /** Items this side carries that nothing else holds or places. */
    unheldItems: number
    /** What gives way when this side loses: the other side already has it. */
    overlap: {
      awareness: number
      involvements: number
      relationships: number
      holdersLosingItem: number
    }
  }
}
```

Each side carries its own `relationCounts`. The merge body's
relations-summary block shows the **non-canonical**'s counts (what
the merge carries over or drops), so toggling canonical flips the
displayed counts to the other side. The World consumer builds both
sides from the stores: link counts with the entity cascade's own
predicates, inverse refs across the six ref fields without the
pair partner (a ref between the two collapses rather than moves),
`embeddings` as 1 when the row isn't `embedding_stale`, and
`overlap` as the rows of this side that give way rather than move:
its awareness rows and involvements in a happening the other side
is in, each of its involvements after its first in one happening,
its relationships with a character the other side relates to, and,
for an item, its holders who lose it because the other item already
has a position.

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
      finalKeywords: string[]
    }
  | {
      mode: 'rename'
      renames: Array<{ id: string; newName: string }> // 1 or 2 entries
    }
  | { mode: 'keep' }

type ScalarField =
  | 'name'
  | 'description'
  | 'status'
  | 'retiredReason'
  | 'injectionMode'
  | 'priority'
```

`fieldChoices` only carries entries for fields that diverge.
Identical-on-both-sides fields stay implicit (caller writes
canonical's value unconditionally). `finalKeywords` is the union of
both sides' keywords, deduplicated under the normalization
`matchTerms` uses so a case variant does not survive as a second
entry, a shared one in the canonical's spelling. `finalTags` is the
union after the user's deselects are applied — empty array is
allowed (entity becomes untagged). Both lists are ordered the same
way: the canonical's own entries in their stored order (keywords
trimmed and de-duplicated), minus the deselected, then the other
side's remaining additions in the order the chips are offered
(sorted). A selection equal to the canonical's set therefore submits
its list exactly, and the merge writes no unchanged list. When the
two sides agree on a list (its partition is `null`), the dialog
submits the canonical's own list as it is.

The rename array is sparse: only entities whose name actually
changed are included, trimmed. Validation: both trimmed names must be
non-empty and must stop colliding under the namesake rule (same
kind, same `normalizeTerm` name), so a case-only change still
collides; the action refuses `invalid-rename` otherwise.

### Divergence computation

`computeDivergence` is pure:

```ts
type DiffPayload = {
  divergentScalars: ScalarField[]
  tags: { onlyInA: string[]; onlyInB: string[]; both: string[] } | null
  keywords: { onlyInA: string[]; onlyInB: string[]; both: string[] } | null
  stateDivergent: boolean
}
```

- **Scalars** — strict equality (`===`). `description` is not
  whitespace-normalized. The right way to converge cosmetic
  whitespace differences is to edit one side in the detail pane,
  not paper over divergence at the dialog level.
- **Keywords** — partitioned like tags, but by `normalizeTerm`: a
  case variant on the other side is the same keyword, and the
  partition is `null` when both sides hold the same keywords under
  normalization. Blanks drop. A keyword only one side holds shows in
  that side's first trimmed spelling; a shared one shows and is
  submitted in the canonical's spelling. The deselect follows the
  keyword, not its spelling. Unioned by the same rule. Tags still
  compare exactly.
  They are retrieval-targeted rather than decorative, so
  taking the canonical side's set alone would silently narrow what the
  merged entity can be matched by — the losing side's aliases are
  exactly the references prose already used for this character. See
  [`retrieval.md → Keywords schema`](../../memory/retrieval.md#keywords-schema).
- **Tags** — partitioned into `onlyInA` / `onlyInB` / `both`.
  `null` when both sides have identical tag sets (order-independent).
- **State** — structural deep-equal: sort keys, compare leaves.

`divergentScalars` preserves a fixed field order
(name, description, status, retiredReason, injectionMode, priority)
for stable rendering — order isn't data-dependent.

### Merge reducer

```ts
type MergeState = {
  canonicalId: string
  fieldChoices: Record<ScalarField, 'A' | 'B'>
  deselectedTags: string[]
  /** `normalizeTerm` keys, so a deselect follows the keyword across spellings. */
  deselectedKeywords: string[]
}

type MergeAction =
  | { type: 'pick-canonical'; id: string; entityAId: string }
  | { type: 'pick-field'; field: ScalarField; side: 'A' | 'B' }
  | { type: 'toggle-tag'; tag: string }
  | { type: 'toggle-keyword'; keyword: string }
  | {
      type: 'reset'
      diff: DiffPayload
      defaultCanonicalId: string
      entityAId: string
    }
```

Transition rules:

- **`pick-canonical`** — rebases `fieldChoices`: every divergent
  scalar resets to the new canonical's side. Matches user
  expectation ("this side wins by default; override per field"),
  and keeps the relations-summary's "loser → canonical" framing
  consistent.
- **`pick-field`** — overrides a single scalar without touching the
  canonical or other choices.
- **`toggle-keyword`** — same shape as `toggle-tag`, against
  `deselectedKeywords`; the reducer normalizes the keyword to its
  key.
- **`toggle-tag`** — adds or removes a tag from `deselectedTags`.
  `finalTags` is derived in the view, not stored: the canonical's
  own tags minus `deselectedTags`, then the other side's remaining
  additions ([Resolution shape](#resolution-shape) gives the order);
  `finalKeywords` likewise against `deselectedKeywords`.
- **`reset`** — re-initializes on entity-input change. Defensive;
  in practice the dialog is keyed by entity ids so unmount handles
  most cases.

`pick-canonical` and `reset` carry `entityAId` so the reducer can
tell which side the canonical is. Initial state: `canonicalId` =
`defaultCanonicalId`, `fieldChoices` sets each field to whichever
side matches the canonical, and `deselectedTags = []` and
`deselectedKeywords = []`.

### Submit-enabled rules

- **Merge** — always enabled once the canonical is picked. Init
  defaults canonical to A, so this is true from open. The user
  cannot get stuck in an un-submittable state.
- **Rename** — enabled when both trimmed names are non-empty and
  no longer collide under the namesake rule. A case-only change
  still collides, so leaving both names as they are never enables
  it.
- **Keep** — always enabled.
- **Blocked** — while `blockedReason` is set, every submit
  disables and the reason shows under the footer. The caller's
  action refuses a write in flight regardless.

### Bodies

**Merge** renders in order:

1. **Canonical picker** — segment toggle (Select primitive in
   segment mode) with two options:
   `<A.name> · <relative time>` /
   `<B.name> · <relative time>`, the wall-clock relative time
   History renders (`relativeTimeLabel`). A `· Canonical` suffix
   appears on the selected side. On phone the picker renders as
   full-width radio rows, since a half-width segment label clips.
2. **Divergent-field table** — one row per divergent scalar.
   Each row: field label · radio for A's value · radio for B's
   value. Identical fields are omitted entirely. Empty when no
   scalars diverge. Where the choices sit side by side (web above
   phone), a header row names the sides `Older · <relative time>` /
   `Newer · <relative time>`, the canonical's with the `· Canonical`
   suffix; on stacked tiers (phone, or any native tier) each choice
   carries that caption itself instead, and each field is one
   `radiogroup` named by the field label.
3. **Keyword union** (when `diff.keywords != null`) — single row
   labeled "Keywords", identical in shape to the tag row below it and
   rendered directly above it.
4. **Tag union** (when `diff.tags != null`) — single row labeled
   "Tags". Renders all tags from the union as chips; each chip has
   an inline `×` to deselect. Deselected chips render in a
   strikethrough / dimmed variant and can be re-selected.
5. **State JSON note** (when `stateDivergent` is true) — inline
   muted text: "`state` will follow the canonical row · edit on
   detail pane after merge."
6. **Relations summary** — read-only block showing non-canonical's
   counts: awareness rows, involvements, relationships, inverse
   refs, embeddings, items left unheld, and translation rows as
   dropped. Footnotes, each shown only when its count is non-zero:
   awareness rows and involvements the canonical already has (it
   keeps its own, the duplicates drop) or that repeat a happening
   the non-canonical is already in (the first moves), relationships
   with a character the canonical already relates to (it keeps its own
   views, taking the duplicate's only where blank), holders who lose
   an item because the canonical item is already held or placed, and
   the relationship between the two being dropped. Counts re-derive
   when canonical flips.
7. **Footer** — `[ Cancel ]` · `[ Merge into <canonical-name> ]`.
   The primary button echoes the canonical pick so the destructive
   direction is obvious.

**Rename** — two stacked text inputs, one per entity, labeled
`Older · <relative time>` / `Newer · <relative time>`. Each input
initialized to the entity's current name. Inline help states the
rule: it names the failing rule only once a name was touched and
fails it, and otherwise (untouched, or valid) shows the plain
prompt to change a name.
Footer: `[ Cancel ]` · `[ Save renames ]`.

**Keep as distinct** — single muted paragraph (verbatim from
[`world.md → Keep as distinct`](../screens/world/world.md#keep-as-distinct)),
footer: `[ Cancel ]` · `[ Keep as distinct ]`.

**Phone tier and native tiers** — the dialog stays a Modal on
phone. In the merge table, which stacks on these tiers, prose
values (`description`, `retiredReason`) clamp to 3 lines, and
tapping the prose expands that value in place, apart from its
radio's tap target. Each radio shows an inline age caption under
its value.

## `CollisionListRow`

### Strip compound props

```ts
type CollisionListRowProps = {
  row: ListRowProps // forwarded verbatim
  collision: { otherName: string; onJumpToOther: () => void } & (
    | { onResolve: () => void; resolveDisabledReason?: never }
    // Resolve stays visible but inert; the reason doubles as its tooltip and a11y hint.
    | { onResolve?: never; resolveDisabledReason: string }
  )
}
```

Forwarding `ListRowProps` verbatim keeps the row's contract intact.
The strip is rendered as a sibling `<View>` below the row's
`<Pressable>` — outside its tap surface so the strip's own buttons
own their tap targets cleanly. Resolve either acts or says why it
can't; an inert Resolve with no reason can't be expressed.

### Strip render

The compound stacks two children:

1. `<ListRow {...row} />` — the existing primitive, untouched.
2. `<View>` strip — `Tag tone="warning"` overlay surface, padded,
   with two children:
   - `<Pressable onPress={collision.onJumpToOther}>` rendering
     `⚠ Collides with <otherName>` (link styling, underlined).
   - `<Button>` labeled `Resolve →` (compact / secondary variant),
     wired to `collision.onResolve`, or disabled with
     `collision.resolveDisabledReason` as its tooltip and a11y hint.

The strip's tap surfaces are separate from the row's `Pressable`.
On phone, the strip's two children stack vertically if the layout
overflows; on tablet+ they sit on one row with the link taking
remaining width.

### Accessibility

The strip is a named group: `role="group"`,
`accessibilityLabel="Collision warning"`. Screen readers announce
row + group as siblings. Not `alert`: a collision is a standing state,
not an event, and an assertive live region on every flagged strip
would announce them all whenever the list mounts or a tier expands.
Not `region`: that would make each flagged row its own landmark.

## Out of scope

- **World top-bar `⚠ N need review` pill** — screen chrome; see
  [`world.md → Surfacing`](../screens/world/world.md#surfacing).
- **Collapsed-accordion `⚠ N` badge** — screen chrome on the World
  accordion groups.
- **3+ collision iteration** — multi-way collision orchestration is
  the caller's responsibility. The dialog handles 2-side merges
  only per
  [`world.md → Authorship and 3+ collisions`](../screens/world/world.md#authorship-and-3-collisions).
- **Disabled-while-generating gating** — the caller passes the
  strip `collision.resolveDisabledReason` and the dialog
  `blockedReason`; neither is aware of generation state itself. The
  [edit-restrictions rule](../principles.md#edit-restrictions-during-in-flight-generation)
  is enforced at the World consumer.
