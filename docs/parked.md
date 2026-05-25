# Parked

Items deferred beyond the current milestone (v1). Two flavors:

- **[Post-v1 confirmed](#post-v1-confirmed)** — work that will be
  addressed; just not in v1. Has a known landing window
  (post-MVP, when feature X ships, when component Y is built).
- **[Parked until signal](#parked-until-signal)** — speculative or
  "if real demand surfaces" items. May never be addressed; only
  revisited if testing or real use produces concrete signal.

The active ledger ([`followups.md`](./followups.md)) holds items
the current milestone needs. Movement between the two files is
normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

Resolved items in either file are removed (not crossed out); the
commit that resolves an item carries the resolution narrative.

---

## Post-v1 confirmed

### Data-model (post-v1)

#### Drizzle schemas as source of truth for typed-enum unions

Several compound APIs duplicate enum unions from the data-model
spec by hand:

- `DeltaLogRow.source` mirrors `deltas.source` per the
  [DeltaLogRow pattern](./ui/patterns/delta-log-row.md#compound-api).
- `DeltaLogRow.op` mirrors `deltas.op`.
- `EntryCard.kind` mirrors `story_entries.kind` per the
  [EntryCard pattern](./ui/patterns/entry-card.md#compound-api).
- `StoryCard.story.mode` mirrors `stories.mode` per the
  [StoryCard pattern](./ui/patterns/story-card.md#compound-api).

Today each compound types its own union, manually kept in sync
with the data-model spec. Drift risk is small but real.

The fix lands once Drizzle's schema definitions exist (per
[Slice 1.2](./implementation/milestones/01-spine/slices/02-drizzle-schema.md))
with `text({ enum: [...] })` shapes on the four columns above
(`deltas.source`, `deltas.op`, `story_entries.kind`,
`stories.mode`). Compound APIs then derive via
`typeof schema.deltas.$inferSelect['source']` (or equivalent)
rather than re-typing the enum independently — eliminates the
duplication without changing compound shapes.

**Zod's scope is separate.** Zod (when it joins the dep list)
owns JSON column contents (`entities.state`, `stories.settings`,
`stories.definition`, `app_settings` JSON), runtime LLM-output
validation, and import / export validation — not the direct-DB
column enums above. Adjacent design surfaces (importer JSON
validation hinted at in the
[Importer needs-design row](./ui/component-inventory.md#compounds--needs-design)
as "zod-validated parse", structured-output schemas) drive Zod's
adoption when they ship.

#### Multi-version `undo_payload` apply-dispatcher

The deltas
[`encoding_version`](./data-model.md#diagram) column ships at v1
with every writer stamping `1` and every reader assuming v1
semantics — the column exists to enable a future dispatcher that
routes each delta through a version-appropriate apply path. The
dispatcher itself is post-v1 work, landing when a migration first
needs to change encoding rules (column rename, sub-field type
change, encoding-rule revision) on a column that already carries
v1 deltas.

Two consumers care:

- **CTRL-Z rollback** — reverse-replay over a chain that spans an
  encoding-rule change must apply each delta with its writer-era
  rules, not the current reader's.
- **Crash recovery startup pass** — an orphan written by an older
  app version, recovered after a migration that changed the
  referenced column shape, hits `DeltaReplayError` today and waits
  out the stuck-orphan state (per
  [`generation-pipeline.md → Recovery-failure policy`](./generation-pipeline.md#recovery-failure-policy)).
  The dispatcher resolves the stuck case.

Out of scope for v1: app version churn is single-developer-local
and migrations between v1 sub-releases don't touch delta-logged
column shapes. Lands at the first post-v1 migration that does.

#### Vault content storage pattern

When Vault gets wireframed (currently deferred per
[`ui/README.md`](./ui/README.md)), decide whether to unify all
content types under a polymorphic `vault_items` table with a `kind`
discriminator + JSON body, or keep per-type tables (`vault_calendars`,
future `vault_packs`, `vault_scenarios`, `vault_character_templates`,
etc.). Calendars set the per-type precedent in v1; the unification
question earns its weight when ≥2 content types ship and we can
validate against actual schema overlap.

#### Backup / export packaging shape

Two adjacent packaging questions deferred from
[`data-model.md → Backup & export format`](./data-model.md#backup--export-format)
to implementation time:

- **Full backup — failsafe JSON dump location.** The full backup
  produces a `.sqlite` snapshot via `VACUUM INTO` plus a failsafe
  JSON dump of each story. Bundling shape (single combined file
  vs adjacent sidecar files) is unspec'd; lands at backup
  implementation.
- **Per-story export — binary asset packaging.** `.avts` envelopes
  embed entry assets either base64-inline within the JSON or as
  sidecar files inside the envelope. Tradeoff: inline is simpler
  to parse but inflates JSON size on image-heavy stories; sidecar
  preserves binary efficiency but complicates the
  single-file-per-story mental model. Lands at export
  implementation.

Both questions live with the broader backup design pass — see
[Backup / export consistency](#backup--export-consistency) for the
gating concerns that share the same pass.

### UX (post-v1)

#### Prompt-pack editor (desktop spec + mobile retrofit)

The prompt-pack editor surface is post-v1. v1 ships without a
dedicated editor surface; users live with the bundled / vault
prompt packs and any small variable-tweak controls that surface
inside Story Settings.

When the editor lands post-v1 it needs both:

- **Desktop spec** — the editor itself: layout, panes, JSON / DSL
  shape, validation, save flow. Doesn't yet exist.
- **Mobile expression** — `## Mobile expression` section,
  viewport-toggle wireframe, tier reflow. Mechanical once the
  desktop design is settled, except for one substrate question:
  **CodeMirror fallback on RN.** CodeMirror doesn't run on React
  Native. Phone fallback is plain textarea; full editor on
  tablet + desktop only. How does the surface communicate the
  feature gap — graceful banner, tier-aware toolbar, partial
  hide?

Surfaced during Group D mobile retrofit
([exploration record](./explorations/2026-05-02-mobile-group-d-settings.md)).
The other three Group D surfaces (story-settings, app-settings,
vault calendars) landed; this one was always pending its desktop
design and is now confirmed post-v1 in scope.

#### Pack validation contract

[`architecture.md → Prompt templates and authoring`](./architecture.md#prompt-templates-and-authoring)
mentions that "a runtime validator catches macro include
mismatches on pack load" without specifying:

- **When it runs** — pack activation (story creation,
  story-settings swap, app start with active pack)? Per-call?
- **What it validates** — macro resolution, Liquid parse,
  required-variable presence in each template's targeted
  context-kind. Plus:
  - **Empty-bundle guards** — any `{% for x in retrieved* %}`
    has a sibling or wrapping `{% if size > 0 %}` (or
    equivalent guard). Catches the dangling-section-header
    bug from M10.
  - **Active+in-scene injection** — best-effort detection of
    templates that appear to apply `injection_mode` filtering
    to the active+in-scene iteration. Flag for the design
    pass; harder to mechanically detect than the empty-bundle
    case.
- **What it surfaces — severity: warnings, not errors.** The
  validator surfaces issues as warnings in the editor; never
  blocks save or pack activation on user-authored packs. User
  freedom takes precedence — if a user deliberately breaks an
  invariant in their own pack, that's their call. The bundled
  pack is held to a higher bar via its own test suite (see
  A7's bundled-pack test scope).

Applies even with v1's bundled / vault-only pack workflow —
whenever a pack is loaded, malformed templates surface as
runtime generation failures with no actionable path back to
"the pack's template is broken." Owned by the first pack
design pass (editor or pack-format, whichever lands first);
cross-references the
[Prompt-pack editor entry](#prompt-pack-editor-desktop-spec--mobile-retrofit).

#### Bulk operations on entities

Bulk ops (multi-select, batch status change, batch tag, batch retire,
batch export) span World panel rows, story list cards, and possibly
Plot rows. v1 ships without any of it; principles records the shipped
invariant in
[`ui/principles.md → Bulk operations — deferred`](./ui/principles.md#bulk-operations--deferred).

Sub-questions parked for the dedicated design pass:

- How do batch ops group under `action_id` for single-press undo?
- Confirmation patterns — when, how loud, what counts shown?
- Cross-kind selection — does "retire all" make sense across mixed
  kinds (characters + items + factions)?
- Selection persistence across tab switches, filter changes,
  navigation away and back?
- Visual design of the selection bar — persistent vs contextual?

#### Cover display on story list cards

Story Settings · About exposes a cover image field, but the story
list card never displays it — we deliberately went text-first so
cards don't depend on covers. Open: where does a set cover surface?

Proposal to evaluate: when a cover is set, the 4px left accent strip
expands to a ~60px cover thumbnail block (uncovered stories keep the
thin strip). Asymmetric cards but clearly signals "this story has a
cover" vs "accent-only". Alternatives: subtle background image behind
text, or small corner thumbnail. Decide with visual identity pass.

#### Legacy `.avt` migration import

Old-app `.avt` files have a fundamentally different schema from the
v2 `.avts` format — not a clean format-version bump, a real
migration. Import path needs its own design pass: schema mapping
(old `characters` / `locations` / `lorebookEntries` → unified
`entities`), checkpoint translation (old per-checkpoint state → v2
delta log + branches), and surfaces (validation failures, partial
imports, conflict resolution). Defer the design until v2's import
flow is in place; piggyback on the file-import flow when ready.

#### JSON viewer — edit mode

The shared raw-JSON drawer (per principles) ships read-only in v1.
Edit mode would be raw JSON edit + zod-validate on save. Pending
its own design pass — needs careful UX around partial-edit failures
(field-level validation errors mapped back into the JSON) and the
"this is the only way to fix some shapes" power-user case vs the
"don't let users break their data" common case.

#### Image generation

Auto-generated images via an LLM-driven agent (portraits / scene
illustrations / etc.) — entire feature deferred. Implies:

- New agent (`imageGen`) joining the assignments list when the
  feature lands. Image-gen models have a different parameter shape
  from text profiles (size / quality / style / aspect ratio); they
  don't fit the `ModelProfile` shape and likely warrant their own
  dedicated configuration tab in App Settings.
- `stories.settings.models.imageGen?` field returns to the override
  list at that point.
- Per-story granular image-gen parameter override (size / style /
  quality) joins the existing
  [Granular per-story model controls](#granular-per-story-model-controls)
  followup.

Asset gallery (uploaded images) and `entry_assets` table are in
scope; only the auto-generation pipeline is deferred. Decoupled
domains.

#### Translation Wizard

Multi-language conversion of an existing story's content (per-story
Settings supports one target at a time; the Wizard batches
conversions to a new target). Inventory #15, pending.

#### Character-side Awareness tab on World panel

The Plot panel surfaces awareness as a happening-detail tab (who
knows about this event). The reverse pivot — "what does character X
know" — should live as a new Awareness tab on the World panel for
character entities. Same `happening_awareness` data, queried from the
character end. Pending; add when the character-kind detail tabs get
their next pass.

#### Asset gallery

A per-story gallery of all images attached to entries
(`entry_assets` + `assets`) — browsable view, pick-from-asset
affordance for portrait fields and entity attachments, removal
flow. Decoupled from the deferred image-generation feature;
user-uploaded images are in v1 scope, only auto-generation is
deferred (see [Image generation](#image-generation)).

Surfaces TBD. Likely accessible from World panel · Assets tab
("Pick from gallery" button on entity attachments) and a Story
Settings → Assets sub-tab (browse + manage).

**Maybe-future:** a **global** gallery aggregating assets across
all stories (deduped naturally by `content_hash`). Useful when a
user wants to reuse an image they uploaded elsewhere without
re-uploading. Defer until per-story lands and demand is real.

#### Vault content types for genre / tone / setting templates

The bundled preset library for `definition.genre` and
`definition.tone` (preset+prose hybrid per
[`data-model.md → Story settings shape`](./data-model.md#story-settings-shape))
lives in code for v1, and `definition.setting` is freeform prose
only. Post-v1, user-authored presets for all three land in Vault as
new content types — parallel to user-authored calendars in
`vault_calendars` (per
[`data-model.md → Vault content storage`](./data-model.md#vault-content-storage)).

Each preset row carries `displayName`, optional `tagline`, and
`promptBody`. Per-type tables (`vault_genre_presets`,
`vault_tone_presets`, `vault_setting_templates`) follow the
per-type-not-polymorphic precedent calendars set; the unification
question revisits with multiple content types live (see
[Vault content storage pattern](#vault-content-storage-pattern)).

Built-in catalog stays in code for both v1 and post-v1; user
clones land in Vault. Selection at wizard time copies preset
content into the story (fire-and-forget) — no preset id stored,
no orphan handling.

**Setting templates note.** These are typically larger blobs than
genre/tone presets — possibly with subsections for world-rules /
atmosphere / key locations — though v1's freeform `setting: string`
shape covers the common case without forcing structure. The
sub-structure decision lands with this design pass.

#### Vault parent shell

Vault home navigation + the calendar editor have shipped (see
[`docs/ui/screens/vault/calendars/calendars.md`](./ui/screens/vault/calendars/calendars.md)).
What's still deferred:

- **Import/export at the Vault level** — round-tripping calendar
  packs (and future content types) as `.av*` files. Per-card import
  exists; the Vault-level "import many" / "export selected" surface
  doesn't.
- **Vault entry-point UI from app chrome** — how the user gets to
  Vault from outside an open story. Story list has the Vault icon
  slot pencilled in; behavior + placement aren't locked.
- **Design for non-calendar content types** — Vault home will
  eventually carry packs, presets, possibly templates. Each needs
  its own list/editor design once the content types are spec'd.
  Pending a second content type to validate the shell against.

#### Universal import surface

The [Aventuras file format](./data-model.md#aventuras-file-format-avts)
envelope identifies its content via the `format` field. A
universal-import affordance — one file picker that accepts any
`.avts`, reads the format, and dispatches to the matching creation
flow — would be a convenience for the "I have this file, just
import it wherever it goes" case.

v1 ships only per-UI gated imports (each surface accepts only its
matching kind). Universal import is non-blocking since the per-UI
flows cover the common cases. Likely surface when designed: App
Settings → Data tab (alongside Full backup / Restore / Export all
stories), and possibly the global Actions menu. Pending its own
design pass.

#### FTS5 upgrade for search

Search currently uses `LIKE` + `json_extract` / `json_each` against
SQLite. Fast enough for thousands of rows; large stories (tens of
thousands of entries + their delta log) eventually need FTS5
(SQLite's full-text-search virtual tables) to stay snappy.
Mirror searchable text into an FTS index, triggers keep it in
sync. Pending — revisit when a real story hits the wall.

#### Background-pipeline declarations

[`generation-pipeline.md → Pipeline declaration`](./generation-pipeline.md#pipeline-declaration)
defines the Pipeline shape every future background pipeline picks
values for at its own design pass — `gateBehavior`,
`concurrencyPolicy`, `affordance`. The periodic classifier is the
first consumer (see [`memory/classifier.md → Background-task framing`](./memory/classifier.md#background-task-framing));
future style-review or any agent that splits out of chapter-close is
another candidate. Each pipeline's design pass picks values with
reasoning; the framework doesn't prescribe defaults.

#### Smarter mid-pipeline data-error recovery

V1's `callWithRetry` helper retries the SAME prompt up to a budget
on both provider failures and parse failures (per
[`generation-pipeline.md → Error, cancel, and retry`](./generation-pipeline.md#error-cancel-and-retry)).
That's enough for most cases — LLM sampling variance produces
parseable output on retry surprisingly often. The future direction
makes retry strategies pluggable:

- Re-prompt with the failed response embedded ("previous response
  wasn't valid; here's what you sent, please retry following the
  schema...")
- Adjust call parameters per retry (lower temperature, system prompt
  nudge, switch to a sibling model with better structured-output
  reliability)
- Per-call-type strategies (classifier parses tolerate looser
  fallbacks; structured-tool calls need stricter; suggestion
  emission can ditch failures silently)
- Cross-attempt context (avoid the same failure mode twice)

Lands when v1 measurement shows where same-prompt retry isn't
enough. The `callWithRetry` shape doesn't foreclose the extension —
the retry strategy becomes a typed pluggable argument.

#### Streaming-aware retry / partial-content persistence

V1's streaming resilience is thin: a mid-stream provider error
returns fatal, reverse-replay runs, orphan placeholder gets dropped,
user re-prompts. Partial content is lost.

Future directions, materially harder than v1's same-prompt retry:

- **Resume from chunk N.** Some providers expose continuation
  endpoints; resume from the last received offset rather than
  re-streaming from scratch.
- **Accept-partial affordance.** Surface the partial content with
  a "keep this?" prompt; if accepted, commit as-is and the
  classifier picks up the broken-off scene normally.
- **Auto-retry-stream once before fatal.** A single retry attempt
  before declaring fatal might catch transient provider hiccups
  without losing all work.

Each option has UX and provider-coupling implications. Lands when
real user complaints surface; until then, v1's drop-and-re-prompt
behavior is acceptable.

#### Pack runtimeVariables surface

`packVariables.runtimeVariables` follows the same context-shape
pattern as static pack variables (per
[`architecture.md`](./architecture.md)) but is deferred until the
broader pack system lands. The Story Settings · Pack tab ships
the static side in v1; the runtime-variable surface (variables
the user can adjust live across turns, or that derive from
in-story state) lands as a later-phase pack-system extension.
Adds a Pack tab section or sibling control set; design pass picks
the affordance shape once the static pack workflow has been used
in practice.

### Deferred design sessions

#### Visual identity

Once wireframes settle, decide palette, typography, spacing scale,
icon set, motion primitives, overall mood. Today's wireframes stay
monochrome intentionally.

#### Feature components in Storybook

Wireframes expose component boundaries (EntryBubble, EntityRow,
ChapterBreak, PeekDrawer, BrowseRail, etc.). Those become Storybook
stories once visual identity lands.

---

## Parked until signal

### Data-model (parked)

#### Per-field provenance metadata for `entities.state`

The [state-field shape](./data-model.md#world-state-storage) lands
in v1 without per-field provenance. Each typed slot stores its
value; nothing records _who_ wrote it (classifier vs user vs
wizard) or _when_ it was last touched. Two real costs:

- **Stale detection.** No way to surface "this character's
  `visual.attire` was last classifier-touched 12 turns ago — possibly
  stale" in the UI.
- **User-edit precedence.** A user manually edits Kael's
  `current_location_id` to "The Iron Tavern"; next turn's prose
  has Kael at the bridge. Without provenance, classifier
  unconditionally overwrites the user's edit. With provenance,
  classifier could honor user-asserted values until prose
  explicitly contradicts.

Sketch shape (v1.5):

```ts
type FieldMeta = {
  source: 'classifier' | 'user' | 'wizard'
  last_observed_entry: string  // entry id
  last_observed_worldTime: number
}
// Sparse sidecar map keyed by dotted path, only fields that have been touched
state._fieldMeta?: Record<string /* dotted path */, FieldMeta>
```

Open questions: storage cost (every classifier write maintains
metadata), UI surfacing (passive "last updated N turns ago"
tooltip vs active "stale fields" filter view), interaction with
chapter-close compaction (does compaction reset provenance to
"agent" or preserve original source?). Lands once v1 testing
surfaces real signal that the policy gap (manual-edit-vs-overwrite,
stale-tracking) bites.

#### Per-entity classifier-lock

Complementary to per-field provenance: a per-row, all-or-nothing,
opt-in `classifier_locked` boolean on `entities` (and on
`character_relationships` if applied there too) marks individual
rows the classifier may not touch. Classifier skips the row's UPSERT;
only user edits affect it.

Use case: "this character is my protagonist, I've spent time
authoring them precisely — don't let the per-turn classifier
rewrite their traits because the LLM described them in a slightly
different way."

Lands alongside or after the per-field provenance work above, once
real demand surfaces from users hand-curating specific entities.

#### Structural one-level containers on `ItemState`

[`data-model.md → World-state storage`](./data-model.md#world-state-storage)
ships v1 with descriptive-only containers — satchels and quivers
exist as ordinary item entities; their _contents_ live on the
holder (character.inventory + character.stackables). Structural
one-level containment was considered and deferred:

```ts
// v1.5 sketch — additive to existing ItemState
type ItemState = {
  at_location_id: EntityId | null
  condition?: string
  is_container?: boolean // default false
  contained_items?: EntityId[] // unique items only
  contained_stackables?: Record<string, number> // currencies / ammo
}
```

Convention: contained items can't themselves be containers
(recursion bound at one level). Container transfer cascades
contents (handing Kael's satchel to Aria moves contained_items

- contained_stackables along).

Open questions:

- **Cycle prevention** — app-layer; SQLite can't enforce that
  `contained_items` doesn't include the container itself
  transitively. Same family of bugs as `parent_location_id`.
- **Transfer cascade semantics** — when classifier processes
  "Kael handed Aria his satchel," it walks contents and
  re-parents them. UI should show this clearly (the contents
  visibly moving between holders, or just the container moving
  with a contents-attached badge).
- **UI tree depth** — character form gains a holder-tree
  rendering for contained items. Shape isn't drawn.

When v1.5 escalates: real signal that prose-driven satchel
handoff is unreliable (classifier consistently loses contents on
character-to-character transfer); strong RPG-style demand for
inventory-management UX; or testing surfaces "the AI keeps
forgetting the gold was in the chest, not on the floor."

#### `LocationState.stackables`

`CharacterState.stackables: Record<string, number>` covers
character-side fungibles in v1. Loose-fungibles-at-locations
("the chest at the Iron Tavern contains 200 gold") stay in prose;
when a character takes the gold, classifier creates the stack
reference on the character at that moment.

If real demand surfaces (looting scenes that need precise
location-side tracking; multi-character looting where prose-only
loses precision), add the same shape to `LocationState`:

```ts
type LocationState = {
  parent_location_id: EntityId | null
  condition?: string
  stackables?: Record<string, number> // NEW
}
```

Same cross-holder key-normalization concern as character
stackables (chapter-close lore-mgmt handles).

#### Named fungibles with descriptions

Stackables-as-string-keys covers the common fungible cases
(currencies, generic ammo, generic supplies) but can't carry
entity-level rich data. The "magical arrows blessed by Vael, +1
to hit, glow faintly in dark places" case has no place for the
description in v1.

Two routes when the case lands:

- **Unique item entity covering the whole batch.** "Quiver of
  Vael-blessed arrows" is one item entity with description; user
  treats it as a single named item that gets depleted. Classifier
  manages the batch level. Works for set-sized batches.
- **`entity_stacks` table.** Promoted shape — stackables become
  entities with their own row + description, plus a stack table:
  ```ts
  entity_stacks {
    item_id FK
    holder_kind: 'character' | 'location'
    holder_id: EntityId
    count: number
  }
  ```
  Symmetric for character + location holders. Loses the
  Record<string, number> simplicity for currencies and gains real
  entity-level data for named fungibles.

Decide route at design pass; lean unique-item-as-batch for
narrow cases, `entity_stacks` if/when broader stackable-with-
description demand emerges.

#### Token-trigger classifier cadence mode

`stories.settings.classifierCadence` ships v1 as a single number
(turns between background classifier runs). The original schema
was a discriminated union — `{ mode: 'turns' | 'token-trigger',
value: number }` — but the token-trigger variant was dropped from
v1 because the buffer-aware overlap UX
([`memory/cadence.md → User-tunable knobs`](./memory/cadence.md#user-tunable-knobs))
pairs cadence with `partialChapterBuffer`, which is entry-counted;
pairing those across two different units (turns vs tokens) is hard
to reason about and the indicator math gets noisy.

Real signal that token-trigger is wanted (long entries pushing
classifier work too far apart, or short entries running classifier
too aggressively) would justify reintroducing the union.
Reintroduction is additive — the schema goes from `number` to
`{ mode, value }`, the UI adds a mode picker. No data migration
beyond field-shape lifting.

### Memory pipeline (parked)

Subsystem-scoped deferrals for the memory pipeline (retrieval,
classifier cadence, chapter-close, embedding). All parked-until-
signal — v1 ships without them and they revisit only when real
usage produces concrete evidence the gap bites.

#### vec0 copy-on-fork storage optimization

Each branch owns its own `*_vec` rows per the
[branch-copy manifest](./data-model.md#branch-model). At fork the
new branch duplicates every vector — 2x storage for the fork's
lineage. For typical story sizes (hundreds of rows × KB-scale per
vector) this is MB-scale and cheap.

If real users routinely make many short-lived exploratory branches
and total embeddings storage becomes a concern, evaluate a
content-hash-keyed vec0 schema: `(target_kind, target_id,
content_hash)` — vectors stored once per content version, branches
reference by hash, edits add a new row instead of overwriting.
Cost: every retrieval computes content_hash to pick the right row.
Signal: user complaints about disk usage from prolific branching,
or embedding storage exceeding narrative storage by orders of
magnitude on real stories.

#### Mode-3 (LLM-only retrieval)

Stripped from v1 — embedder is hard-required at story creation
per
[`memory/model-management.md → Onboarding`](./memory/model-management.md#onboarding).
Return depends on how embedder-driven retrieval performs in
practice; that's the signal that gates revisit.

The original spec (frozen here so a future revisit doesn't
reinvent it):

- Story-creation regime, no mid-story switching. Two regimes
  (embedding-driven vs LLM-only) produce different memory
  behavior — different cost-per-turn, different failure modes,
  different retrieval-quality curve on long stories. Switching
  mid-story would invalidate the prior memory model.
- A dedicated retrieval agent makes per-turn LLM calls to pick
  what to inject from the candidate pool. Slow, expensive, but
  works without embedding infrastructure.
- Set at story creation via `stories.settings.retrievalMode`
  (`'embedding' | 'llm-only'`), immutable thereafter. The
  `retrieval` agent slot in `stories.settings.models` is the
  model the LLM-only ranker uses.

Probe support also parked: Mode-3 stories don't have a numeric
ranker to inspect — probe surface would need a different
per-row body (LLM verdict + reasoning text instead of score
table). Different content, same outer shell. Returns alongside
Mode-3 itself if it ships.

#### Multi-axis salience

Single-number `decay_resistance` collapses orthogonal relevance
dimensions ("emotionally resonant" vs "plot-relevant" vs
"character-defining"). Real signal where retrieval misses
load-bearing facts in scene-mismatched contexts triggers the
design. Tracked alongside the v1 limitations in
[`memory/edge-cases.md → v1 limitations`](./memory/edge-cases.md#v1-limitations).

#### Pin contradiction reconciliation

Auto-detection that a `death` pin is invalidated by a later
"actually alive" reveal. v1 floor: manual unpin.

#### Spillover policy on per-type budgets

Hard partitions in v1; cross-type spillover when one type
underfills lands post-v1.

#### Polymorphic naming support

Schema-level support for two distinct entities with the same name
(without one being renamed).

#### Auto-promotion `retired → active`

Agent-driven path; v1 is user-only.

#### Per-type query pools

Different queries per candidate type (e.g. lore retrieved against
thematic queries vs happenings against scene queries). v1 uses a
uniform query bundle.

#### Cutaway / multi-scene entries

Full structural support for meanwhile-style prose with multiple
scenes per entry. v1 ships single-scene-per-entry.

#### Cross-chapter semantic dedup of happenings

Phase 3e
([`chapter-close.md → 3e happenings consolidation`](./memory/chapter-close.md#3e--happenings-consolidation))
handles the within-chapter case (clusters happenings by similarity

- cast + time, agent decides merge / keep distinct / delete
  redundant; awareness rows merge as a side effect). The residual
  case is happenings that describe related events across chapter
  boundaries — phase 3e operates on the closed range only, so
  cross-chapter related happenings stay distinct. Probably rare;
  parked until signal.

#### Lore-mgmt cross-arc callback detection

Agent at chapter close identifies "this chapter calls back to
chapter 3" patterns and re-pins relevant old rows. Powerful but
expensive (agent needs wide context window) and hard to do reliably
(LLM judgment on cross-chapter relationships at scale). v1 relies
on the high-similarity bypass + retrieval-frequency feedback to
surface revivals organically. Lands if real signal shows callbacks
consistently miss.

#### Storage-tier triggers

Periodic stale pruning of cold awareness rows, per-character
awareness volume cap, retrieval-frequency-driven pruning. Not in
v1; levers if testing shows the awareness-graph long tail genuinely
bites.

#### Pre-blended query vector — escape hatch for high-dim provider on mobile

Three-query KNN scales linearly with dim and triples per-pass cost
vs single-query. For users running heavy provider embeddings
(Qwen3-Embedding-8B at 4096-dim, OpenAI `text-embedding-3-large`)
on mobile, retrieval-pass cost grows into multi-second territory at
100k pools. Pre-blending the three query vectors before KNN is
mathematically rank-equivalent to weighted score-blend for
L2-normalized embeddings (with per-batch-constant scaling). Real
trade-offs:

- **Recall at top-K cutoff.** Score-blend retrieves top-K from each
  query separately; candidates that excel at one query but average
  poorly still enter the candidate pool. Pre-blend operates on a
  single top-K of the blended query — those "specialist" candidates
  can fall off entirely. Mitigated by raising K, but recall recovery
  isn't free.
- **Lost per-query debug visibility.** The empirical-tuning pass
  leans on the [memory probe](./memory/probe.md) to inspect
  per-query similarity contributions. Pre-blend collapses three
  signals into one; "why was this row retrieved" gets murkier.
- **Forecloses non-linear blends.** Pre-blend can only express
  linear combinations of query vectors. Future levers like
  per-query thresholds, max-of-cosines, or harmonic mean become
  impossible without going back to score-blend.

Lands as a story-level toggle ("Use combined query — faster, less
precise") if cross-device data shows mid-range mobile users with
high-dim provider models hitting unworkable retrieval latency.

### UX (parked)

#### Outage-mode fallback for user-action-translation

[`architecture.md → user-action-translation`](./architecture.md#user-action-translation-pre-narrative)
is critical-path: if the translation provider is down at submit
time, the per-turn pipeline aborts and the user can't continue
writing. Workaround for any individual outage is to set
`settings.translation.targetLanguage` equal to the source language,
which short-circuits the phase.

A degraded fallback might write the user's typed action **in the
target language directly** to `story_entries.content`, breaking
the monolingual-log invariant for the duration of the outage. The
LLM sees target-language input for those turns; narrative quality
may suffer (most providers are multilingual but the source-language
prompt presets weren't authored against mixed inputs). A
background re-translate pass would clean up once the provider
returned.

Real signal driving this work would be sustained outage friction
in production use — users reporting "can't write while the
translator is flaky." Until then the v1 fatal-on-failure floor
stands; the workaround is documented in app onboarding when
translation is enabled.

#### Translation-miss persistence or registry table

[`architecture.md → Graceful degradation contract`](./architecture.md#graceful-degradation-contract)
ships v1 with outstanding misses computed on story-open via a
SQL join of translatable source content against the `translations`
table, maintained incrementally via `delta_emitted` subscription.
Sub-100ms expected on v1 story sizes.

A persistent `translation_failures` table would carry
`(branch_id, target_kind, target_id, field, language, attempted_at, error_kind)`
per failure, removing the bootstrap query in favor of a cheap
COUNT and giving diagnostics surfaces per-failure error metadata.
Schema delta + cleanup obligations (cascade on source delete,
removal on successful retry) make it heavier than v1 warrants.

Lands if real-device data shows the bootstrap query causing a
visible pause on story-open for large stories.

#### Translation-aware search

Search runs over source-language text only; the
[`translations`](./data-model.md#translation) table is display-only
per locale. A user reading a translated locale who searches a
translated term won't match entities whose source-language state
carries the same concept. Translation-aware search would also query
the `translations` table for the active locale. Until now this gap
was tracked only by reference from the (since-resolved) translation
export / import followup; it lands on its own if translated-locale
search friction proves real.

#### User-controllable narrative language

The AI generates narrative in English, the fixed source language
([`architecture.md → What translation CANNOT do`](./architecture.md#what-translation-cannot-do)).
Translation renders that English into a display target language but
never changes what the AI writes. A user-controllable
narrative-language setting — letting the author pick the language
generation itself runs in — is a distinct concept from translation,
not currently modeled. Lands if real demand emerges; until then
English source plus display translation covers the multilingual
case.

#### Reader font-size scaling generalized to all body prose

[`ui/foundations/typography.md → Reader font-size setting`](./ui/foundations/typography.md#reader-font-size-setting)
ships v1 with the user-orthogonal reader font-size axis scoped to
**reader entry content only** — prose body, entry titles, entry
meta line. Body prose elsewhere (lore detail panes, entity
descriptions, peek drawer prose, wizard prose) stays at locked
sizes regardless of the user setting. Generalization to all body
prose was considered and parked: scope-creep risks scaling things
the user didn't intend (a `1.4×` lore-detail-pane likely looks
worse than the default; short-form prose elsewhere doesn't share
the marathon-reading rationale that drives the reader's setting).

When real demand surfaces (users asking "the reader scaled but
my entity descriptions didn't"), the work is:

- Decide whether the existing setting generalizes (one axis,
  broader scope) or a new orthogonal axis lands (separate "UI
  prose scale").
- Decide which surfaces opt in — likely lore + entity + peek +
  wizard at minimum; story-list cards and chrome stay locked.
- Verify the multiplier doesn't break click-targets or visual
  hierarchy on short-form panes; surface UX testing needed.
- The CSS-variable cascade pattern is already established
  (per `typography.md`); generalizing scope is mostly a matter
  of adding `--reader-font-scale` references to the additional
  surfaces' size calcs.

Lands when user demand surfaces.

#### User-authored themes

The visual identity contract (per
[`ui/foundations/theming.md → Theme registry`](./ui/foundations/theming.md#theme-registry))
ships v1 with a curated theme gallery only — TS modules bundled
with the app. User-authored themes were considered and parked:
the intended landing is **raw CSS edit, no UI fanciness** — users
drop a `.css` file declaring the same `ColorToken` /
`FontToken` slot values into a known directory under the OS
app-data path; the registry parses + validates against the same
shape; malformed themes are skipped, not crashed on.

When real demand surfaces (users asking for personal palettes
post-launch; community sharing of theme files), the work is:

- Decide the exact OS app-data directory and how the registry
  watches/loads it.
- Validation + skip-on-malformed (skeleton in spec).
- App Settings · Appearance: surface "imported themes" alongside
  curated entries in the gallery; clearly distinguish source.
- Backup / export — story exports already don't carry user
  themes; the full DB backup carries `appearance.themeId` but
  not the theme CSS file. User-authored themes are
  device-portable only when manually copied.

No-UI-for-authoring is a deliberate scope choice — power-user
feature, not a v1 design surface. Parked-until-signal.

#### Per-story theme override

[`ui/foundations/theming.md → Persistence`](./ui/foundations/theming.md#persistence)
stores the active theme app-wide at
`app_settings.appearance.themeId`. Some users may want **per-story
theme override** for narrative immersion ("dark academia" theme
for one story, "cosmic horror" for another).

Adds one optional field:

```ts
stories.settings.themeId?: string   // override-at-render; absent = app default
```

Override-at-render pattern (per
[`ui/principles.md → Settings architecture`](./ui/principles.md#settings-architecture--split-by-location)),
matching how `stories.settings.models` works. Story Settings
gains an Appearance tab (or folds into an existing tab); App
Settings · Appearance picker becomes the global default.

Costs: per-story theme switching causes a brief theme-swap flash
on story navigation; a "this story uses X theme, override?"
status indicator may be needed; cross-story consistency in chrome
becomes optional. Speculative until users ask.

#### OS dark/light follow

The visual identity foundations ship explicit-pick only — user
selects one theme and that's what they get all day. Auto-following
OS preference (switch from light theme to dark theme when the
system goes dark) is not in v1.

Rationale: previous version of the app didn't have it and users
didn't ask. The "Linux desktop required" project constraint plus
Expo's mobile target means OS-preference plumbing across macOS,
Windows-via-Electron, Linux, iOS, Android — each with quirks —
all to support a feature with no real demand signal.

If signal surfaces, the design adds:

- `app_settings.appearance.followOs?: boolean`,
  `preferredLightThemeId?: string`,
  `preferredDarkThemeId?: string`.
- Settings UI: toggle + paired light/dark picker shown when toggle
  on.
- Platform glue per target.
- Coexistence with explicit-pick: when `followOs` is on,
  `themeId` becomes derived; when off, `themeId` is the explicit
  pick.

Parked-until-signal.

#### Structurally-pinned indicator

[`ui/principles.md → Injection / retrieval rules for prompt context`](./ui/principles.md#injection--retrieval-rules-for-prompt-context)
records the structural invariant: active + in-scene entities are
ALWAYS injected, the dropdown only governs off-scene/inactive rows.
Open question: should the UI surface this — e.g., a small "pinned"
chip or icon adjacent to the mode dropdown when the row is
structurally injected — so users know the mode is moot for that
row, or is the dropdown's enabled/disabled state already enough
signal? Lands with the World panel · Overview detail design pass.

#### Encryption at rest for provider keys

Provider API keys live in SQLite (per data strategy). Encryption
mechanism deferred — not blocking v1 since this is a local app
with no network exposure of the DB. Lean: explore once a real
threat model surfaces (export-leak, multi-user shared machine, etc.).

v1 user-facing risk acknowledgment lands in the Full backup
AlertDialog — see
[`app-settings.md → APP · Data`](./ui/screens/app-settings/app-settings.md#app--data)
— since backup is the one user-initiated action that takes the
unencrypted keys outside the local-only threat model.

#### Granular per-story model controls

v1 story-level override is **model id only** (no per-story
temperature, max-output, custom JSON, etc.). When a real demand
surfaces (e.g., "this story needs a different temperature for the
narrative model only"), extend `stories.settings.models` to hold
either inline param overrides or a story-specific profile id. Lean
toward inline param overrides as the simpler extension.

#### Story tags on library cards

Story-list cards currently omit tags entirely (per
[story-list.md → Story card](./ui/screens/story-list/story-list.md#story-card--text-first):
"tags still exist in data for search/filter; they're not primary
card content"). Reconsider: surface a small inline tag row with
overflow handling.

Sketch:

- Show 2-3 tags inline below description.
- Long tag text → ellipsis at chip width cap.
- Hidden tags collapse into a `+N` badge at the end.

Decisions to make: chip width cap, max visible count, what `+N`
expands to (tooltip listing? popover? inert?), interaction model
(do tag clicks filter the library?), behavior on empty (hide row
entirely vs show "no tags" placeholder).

Defer until visual identity lands or sooner if real demand
surfaces.

#### Optional user-side scene tagging on user-written openings

User-written openings start with empty
`metadata.sceneEntities` / `currentLocationId` / `worldTime: 0`
per the locked
[opening entry contract](./data-model.md#opening-entry).
Turn-2 classifier picks up scene presence from there. Some users may
want to pre-tag scene presence on the opening at wizard time — pick
which cast members are in the opening's scene, which location is
current — so first-turn generation context is grounded from entry 1.

Wizard concern, not data-model. The
[Wizard design pass](./explorations/2026-04-30-story-creation-wizard.md)
landed without this affordance — AI-generated openings emit
metadata refs via structured output, but user-written openings
remain empty until turn-2 classifier picks up. Adding a manual
scene-tagging surface on the wizard's step 5 was deliberately
deferred. Parked-until-signal: revisit if user feedback shows
unbacked turn-1 generation quality is materially worse than
seeded-metadata generation. The data shape already supports it
(metadata fields exist and are user-editable per
[Entry metadata shape](./data-model.md#entry-metadata-shape));
only the wizard UX is missing.

#### Regenerate-opening affordance — post-commit from reader chrome

The opening entry is permanent within its branch (block-delete per
the [opening invariants](./data-model.md#opening-entry)) but
editable. Wizard-time regeneration is shipped per
[wizard.md → Step 5](./ui/screens/wizard/wizard.md) (the `✨`
trigger + `Refine` / `Regenerate` actions on the opening preview).
What remains parked is the **post-commit regenerate from reader
chrome** path: surfaces an affordance on the opening entry in the
reader (a non-standard icon since regen is suppressed on opening
per its render contract). Heavier than the wizard surface — needs
a confirmation flow since the opening's text is the floor for the
entire branch. Defers until real demand surfaces post-launch.

#### Classifier-on-opening retrofit

The locked
[opening entry contract](./data-model.md#opening-entry) skips the
classifier on the opening for v1 — AI-generated openings inline
their own minimal scene metadata; user-written openings start with
empty metadata. If a future feature genuinely needs entry-1
metadata to be populated for user-written openings (e.g., chapter
timeline showing first-scene cast, awareness-graph queries that
include the opening), retrofit by running the classifier as a
separate scene-tagging pass against the opening prose — restricted
to populating `sceneEntities` / `currentLocationId` against the
wizard-curated cast (no entity creation). Add at the design pass
that surfaces the need.

#### Wizard-assist agent profile splitting

[`wizard-assist`](./data-model.md#app-settings-storage) is one
agent serving every AI call fired from the
[Story creation wizard](./ui/screens/wizard/wizard.md) — title-chip
generation (5 tokens, low-stakes) AND structured-output opening
prose with metadata refs (800 words, higher-stakes). One profile
backs both. If real signal post-launch shows quality varies
pathologically (small profile underdelivers on opening prose, or
expensive profile is wasteful for chip generation), split into
`wizard-assist-light` and `wizard-assist-prose`. The architecture
supports it; v1 ships single-agent.

#### Wizard concurrent-state prompt third button

The [story-list concurrent-state prompts](./ui/screens/story-list/story-list.md#unfinished-wizard-session-automatic-safety-net)
ship two-button (`Continue` / `Discard session & ...`). A third
button — `Save session as draft & continue with <target>` — would
let users preserve in-flight session state AND open the new target
in one click, instead of dismissing the prompt → save-as-draft
inside the wizard → re-trigger the click. Three buttons is
borderline busy on a fork-in-the-road decision; v1 floor is
two-button + destructive labeling. If users report losing work via
the destructive path, the third button lands.

#### Wizard step 3-4 long-list ergonomics

Three deferred ergonomics improvements for the wizard's lore list
(step 3) and cast list (step 4). All three trigger on the same
signal — real cast/lore counts producing friction in the
long-scroll layout — and are not orthogonal solutions (per-kind
tabs may obviate section-collapse, etc.), so they are likely
designed together at signal time:

- **Reorder.** Lists currently render insertion-ordered with no
  reorder UX. Drag-to-reorder within a wizard list would let users
  author a deliberate arrangement (lead character first, lore in
  narrative order, etc.). Skipped in v1 because reorder is fiddly
  to implement and the underlying data shape doesn't carry an
  order column. If shipped, requires an `order: number` field on
  `entities` / `lore` (or a story-scoped ordering JSON) and the
  drag affordance.
- **Section-collapse toggle.** At pathological row counts (20+
  per section) the step's scroll length grows. A section-collapse
  toggle (`▼ Initial lore (12 rows)` → click to collapse to a
  one-liner) would let users hide bulk while authoring other
  sections. v1 ships expanded-only.
- **Per-kind grouping or tabs in step 4.** Step 4's cast list is a
  single mixed list with kind icons (per
  [`patterns/entity.md`](./ui/patterns/entity.md)). At high counts
  (20+ entities, character-heavy), grouping by kind or tabbing
  (Characters | Locations | Items | Factions) might improve scan
  density. v1 ships flat mixed list.

Revisit when real cast/lore counts push beyond comfortable
mixed-list density.

#### Wizard-time pack selection

[`stories.settings.activePackId`](./data-model.md#story-settings-shape)
copies from `app_settings.default_story_settings` at wizard time
per the operational-config copy-at-creation rule. A power user
might want to pick a non-default pack at story creation rather
than post-creation in Story Settings. Adds a wizard-step affordance
or step-5 disclosure. Speculative; low priority pending real
signal.

#### Wizard session storage cleanup

The [Story creation wizard's](./ui/screens/wizard/wizard.md)
auto-save session persists in SQLite (Zustand persist) on the
first meaningful state change and survives across app restarts
indefinitely. Without a cleanup pass, sessions accrue when users
abandon them long-term (laptop in a drawer, install lingers).

Open sub-questions:

- TTL-based expiry (e.g., session older than 30 days auto-cleared
  on app boot)?
- App-boot age check + user-prompt-to-discard for very old
  sessions?
- Storage budget before triggering cleanup?

v1 ships with no cleanup, accepts storage drift. Lands when
session storage shows real accumulation in usage signal.

#### `SearchableOverlayList` — `initialScrollRowId`

The
[substrate spec](./ui/patterns/searchable-overlay-list.md#implementation-notes)
describes `initialScrollRowId` (open-time scroll-into-view, mid-viewport) for
consumers that want to anchor a particular row in view when the overlay opens
(favorites, active model, etc.). Not implemented in v1. The shipped substrate
already has the virtualization plumbing (`@tanstack/react-virtual` web,
`SectionList` native) that this would build on — call
`virtualizer.scrollToIndex(idx, { align: 'center' })` on open.

#### Calendar picker search-bar threshold

The [calendar picker pattern's](./ui/patterns/calendar-picker.md)
popover gains an inline search/filter bar at some option-count
threshold (rough lean: ≥ 8). Pick the actual number once we have
real preset catalogs to test against — speculative until the
catalog size is concrete enough to validate against. The picker's
open-shape question (Select-extension vs Picker-fork) was
resolved during the calendar-picker build pass — picker extends
Select via the `renderRow` / `renderTrigger` / `tailAction` hooks
documented in
[`forms.md → Select primitive`](./ui/patterns/forms.md#select-primitive).

#### Chip input vs comma-separated string

Several string-array fields surface as **chip inputs** across the
app — `entities.state.traits`, `drives`, `agenda`,
`visual.distinguishing`, `tags` (entities, lore, stories), and
the same fields surfaced inline in the
[wizard's step 4 cast editor](./ui/screens/wizard/wizard.md).
Chip inputs are richer (per-element delete affordances, validation
per chip, preview shape) but more expensive to implement and
arguably overkill for the underlying simple `string[]` shape. A
plain comma-separated single-line input may be cheaper to author,
simpler to implement, and adequate for the common case. Cross-
cutting reconsideration; affects entity / lore / wizard surfaces
uniformly. Defer until first chip-input component is implemented
and the per-feature cost is concrete.

#### Per-branch definition override

`stories.definition` is story-level — all branches share the same
genre / tone / setting / mode / narration. A user wanting a tonal
experiment across narrative paths uses a separate story today, not
a branch. If real demand for "this branch is comedic, the parent is
brooding" surfaces post-launch, the design space is per-branch
override of selected definition fields (probably a sparse JSON on
`branches` that overlays the story-level `definition`). Speculative;
low priority pending real signal.

#### Inline rename for era flips in Story Settings · Calendar

The era flips list in Story Settings (per
[era-flip design](./explorations/2026-04-28-era-flip-affordance.md))
ships v1 with delete-only per-row actions. Inline rename is the
natural extension if real demand surfaces — would let users fix
typos or re-canonicalize without delete + re-flip. Defer until
demand is real.

#### Scoped-gate UI design + structural writeSet

[`generation-pipeline.md → Concurrency model`](./generation-pipeline.md#concurrency-model)
names `'scoped-gate'` as one of three valid `gateBehavior` values —
gating only the pipeline's writeSet rather than the entire user
surface. v1 defers both the value itself AND the structural
`writeSet` field on Pipeline declarations; pipelines today claim
disjoint write sets via prose + narrow-action-function naming, not
typed declarations.

When scoped-gate lands, three things ship together:

- The `writeSet: readonly ActionKind[]` field on Pipeline (currently
  absent — see
  [`generation-pipeline.md → Narrow action functions over write-set declarations`](./generation-pipeline.md#narrow-action-functions-over-write-set-declarations))
- The orchestrator's gate derivation reads writeSet and gates user
  actions selectively (instead of the binary blocked / not-blocked)
- Surface-level affordance for the partial-gate case (which controls
  disable, what tooltip copy says, how the user disambiguates "this
  control is gated by pipeline X" from "this control is gated by
  per-turn pipeline")

Lands when the first pipeline declares `gateBehavior: 'scoped-gate'`.
Style-review's motivating use is `'no-gate'`, so this followup
isn't blocking style-review.

#### Scoped-gate read-tracking strategy

`readSet` is intentionally absent from the Pipeline declaration
shape because read-set is template-determined, pack-editable, and
dynamic — not code-declarable
(per [`architecture.md → The single-context principle`](./architecture.md#the-single-context-principle)).
A `'scoped-gate'` pipeline therefore prevents user mutations to its
writeSet but not to its (unbound) read-set; user edits during the
pipeline's run could create torn reads.

Two candidate strategies for when scoped-gate's design pass
addresses this:

- **Liquid AST analysis at template load.** Walk the parsed
  template, extract top-level variable references, take that as a
  conservative read-set superset. Re-runs whenever the template
  changes (pack edit, app update). Adds infra cost; doesn't catch
  filter-internal slicing but bounds the read surface usefully.
- **Hard-gate fallback for unbound templates.** Only allow
  `'scoped-gate'` when the pipeline's template + context group are
  simple enough to bound; everything else uses `'hard-gate'`.

Decision lands at scoped-gate's own design pass.

#### Multi-background-pipeline concurrency

Two future background pipelines running simultaneously
(style-review + standalone memory-compaction or similar). The
cascading `concurrencyPolicy` interactions when multiple background
pipelines overlap aren't covered by the periodic classifier alone
(which is the v1 single background consumer). Owned by the first
design pass that introduces a second concurrent background pipeline.
Foundation in
[`memory/cadence.md → Concurrency`](./memory/cadence.md#concurrency).

#### Style-review pipeline

Mentioned in
[`generation-pipeline.md`](./generation-pipeline.md) as a future
consumer; its `gateBehavior` / `concurrencyPolicy` / phase list get
picked when style-review is designed.

#### Pack-defined pipeline kinds

`PipelineAction` is a closed TypeScript union (see
[`generation-pipeline.md → Action-layer integration`](./generation-pipeline.md#action-layer-integration)).
If packs ever ship code (today they're templates / macros only),
pack-defined pipeline kinds could declare new phases AND new action
kinds — which means the action layer's typed dispatch table can't
stay closed. Lands when (a) packs gain a code-shipping surface and
(b) a real consumer wants pack-defined pipeline behavior. Each is a
substantial design pass on its own; this entry exists so the
generation-pipeline framework's closed-PipelineAction-union choice
is revisitable.

#### Backup / export consistency

A backup run reads the entire story state. Per
[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation),
backup / export reachable from inside the story (Actions menu,
Story Settings) is gated and disabled during a transaction. Backup
from app-level surfaces (App Settings → Data tab) requires leaving
the story, which routes through the abort-confirm modal — also
safe.

What's not yet specified: backup behavior when initiated from a
path that doesn't trigger either gate (a future programmatic
export, MCP exposure, scheduled backup). Such a path can capture
inconsistent state mid-pipeline. Two clean options for the backup
design pass to choose between:

- Block backup initiation while any transaction is in flight
  (uniform with other mutating actions).
- Snapshot story state at backup-start; backup operates on the
  snapshot regardless of in-flight pipeline.

Belongs to the backup design pass; this followup ensures the
question is asked before such a path lands.

#### Lore Assets

Entities have an Assets tab (per
[`world.md → Tabs — per-kind composition`](./ui/screens/world/world.md#tabs--per-kind-composition))
backed by `entry_assets`. Lore is text-shaped — magic-system
rules, religion descriptions, cosmology — and consumes prose at
retrieval, not visuals. But user-facing visual aids (cosmology
diagram, religion sigil, schematics for hard-SF systems) are
plausible reference material a worldbuilder might want to attach
per-entry.

The lore detail-pane composition (per
[`world.md → Lore — separate kind`](./ui/screens/world/world.md#lore--separate-kind))
deliberately excludes an Assets tab in v1. Schema today has no
asset-link from `lore`. If real demand surfaces — worldbuilders
asking to attach images per-entry — design needs:

- Schema link from `lore` to `entry_assets` (or a parallel table).
- Asset tab on the lore detail-pane shape (becomes
  `Body | Settings | Assets | History`).
- Lore peek body treatment for asset thumbnails (if any).

Distinct from the broader [Asset gallery](#asset-gallery)
post-v1 entry, which is the shared library surface; this is
per-entry attachment on lore specifically.

#### Haptic feedback on mobile actions

[`ui/foundations/mobile/platform.md`](./ui/foundations/mobile/platform.md)
explicitly scopes haptic feedback (iOS / Android haptic taps on
button press, sheet drag, save commit, error states) out of v1.
Could add subtle polish — sheet snap-to-position, action commit
confirmation, error vibration — but it's not foundational and adds
maintenance surface (haptic-strength preference, accessibility
opt-out, platform feel differences). RN supports haptics natively
via `expo-haptics`; the work is per-affordance: pick which actions
get which haptic style, calibrate intensity, validate on real
devices.

Lands when user testing surfaces a concrete request for haptic
feedback or signals that the silent default feels under-responsive.

#### Deep links via URL scheme

Mobile users currently reach the app's surfaces by launching it
and navigating in-app. Deep links (`aventuras://story/<id>` or
similar) would let external triggers — share sheets, notification
taps, calendar reminders — open a specific story / surface
directly. Scoped out of v1 per
[`ui/foundations/mobile/platform.md`](./ui/foundations/mobile/platform.md);
the local app has no immediate consumer beyond manual
sharing.

Lands if integrations surface real demand: e.g., a "share story
context" affordance that drops a deep link into iOS Messages /
Android Share, or a future calendar-reminder integration that
deep-links into the story.

The work itself is straightforward — Expo Router supports URL
schemes natively; route mapping plus a launch-time deep-link
handler. Schema cost is also small (URL templates per surface).
Held parked because v1 doesn't have a consumer that benefits.

#### Observability — file-based persistent logger

The [observability layer](./observability.md) ships in-memory
ring buffers for `httpCalls`, `logEntries`, and `turnCaptures`.
On app quit, these vaporize. A user / engineer who wants to
look at "what happened before the crash" or "what did the system
log during yesterday's session" has no recourse.

File-based logging adds a rotating log file (Electron: app data
dir; RN: sandbox storage) as a second sink alongside the
in-memory ring buffer. Same `logger` interface, same record
shape; the new sink writes to disk. Rotation policy (size-based?
time-based?), retention, redaction of sensitive payloads
(prompts, headers) all need design.

Held parked because v1 has no concrete consumer — the in-memory
ring buffer covers active debugging, and "post-crash forensics"
is speculative until users actually report needing it. Lands if
real signal surfaces.

#### Observability — manual export to JSON file

User affordance to save the current ring-buffer contents (full
buffer or a filtered subset) to a JSON file. For triage, bug
reports, "let me look at this later" workflows. Lives in the
Diagnostics Hub as an export button per-tab.

The feature owns its own redaction policy — API keys are already
redacted at sink-time, but the export's "what to include in the
prompt body" question (auto-truncate, opt-in for full bodies,
strip nothing) needs explicit design. Until that design exists,
the user can workaround by screenshotting the hub.

Held parked because v1 dev/power-user workflow stays in the live
hub. Lands when a "share my diagnostic state" use case becomes
concrete.

#### Observability — pin-to-keep per-row affordance

Per-row affordance on Call log / Logs / Per-turn inspector to
flag a single ring-buffer entry to survive FIFO eviction.
Bounded count (cap 20-50) of pinned entries lives in
`localStorage` or a tiny `pinned_diagnostics` table. Lightweight
selective persistence without committing to whole-stream archive.

Useful when investigating a hard-to-reproduce issue across
multiple sessions — pin the one anomalous turn, keep working,
return to it later. Held parked until the in-memory ring-buffer
model's limitations bite real workflows.

#### Observability — cross-window aggregator on Electron

Each Electron window has its own renderer with its own
`diagnosticsStore`. A user with multiple windows open sees per-
window state in each hub instance; window A doesn't show window
B's calls. Acceptable for v1 (multi-window is uncommon), but a
cross-window aggregator (combining per-window state into a
unified hub view via main-process IPC) is the natural extension.

Implementation cost is real: main-process recorder + IPC channel

- per-window store reconciliation. Held parked until multi-
  window debugging becomes a recurring friction.

#### Observability — `progressCall` for streaming live byte count

[`httpCallSink`](./observability.md#httpcallsink) currently
captures streamed responses as one transition at stream end (body
accumulated in the wrapper, `completeCall` fires once with the
final body). The UI shows "in-flight" throughout and resolves at
end.

A future `progressCall(id, { chunks, bytes })` API would let the
wrapper emit incremental progress to the sink, enabling a live
byte-counter or token-counter UI in the Call log row during
streaming. Useful for "is this stream actually progressing or
hung?" debugging.

Held parked because v1's binary in-flight / completed model is
sufficient for the most common debugging cases. Lands if "stream
appears hung" turns out to be a recurring v1 issue.

#### Observability — performance metrics dashboard tab

The [Per-turn inspector](./ui/screens/diagnostics/diagnostics.md#tab-2--per-turn-inspector)
surfaces per-turn performance (phase timing, call counts, token
usage on individual calls). A sibling tab aggregating across
turns — mean / p95 latency per phase, mean tokens-per-turn, plot
trends over the last N turns — is the natural next view.

Held parked because v1 single-turn inspection covers the
debugging case; aggregate analysis is the "I'm tuning
performance" workflow, which isn't a v1 motivator. Lands when
performance tuning becomes a focused workflow.

#### Structured filters on entity rows

Entity search in v1 is text-substring `LIKE` + `json_extract`
over a fixed per-kind scope (see
[`patterns/entity.md → Search scope`](./ui/patterns/entity.md#search-scope)).
Four trigger-distinct extensions wait for signal:

- **FK target name resolution.** Searching `Iron Tavern` doesn't
  currently match characters whose `state.current_location_id`
  resolves to a location named Iron Tavern. Add when
  narrative-relation queries become a real user motion (likely
  once stories cross a scale where memorizing character locations
  stops working).
- **`stackables` filtering.** Both text ("characters with gold")
  and numeric ("gold > 0") shapes are out. Structured-filter
  territory, not text scope. Lands at the first design pass that
  touches inventory-management UX (post-v1 RPG-flavored work).
- **Per-`visual.*` sub-field toggle.** `visual.*` participates in
  scope today with an acknowledged flooding risk on broad terms
  (`dark`, `red`). If real use flags flooding, add a per-sub-field
  toggle in the ⓘ popover or a kind-specific filter chip row.
  Lean: defer until signal exists; don't pre-build the guardrail.
- **Cross-field multi-word query language.** `hair:red AND
attire:cloak`-style queries. Significant scope; only earns its
  way in if simple substring stops covering use cases.

Lands as one design pass once two or more triggers fire
concurrently — they share enough query-layer machinery that
piecemeal work is wasteful.

#### Multi-device sync for power users

v1 ships single-device only — local SQLite is canonical and not
replicated. Power users with more than one device hit a friction
wall (laptop edits unreachable from phone, phone notes unreachable
from desktop). Speculative post-v1 feature: opt-in multi-device
mode pointing devices at a self-hosted always-on node (homelab
container, NAS, small VPS) reached over Tailscale or similar
private network. Default install stays single-device; multi-device
is a configuration the user opts into.

**Architectural fork.**

- **Local store with delta sync (preferred shape).** Devices keep
  their own local SQLite for offline reads and writes; deltas
  ship to the always-on node, which propagates to other devices.
  Offline editing on mobile is preserved. The sync engine is the
  hard problem. The existing [delta log](./data-model.md) is the
  natural transport unit — it's already designed to carry
  forward-replayable state changes.
- **Always-remote.** Device has no local DB; every read / write
  hits the homelab over the network. Trivially solves
  multi-device (one DB) but breaks offline-on-mobile, which is
  half the v1 value prop. Rejected unless real signal shows
  users would accept the trade.

**Open questions for the design pass.**

- **SQLite stack choice.** v1 uses `expo-sqlite`. The cleanest
  off-the-shelf path for "homelab DB plus device replicas" is
  libsql's `sqld` server with `@libsql/client`'s embedded-replica
  mode; Drizzle's `drizzle-orm/libsql/http` adapter supports it.
  Adopting that means swapping `expo-sqlite` for `@libsql/client`
  across both platforms, and libsql's RN / Expo support is less
  battle-tested. Worth a spike before committing. Alternative:
  keep `expo-sqlite`, build a thin custom sync service that
  ingests the delta log directly — more work, full control over
  conflict semantics.
- **Schema-migration coordination.** When device A updates the
  app and runs a local migration, device B (older version) and
  the homelab DB need a compatibility story. Workable patterns:
  forward-only delta versioning with N-to-N-1 replay, force-update
  gates on devices behind the homelab schema, or epoch-versioned
  schema with cross-boundary replay. Whichever lands constrains
  the sync protocol shape.
- **Conflict resolution semantics.** Single user across two
  devices has low conflict frequency, but concurrent edits (phone
  offline, desktop online, phone reconnects later) need a rule.
  Naive last-write-wins per row is the libsql-server default; the
  delta log plus domain-aware merge rules (entity-state field
  merging, awareness-link union) is the custom-service path's
  win.
- **Deployment friction.** "Deploy a container on your homelab"
  is heavier than it sounds — TLS / cert renewal, backups,
  recovery when the SSD dies. The design either ships a
  one-command deployment artifact (Docker image with sane
  defaults) or accepts this is a developer-only feature.

**Alternative shape — CR-SQLite peer-to-peer (no server).**
[CR-SQLite](https://github.com/vlcn-io/cr-sqlite) is a SQLite
extension adding CRDT semantics so two SQLite files converge
without a central authority. Two devices on the same LAN or both
on Tailscale could sync directly when both are online. Distinct
from the always-on-node path because P2P requires both devices
online simultaneously to merge — the homelab rendezvous is what
makes "edit on phone offline, read on desktop later" work without
ceremony. Constrains schema: every column is effectively a
registered CRDT type (LWW, counter, set), so the data-model needs
a per-column CRDT-shape audit before adoption. Drizzle support is
informal — community examples exist, no first-party adapter.
Lands as a separate "manual merge" affordance if signal surfaces
for users who want occasional cross-device sync without running a
server, or as a complement to the homelab path above (one option
for "I have always-on infra", one for "I don't").

Lands when real demand surfaces from users running the app across
multiple devices — not before. v1 single-device floor is the
right default for the assumed common case.

### Two-stage touch feedback (light hover + stronger press)

Some mobile apps (Discord noted) ship a two-stage feedback on
touch: a light "hover-like" highlight that fires on touch-down,
followed by a more prominent press highlight if the finger
lingers / commits. Distinct from RN's single-stage Pressable
model where `pressed=true` from touch-down through release at
one intensity.

Implementing it would require either:

- Two timed states inside Pressable (onPressIn → light tint;
  setTimeout → stronger tint), with cancel logic if released
  early.
- Or a custom press tracker via PanResponder / Gesture.LongPress
  that surfaces the intermediate phase.

Useful polish; not blocking v1. Surface again if a consumer ships
something where the distinction would matter (e.g., a
context-menu trigger where touch-down should feel different from
commit-press).

### Toast — auto-timer pause on hover / touch

The Toast primitive ([`ui/patterns/toast.md`](./ui/patterns/toast.md))
auto-dismisses after per-severity durations (3s success / 5s info /
7s error) without pausing on user attention. A common refinement
holds the timer while the toast is hovered (web) or held under a
finger (native), resuming when the pointer / finger leaves.

Skipped for v1: the always-visible × close button gives users an
escape hatch on every toast, and the per-severity durations were
chosen to be readable without pause. If error toasts (7s) prove
too short in practice — e.g., users report missing the message
while skimming — implement as a per-toast `Date.now()` pause /
resume on the timer.

### AlertDialog scroll-on-overflow

[`ui/patterns/alert-dialog.md`](./ui/patterns/alert-dialog.md)
ships v1 without scroll handling on the dialog body. v1 consumers
(rollback confirm, calendar swap-warning, branch / entity delete
confirms) all carry bounded content. If a future call-site needs
unbounded content (e.g. very long impact lists, large preview
blocks), add `max-h` + `overflow-auto` to the dialog body region
between header and footer.

Surface again when a use case forces it; until then the centered
modal stays bounded by content.

### Filter chip pill→square wireframe consolidation

[`ui/patterns/chips.md`](./ui/patterns/chips.md) splits Chip
(square, toggleable filter / state) and Tag (pill, labeled content)
along corner radius as the visual fundamental. Three wireframes
drifted to pill on filter chips when they should match the square
Chip shape:

- `docs/ui/screens/story-list/story-list.html` — `.filter-chip`
  (All / Favorited / Archived) currently `border-radius: 999px`.
- `docs/ui/screens/vault/calendars/calendars.html` —
  `.filter-chip` (All / Built-in / Custom) currently `999px`.
- `docs/ui/screens/reader-composer/reader-composer.html` —
  `.sheet-chip` inside the Browse rail mobile sheet (All / Lead /
  Recent / Pinned) currently `999px`.

Cosmetic consolidation pass — primitive ships independent of
wireframe state, and the wireframes still communicate the right UX
shape. Surface again when wireframes are next on the touch list
or when a visual-identity sweep ships.

### Toast — visibility-API tab pause (web)

The web Toast timer keeps running while the browser tab is hidden,
so a user returning to a tab after several minutes may find no
visible toasts even though they fired moments before the
backgrounding. The standard mitigation pauses the timer on
`document.visibilitychange` (hidden) and resumes on visible.

Skipped for v1: backgrounding mid-action is uncommon for the
documented call-sites (save success, onboarding completion, wizard
lead-unset). Surface again if users report missed toasts after
returning to a backgrounded tab.

### Recency-bias diversity mitigation for suggestion category mix

v1 ships a prompt-level diversity nudge ("vary which categories you
draw from") in all three suggestion emission paths
([`explorations/2026-05-19-next-turn-suggestions.md`](./explorations/2026-05-19-next-turn-suggestions.md)).
If field evidence shows the model rut-defaulting through the nudge —
emitting the same one or two categories every turn regardless of
the enabled palette — the stronger mitigation is to pass the
previous entry's `nextTurnSuggestions.items[].categoryId` mix into
the emission prompt with "prefer categories other than these unless
none fit." Schema already supports it (prior-turn data lives on the
preceding entry's metadata). Surface when real signal emerges.

### Split granular translation toggle for suggestions

Next-turn suggestion chip text rides
`stories.settings.translation.granularToggles.narrative` in v1 —
chips translate when narrative does. If real signal surfaces for
split control (language-learning users wanting translated narrative

- source-language chips for vocabulary practice, or the inverse for
  some other use), add `granularToggles.suggestions: boolean` as its
  own toggle. Lands on demand.

### Split capability flag for `<suggestions>` parse reliability

The piggyback + classifier emission paths reuse the existing tagged-
block reliability capability flag on
`app_settings.providers[].cachedModels[].capabilities` — a model
that reliably emits `<state>` is presumed to emit `<suggestions>`
reliably too. If field evidence shows a model reliable on
`<state>` (structured extraction) but unreliable on `<suggestions>`
(creative prose in a tagged block — potentially a different
reliability axis), split into a dedicated `suggestionsBlock`
capability flag. Surface on signal.

### Re-roll cancel-and-restart on rapid double-click

The `suggestion-refresh` pipeline's concurrency policy self-blocks,
so a second refresh click while the first is still loading is a
no-op. If users find the no-op unintuitive — they want the latest
composer text to feed the in-flight re-roll without waiting — switch
to cancel-previous-and-restart semantics. Adds cancel + restart
machinery to the pipeline kind. Surface on signal.

### Narrative quality empirical risk under suggestion fold

When `piggybackMode='on'`, the narrative model emits prose AND
`<state>` AND `<suggestions>` in one call. The design assumes
narrative quality is unaffected by the suggestion-fold. Plausible
empirical failure modes: shorter or shallower prose because the
model is "saving room" for the trailing block, mid-prose drift from
pre-composing distinct suggestion seeds, tagged-block leakage into
prose. If signal emerges in v1 rollout, fall back to suggestion-
agent-always (route on-turn emission through the dedicated
`models.suggestion` agent instead of the narrative trailing block,
regardless of `piggybackMode`). Monitor in field; act on signal.

### Restore-draft mechanism for tap-after-typing on suggestion chips

When the user has typed unsaved content in the composer and taps a
suggestion chip, the chip text replaces the composer content and
the typed draft is lost — composer input isn't delta-logged, so
Cmd/Ctrl-Z does not recover it
([`explorations/2026-05-19-next-turn-suggestions.md`](./explorations/2026-05-19-next-turn-suggestions.md)).
v1 documents the wart explicitly. Mitigation options if real signal
surfaces: a Toast with "Restore draft" action firing on
tap-with-non-empty-composer, OR an AlertDialog "Replace your typed
text?" confirm gate. Toast is lighter-weight and uses the existing
[`patterns/toast.md`](./ui/patterns/toast.md) primitive; dialog is
more explicit. Surface on user reports.
