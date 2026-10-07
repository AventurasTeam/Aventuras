# Slice 4.2c — Collision review drivers

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.2b](./02b-lore-history-delete.md) (the
  merge's losing row deletes through the hardened entity arm — C3);
  the dialog wiring, rename and keep drivers need only
  [Slice 4.1](./01-world-shell.md) (a partial gate in the milestone
  graph)
- **Blocks:** none

## Goal

The shipped `CollisionResolveDialog` gets real drivers. `Resolve →`
on a flagged row opens the dialog with both rows projected to
`EntitySummary`, and each resolution writes deltas under one
`action_id`: **merge** (canonical update, loser delete through C3,
awareness / involvement / relationship rows re-created on the
canonical with duplicates dropped, inverse-ref rewrite, the loser's
translations dropped, keyword and tag union), **rename** (both rows,
flag clears), **keep as distinct** (flag clears only). The dialog's
drifted `InjectionMode` and `ScalarField` unions are fixed first. The
History tab also starts listing edits to the link rows that name its
row: relationships, involvements, awareness.

## Background

The periodic classifier writes `name_collision_flag = 1` when a
freshly extracted entity's description does not match an existing
same-name row strongly enough to promote it. The World panel is the
only surface that resolves the flag; 4.1 made it visible and seeded a
flagged pair, this slice makes it actionable. The compound is a pure
View with a Promise-driven `onResolve`; the pattern doc's own open
item is exactly this slice — real DB-write drivers. Two known drifts
to clear before wiring: `collision-resolve-diff.ts` declares
`'always' | 'on-relevance' | 'never'` against the shipped
`'always' | 'auto' | 'disabled'` enum, and its `ScalarField` omits
`priority`, which canon lists among the per-row radio scalars.

## Required reading

- [`world.md → Collision review and entity merge`](../../../../ui/screens/world/world.md#collision-review-and-entity-merge)
  through [`Authorship and 3+ collisions`](../../../../ui/screens/world/world.md#authorship-and-3-collisions)
  — every path's writes, the UNIQUE-collision rule, reversibility,
  the in-flight gate, the 3+ iteration rule.
- [`patterns/collision-resolve.md`](../../../../ui/patterns/collision-resolve.md)
  in full — dialog props, `EntitySummary` projection, `Resolution`
  shape, divergence and merge reducer, submit rules, open items.
- [`layout.md → Mapping — desktop to mobile`](../../../../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile)
  — a short Modal stays a Modal on phone; the dialog has no Sheet
  expression.
- [`memory/edge-cases.md → Name collision`](../../../../memory/edge-cases.md#name-collision-and-disambiguation)
  and [`Polymorphic naming`](../../../../memory/edge-cases.md#polymorphic-naming--v1-limitation).
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  (the awareness UNIQUE constraint) and
  [`Character-to-character relationships`](../../../../data-model.md#character-to-character-relationships)
  (the `a_id < b_id` invariant a reattached row must keep).
- [`data-model.md → Translation targets`](../../../../data-model.md#translation-targets)
  — the rows that move with the canonical id.
- [`memory/retrieval.md → Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
  — why keywords union and de-duplicate.
- [`world.md → History tab`](../../../../ui/screens/world/world.md#history-tab)
  — the query, search and op filter the link-row union extends.
- [Milestone contracts C3, C4, C7, C12](../milestone.md#slice-contracts).

## Scope: in

- **Drift fixes** as the first commit: the compound imports the
  shipped `InjectionMode`, and `ScalarField` / `SCALAR_FIELDS` gain
  `priority` so a divergent priority renders its radio row.
- **Projection:** the World consumer builds two `EntitySummary`
  values (older by `created_at` first) with real `relationCounts`
  read from the stores / DB (awareness, involvements, inverse refs
  across the six ref fields, embeddings 0 | 1, translations).
- **Merge driver:** one `applyDeltaActionGroup` under a single
  `action_id` with `source = 'user_edit'` — `updateEntity` on the
  canonical (chosen scalars, keyword union normalized through C12, tag
  union), awareness rows moved to the canonical id (loser's row
  dropped on a `(branch_id, character_id, happening_id)` collision,
  footnoted in the summary), involvements moved, relationships
  re-keyed through the both-perspective action C7 pins (a pair that
  would collapse to self is dropped; a duplicate pair merges
  perspectives, canonical's non-null winning), inverse `state` refs on
  other entities rewritten to the canonical — one merged
  `updateEntity` per affected row — the tail scene rewritten to the
  canonical, the loser deleted through the C3 entity arm (which sweeps
  its vectors and translations, and refuses if the loser is the lead),
  and the flag cleared. As shipped, link rows are re-created on the
  canonical rather than re-keyed; see
  [Implementation notes](#implementation-notes). The canonical
  re-embeds via `embedding_stale` if an embedded field changed
  (already the update arm's behavior).
- **Rename driver:** two `updateEntity` deltas (sparse — only rows
  whose name changed) plus a flag clear on each flagged row of the
  pair, one `action_id`.
- **Keep driver:** a flag clear on each flagged row of the pair, one
  `action_id`.
- **Flag clear as a delta.** Canon makes every path CTRL-Z
  reversible; keep-as-distinct's only write is the clear, so the
  clear must be delta-logged — this slice adds `nameCollisionFlag` to
  the entity update arm's delta-logged columns for the user-edit
  path, leaving the classifier's operational **set** on the M1.5
  non-delta seam, and adds the field's label to C4's humanizer.
- **Wiring:** 4.1's `Resolve →` opens the dialog — a Modal on every
  tier, as shipped — disabled while generation is in flight; a merge
  whose loser is the lead surfaces the `lead-entity` refusal inline;
  after a resolution the list re-derives (pill count drops, strip
  disappears, a remaining pair re-surfaces for 3+ collisions while
  its namesake is itself flagged).
- **History shows link-row edits** (moved from `parked.md` on the 4.2b
  stack's manual review, 2026-09-30: the developer asked where a
  relationship edit went, the entry's revisit signal). Before this
  slice, a character's History tab omitted relationship edits; an
  entity's omitted its involvement edits; a happening's omitted
  involvement and awareness edits; a character's also omitted its own
  awareness edits. All four are deltas on the link row itself (`character_relationships`,
  `happening_involvements`, `happening_awareness`), keyed by the link
  row's own id, not the target's. See
  [World — History tab](../../../../ui/screens/world/world.md#history-tab).
  The fix unions deltas of link rows naming the target — live rows
  plus delete payloads — in C4's shared History module, so World's
  entity panes and Plot's happening pane both get it. It overlaps the
  merge driver, which reattaches these same link rows
  ([Implementation notes](#implementation-notes)).
- **Storybook:** the dialog already has stories; add the `priority`
  radio row and the phone 3-line prose clamp state.

## Scope: out

- Surfacing chrome (pill, strip, badge) and the seeded pair —
  [Slice 4.1](./01-world-shell.md).
- N-way merge UI — not v1 by canon; the user iterates pairs.
- Per-field diff inside `state` — v1 limitation by canon.
- The classifier's flag-setting path — M3.3 (unchanged).

## Acceptance criteria

- Merging B into A where B holds an awareness row A already has for
  the same happening keeps A's row, drops B's, and the summary
  footnote fires; every other awareness / involvement / relationship
  row of B is on A afterwards; the two other entities holding B in
  `inventory[]` and `current_location_id` point at A through one
  update each; B's translations are dropped; B is gone with zero vec0
  rows; A's `name_collision_flag = 0` (vitest over fixtures).
- CTRL-Z of the merge restores B with every row it held, restores
  the inverse refs, re-flags B, and B is `embedding_stale = 1`;
  redo re-merges (vitest on reverse-replay and redo of the group).
- A merge whose losing row is the story's lead is refused with
  `lead-entity` before any write (vitest).
- The projection's `relationCounts` match the DB for a fixture entity
  across all six inverse-ref fields, awareness, involvements and
  translations (vitest on the projection builder).
- Rename with only B's name changed writes one `updateEntity` delta
  and the flag clear; Save is disabled while the trimmed names still
  collide (vitest plus component test).
- Keep-as-distinct writes one delta per flagged row of the pair (the
  flag clear), CTRL-Z re-flags the row, and the History tab labels the
  field (vitest; component test on the humanizer).
- With three same-name rows, resolving one pair leaves the remaining
  pair visible on next open while the row outside the resolved pair is
  itself flagged: it keeps its strip, paired with a remaining namesake
  (vitest on the list derivation).
- `Resolve →` is disabled with the in-flight tooltip during a turn
  (component test).
- `tsc --noEmit` passes with the compound consuming the shipped
  `InjectionMode`, and a fixture pair differing only in `priority`
  renders one radio row (component test).
- A character's History tab lists edits to the relationship and
  awareness rows naming it, any entity's its involvement edits, and a
  happening's its involvement and awareness edits, in log order among
  the row's own deltas; a link row removed on its own still lists its
  edits on those tabs, found through its delete delta's payload
  (vitest on the History query over fixtures).
- The `Deleted` op chip on a character's History tab returns a
  relationship row removed on its own, its first per-row match: a row's
  own delete can't be opened, and undoing it prunes the delta (vitest
  on the History query over fixtures).

## Tests

- Vitest: merge driver matrix (each relation table, UNIQUE collision,
  relationship self-collapse and pair-merge, inverse refs per field
  merged per row, translations, keyword and tag union normalization,
  lead refusal), rename and keep drivers, group reversibility,
  projection counts, and the History link-row union (each link table
  from each end it names, live and deleted link rows, search, op
  filter and chunking over the unioned log).
- Component tests: wiring gates, refusal copy, humanizer label, a
  link-row History row's wording.
- E2E (desktop): seeded pair → merge → undo, asserting rows in the DB.

## Open questions

None open. Each question this slice carried was settled while
planning it or during the run; the answers are in
[Implementation notes](#implementation-notes).

## Implementation notes

Shipped as three stacked PRs (#578 `lib`, #579 dialog, wiring and
collision canon, PR 3 History union). Developer decisions are marked.

- **The merge creates link rows on the canonical** (developer,
  planning). Awareness, involvements and one both-view relationship per
  other character are re-created on the canonical, and
  `deleteEntity(loser)`'s C3 cascade removes the originals. No arm
  re-keys a link row in place. Moved rows get new ids, so their
  pre-merge edits stay on the other end's History tab through the
  union, not on the canonical's. Awareness and involvements the
  canonical already holds in the same happening are dropped and
  footnoted. A relationship with a character the canonical already
  relates to merges perspectives (the canonical's non-null views win,
  the loser's fill its blanks) and is footnoted too.
- **Merge copies across sweeps** (developer, during the run). The
  copies are user creates with no entry anchor, so a prose-edit sweep
  that reverses the classifier pass behind the originals leaves them,
  unless a copy names a row that pass created. Rollback and regenerate
  take the merge too. Pinned by
  `lib/actions/world/resolve-collision-sweep.test.ts`.
- **The merge's tail-scene effects cover the canonical only**
  (developer, during the run). A merge that rewrites the tail promotes
  the canonical if its merged status is `staged`, whatever its kind,
  and a character canonical in the tail scene takes the tail's known
  location. Each folds into the canonical's update when that already
  writes the column (`status`, `state`), else is its own write
  (`promoteStagedEntity`, `updateEntityLocationTracking`). No bystander
  is written. The next turn's structural floor seats only active
  entities, and its prompt is built before its piggyback fold.
  Accepted consequences: an in-scene canonical is promoted even when
  the status choice was left on `staged`, and the tail's location
  overwrites a manual location edit on the canonical when the tail
  scene already held the canonical beside the loser.
- **Planned inside the branch lock** (developer, planning). Every
  resolution commits through `applyDeltaActionGroupBuilt`, so a no-gate
  classifier pass can't stale the plan. 4.2b's entity delete stays on
  the plain group: it now also plans from names and flags, which the
  classifier never renames, deletes or clears.
- **Grouped writes need no group-aware pass.** The runner refuses two
  writes to one column of a row, and the merge makes none: one
  both-view relationship per other character, one `updateEntity` per
  entity row, and the canonical's scene effects on the columns its
  update leaves unwritten. A ref to the loser on the
  canonical collapses to null. A merge whose canonical descends from
  the loser through another location is refused as `parent-cycle`,
  because the pre-group reads see the cycle.
- **Flag clears** (developer, planning). Every dialog path clears each
  flagged row of its pair, not only the newer one: an older flagged row
  would otherwise be unresolvable. 4.2a's rename save and 4.2b's delete
  clear any flag their write leaves without a namesake. A reversal that
  orphans a flag is accepted; the next pairing clears it.
- **Where a clear lands.** It folds into a row's `updateEntity` only,
  so when a 4.2a save also takes an item from a row whose flag it
  clears, that row writes two deltas.
- **Other merge write-set choices** (developer, planning):
  - The loser's translations are dropped, not moved.
  - The tail scene is rewritten to the canonical, overturning 4.2b's
    drop.
  - A canonical item with no position takes the loser's placement.
    When the canonical item is already held or placed, the loser's
    holders drop it; one carrying both copies keeps one.
  - Moved awareness keeps `retrieval_count`. Since a duplicate is
    dropped rather than merged (first bullet), its count is lost; the
    canonical keeps its own.
  - A merge-written relationship view counts as the user's.
- **Rename validation.** Trimmed names must be non-empty and stop
  colliding under the namesake rule, so a change of letter case or of
  spaces at either end still collides. Interior spacing counts.
- **Dialog choices beyond the brief.**
  - Shared keywords show and submit in the canonical's spelling.
  - The merge submits the canonical's lists in their stored order, so
    it never writes an unchanged list.
  - The phone canonical picker is radio rows, since segment labels
    clip.
  - Native tiers stack choices with Older / Newer captions.
  - `Resolve →` goes through the pane's dirty guard.
  - A refusal that lands after the dialog closed shows as a toast.
- **History union** (developer, planning). A tab lists live
  link rows naming its row, link rows deleted on their own, and link
  rows held in the other end's delete payload, that delete itself
  listing under `Deleted`. Relationship edits show on both characters'
  tabs, whichever view they changed, labelled from the tab's side of
  the `a_id < b_id` pair. Awareness updates that change only the
  retrieval count are left out.
  - Wording: a link row's target line reads `<link> · <other end>`,
    the other end's name taken from the stores, else its delete
    payload, else unknown. Summaries read `Created`,
    `Modified <fields>`, `Deleted` and
    `Removed when <name> was deleted`. Link fields read Your view /
    Their view, Role, Source, Decay resistance and Learned at.
  - Search: a field term resolves against the labels of the delta's
    own table, a relationship's by side; free text works as before;
    the target line matches from a word start; the op chips count link
    rows.
- **Unknown other end.** A removal whose other end has no name to read
  says "Removed when its other end was deleted".
- **Union cost.** Measured on a 30k-delta branch, the link-end scan
  takes 6–32 ms per page and per search keystroke, more on
  delete-heavy branches. If History feels slow on a long story, cache
  the link ends per tab, keyed on the tab's refresh version (not a DB
  token: sweeps rewrite payloads in place). The missing table
  statistics are in [triage](../../../triage.md).
- **Not taken:** `revealFirstFlagged()`; the pill's handler is
  untouched.
