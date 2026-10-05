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
awareness / involvement / relationship reattachment with the UNIQUE
rule, inverse-ref rewrite, translations move, keyword and tag union),
**rename** (both rows, flag clear), **keep as distinct** (flag clear
only). The dialog's drifted `InjectionMode` and `ScalarField` unions
are fixed first. The History tab also starts listing edits to the link
rows that name its row: relationships, involvements, awareness.

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
  `updateEntity` per affected row — translations re-targeted, the
  loser deleted through the C3 entity arm (which sweeps its vectors,
  drops it from the tail scene, and refuses if the loser is the lead),
  and the flag cleared. The canonical re-embeds via `embedding_stale`
  if an embedded field changed (already the update arm's behavior).
- **Rename driver:** two `updateEntity` deltas (sparse — only rows
  whose name changed) plus the flag clear, one `action_id`.
- **Keep driver:** the flag clear alone, one `action_id`.
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
  disappears, a remaining pair re-surfaces for 3+ collisions).
- **History shows link-row edits** (moved from `parked.md` on the 4.2b
  stack's manual review, 2026-09-30: the developer asked where a
  relationship edit went, the entry's revisit signal). A character's
  History tab omits relationship edits; an entity's omits its
  involvement edits; a happening's omits involvement and awareness
  edits; a character's also omits its own awareness edits. All four
  are deltas on the link row itself (`character_relationships`,
  `happening_involvements`, `happening_awareness`), keyed by the link
  row's own id, not the target's. See
  [World — History tab](../../../../ui/screens/world/world.md#history-tab).
  The fix unions deltas of link rows naming the target — live rows
  plus delete payloads — in C4's shared History module, so World's
  entity panes and Plot's happening pane both get it. It overlaps the
  merge driver, which reattaches these same link rows (Open questions).
- **Storybook:** the dialog already has stories; add the `priority`
  radio row and the phone 3-line prose clamp state if the pattern's
  open item is picked up here.

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
  update each; B's translations target A; B is gone with zero vec0
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
  and the flag clear; Save is disabled while neither name changed
  (vitest plus component test).
- Keep-as-distinct writes exactly one delta (the flag clear), CTRL-Z
  re-flags the row, and the History tab labels the field (vitest;
  component test on the humanizer).
- With three same-name rows, resolving one pair leaves the remaining
  pair flagged and visible on next open (vitest on the list
  derivation).
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

- **Delta-logging the flag clear.** Adding `nameCollisionFlag` to the
  update arm's `UPDATABLE` set makes any future user-edit path able to
  flip it; confirm no classifier path routes through the user-edit
  arm so the M1.5 operational seam stays the only setter.
- **Orphaned flags.** World derives each flagged row's "Collides
  with" target from a same-kind namesake; a flagged row with no
  namesake left (e.g. after a Merge that keeps the newer, flagged row
  and deletes the older — canon never says the survivor's flag
  clears — or after a rename or delete in 4.2a / 4.2b) gets no strip
  and no pill count, so its flag can never be cleared. Decide: count
  flagged rows directly and render a no-namesake strip, or have
  merge / rename / delete clear the orphaned flag (and write that
  into canon). Also canon drift: [world.md → Authorship and 3+
  collisions](../../../../ui/screens/world/world.md#authorship-and-3-collisions)
  says the remaining pair "re-surfaces in the filter view", but
  [Surfacing](../../../../ui/screens/world/world.md#surfacing)
  rejected the filter chip.
- **`revealFirstFlagged()` handle.** The review pill's target
  (`components/world/first-flagged-row.ts`) and the pane's list
  signals are built separately, and the switch-plus-reveal "one
  synchronous handler" contract is comment-only, not type-enforced. A
  `revealFirstFlagged()` handle method would own both if this slice
  touches the pill.
- **Grouped relationship and parent writes read pre-group state.**
  4.2a's handlers each read the state before the group, so (a) two
  creates for the same character pair in one group throw on the
  pair's unique index rather than rejecting cleanly — merge duplicate
  pairs before emitting actions; (b) two `parent_location_id` writes
  in one group can form a loop the cycle guard doesn't see, and a
  valid reparent sequence (A.parent := null; B.parent := A while
  A.parent = B) is refused. Does the merge rewrite need a group-aware
  pass?
- **Merge writes count as user edits for precedence.** The merge
  driver's `updateEntity` and its re-keyed relationship writes are
  `user_edit`, so they count toward
  [user precedence](../../../../memory/cadence.md#user-edits-and-classifier-writes):
  a classifier fact from older prose no longer overwrites a column or
  view they wrote. `updateEntity` now drops unchanged columns, so only
  the scalars the merge actually changes count. Decide whether a
  re-keyed pair should read as a user-authored view: it is a user
  create, so each view it carries over non-null blocks upserts from
  older prose even though the classifier wrote it.
- **The dialog's chrome isn't routed through `t()`.**
  `components/compounds/collision-resolve-dialog.tsx` holds about twenty
  raw English strings — mode labels, buttons, the field-label map, the
  merge-count lines, the keep-as-distinct warning — and `formatAgo`
  returns "just now", "N min ago", "N h ago" and "N d ago" as literals,
  spliced into "Older · …" and "Newer · …", against
  [`code-conventions.md → i18n discipline`](../../../../code-conventions.md#i18n-discipline).
  The dialog has no live caller until this slice gives it drivers, so
  route it through `t()` here (`relativeTimeLabel` in `lib/i18n` already
  renders History's and the story card's "5m ago"); relative times want whole-sentence keys
  (see [`parked.md → Sentence composition in World's copy`](../../../../parked.md#sentence-composition-in-worlds-copy)).
  Found by the 2026-09-27 triage pass.
- **How does the merge re-key the loser's link rows, given the entity
  arm's constraints?** C3's `deleteEntity` cascade reads the loser's
  involvement, awareness, relationship and translation rows pre-group
  and deletes them by id, and the group runner rejects a group that
  also targets one of those rows. The ref rewrite and tail-scene drop
  live in `entityDeleteActions`, which nulls refs — the merge needs its
  own rewrite-to-canonical, and one row can't carry both the rewrite
  and the nulling patch in one group (the runner rejects a same-column
  double write). Does the merge instead write new link rows for the
  canonical entity and let the cascade remove the loser's originals, or
  some other shape? Whatever 4.2c settles on,
  [`world.md → Reversibility`](../../../../ui/screens/world/world.md#reversibility)'s
  merge write list must be amended to match. New rows plus the cascade
  means more rows a delete captures. Captured rows follow
  [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay).
- **Reuse the delete confirm's link counts** (4.2b):
  `components/world/delete-impact.ts` repeats the entity cascade's
  awareness / involvement / relationship predicates against the
  stores; 4.2c's merge summary needs the same counts over the same
  tables — move them into `lib/world` beside `entityDeleteActions`
  rather than writing a third copy.
- **Link-row History, open from the 4.2b stack's manual review
  (2026-09-30).** The parked entry fixed the rule, not these:
  - **Wording on each side.** The humanizer names every row after the
    tab's own row and labels its paths from the tab's table
    (`lib/history/humanize.ts`), and a create reads `Created`, so on
    Aria's tab a relationship made with Kael would read as Aria being
    created. Decide what a link-row delta names (the other end, or the
    link, as in "relationship with Kael"), how it names an other end
    that no longer exists, and how a relationship's two views label on
    each character's tab: `kind` is a's view of b, `inverseKind` b's
    view of a, and which one a tab's character holds follows the
    `a_id < b_id` ordering, not the tab.
  - **Both characters of a relationship.** Naming the target puts
    every relationship edit on both characters' tabs, an edit to only
    the other's view included. Keep that, or list a one-view edit only
    on the tab of the character whose view changed? Involvement and
    awareness rows have no such split.
  - **Search, op filter and the field-path vocabulary.** The label
    vocabulary (`lib/history/field-labels.ts`) is keyed by
    `HistoryTable`, which lists no link table, so link-row paths would
    render raw (`inverseKind`, `decayResistance`) and search would
    reach them only by raw path: add their labels, and resolve each
    term against the labels of the table a delta belongs to. The op
    chips then count link rows too: `Created` on a character's tab
    would also list the relationships made, and `Deleted` gets its
    first per-row matches (pinned in
    [Acceptance criteria](#acceptance-criteria)). The search bullet's "`target_table` is never matched,
    since it's constant within a per-row tab" in
    [`world.md → History tab`](../../../../ui/screens/world/world.md#history-tab)
    and C4's single-target query stop holding; amend both with the
    union.
  - **Which delete payloads.** A link row removed on its own leaves a
    `delete` delta whose payload names both ends. One that an entity or
    happening delete cascaded has no delta of its own: it rides in that
    delete's payload under `relationships`, `involvements` or
    `awareness` (`lib/actions/delta/delete-cascade.ts`), and its create
    payload is null and its updates carry only changed columns.
    Deleting Kael leaves no live link row and no link delete delta
    naming Aria, so the relationship's edits drop out of her tab
    unless the union also reads cascade payloads. Decide whether it
    does, and how the cascade reads on the surviving end.
  - **The tab's refresh version.** `HistoryTab` refetches when its
    target row or `settleCount` changes; a user edit to a link row
    changes neither, so the union folds the link stores it reads into
    that version (2026-10-04 triage pass). A reversal that edits a
    delete's payload emits no store patch, so link rows the union reads
    from payloads need a refresh signal of their own
    ([`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay)).
  - **Overlap with the merge.** The merge reattaches the loser's link
    rows to the canonical, in a shape the re-key question above leaves
    open. Moved in place, a row names the canonical and brings its
    earlier edits along; rewritten as new rows with the originals
    cascaded, those edits sit in the loser's delete payload and reach
    the canonical's tab only if the union reads cascade payloads.
    Settle the two together, and give the union's fixtures a merged
    pair.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
