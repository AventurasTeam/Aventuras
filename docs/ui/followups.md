# UI follow-ups

Data-model, architecture, and UX items the UI work surfaced — stacked
for later sessions. Separate from wireframes / principles so it stays
actionable.

This file tracks **outstanding** items only. Anything cashed into
`docs/data-model.md` or `docs/architecture.md` is removed on resolution.

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

- Where a story's calendar system is declared (likely a wizard step
  - a `stories.settings.calendarSystem` field).
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

See principles.md for open sub-questions. Dedicated design pass.

### Cover display on story list cards

Story Settings · About exposes a cover image field, but the story
list card never displays it — we deliberately went text-first so
cards don't depend on covers. Open: where does a set cover surface?

Proposal to evaluate: when a cover is set, the 4px left accent strip
expands to a ~60px cover thumbnail block (uncovered stories keep the
thin strip). Asymmetric cards but clearly signals "this story has a
cover" vs "accent-only". Alternatives: subtle background image behind
text, or small corner thumbnail. Decide with visual identity pass.

### Translation Wizard

Multi-language conversion of an existing story's content (per-story
Settings supports one target at a time; the Wizard batches
conversions to a new target). Inventory #15, pending.

### Plot panel shape

Not yet wireframed. Different pattern from World (dashboard / monitor
over workshop) — threads + happenings have different interaction
needs from entities + lore.

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
