# Follow-ups

Top-level ledger of outstanding data-model, architecture, and UX
items deferred from earlier work. Items that have been cashed into
the relevant topic doc (`data-model.md`, `architecture.md`,
per-screen UI docs) are removed on resolution.

UI work surfaces most of these today; other domains add sections as
they accumulate items.

---

## Data-model

### `entities.state` kind-specific shape

Per `data-model.md`: "Kind-specific state shape is deferred." Peek
drawer's fields, World panel's Overview and Relationships tabs all
depend on this. Wireframes scaffold the regions; field-level UI lands
once the discriminated-union types (`CharacterState`, `LocationState`,
`ItemState`, `FactionState`) are designed.

### Non-linear narrative (v1 limitation → future exit)

Single-`worldTime` cleanly models linear narrative plus short
flashbacks. Does NOT model structural non-linearity (alternating
timelines, time travel, parallel chronologies). Captured in
data-model.md → "In-world time tracking" as a documented v1
limitation.

Future exit if demand emerges: optional
`story_entries.metadata.sceneTime: number | null`. Null = same as
`worldTime`; non-null = this entry depicts a scene at this historical
time. Awareness + happening logic would consult `sceneTime` when
present. Zero schema-migration cost (metadata is a JSON blob) — no
reason to reserve the field now. Revisit when a concrete user story
demands it.

### Fictional calendar systems

v1 ships Earth-calendar-only (base unit = seconds, formatted via
`worldTimeOrigin` ISO anchor). Design for fictional calendars is
spec'd in [`calendar-systems/`](./calendar-systems/README.md): a tiered
counter primitive with sub-divisions for week-style cycles and
manually-flipped eras hoisted out of the rollover chain, all
rendered through a Liquid display template. Schema and pipeline
fit the design without a refactor; v1 ships only the Earth preset.

Implementation deferred until 2–3 concrete fictional calendars
surface to validate the design against. Adding a preset is a data
commit per `calendar-systems/spec.md → Presets to ship`.

### Manual worldTime correction — cascade vs. jump + downstream blast radius

Per [In-world time tracking](./data-model.md#in-world-time-tracking)
users can manually edit `metadata.worldTime` on a single entry to
correct classifier drift. The edit is delta-logged like any metadata
mutation. What's NOT specified: what happens to subsequent entries
and to anything that derives time from them. Two options, both with
real costs:

- **Cascade correction** — shift every entry after N by the
  correction delta. Preserves the monotonically non-decreasing
  invariant. Costs: one user edit produces N writes; either each
  gets its own delta (loud log) or they batch under a single
  `action_id` (cleaner, but a larger atomic operation). Also racy
  if a classifier pass is mid-stream on a new entry.
- **Jump (leave subsequent alone)** — only entry N changes;
  entries > N retain their original worldTimes. Breaks the
  "monotonically non-decreasing" promise between N and N+1.
  Downstream consumers reading worldTime arithmetic (character
  ageing, scheduled-happening firing checks, freshness-based
  retrieval decay) misbehave in subtle ways.

Secondary concerns the design needs to answer:

- **Derived happening times.** A happening with
  `occurred_at_entry = E` derives its in-world time from entry E's
  worldTime (per the [`happenings` decision](./data-model.md#happenings--character-knowledge)).
  Editing entry E's worldTime semantically shifts every such
  happening's time. The shift is audit-visible via the delta log,
  but the UX needs to surface "this edit changes N derived times"
  before the user commits.
- **Flashback / non-linear corrections.** The classifier emits `0`
  for detected flashbacks, but a user might manually set a
  worldTime on a flashback entry to mean "this scene depicts 1872
  AR." That collides with the "metadata.worldTime is always
  main-timeline elapsed" contract. The future `sceneTime` exit
  (already in [Non-linear narrative](#non-linear-narrative-v1-limitation--future-exit))
  is the cleaner home for this — manual worldTime edits on
  flashback entries should probably be blocked with guidance
  pointing at sceneTime once it lands.
- **Non-linear narratives** generalize the flashback case.
  Single-`worldTime` was already flagged a v1 limitation; manual
  correction makes the limitation more user-visible, since users
  in those genres will reach for the edit affordance.

Decisions needed:

- Cascade vs. jump (or a third option — interactive confirmation
  showing the affected entries + happenings and letting the user
  pick).
- UX for blast-radius preview before commit.
- Guardrails (if any) blocking edits that would break
  monotonicity or shift derived times the user didn't intend.
- How `sceneTime` (when it lands) co-exists with manual
  `worldTime` edits.

### Top-K-by-salience retrieval — long-term memory implications

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

---

## UX

### Top-bar shape on World and Plot panels

Both panels currently render a moderately-simplified top-bar
(logo + breadcrumb-with-chapter-context + branch chip + Actions +
Settings + Return). Story Settings and Chapter Timeline ship with
a more minimal shape (logo + breadcrumb + Actions + Return only —
no branch chip, no chapter context).

Decide whether World and Plot should match the minimal pattern.
Trade-off: they're more "working with story state" than "configure
the story", so retaining the chapter + branch context is arguable.
The reader stays full-fidelity (status pill + chapter chip ▾ +
progress strip + time chip + branch chip) regardless of the call.

If the minimal pattern wins, codify the rule in principles.md:
"Reader-specific chrome (status / chapter ▾ / progress / time)
renders only on the reader. Supporting screens use the minimal
shape."

### Bulk operations on entities

See [ui/principles.md](./ui/principles.md) for open sub-questions. Dedicated design pass.

### Cover display on story list cards

Story Settings · About exposes a cover image field, but the story
list card never displays it — we deliberately went text-first so
cards don't depend on covers. Open: where does a set cover surface?

Proposal to evaluate: when a cover is set, the 4px left accent strip
expands to a ~60px cover thumbnail block (uncovered stories keep the
thin strip). Asymmetric cards but clearly signals "this story has a
cover" vs "accent-only". Alternatives: subtle background image behind
text, or small corner thumbnail. Decide with visual identity pass.

### Legacy `.avt` migration import

Old-app `.avt` files have a fundamentally different schema from the
v2 `.avts` format — not a clean format-version bump, a real
migration. Import path needs its own design pass: schema mapping
(old `characters` / `locations` / `lorebookEntries` → unified
`entities`), checkpoint translation (old per-checkpoint state → v2
delta log + branches), and surfaces (validation failures, partial
imports, conflict resolution). Defer the design until v2's import
flow is in place; piggyback on the file-import flow when ready.

### JSON viewer — edit mode

The shared raw-JSON drawer (per principles) ships read-only in v1.
Edit mode would be raw JSON edit + zod-validate on save. Pending
its own design pass — needs careful UX around partial-edit failures
(field-level validation errors mapped back into the JSON) and the
"this is the only way to fix some shapes" power-user case vs the
"don't let users break their data" common case.

### Image generation

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
  quality) joins the existing "granular per-story controls"
  followup.

Asset gallery (uploaded images) and `entry_assets` table are in
scope; only the auto-generation pipeline is deferred. Decoupled
domains.

### Encryption at rest for provider keys

Provider API keys live in SQLite (per data strategy). Encryption
mechanism deferred — not blocking v1 since this is a local-first app
with no network exposure of the DB. Lean: explore once a real
threat model surfaces (export-leak, multi-user shared machine, etc.).

### Granular per-story model controls

v1 story-level override is **model id only** (no per-story
temperature, max-output, custom JSON, etc.). When a real demand
surfaces (e.g., "this story needs a different temperature for the
narrative model only"), extend `stories.settings.models` to hold
either inline param overrides or a story-specific profile id. Lean
toward inline param overrides as the simpler extension.

### Virtual-list library choice

`react-window` vs `@tanstack/react-virtual` — both mature, both
solve the same problem. Decision blocked on:

- React Native Web compatibility verification (we render to RN-Web
  for desktop via Electron; library must work there).
- Per-row height handling: uniform vs computed-per-row vs measured.
  Model rows are uniform; history rows might vary slightly.
- Bundle size and tree-shaking story.

Lands when the first virtualized component is implemented (likely
the model picker dropdown or App Settings · Profiles model list).

### Storybook design-rules pattern setup

When component implementation begins, set up Storybook's tree as
**Foundations / Patterns / Components / Screens**. Patterns pages
are MDX with prose + live component demos. Rule is **dual-source**:
`docs/ui/patterns/` stays authoritative (greppable, versionable,
IDE-readable); Storybook Patterns pages cite the corresponding
pattern file as canonical and add the visual / interactive layer
(live render-mode demos for Select, side-by-side comparisons,
accessibility checks).

No duplication of prose — Storybook pages prose-cite the patterns
file and embed component stories. Drift prevention by construction.

Lands when we start building shared components (Select first,
probably). Premature to scaffold before components exist; the live
embedding is the whole point.

### FTS5 upgrade for search

Search currently uses `LIKE` + `json_extract` / `json_each` against
SQLite. Fast enough for thousands of rows; large stories (tens of
thousands of entries + their delta log) eventually need FTS5
(SQLite's full-text-search virtual tables) to stay snappy.
Mirror searchable text into an FTS index, triggers keep it in
sync. Pending — revisit when a real story hits the wall.

### Translation Wizard

Multi-language conversion of an existing story's content (per-story
Settings supports one target at a time; the Wizard batches
conversions to a new target). Inventory #15, pending.

### Character-side Awareness tab on World panel

The Plot panel surfaces awareness as a happening-detail tab (who
knows about this event). The reverse pivot — "what does character X
know" — should live as a new Awareness tab on the World panel for
character entities. Same `happening_awareness` data, queried from the
character end. Pending; add when the character-kind detail tabs get
their next pass.

### Observability / debug UI

Standalone panel exposing the global `deltas` log for power-user
debugging — what happened to the data layer, when, by which agent
(classifier / lore-mgmt / memory-compaction / user_edit). Likely a
chronological scroll with filters by source, target_table,
action_id. Distinct from per-entity History tab (World, Plot) which
already scopes the log to one row's lineage.

No external services. Larger topic touching debugging, logging, and
observability — own design pass. Surfaced during Plot panel
brainstorm.

### Per-kind Overview composition in World panel

Only character-kind Overview is wireframed. Location / item / faction
need their own composition driven by their typed state. Lore's
Overview is separate again (different table, different fields). All
pending — blocks on `entities.state` shape.

### Asset gallery

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

### Story tags on library cards

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

### Story definition baseline

What's the minimum set of inputs that defines a story? The wizard
needs to prompt for the load-bearing fields without inflating the
flow with optional extras. Today's `stories.settings` shape mixes
definitional (mode, leadEntityId, narration, tone) with operational
(memory knobs, translation, models, pack) — all set somehow at
creation but only the definitional fields are wizard-required.

Discussion needed:

- Which fields are **required** at story creation (cannot be left
  empty, no sensible default)?
- Which are **prompted but skippable** (defaults work; user can
  refine later)?
- Which are **deferred to post-creation** entirely (user gets to
  them in Story Settings if/when needed)?
- What's the minimum-viable "blank slate" — start writing
  immediately vs. fill in setting first?

Sister concern: `entities.state` discriminated-union shape — the
same "what's required vs deferred" question for character /
location / item / faction state. Tracked separately in
[`entities.state` kind-specific shape](#entitiesstate-kind-specific-shape).

Both feed into the wizard design (Story Creation wizard, inventory
#2, pending) and the entity-creation form (per-kind, blocked on
state shape).

### Provider / profile / model-profile deletion semantics

No spec'd behavior for deleting a provider, profile, or model
profile that's referenced by stories or assignments. Calendar
deletion (designed in
[`calendar-systems/spec.md`](./calendar-systems/spec.md), folded
into [data-model.md → App settings storage](./data-model.md#app-settings-storage))
sets the stricter precedent — block when references exist.
Provider/profile probably want the same shape but worth a dedicated
pass: orphan handling on import, soft-warn vs hard-block tradeoffs,
what happens to `default_provider_id` if the referenced provider is
deleted, etc.

### App Settings → Calendars surface

Per [calendar-systems/spec.md → Authoring (UI)](./calendar-systems/spec.md#authoring-ui),
the L2 calendar editor lives at App Settings → Calendars (sibling to
Profiles, Providers). Wireframe and surface design pending — App
Settings doc currently has no calendar-related elements.

### Story Settings calendar-picker surface

Per [calendar-systems/spec.md → Authoring (UI)](./calendar-systems/spec.md#authoring-ui),
Story Settings exposes the active calendar picker plus a read-only
summary of the selected calendar's shape. Wireframe element pending
— the existing Story Settings wireframe references `worldTimeOrigin`
but doesn't surface a picker yet.

### Backup / story export with user-authored calendars

A story export references `calendarSystemId`. If the calendar is a
user-authored clone, the importing system doesn't have it. Export
needs to embed user-authored calendar definitions as a sidecar (or
prompt for substitution on import). Built-in references resolve
fine since built-ins ship with every install.

### Edit restrictions during in-flight generation

Cross-cutting UX pattern: which mutations are blocked while
generation is in progress? Calendar swap is one instance (prohibited
mid-generation per
[`calendar-systems/spec.md → Adversarial check`](./calendar-systems/spec.md#adversarial-check)).
Story-settings edits during generation are likely another.
Definitional changes (mode, narration) probably want the same gate.
Settle on a uniform pattern — lean toward "no settings edits while
generation in-progress" — and document where the gate applies.

---

## Deferred sessions

### Visual identity

Once wireframes settle, decide palette, typography, spacing scale,
icon set, motion primitives, overall mood. Today's wireframes stay
monochrome intentionally.

### Feature components in Storybook

Wireframes expose component boundaries (EntryBubble, EntityRow,
ChapterBreak, PeekDrawer, BrowseRail, etc.). Those become Storybook
stories once visual identity lands.

### Mobile variants for every screen

Every wireframe in scope today gets a mobile pass after desktop
settles. Actions menu, peek drawer, master-detail patterns all need
mobile adaptations (bottom sheets, full-screen takeovers, sheet-
based navigation). Mobile is first-class, not an afterthought.
