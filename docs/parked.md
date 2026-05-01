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

#### Top-K-by-salience retrieval — long-term memory implications

Per [Happenings & character knowledge](./data-model.md#happenings--character-knowledge):
"character awareness lists grow unbounded. This is handled at
injection time (retrieve top-K by salience + scene relevance, not
full history) and by periodic compaction at chapter close." Top-K
is fine as a default for short or medium stories. For genuinely
long-running stories (year-of-narrative spans, dozens of chapters)
the model has known failure modes worth ironing out before a real
user hits them.

- **Single-axis salience conflates orthogonal relevance.** "Aria's
  mother died in chapter 2" is high-salience for emotional /
  family-drama scenes, near-zero for chapter-50 combat. One
  salience number can't be both. Top-K drops the wrong things in
  the wrong scene.
- **Decay-then-drop loses load-bearing facts.** Compaction decays
  salience over time and may consolidate low-salience rows into
  summary happenings (per the
  [Chapters / memory system](./data-model.md#chapters--memory-system)
  decision — exact behavior TBD). A pivotal chapter-1 plot point
  can decay by chapter 20, get summarized (losing detail), and
  drop out of top-K entirely by chapter 40. Reversible via
  rollback, but on a long story rollback is impractical.
- **K is a hard cutoff.** No soft middle ground for
  medium-relevance background. Two happenings tied at salience
  with K-1 slots above them — one gets in, one doesn't, no signal
  which.
- **Compaction summaries carry their own provenance.** When the
  classifier writes a new happening referring back to an earlier
  event, does it reach the original happening or the summary?
  Reference fields (`occurred_at_entry`, awareness
  `learned_at_entry`) point at originals — but if compaction
  deleted the original in favor of a summary, those references
  go stale.

Decisions needed:

- Salience model — single number vs. multi-axis (per-thread /
  per-entity / per-tone)?
- Compaction philosophy — does the original happening survive
  with low salience, occasionally retrieved? Or is it deleted in
  favor of the summary?
- "Pinned forever" override — a way for users (or the
  lore-management agent) to mark a happening_awareness row as
  load-bearing and exempt it from decay. Today,
  `injection_mode = always` exists on `lore` / `entities` /
  `threads` but NOT on `happening_awareness` rows; worth
  considering whether it should.
- Retrieval shape beyond hard top-K — tiered (must-include +
  top-K + sampled-from-rest), salience-weighted sampling rather
  than cutoff, etc.
- "Memory probe" affordance for users to inspect what the model
  is actually seeing on a given turn — debug tool to surface the
  dropped happenings.

### UX (post-v1)

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

#### Observability / debug UI

Standalone panel exposing the global `deltas` log for power-user
debugging — what happened to the data layer, when, by which agent
(classifier / lore-mgmt / memory-compaction / user_edit). Likely a
chronological scroll with filters by source, target_table,
action_id. Distinct from per-entity History tab (World, Plot) which
already scopes the log to one row's lineage.

No external services. Larger topic touching debugging, logging, and
observability — own design pass. Surfaced during Plot panel
brainstorm.

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

#### Vault genre + tone preset content types

The bundled preset library for `definition.genre` and
`definition.tone` (preset+prose hybrid per
[`data-model.md → Story settings shape`](./data-model.md#story-settings-shape))
lives in code for v1. Post-v1, user-authored presets land in Vault
as new content types — parallel to user-authored calendars in
`vault_calendars` (per
[`data-model.md → Vault content storage`](./data-model.md#vault-content-storage)).
Each preset row carries `displayName`, optional `tagline`, and
`promptBody`. Per-type tables (`vault_genre_presets`,
`vault_tone_presets`) follow the per-type-not-polymorphic precedent
calendars set; the unification question revisits with multiple
content types live (see
[Vault content storage pattern](#vault-content-storage-pattern)).

Built-in catalog stays in code for both v1 and post-v1; user
clones land in Vault. Selection at wizard time copies preset
content into the story (fire-and-forget) — no preset id stored,
no orphan handling.

#### Vault setting templates

`definition.setting` is freeform prose only in v1. Some users will
want reusable setting prose across stories ("my Forgotten Realms
homebrew", "the Aetherium cyberpunk stack I keep returning to"). A
post-v1 Vault content type for setting templates fits the same
shape as the genre/tone preset content types above. Setting
templates are larger blobs typically — possibly with subsections
for world-rules / atmosphere / key locations — though the v1
freeform `setting: string` shape covers the common case without
forcing structure.

Lands when the genre/tone Vault content types are designed (the
shapes and Vault-shell affordances are likely shared).

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

#### Backup / story export with user-authored calendars

A story export references `calendarSystemId`. If the calendar is a
user-authored clone, the importing system doesn't have it. Export
needs to embed user-authored calendar definitions as a sidecar (or
prompt for substitution on import). Built-in references resolve
fine since built-ins ship with every install.

#### Background-agent gate declarations

[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation)
defines a four-field declaration shape (`writeSet`, `gateBehavior`,
`conflictPolicy`, `affordance`) every future background agent picks
values for at its own design pass. Style-review is the motivating
example; any standalone memory-compaction agent that splits out of
the chapter-close pipeline is another candidate. Each agent's
design pass picks values with reasoning; the principle doesn't
prescribe defaults.

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

### UX (parked)

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
mechanism deferred — not blocking v1 since this is a local-first app
with no network exposure of the DB. Lean: explore once a real
threat model surfaces (export-leak, multi-user shared machine, etc.).

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

#### Calendar picker search-bar threshold

The [calendar picker pattern's](./ui/patterns/calendar-picker.md)
popover gains an inline search/filter bar at some option-count
threshold (rough lean: ≥ 8). Pick the actual number once we have
real preset catalogs to test against — speculative until the
catalog size is concrete enough to validate against. Pairs with
the active
[Calendar picker primitive — Select-extension vs Picker-fork](./followups.md#calendar-picker-primitive--open-shape-decisions)
followup.

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

#### Scoped-gate UI design

[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation)
names `'scoped-gate'` as one of three valid `gateBehavior` values —
gating only the agent's `writeSet` rather than the entire user
surface. Surface-level affordance for the partial-gate case
(which controls disable, what tooltip copy says, how the user
disambiguates "this control is gated by agent X" from "this
control is gated by per-turn pipeline") is unspec'd.

Lands when the first agent declares `gateBehavior: 'scoped-gate'`.
Style-review's motivating use is `'no-gate'`, so this followup
isn't blocking style-review.

#### Scoped-gate read-tracking strategy

`readSet` is intentionally absent from the background-agent
declaration shape because read-set is template-determined,
pack-editable, and dynamic — not code-declarable
(per [`architecture.md → The single-context principle`](./architecture.md#the-single-context-principle)).
A `'scoped-gate'` agent therefore prevents user mutations to its
`writeSet` but not to its (unbound) read-set; user edits during
the agent's run could create torn reads.

Two candidate strategies for when scoped-gate's design pass
addresses this:

- **Liquid AST analysis at template load.** Walk the parsed
  template, extract top-level variable references, take that as a
  conservative read-set superset. Re-runs whenever the template
  changes (pack edit, app update). Adds infra cost; doesn't catch
  filter-internal slicing but bounds the read surface usefully.
- **Hard-gate fallback for unbound templates.** Only allow
  `'scoped-gate'` when the agent's template + context group are
  simple enough to bound; everything else uses `'hard-gate'`.

Decision lands at scoped-gate's own design pass.

#### Concurrent pipeline / agent coordination

[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation)
holds a single-writer invariant: at most one pipeline transaction
in flight at a time. v1 satisfies this by construction
(chapter-close runs only between turns; no overlap surface). When
background agents enter the picture (style-review or future
standalone memory-compaction), overlap becomes possible:

- Background agent + per-turn pipeline simultaneously — abort the
  agent, block the pipeline, or run side-by-side (only safe if
  write sets are disjoint)?
- Two background agents simultaneously — same questions, with the
  agents' `conflictPolicy` declarations creating cascading
  decisions.

Owned by the first design pass that introduces a concurrent agent.
Worth flagging that aborting an expensive agent on every per-turn
start can starve agents whose work spans many turns and burns
provider quota; abort-self isn't a safe default for everything.

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
the local-first app has no immediate consumer beyond manual
sharing.

Lands if integrations surface real demand: e.g., a "share story
context" affordance that drops a deep link into iOS Messages /
Android Share, or a future calendar-reminder integration that
deep-links into the story.

The work itself is straightforward — Expo Router supports URL
schemes natively; route mapping plus a launch-time deep-link
handler. Schema cost is also small (URL templates per surface).
Held parked because v1 doesn't have a consumer that benefits.
