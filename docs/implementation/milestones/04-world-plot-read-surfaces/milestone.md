# Milestone 4: World + Plot read surfaces

## Goal

Users can browse and edit the entity graph the memory pipeline
produces. The World panel renders entities by kind and lore with the
full per-kind detail composition, resolves name collisions, and
deletes cleanly; the Plot panel renders threads and happenings with
their involvement and awareness links; the reader gains the Browse
rail and peek drawer that make the graph visible without leaving the
prose; Story Settings grows from the M3 shell into the basic surface
real data needs (model overrides, story identity, authoring aids,
memory knobs); and every per-row kind can be imported from and
exported to an `.avts` file. Stories made in M4 are inspectable and
correctable by hand.

## Why now

M3 fills the `entities`, `lore`, `happenings`, `happening_awareness`,
`happening_involvements`, `character_relationships` and `threads`
tables from live traffic, and nothing renders them — the memory
pipeline is invisible and its mistakes are uncorrectable except by
rollback. This milestone is read-heavy with light edit: it validates
the classifier's output against human eyes (the inspection need named
in
[`roadmap.md → Milestones that may merge or split`](../../roadmap.md#milestones-that-may-merge-or-split))
and gives the user the correction surfaces canon already specifies —
collision review, manual entity edits, delete, keyword authoring. It
lands before chapters (M5) because chapter close compacts exactly
these rows, and a compaction nobody can see is untestable. The build
itself is the strongest cross-milestone look-ahead candidate in the
roadmap: every shape it renders is frozen in
[`data-model.md`](../../../data-model.md), and `pnpm db:seed` already
carries thirteen entities plus lore, threads, happenings, awareness and
relationships, so surfaces were buildable against seeds mid-M3 and
only the definition of done waits on real classifier output.

## Narrative / overview

Three surfaces and one settings extension, converging on the reader.
The **World track** is the milestone's spine.
[Slice 4.1](./slices/01-world-shell.md) lands the World route on the
shipped `ScreenShell` / `MasterDetailLayout` / `EntityListPane` /
`DetailPane` shells: five-category kind dropdown, per-kind filter
chips and accordion grouping, the four-layer entity sort and two-layer
lore sort, category-aware search over row columns and `state` JSON,
the four-channel row composition, the Actions menu's `GO TO` group,
and the collision **surfacing** chrome (top-bar review pill, per-row
strip, collapsed-accordion badge). It also owns two substrate modules
every later surface reads: the derived-signal selectors for
recently-classified and in-scene (C1) and the per-kind list modules
(C2). [Slice 4.2a](./slices/02a-entity-detail.md) fills the detail
pane for the four entity kinds — the hand-written Overview / Identity
/ Carrying / Connections / Settings panes, the relationships
sub-section, the per-row save session (C7), create mode, `Set as
lead` (C5), raw JSON, and the `parent_location_id` cycle guard the
wizard adopts too. [Slice 4.2b](./slices/02b-lore-history-delete.md)
adds the lore detail (Body / Settings / History), the shared History
tab module (C4) that backfills the entity History tab and later serves
Plot, and the first delete surfaces — entity and lore — with the link
cascade and vector sweep (C3) that the roadmap's carried deferrals
named. [Slice 4.2c](./slices/02c-collision-review.md) wires the
shipped `CollisionResolveDialog` to real drivers: merge, rename and
keep-as-distinct under one `action_id`, the dialog's drifted
`InjectionMode` and `ScalarField` unions fixed as the first step.

The **Plot track** is one slice. [Slice 4.3](./slices/03-plot-panel.md)
lands the Plot route on the same shells with the Threads / Happenings
segment toggle, status-tier and chapter-bucket grouping, the thread and
happening detail panes with the Involvements and Awareness editors,
and the entry-ref picker (C8) this milestone introduces as the first
consumer of a pattern later entry-ref surfaces reuse. The kind-aware
entity picker is the other C8 half, owned by 4.2a and shared with
Plot's link editors.

The **settings track** extends the M3.11 shell rather than replacing
it. [Slice 4.4](./slices/04-story-settings-basic.md) is the "basic
surface" the roadmap deferred here: the Models tab (narrative override
plus the five story-agent overrides over `resolveModel`), the About
tab with the story-list `Edit info` route, the Generation tab's
Authoring aids completed with composer modes and wrap POV (which
brings the definitional-change confirmation for `composerWrapPov`),
the Memory tab's chapter-close, prompt-context, classifier-cadence,
retrieval-budget and keyword-retrieval knobs, the story-open
embedding upgrade prompt beside `SwapResumeHost` with both `Keep`
write sites, and the phone save-bar placement call M3.7b queued. The
M7.2 boundary is drawn explicitly in that slice: definitional fields,
the classifier status panel and `piggybackMode` gate, Pack, Calendar,
Translation, Advanced and Probe stay deep.

The **reader track** converges last. The roadmap entry named only a
peek drawer, but Slice 2.5 deferred the whole Browse rail to "M4-era"
and the reader still renders a placeholder column, and canon opens the
peek only from rail rows — so the rail joined at promotion.
[Slice 4.5a](./slices/05a-browse-rail.md) builds it: the
seven-category dropdown grouped World / Plot, the rows and queries
reused from 4.1 and 4.3 via C2, the collapsed strip dashboard with its
per-kind classifier tint, the manual-plus-viewport state model, and
the phone `[☰ Browse]` chip in the shell's shipped chip-strip slot
that opens the rail as a Sheet built to morph (C10).
[Slice 4.5b](./slices/05b-peek-drawer.md) adds the peek drawer as a
440 px projection of 4.2a's Overview (and the lore peek), the
`Set as lead` affordance over C5, and the `Open in panel →` route that
lands World / Plot pre-selected (C6). The roadmap's "awareness chips
on entries" phrase was dropped at promotion: no canonical doc specs an
entry-level awareness affordance, and the scene chips the world-state
panel already renders are M3.2's. Finally
[Slice 4.6](./slices/06-import-export.md) wires the shipped
`ImportDialog` as its first consumer — the four per-row envelope kinds
with kind-narrowed Zod payload schemas, import actions behind the
`[+] From JSON file…` menus on both panels, and the matching per-row
export behind the detail-head `⋯` menus (C9). The roadmap's
install-and-rebuild prerequisite for that slice is stale:
`expo-document-picker` and `expo-file-system` are installed and
already imported by the dialog; what the slice actually needs on
native is a share / save path for export.

What changes from "before" to "after": the app goes from "a memory
pipeline whose output is visible only through the developer probe" to
"a world the user can browse from the reader, open in its workshop,
correct, merge, delete, and carry between stories as files." M5 then
closes chapters over a graph the user has seen.

Three deliberate M4 limits are worth naming. History tabs render
against **raw delta-log queries** — correct but uncached; M6.4's diff
cache upgrades the summary prose without changing the C4 contract.
The entity **Assets tab and portrait slot ship as placeholders**:
canon specs them, but `entry_assets` links entries only and the asset
gallery that would give entities attachments is parked with "surfaces
TBD" ([open question](#open-questions)). And Plot's **chapter buckets
are seed-only until M5**: nothing opens a chapter before chapter close
lands, so the `Current chapter` / `Earlier chapters` split and the
`This chapter` chip render against `pnpm db:seed` fixtures and collapse
to one implicit bucket on every real M4 story.

## Slices

- [Slice 4.1](./slices/01-world-shell.md) — World panel shell and
  list pane: route, kind dropdown, filters, sort, search, rows,
  collision surfacing chrome, `GO TO` menu group; C1 derived-signal
  selectors, C2 list modules
- [Slice 4.2a](./slices/02a-entity-detail.md) — entity detail: four
  per-kind panes, relationships, save session (C7), create mode,
  `Set as lead` (C5), raw JSON, cycle guard, entity picker (C8 half),
  overflow menu (C11 half)
- [Slice 4.2b](./slices/02b-lore-history-delete.md) — lore detail,
  shared History tab module (C4), entity and lore delete with cascade
  and vector sweep (C3)
- [Slice 4.2c](./slices/02c-collision-review.md) — collision review
  drivers: merge / rename / keep under one `action_id`,
  `InjectionMode` and `ScalarField` drift fixes
- [Slice 4.3](./slices/03-plot-panel.md) — Plot panel: threads and
  happenings lists and details, Involvements and Awareness editors,
  entry-ref picker (C8 half), overflow menu (C11 half)
- [Slice 4.4](./slices/04-story-settings-basic.md) — Story Settings
  basic surface: Models, About, Authoring aids completion, Memory
  knobs, story-open upgrade prompt, phone save-bar call
- [Slice 4.5a](./slices/05a-browse-rail.md) — reader Browse rail:
  seven categories, collapsed strip, state model, phone Browse chip
  and rail-as-Sheet (C10)
- [Slice 4.5b](./slices/05b-peek-drawer.md) — peek drawer: Overview
  projection, lore peek, lead affordance, `Open in panel →` (C6)
- [Slice 4.6](./slices/06-import-export.md) — per-row `.avts` import
  and export: envelope kinds, payload schemas (C9), `ImportDialog`
  first wiring, native share path

## Dependency graph

```
day-one: 4.1   4.3   4.4   (+ 4.6-schemas)

4.1 ───→ 4.2a ───→ 4.2b ───→ 4.2c
4.1 ┄──→ 4.2c     (partial: dialog wiring, rename and keep drivers)
4.1 ┄──→ 4.3      (partial: C1 signals, C6 World deep link)
4.2b ┄─→ 4.3      (partial: C3 delete arms, C4 History tab)
4.1, 4.3 ──────→ 4.5a ───→ 4.5b
4.2a ──────────────────────→ 4.5b   (Overview projection, C5)
4.1, 4.3 ┄─────→ 4.6      (import hosts)
4.2a, 4.2b, 4.3 ┄→ 4.6    (export hosts)
```

- **Day-one startable:** 4.1 (shells, stores and CRUD arms are M1.5;
  row data from `pnpm db:seed`), 4.3 (same, plus the M3.3 happening
  cascade), 4.4 (extends the merged M3.11 shell), and the
  build-independent half of 4.6 — envelope kinds, payload schemas,
  import actions, export serializer.
- **4.1 gates 4.2a** — the detail pane is hosted in the shell, and
  `[+] Blank` opens 4.2a's create mode (4.2b's for lore). **4.2a gates
  4.2b** — lore detail rides the per-row save-session host C7 and the
  `⋯` menu 4.2a establishes; the shared History module backfills
  4.2a's placeholder tab. **4.2b gates 4.2c** — the merge driver
  deletes the losing row through the hardened delete arm (C3: link
  cascade, vector sweep, lead refusal). 4.2c's rename and keep drivers
  and the dialog wiring itself need only 4.1 — a partial gate drawn
  above — so its planning may start early; only merge waits.
- **4.3** is day-one with two partial gates. From 4.1 it consumes the
  C1 selectors for its row signals and the C6 World deep link its
  Involvements and Awareness rows route to. From 4.2b it consumes the
  C4 History module and the C3-hardened thread and happening delete
  arms — 4.3 ships its History tab as a placeholder and its `Delete …`
  entries present-but-disabled until 4.2b merges. Everything else —
  shell, lists, details, editors, pickers — builds against seeds. 4.3
  and 4.2a are a
  [doc-as-contract](../../conventions.md#sequencing-vs-doc-as-contract)
  pair over C7 (the per-row save-session host), C8 (the two picker
  primitives) and C11 (the overflow-menu compound); 4.3 and 4.1 are a
  pair over C6 (the deep-link param shape). Whichever lands first fixes
  the names.
- **4.5a** gates on 4.1 and 4.3 in full — it renders their row
  renderers and calls their list queries (C2) rather than building a
  third copy. **4.5b** gates on 4.5a (the rail hosts the peek and owns
  the Sheet morph seam, C10) and 4.2a (the peek body is a projection of
  the Overview component; the lead affordance calls C5). C1 and C6
  reach 4.5b through 4.5a's gates.
- **4.6** gates partially: the import wiring needs 4.1's and 4.3's
  `[+]` menus to host the dialog; the export wiring needs 4.2a's,
  4.2b's and 4.3's `⋯` menus. Those hosts ship their `From JSON file…`
  and `Export … as JSON` entries present-but-disabled with a
  "lands in Slice 4.6" reason, and 4.6 flips them.
- **4.4** has no build edge in either direction. Its keyword-retrieval
  panel is only _useful_ once 4.2a's and 4.2b's keyword editors make
  keywords authorable (the roadmap's carried deferral asked for the two
  to be sequenced together), so its milestone-level validation follows
  4.2b the way M3.8's followed M3.2 — without blocking its build.
- **The roadmap's parallel-paths sketch is superseded.** It drew
  `{4.1, 4.2} || {4.3} || {4.4} || {4.5}` with 4.6 gated only on the
  shells. The rail joined at promotion and consumes both panels'
  modules, the peek projects 4.2a's Overview, and export needs the
  detail heads, so 4.5a, 4.5b and 4.6 are converging slices here.

## Slice contracts

### C1 — Derived row-signal selectors

[Slice 4.1](./slices/01-world-shell.md) owns one pure module that
computes the two runtime-derived row signals every list surface
renders, so no consumer computes its own.

**Recently-classified.** Given the branch's delta rows and its latest
entries, return `ReadonlyMap<rowId, RecentlyClassified>` — the
value union from `lib/row-signals/types.ts` (`'fresh' | 'fading'`)
— over every classifier-touched row across
`entities`, `lore`, `threads` and `happenings`, plus a per-kind
aggregate (`fresh` if any contributor is fresh, `fading` if all are
fading, absent otherwise) for the rail strip's cells and the phone
Browse chip. The exact rule is fixed in 4.1: a delta log-position
window over the create deltas of the last two `ai_reply` entries
(fresh, fading), tiering pipeline-source deltas (not `user_edit`)
directly and link-table writes (`happening_awareness`,
`happening_involvements`, `character_relationships`) by the rows they
connect; scene-presence transitions tier per reply, kind-aware like
in-scene; deltas of reversed runs are excluded. See
[`entity.md → Recently-classified row
accent`](../../../ui/patterns/entity.md#recently-classified-row-accent)
for the full rule. Decay at two turns resolves the
[`plot.md` open question](../../../ui/screens/plot/plot.md#screen-specific-open-questions)
of the same name, which 4.1's PR removes now that `entity.md` carries
the rule.

**In-scene.** From the branch tail's scene triple (read through the
reader's inherited-metadata helper, so a tail `user_action` inherits
correctly): characters and items present in `sceneEntities`, the one
location equal to `currentLocationId`, factions never. Returned as a
set of row ids.

Consumers: 4.1 (World rows, detail-head badge), 4.3 (Plot rows and
badge), 4.5a (rail rows, strip cells and counts, Browse chip), 4.5b
(peek head badge).

### C2 — Per-kind list modules

Two owners, one interface. [Slice 4.1](./slices/01-world-shell.md)
owns the entity and lore modules; [Slice 4.3](./slices/03-plot-panel.md)
owns the thread and happening modules. Every module exports the same
shape — a `ListModule` with: a branch-scoped **query** taking
`{ search, filter }` and returning rows in canonical order (entities:
the
[four-layer sort](../../../ui/patterns/entity.md#entity-list-sort-order--static-four-layer)
with the search scope from
[`patterns/entity.md → Search scope`](../../../ui/patterns/entity.md#search-scope);
lore: priority then title; threads: status tier then title;
happenings: `occurred_at` position DESC with `temporal` rows last); the
**grouping key** the All view's accordion uses; the **filter-chip
vocabulary**; the **search-scope copy** (placeholder, tooltip, ⓘ
popover body); the **empty-state and no-results copy** for the kind;
and a **row renderer** composing the shipped `ListRow` that takes the
row plus its C1 signals (lead, in-scene, recently-classified,
collision) as props, reads no store itself, and accepts a **density
prop** for the rail's narrower layout. The **category label** is
surface-owned and passed in, because canon itself diverges — World's
dropdown says `Locations`, the rail's says `Places` — so the module
never hardcodes it. Consumer: [Slice 4.5a](./slices/05a-browse-rail.md)
mounts the same renderers and calls the same queries; any divergence
is a prop, never a fork. The interface and its names are fixed by
whichever of 4.1 / 4.3 lands first; the other conforms.

### C3 — Delete arm hardening

[Slice 4.2b](./slices/02b-lore-history-delete.md) owns the first
delete surfaces and therefore the correctness of the four delete arms
M1.5 left without a production caller. Pinned behavior, and the
mechanism where the shipped runner forces it:

- Deleting an **entity** is one `applyDeltaActionGroup` under one
  `action_id`. The group carries **one** `updateEntity` per other
  entity that references the id, with every affected ref field
  (`current_location_id`, `parent_location_id`, `at_location_id`,
  `faction_id`, `equipped_items[]`, `inventory[]`) merged into a single
  `state` patch — the runner rejects two writes to one row's column —
  then one `updateStoryEntryMetadata` dropping the id from the tail
  entry's `sceneEntities` / `currentLocationId`, then the
  `deleteEntity` whose registered `cascadeDeleteOps` removes its
  `happening_involvements`, `happening_awareness`,
  `character_relationships` and `translations` rows. The link and
  translation set mirrors the merge path canon gives in
  [`world.md → Reversibility`](../../../ui/screens/world/world.md#reversibility)
  minus the rewrite-to-canonical half. The tail-metadata drop is this
  milestone's **default assumption** — canon is silent on it for both
  delete and merge — routed as an [open question](#open-questions) for
  a `world.md` amendment.
- Deleting the **lead character** is refused with a named rejection
  (`lead-entity`) rather than nulling `definition.leadEntityId`, which
  the schema's `needsLead` refine forbids in adventure or first- and
  second-person stories; the confirm dialog explains and points at
  `Set as lead`. The same refusal applies to a merge whose losing row
  is the lead.
- Deleting a **lore**, **thread** or **happening** row deletes the row
  and its cascade. Because 4.3 makes the user a second writer of
  `happening_involvements` and `happening_awareness`, 4.2b moves the
  happening cascade's child read and delete into one critical section
  under the key lock — the shipped cascade's own comment calls it safe
  only while the classifier is the sole writer.
- Every delete — forward, and again on **redo** — leaves zero vec0
  rows for the id across every dim family. The sweep lives in
  `cascadeDeleteOps` via `deleteVecOps`, because `applyRedo` rebuilds
  a delete from the descriptor plus that hook and never re-runs the
  handler. Reverse-replay restores the row `embedding_stale` so the
  drain re-embeds it (already shipped).

Consumers: 4.2c (the merge's losing row goes through the entity arm,
never a bespoke delete), 4.3 (thread and happening delete — its
entries ship disabled until 4.2b), and any later delete surface. A
delete that bypasses the arm is a contract violation.

### C4 — History tab module

[Slice 4.2b](./slices/02b-lore-history-delete.md) owns the delta-log
History tab every detail pane shares. Pinned surface: a branch-scoped
**query** taking `{ targetTable, targetId, op?, search?, sort, cursor }`
and returning one load-older chunk (search is `LIKE` over
`target_table` / `op` plus `json_extract` over `undo_payload`, per
[`world.md → History tab`](../../../ui/screens/world/world.md#history-tab));
a **host humanizer** mapping a `deltas` row to the
[`DeltaLogRow` props](../../../ui/patterns/delta-log-row.md#compound-api)
— target display name resolved from the working-set stores, field
path, a summary derived from `undo_payload` keys (the M4 interim;
M6.4's diff cache upgrades the prose without changing this contract),
source, relative time, `entry #n`; and a **`HistoryTab` component**
taking `{ branchId, targetTable, targetId }` that composes search,
op-filter chips, sort, the load-older list and the read-only empty
state. The humanizer owns the field-path label vocabulary: a later
slice that adds a delta-logged column (4.2c adds `nameCollisionFlag`)
also adds its label. Consumers: 4.2b itself (entity and lore), 4.3
(thread and happening — partial gate). Names fixed in 4.2b's first
commit.

### C5 — Story-definition lead mutator

[Slice 4.2a](./slices/02a-entity-detail.md) owns the first
post-creation writer of `stories.definition`: no such arm exists
today — `updateStorySettings` takes settings only — so this is a new
action, not a settings-path call. Pinned: it sets
`definition.leadEntityId` for a story, validating that the target is a
`kind='character'` entity on the story's current branch and that the
result still satisfies the schema's `needsLead` refine; it writes no
delta (`stories` is absent from `deltas.target_table`); it refuses
while `isUserEditBlocked` holds, because both its consumers sit
outside C7's gating; and it refreshes the current-story and stories
stores so the reader's `You` anchor re-anchors immediately (the
feedback canon names in
[`reader-composer.md → Peek drawer`](../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)).
Consumers: 4.2a's `⋯ → Set as lead`, 4.5b's peek-head `Set as lead`.
M7.2's Generation-tab lead picker is a later consumer of the same
action. Name fixed in 4.2a's first commit.

### C6 — Panel deep link with a pre-selected row

[Slice 4.1](./slices/01-world-shell.md) and
[Slice 4.3](./slices/03-plot-panel.md) own the World and Plot routes
and are a doc-as-contract pair over this shape. Pinned: both accept an
optional selection `{ kind, id, tab? }` in their route params; when
present the surface mounts with that row selected, on that tab when
given, and — on phone — directly in the detail state, with the first
`←` returning to the list (per
[`collapse.md → Two-pane navigation surfaces`](../../../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings)).
Whichever route lands first fixes the param names; the other mirrors
them. A link into a route that does not exist yet renders inert with a
"lands in Slice 4.x" reason — 4.2a's Involvements rows until 4.3
merges, 4.3's Involvements and Awareness rows until 4.1 merges.
Consumers: 4.5b (`Open in panel →`, including the Overview
region-to-tab click-through), 4.2a (Involvements → Plot happening),
4.3 (Involvements / Awareness → World entity), 4.1's collision strip
(`Collides with <other>`, in-surface).

### C7 — Per-row save-session host for World and Plot detail panes

[Slice 4.2a](./slices/02a-entity-detail.md) owns the shared hook that
turns a detail pane into a
[save session](../../../ui/patterns/save-sessions.md): one
react-hook-form session per selected row; dirty state surfaces the
shipped `SaveBar` in `DetailPane`'s `saveBar` slot with the
user-recognizable dirty-field labels; `Cmd/Ctrl-S` saves; the session
exposes a `requestLeave` that the surface routes every in-surface
transition through — row switch, kind or segment switch, `←` via
`useMasterDetailBack`, the Actions menu's `beforeNavigate` — raising
Save / Discard / Cancel when dirty (the Story Settings precedent),
while `useUnsavedChangesGuard` covers only what it was built for:
navigator removal, window close and reload. Save commits every change
as deltas under **one** `action_id` through `applyDeltaActionGroup`,
which means a relationship row authored with both perspectives is
**one** action — 4.2a extends the M1.5 `upsertCharacterRelationship`
payload to carry both pov columns, since the runner rejects two
writes to one row's column in a group. Discard resets; success fires
the `Saved.` toast; an invalid draft disables Save and renders its
reason in the bar's `notice` slot; every control disables with the
principle-owned tooltip while `isUserEditBlocked(txState)` holds; and
on phone the bar hides while the keyboard is open and returns on blur
(per
[`touch.md → Save bar on phone`](../../../ui/foundations/mobile/touch.md#save-bar-on-phone)
— a `SaveBar` change 4.2a owns, which Story Settings inherits). This
is **not** the Story Settings session from M3.11 — that one aggregates
sections into a single settings write with no delta; this one is
per-row and delta-logged. Consumers: 4.2b (lore pane), 4.2c (the
relationship re-keying shape), 4.3 (thread and happening panes — a
doc-as-contract pair with 4.2a; whichever lands first creates the hook
and the other adopts it). Name fixed in the first commit to land.

### C8 — Picker primitives: entity picker and entry-ref picker

Two primitives this milestone introduces, each owned by its first
consumer. [Slice 4.2a](./slices/02a-entity-detail.md) owns the
**kind-aware entity picker** — an `Autocomplete` over the branch's
entities filtered to a set of kinds, excluding given ids, returning
an entity id — used by Connections (`current_location_id`,
`faction_id`, `parent_location_id`, `at_location_id`), Carrying
(`equipped_items[]`, `inventory[]`) and Relationships (characters
minus self). [Slice 4.3](./slices/03-plot-panel.md) owns the
**entry-ref picker** — a searchable list over the branch's entries
returning an entry id, displaying `entry #n` plus a content excerpt —
with two editable consumers, `occurred_at_entry_id` and
`learned_at_entry_id` (the two thread refs render read-only per
[`plot.md → Threads side`](../../../ui/screens/plot/plot.md#threads-side)),
and consumes the entity picker for Involvements (kind-aware) and
Awareness (characters). Both are controlled components taking
`{ value, onChange, disabled, disabledReason }` and the domain filter
as props; both present per the Select / Sheet tier rules. The
entry-ref picker's UX is a
[canonical open question](../../../ui/screens/plot/plot.md#screen-specific-open-questions)
4.3 resolves at planning (see [Open questions](#open-questions)).
Doc-as-contract between 4.2a and 4.3: whichever lands first creates
the entity picker at this shape.

### C9 — Per-row `.avts` envelope kinds and payload schemas

[Slice 4.6](./slices/06-import-export.md) owns the four per-row
formats from
[`data-model.md → Aventuras file format`](../../../data-model.md#aventuras-file-format-avts)
— `aventuras-entity` (payload key `entity`, a discriminated union over
the four kinds), `aventuras-lore`, `aventuras-thread`,
`aventuras-happening` — each with a Zod **payload schema** that
excludes server-owned columns (`id`, `branch_id`, `embedding_stale`,
`name_collision_flag`, timestamps) and carries the same cross-field
refinements the row schemas enforce (happening time-anchor
exclusivity, lore body required), an **import action** per kind that
creates the row through the existing create arm with
`source = 'user_edit'` and returns the new id, and an **export
serializer** per kind producing the envelope with `formatVersion`
`1.0`. Pinned for the hosts: World and Plot mount `ImportDialog` with
its real props — `format`, `supportedMajor`, `payloadKey`, the
(kind-narrowed, for entities) `schema`, `title`, and an `onValidated`
that runs this module's import action and selects the new row — and
the detail-head `⋯ Export … as JSON` entries call the serializer.
Hosts own nothing about the envelope. Names fixed in 4.6's first
commit; the host menu entries ship disabled until then.

### C10 — Rail Sheet morph seam

[Slice 4.5a](./slices/05a-browse-rail.md) owns the phone rail Sheet
and builds it to morph: its host holds `{ content: 'list' | 'peek',
size }` state, renders the rail vocabulary or a peek body from that
state inside **one** `Sheet`, and changes the Sheet's size between the
medium and tall detents on a content swap — never a second Sheet, per
[`layout.md → Stacking`](../../../ui/foundations/mobile/layout.md#stacking).
Pinned because the shipped `Sheet` primitive maps each `size` to one
snap point and derives its keyboard behavior from it, so a runtime
size change is primitive work 4.5b would otherwise discover after
4.5a merged. 4.5a ships the seam with the `peek` content slot empty
and a criterion exercising the size change; [Slice 4.5b](./slices/05b-peek-drawer.md)
fills the slot and wires the icon-only `←`. Names fixed in 4.5a's
first commit.

### C11 — Detail-head overflow menu

`DetailPane.overflowMenu` is a bare slot with no compound behind it,
and [Slice 4.2a](./slices/02a-entity-detail.md) and
[Slice 4.3](./slices/03-plot-panel.md) both fill it in parallel.
Pinned: one overflow-menu compound taking an ordered list of entries
`{ key, label, disabled?, disabledReason?, destructive?, onPress }`,
rendering the `⋯` trigger with a Popover on desktop and tablet and a
Sheet (short) on phone, showing a disabled entry's reason as a tooltip
(web) or inline hint (native). The disabled-with-reason state is what
4.2b (`Delete`), 4.2c (`Resolve →` is list-side but shares the
convention) and 4.6 (`Export …`) later flip. Doc-as-contract between
4.2a and 4.3: whichever lands first creates it; the other consumes.

### C12 — Keyword normalizer

Every user-authored write to a `keywords` column — 4.2a's entity
Settings editor, 4.2b's lore Settings editor, 4.2c's merge union,
4.6's import payloads — normalizes and de-duplicates through
`normalizeTerm` from `lib/keyword-terms` (re-exported by
`lib/retrieval/name-index.ts`), the same helper the classifier's
append path and `matchTerms` use, so a case variant can never survive
as a second entry and retrieval sees one vocabulary. No slice adds a
second normalizer. Owner: none — the module is shipped; this pins its
use.

## Definition of done

- **World loop, both platforms.** On Electron desktop and an Android
  device / emulator, on a story played past one classifier cadence:
  the World panel lists the classifier-created entities with the
  fresh / fading tint on the rows it wrote this turn and last; opening
  a character shows its Overview glance card with resolved location
  and faction links; editing `description` on Identity and saving
  writes one delta group under a single `action_id` (verified in the
  DB); CTRL-Z in the reader reverses it; the entity's History tab
  lists the edit and the classifier's earlier writes.
- **Collision resolved.** On a branch with a `name_collision_flag`
  pair (seeded by 4.1 or real): the top-bar pill reads
  `⚠ 1 needs review`, the flagged row carries the strip, and merging through `Resolve →` removes the losing row, moves its awareness and involvement
  rows, rewrites inverse refs, clears the flag and writes everything
  under one `action_id`; CTRL-Z restores both rows and the restored
  loser is `embedding_stale` (vitest on the driver plus manual smoke).
- **Delete is clean.** Deleting an entity leaves zero vec0 rows for
  its id in every dim family, zero dangling link rows, and no trace in
  the tail entry's `sceneEntities`; undo restores the row stale; redo
  re-deletes and re-sweeps; deleting the lead is refused with
  `lead-entity` (vitest over the arm; asserted in the DB).
- **Plot audit.** On a branch with one open and one closed chapter
  (seed fixtures until M5 opens chapters in real play), happenings
  group into Current chapter / Earlier chapters / Out of narrative; a
  happening's Awareness tab adds and removes a row through the
  character picker and entry-ref picker; toggling `common_knowledge`
  on swaps the tab for the notice; a thread is creatable from
  `[+] Blank` and shows its status pill in the list (vitest on the
  grouping; E2E on the awareness edit and thread creation; manual
  smoke on the notice).
- **Rail and peek.** On desktop the rail lists all seven categories
  and its collapsed strip shows scene counts for characters and items;
  clicking a row opens the peek; `Set as lead` on a non-lead character
  re-anchors the reader's `You` badge without a confirm; the peek foot link lands World with that row selected (E2E). On phone
  the `[☰ Browse]` chip opens the rail as a Sheet, a row tap morphs it
  to the peek, `←` returns to the list (manual smoke on Android;
  component test on the morph state machine).
- **Story Settings basic.** A narrative override picked on the Models
  tab is the model the next turn sends on the wire (asserted against
  the mock LLM's recorded requests in E2E); `Edit info` on a story
  card lands on About and the first `←` returns to the library (E2E);
  enabling composer modes makes the reader's mode picker appear
  (component test); `keywordRetrieval.mode = inject` seats a keyworded
  lore row in the next turn's prompt (E2E via the probe capture); on
  opening a story whose embedding model differs from the app default
  the upgrade prompt appears once, and `Keep on the current model`
  suppresses it until the default changes (vitest on the gate; E2E on
  the Keep path).
- **Import / export round trip.** Exporting an entity writes an
  `aventuras-entity` envelope; importing it through the Characters
  slot on another story creates the row and selects it; importing it
  through the Locations slot surfaces a payload error with one issue
  at `kind` (vitest on serializer, schema and import action; E2E on
  the clipboard import path; manual smoke on the desktop file hop and
  the Android share sheet).
- **Cycle guard.** Setting `A.parent_location_id = B` when
  `B.parent_location_id = A` is rejected with `parent-cycle` as a form
  error in World and as a rejected commit in the wizard (vitest on
  the shared guard).
- **Hygiene.** Storybook stories exist for every compound M4
  introduces; every new chrome string routes through `t()` in the new
  `world` and `plot` namespaces or the existing ones; `pnpm lint`,
  `pnpm typecheck`, `pnpm lint:docs`, and the full vitest suite pass
  on every slice's PR; the E2E suite gains World, Plot, rail and
  settings happy paths per
  [`testing.md → Coverage`](../../../testing.md#coverage-thorough-not-exhaustive).

## Open questions

- **Entry-ref picker and `decay_resistance` UI shape.**
  [`plot.md`](../../../ui/screens/plot/plot.md#screen-specific-open-questions)
  leaves both open (inline recent-entries list vs searchable popover;
  numeric vs slider vs stepped preset). They are canonical open
  questions, not planning ones: resolve in
  [Slice 4.3](./slices/03-plot-panel.md) planning and amend `plot.md`
  in the same PR. If the picker wants more than a `SearchableOverlayList`
  over entries with an excerpt, stop and run the design route.
- **Entity Assets tab and portrait slot have no schema.**
  [`world.md`](../../../ui/screens/world/world.md#assets-involvements-history)
  and [`entity.md`](../../../ui/patterns/entity.md#why-portrait-lives-only-on-overview)
  spec both, but `entry_assets` links entries only and
  [`parked.md → Asset gallery`](../../../parked.md#asset-gallery) has
  "surfaces TBD" for entity attachments. M4 ships the tab and slot as
  placeholders (decided at promotion). The entity-to-asset link is a
  data-model decision for the asset gallery pass.
- **Tail-metadata drop on delete and merge.** C3 pins dropping a
  deleted id from the tail entry's scene triple as a default
  assumption; canon is silent for both paths
  ([`world.md → Reversibility`](../../../ui/screens/world/world.md#reversibility)
  lists the merge writes without it). 4.2b's PR amends `world.md` to
  record the rule, or records the deviation if review rejects it.
- **Plot chapter buckets before M5.** No chapter is opened in M4, so
  the chapter-keyed grouping is seed-only. Default: one implicit bucket
  and a hidden `This chapter` chip while the branch has no open
  chapter; confirm in [Slice 4.3](./slices/03-plot-panel.md) planning.
- **Plot detail `⋯` menu contents.** Canon names only `View raw JSON`
  for threads and happenings. Default assumption: mirror World minus
  `Set as lead` (`Export … as JSON`, `View raw JSON`, `Delete …`);
  confirm in 4.3 planning and amend `plot.md`.
- **Category label divergence.**
  [`world.md → Top-bar`](../../../ui/screens/world/world.md#top-bar)
  says `Locations`; [`principles.md → World / Plot split`](../../../ui/principles.md#world--plot-split--unified-panels-by-purpose)
  gives the rail `Places`. C2 makes the label surface-owned so both
  canon lines are honored; whether the two docs should agree is a
  canon question for whoever touches either next.
- **Rail manual-preference storage.** Canon calls the venue an
  implementation detail. Default assumption: an additive
  `app_settings.appearance.readerRailCollapsed` key, mirroring how
  `showJumpToBottom` landed. Resolve in
  [Slice 4.5a](./slices/05a-browse-rail.md).
- **Phone Browse chip on a chapterless story.**
  [`navigation.md → Reader chip strip`](../../../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only)
  hides the whole strip, Browse chip included, until the story has a
  chapter — which makes the rail unreachable on phone for every M4
  story, since chapters close in M5 and the wizard-authored cast is
  browsable from turn one. Resolve in 4.5a; likely a canon amendment.
- **Peek quick-edits.**
  [`save-sessions.md → Quick-edit exception`](../../../ui/patterns/save-sessions.md#quick-edit-exception--peek-drawer)
  and [`collapse.md → Reader / composer`](../../../ui/foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip)
  spec pencil edits committing on blur, while
  [`reader-composer.md → State-field composition`](../../../ui/screens/reader-composer/reader-composer.md#state-field-composition--same-as-world-panel-overview)
  says peek is read-mostly with the lead mutation as its only inline
  write. M4 follows the reader doc and files the pencil edits in
  [`parked.md → Peek quick-edits`](../../../parked.md#peek-quick-edits);
  the three docs want reconciling when that entry is picked up.
- **4.3 sizing.** Plot is one slice because its two detail panes are
  lighter than World's four, but it carries both picker primitives
  and two link-table editors. If planning runs past "days, not
  weeks," split threads from happenings at the segment boundary.
