# Slice 4.2b — Lore detail, History tab module, delete arms

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.2a](./02a-entity-detail.md) (C7
  save-session host, C11 overflow menu, the History placeholder this
  slice fills)
- **Blocks:** [Slice 4.2c](./02c-collision-review.md) (the merge's
  losing row deletes through C3), the History tab and delete entries
  of [Slice 4.3](./03-plot-panel.md) (C4 and C3 — partial),
  [Slice 4.6](./06-import-export.md) (lore export host — partial)

## Goal

Lore gets its detail pane (Body / Settings / History), the delta-log
History tab lands as a shared module (C4) that also fills 4.2a's
placeholder, and the first delete surfaces ship — `Delete entity` and
`Delete` on lore — over hardened delete arms (C3): the entity link
cascade, inverse-ref rewrite, tail-metadata drop, lead refusal, the
happening cascade's critical section, and the vector sweep on forward
delete and redo for every embedded kind.

## Background

Lore is a separate, simpler kind: text-heavy, no lifecycle, no scene
presence, a required `body`, and — since the 2026-09-06 design — a
`keywords` editor that is load-bearing for the keyword retrieval
pathway (embedding models have no prior for invented terms). History
is the per-row delta log: read-only, searchable over field paths and
`undo_payload`, load-older chunked, rendered through the shipped
`DeltaLogRow` with host-side humanization. Delete is where M1.5's
"no production caller" arms meet reality: `deleteEntity` removes one
row and leaves `happening_awareness`, `happening_involvements`,
`character_relationships`, inverse `state` refs and `translations`
dangling (all FK-less by composite-PK necessity), and nothing on any
delete path reaches the vec0 tables — `deleteVecOps` exists with no
caller. Reverse-replay already restores rows stale; redo rebuilds a
delete from the registry's `cascadeDeleteOps` hook, never from the
handler, which is where the sweep must therefore live.

## Required reading

- [`world.md → Lore — separate kind`](../../../../ui/screens/world/world.md#lore--separate-kind)
  through [`History tab — lore`](../../../../ui/screens/world/world.md#history-tab--lore)
  — the three-tab skeleton, detail head, Body and Settings fields,
  the required-body invariant.
- [`world.md → History tab`](../../../../ui/screens/world/world.md#history-tab),
  [`Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure)
  (the `Delete entity` entry) and
  [`Mobile expression`](../../../../ui/screens/world/world.md#mobile-expression)
  (lore's three-tab Select rule on phone; History controls reflow).
- [`patterns/tabs.md → Tab-strip overflow rule`](../../../../ui/patterns/tabs.md#tab-strip-overflow-rule).
- [`patterns/forms.md → Autocomplete-with-create primitive`](../../../../ui/patterns/forms.md#autocomplete-with-create-primitive)
  (the `category` suggestions), [`Select primitive`](../../../../ui/patterns/forms.md#select-primitive),
  [`Input primitive`](../../../../ui/patterns/forms.md#input-primitive),
  [`Textarea primitive`](../../../../ui/patterns/forms.md#textarea-primitive)
  (the body field's auto-grow), [`TagInput pattern`](../../../../ui/patterns/forms.md#taginput-pattern)
  and [`Form rows — stacked-on-narrow-container`](../../../../ui/patterns/forms.md#form-rows--stacked-on-narrow-container).
- [`patterns/delta-log-row.md → Compound API`](../../../../ui/patterns/delta-log-row.md#compound-api)
  through [`Click behavior`](../../../../ui/patterns/delta-log-row.md#click-behavior)
  — what the host pre-formats, and the cache-miss summary rule.
- [`patterns/lists.md → Load-older`](../../../../ui/patterns/lists.md#load-older--log-shaped-unbounded-lists)
  and [`Search bar scope`](../../../../ui/patterns/lists.md#search-bar-scope)
  (the History row of the table).
- [`patterns/alert-dialog.md → Destructive CTA`](../../../../ui/patterns/alert-dialog.md#destructive-cta-via-button-composition)
  — the delete confirmation shape.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — delta encoding, `undo_payload` shapes, and what redo replays.
- [`world.md → Reversibility`](../../../../ui/screens/world/world.md#reversibility)
  — the merge write set C3 mirrors for delete.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — the `needsLead` constraint behind the lead refusal.
- [`patterns/entry-card.md → World-state panel`](../../../../ui/patterns/entry-card.md#world-state-panel)
  — historical entries render an unresolvable id as an Unknown-entity
  chip, which is why the delete need not touch them; the tail drop is
  this milestone's default, not canon (C3).
- [`memory/retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  and [`Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
  — the vec0 write and sweep obligations and lore `keywords`.
- [`architecture.md → Delta history diff resolution`](../../../../architecture.md#delta-history-diff-resolution)
  — the M6.4 cache the C4 summary later upgrades into; read for the
  contract boundary, not to build it.
- [Milestone contracts C3, C4, C7, C11, C12](../milestone.md#slice-contracts).

## Scope: in

- **Lore pane:** `LoreDetailPane` on the C7 host — detail head
  (kind icon and `Lore`, `InlineEditableName` on `title`, recently-
  classified badge, C11 menu with `Export lore as JSON` disabled until
  4.6, `View raw JSON`, `Delete`; no `Set as lead`); **Body** tab
  (`category` input with a branch-scoped suggestions popover, body
  textarea filling the pane; Save disabled while body is empty);
  **Settings** tab (`injection_mode` with explanation, `priority`
  `0..100` with the shipped-semantics tooltip, `keywords` normalized
  through C12, `tags`); create mode from `[+] Blank` on Lore; tabs via
  Tab strip on desktop and tablet, Select dropdown on phone.
- **C4 History module:** the load-older query, the humanizer with its
  field-path label vocabulary, and the `HistoryTab` component with
  search (field-path / op / summary), op-filter chips, newest / oldest
  sort, `Load older`, the read-only empty state, and controls that
  reflow on narrow widths; mounted on the lore pane and on 4.2a's four
  entity panes (replacing the placeholder), and renderable for the
  `threads` and `happenings` target tables so 4.3 mounts it unchanged.
  Rows link to the reader entry when `entryId` is set.
- **C3 delete arms**, per the milestone's pinned mechanism: the
  grouped entity delete — one merged `updateEntity` per referencing
  entity, one `updateStoryEntryMetadata` for the tail scene drop, then
  `deleteEntity` with `cascadeDeleteOps` covering the three link tables
  and translations; the `lead-entity` refusal when the target is the
  story's lead; the happening cascade's child read and delete moved
  into one critical section under the key lock; and `deleteVecOps`
  emitted from each embedded kind's `cascadeDeleteOps` so forward
  delete and redo both sweep. The 4.2b PR amends `world.md` to record
  the tail-scene drop, or records the deviation if review rejects it.
- **Delete surfaces:** `Delete entity` and lore `Delete` in the C11
  menus over an `AlertDialog` naming what goes with the row (link-row
  counts, the tail-scene drop) or, for the lead, the refusal and a
  pointer to `Set as lead`; gated while generation is in flight;
  routed through the reader's CTRL-Z stack.
- **Storybook:** lore pane states (populated / empty body / create),
  History tab states (rows per op and source, empty, loading older),
  delete confirm and lead refusal.

## Scope: out

- Entity panes and the save-session host — [Slice 4.2a](./02a-entity-detail.md).
- The merge driver that consumes the delete arm — [Slice 4.2c](./02c-collision-review.md).
- Thread and happening delete **surfaces** — [Slice 4.3](./03-plot-panel.md)
  (the arms are hardened here; 4.3's entries stay disabled until this
  slice merges).
- The diff cache and rich diff prose — M6.4.
- Lore Assets (parked), lore categories as dynamic chips (no
  followup until volume demands).
- Global delta-log browser — M7.3 Diagnostics Hub.

## Acceptance criteria

- Deleting a character with two awareness rows, one involvement, one
  relationship, a translation row, and another character holding it in
  both `current_location_id` and `inventory[]` leaves none of those
  rows, rewrites both refs in one `updateEntity`, removes the id from
  the tail entry's `sceneEntities`, and leaves zero vec0 rows for the
  id in every dim family — all under one `action_id` (vitest against
  an in-memory DB with vec tables).
- CTRL-Z of that delete restores the entity, every cascaded row, the
  inverse refs and the tail scene, with the restored entity
  `embedding_stale = 1`; redo re-deletes and the vec tables are empty
  for the id again (vitest on reverse-replay and redo).
- Deleting the story's lead character is refused with `lead-entity`
  from the arm and the confirm dialog shows the refusal instead of the
  cascade summary (vitest on the arm; component test on the dialog).
- Deleting a lore, thread or happening row leaves zero vec0 rows for
  the id; two concurrent writers on a happening's involvements cannot
  interleave with its delete (vitest per kind; vitest on the key lock).
- Historical entries that referenced the deleted id still render it
  as an Unknown-entity chip (component test on the world-state panel
  with a deleted id in `sceneEntities`).
- The delete confirm for a character with two awareness rows, one
  involvement and one relationship names those counts and the
  tail-scene drop (component test plus Storybook).
- Saving lore with an empty body is impossible from the Body tab and
  from create mode (component test).
- History search for a field path (`state.traits`) returns only
  updates touching it; op filter `delete` returns only deletes;
  `Load older` appends the next chunk and never auto-loads on scroll
  (vitest on the query; component test on the tab).
- A `periodic_classifier` delta on the entity renders the
  `periodic classifier` source label and `entry #n` link; clicking it
  navigates to that entry in the reader; the `HistoryTab` renders a
  `threads` and a `happenings` fixture delta with resolved names
  (component test plus manual).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: C3 cascade matrix (each link table, merged multi-field ref
  rewrite, tail scene, translations, lead refusal, happening critical
  section), sweep-on-delete and sweep-on-redo per kind, C4 query
  (search shapes, op filter, sort, cursor), humanizer per op, source
  and target table.
- Component tests: lore pane, required body, History tab controls,
  delete confirm and refusal.
- Storybook: the matrix above.
- E2E (desktop): delete entity → undo → redo, asserting vec rows and
  link rows in the DB.

## Open questions

- **Critical-section shape for the happening cascade.** Whether the
  child read moves inside the delete's transaction or the whole
  `cascadeDeleteOps` call takes the per-happening key lock the
  awareness arm already uses; either satisfies C3. Pick at planning.
- **Group ordering.** The entity delete must come last in the group so
  the referencing entities' `state` patches and the tail metadata
  write are built against rows that still exist; confirm the runner's
  pre-group-state rule makes the order irrelevant, or pin it.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
