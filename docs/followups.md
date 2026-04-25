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
`worldTimeOrigin` ISO anchor). The schema already supports fictional
calendars — `worldTime` is a bare integer; a different calendar is
just a different renderer over the same integer. What's missing:

- Where a story's calendar system is declared (wizard step plus a
  `stories.settings.calendarSystem` field, presumably).
- How calendar systems are authored (built-in presets? pack-declared?
  plugin-shaped?).
- The renderer contract (what a calendar formatter must implement).
- Classifier awareness — does it need to know the calendar to emit
  sensible elapsed-unit deltas, or is "base units" abstract enough?

High design-space breadth; picking a shape too early risks boxing
out common user needs. Defer until we have 2–3 concrete fictional
calendars we want to support and can design against them.

---

## UX

### "Immutable once started" story settings

Which story settings are soft-warn vs hard-lock once narrative
exists, and the confirmation wording. Needs a pass before Story
Settings ships.

### Rollback confirmation

Deleting an entry is rollback semantics (drops target + everything
after). Needs its own wireframe: hover-preview of affected range,
confirmation modal with counts ("removes N entries, M chapters, K
entity updates"), cross-chapter warning.

### Lead switch on reader peek drawer

Add a "Set as lead" action to the peek drawer for characters. Matches
the World panel · Overview affordance but inline. Not drawn in the
current reader wireframe — requires a return pass.

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

### Model profiles data shape

Define the zod schema for `ModelProfile`, `imageGenConfig`,
`agentAssignments`, default-provider field, and onboarding seed
defaults. Lives in `app_settings` JSON field per the data strategy
(simpler than separate tables for v1; schema can normalize later if
needed). Includes the broken-config detection rules (model removed
from provider catalog, key missing, profile orphan after key
removal).

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

### Provider data shape — multi-instance

Provider configurations are user-managed instances (multiple of the
same type allowed). Schema implication:

```ts
app_settings.providers: Array<{
  id: string;
  type: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'nanogpt' | 'openai-compatible';
  displayName: string;
  apiKey: string;
  endpoint?: string;        // override default
  customHeaders?: Record<string, string>;
}>;
app_settings.defaultProviderId: string;
```

`ModelProfile.modelId` becomes `{ providerId: string; modelId: string }`
to disambiguate when multiple providers expose the same model id.
Lands with the schema pass.

### Encryption at rest for provider keys

Provider API keys live in SQLite (per data strategy). Encryption
mechanism deferred — not blocking v1 since this is a local-first app
with no network exposure of the DB. Lean: explore once a real
threat model surfaces (export-leak, multi-user shared machine, etc.).

### Cross-provider model invalidation UX

When a profile's selected model is no longer in the provider's fetched
catalog (deprecation, account changes), surface as: per-profile inline
error + global broken-config banner aggregating across profiles. The
banner has a deep-link button that lands on App Settings · Profiles
with the first broken profile scrolled into view. Spec'd in
`app-settings.md` and partially demonstrated in the wireframe (toggle
`errors: 2 broken` in review controls). Implementation finalizes
when the model-fetching pipeline lands.

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
`docs/ui/principles.md` stays authoritative (greppable, versionable,
IDE-readable); Storybook Patterns pages cite it as canonical and add
the visual / interactive layer (live render-mode demos for Select,
side-by-side comparisons, accessibility checks).

No duplication of prose — Storybook pages prose-cite principles.md
and embed component stories. Drift prevention by construction.

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

### App Settings — "Default story settings" section

The settings-scope policy resolved during this pass introduced an App
Settings section holding defaults-for-new-stories (memory knobs,
translation config, composer UX prefs, suggestions toggle). App
Settings hasn't been wireframed yet; this section's UX (mirror of the
Story Settings panes it defaults) lands when App Settings does.

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
