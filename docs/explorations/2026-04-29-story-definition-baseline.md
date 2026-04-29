# Story definition baseline — what makes a story

Settles "what fields define a story" — the set of inputs the wizard
collects and the AI consumes, plus the storage shape that holds
them. Resolves the **Story definition baseline** followup (removed
from `followups.md` in this same change) and reshapes `genre` /
`tone` into substantial prompt-content fields.

## Background

Today's wizard-authored definitional surface is `mode` /
`leadEntityId` / `narration` / `tone` (a single-line string), plus
identity columns (`genre` as a single-line label, `description`,
`tags`, `cover`, `accent`, etc.). Calendar fields cover time. None
of those name **the world** or **the situation** the story takes
place in — there's no field for setting, no field for opening
prose, no field for substantial style direction. The user's working
note flagged the gap explicitly:

> Genre not as a simple one line string, instead a substantial
> prompt addition. Same for tone.

…and broadened to: "what we have isn't enough to make a story."
This design closes that gap.

Out of scope: how the wizard collects these (step ordering, AI-assist
affordances per field, validation copy) — the Wizard screen is its
own pending design pass (Inventory #2). This session locks **what**
the wizard must collect and the storage / pipeline shape; **how** it
does so lives with the wizard pass.

## Scope

In:

- The data shape — every definitional field on the story, including
  the new substantial-prompt fields.
- What gets injected into the AI's prompt context (the field set);
  the **how** of injection mechanics is parked.
- The required / prompted / deferred categorization of every
  definitional field.
- Impact on the existing Story Settings screen.
- The opening of a story — where it lives and how it's authored.

Adjacent (cited, not designed):

- Wizard flow / step layout / per-field AI-assist UX (Wizard pass
  owns).
- `entities.state` discriminated-union shape — the sister followup
  for character/location/item/faction state. Stays parked.
- Injection mechanics — how each field reaches the prompt
  template — defers to the architecture-side work.

## Decisions

### 1. Split `stories.settings` into `definition` + `settings`

The current single `stories.settings` JSON cram-bundles two
conceptually distinct things: **definitional content** (what the
story IS — mode/lead/narration/tone) and **operational config**
(how it generates — memory knobs, models, translation, pack). The
Story Settings UI already separates these visually (left rail's
"Story" section vs "Settings" section). The data shape catches up
to the UI's mental model.

```ts
stories {
  // identity columns (existing — UNCHANGED)
  id text PK
  title text
  description text
  tags json                             // string[]
  cover_asset_id text FK
  accent_color text
  status text                           // draft | active | archived
  pinned integer
  author_notes text                     // private
  last_opened_at integer
  created_at integer
  updated_at integer
  current_branch_id text FK

  // REMOVED column
  // genre text                         // moves into definition.genre.label

  // NEW JSON column
  definition json                       // see StoryDefinition shape below

  // EXISTING JSON column (operational only after this change)
  settings json                         // see StorySettings shape below
}
```

`StoryDefinition`:

```ts
{
  // Author-relationship (existing fields, relocated from settings)
  mode: 'adventure' | 'creative'
  leadEntityId: string | null // see cross-field constraint below
  narration: 'first' | 'second' | 'third'

  // Substantial prompt content — preset+prose hybrid (NEW shape)
  genre: {
    label: string
    promptBody: string
  }
  tone: {
    label: string
    promptBody: string
  }

  // Substantial prompt content — freeform (NEW field)
  setting: string

  // Time / calendar (existing fields, relocated from settings)
  calendarSystemId: string
  worldTimeOrigin: TierTuple
}
```

`StorySettings` (operational only after the split):

```ts
{
  // Memory (existing)
  chapterTokenThreshold: number
  chapterAutoClose: boolean
  recentBuffer: number
  compactionDetail: string

  // Composer (existing)
  composerModesEnabled: boolean
  composerWrapPov: 'first' | 'third'
  suggestionsEnabled: boolean

  // Translation, models, pack (existing — unchanged)
  translation: { enabled, targetLanguage, granularToggles: { ... } }
  models: { narrative?, classifier?, translation?, ... }
  activePackId: string | null
  packVariables: Record<string, unknown>
}
```

**Scope policy preserved.** Definitional fields are wizard-authored
with no global default (existing rule from
[`data-model.md → Story settings shape`](../data-model.md#story-settings-shape)).
Operational fields are copy-at-creation from
`app_settings.default_story_settings` (existing pattern). The split
is purely about _storage clarity_, not about changing how either
half flows.

**Why two JSON columns, not promoting to columns.** Each
definitional field that's compound (`genre`, `tone`,
`worldTimeOrigin`) would need a JSON-typed column anyway — promoting
to columns gives no query benefit and adds schema rigidity for every
future definitional addition. JSON keeps the shape additive.

**Why drop `stories.genre` entirely (not denormalize as a sibling
column).** Carrying `stories.genre TEXT` alongside
`definition.genre.label` would create drift risk (column out of sync
with JSON). The library card overline reads `definition.genre.label`
via `json_extract`; performance is fine for thousands of stories,
and an indexed expression solves any future scale. Pre-launch — no
migration cost.

### 2. Genre + tone as preset+prose hybrid

Both genre and tone are now substantial prompt-content fields with
the same shape: a short label + a multi-paragraph prose body.
Selection in the wizard is **preset-driven** with snapshot copy:

1. Wizard shows a list of bundled presets (`Hard sci-fi`,
   `Cozy fantasy`, `Noir`, …) with display name + 1-line tagline.
2. User picks one. The preset's `displayName` copies into the
   story's `label`; the preset's `promptBody` copies into the
   story's `promptBody`.
3. User can edit either freely afterward.
4. **Fire-and-forget** — no preset id stored on the story. App
   updates that change the bundled preset don't propagate to
   existing stories. Mirrors the calendar-clone pattern (per
   [`data-model.md → Vault content storage`](../data-model.md#vault-content-storage)).

**No-preset path** — preset selection is optional. User can skip
and author label + prose from scratch. End state is the same shape.

**Preset library lives in code (v1).** Bundled JSON loaded at boot,
sized for common cases (~20-30 entries each for genre / tone). User-
authored presets in Vault are deferred — the
[Vault genre + tone preset content types](../followups.md) followup
captures the post-v1 path, parallel to how user-authored calendars
arrived after the built-in catalog.

### 3. Setting as freeform prose (no preset)

Setting describes the world / time / place — material that's
genuinely unique per story:

> Late-medieval kingdom on the brink of civil war, with magic
> newly returned after centuries of absence.

Versus genre's clustered nature ("most stories cluster into known
genres; many will share Noir"), settings rarely repeat. Forcing
preset selection would either produce a tiny catalog of generic
backdrops ("medieval / sci-fi / contemporary") that users
override anyway, or balloon to hundreds of entries that users
ignore. Freeform respects the field's nature.

A future Vault content type for reusable user-authored setting
templates is parked in followups; v1 ships freeform-only.

### 4. Premise / themes / atmosphere — deliberately not added

Considered and rejected as separate definitional fields:

- **Premise** (story trajectory / hook): the locked combo
  (setting + initial cast + lore + opening prose) carries premise
  content implicitly. A separate field forces every user to
  articulate trajectory upfront — which they often don't know — and
  creates the "what do I put here that I haven't already said?"
  dispose-of problem. Old app encoded this as
  `setting.potentialConflicts: string[]` (3-5 hooks); we don't need
  it as its own slot.
- **Themes** (e.g., "belonging vs autonomy", "the cost of power"):
  risk is billboarding — explicit themes make the AI heavy-handed.
  Tone field (preset+prose) absorbs thematic intent organically.
- **Atmosphere**: scene-level concern, not story-level definitional.
  Belongs to per-scene direction, not the wizard.
- **"Anything else" / extras safety valve**: cookie-jar risk. If
  something doesn't fit a structured field, that's signal to add a
  proper field — not to dump prose into a catch-all that bypasses
  the structured surfaces. User retains pack-level control via
  prompt-pack authorship.

If real demand for any of these surfaces post-launch, the discussion
can be reopened from this exploration's record. Today's lean is
"less is more" — every additional field is a barrier to story
creation.

### 5. Content controls + style mechanics → pack territory

Both were considered as per-story prose fields and **moved to pack
scope**:

- **Content controls** (taboos / encouragements): prompt-pack
  authors distribute packs with content restrictions or
  encouragements baked into the templates. Per-story prose fields
  for the same purpose would duplicate what packs already model.
- **Style mechanics beyond narration POV** (sentence rhythm,
  vocabulary register): same architectural answer. Templates own
  these; per-story fine-grained control is a pack concern.

This shrinks the data-model surface meaningfully and pushes
prompt-shape concerns to their natural layer.

### 6. Initial cast + world rules at wizard time

The wizard pre-populates two existing tables — no schema changes:

- **`entities` rows** for initial cast (incl. lead). Existing entity
  table covers the shape; lead's id is referenced by
  `definition.leadEntityId`.
- **`lore` rows** for world rules / mechanics. Existing lore table
  is the canonical home for "what's true about this world."

Both are wizard-authored at story creation; subsequent agent passes
(classifier, lore-management) extend them naturally as the story
runs.

### 7. Opening as `story_entries[1]` with new `kind='opening'`

The opening of the story IS entry 1 of the initial branch. Not a
settings field; not a separate table — narrative prose lives in the
narrative log.

Adds a new value to the `story_entries.kind` enum:

```ts
story_entries.kind:
  'user_action' | 'ai_reply' | 'system' | 'opening'  // NEW: 'opening'
```

**Why a new kind, not overloading:**

- Reusing `system` would conflict with its established "error
  surfaces" semantics (per
  [`reader-composer.md → Error surface`](../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-not-chrome-indicators)).
  An `opening` is narrative, not machinery output.
- Reusing `ai_reply` for user-written openings is genuinely wrong
  (calling user-authored prose "AI reply" misleads downstream code
  that reads kind for provenance).
- A first-class `opening` kind is cheap (one enum value), keeps
  semantics clean, and sets up future "manual narrative insertion
  mid-story" to reuse the same kind.

**Authorship discriminator: `metadata.model`.** Set when AI-generated
(during the wizard's optional AI-assist path), `null` when
user-written. No separate `authorSource` field needed.

**Reader rendering:** identical to `ai_reply` bubbles — the opening
is narrative, indistinguishable visually. Provenance lives in
metadata, not in styling.

### 8. Opening invariants

- **Position invariant.** Always position 1 of its branch.
  Action-layer enforced.
- **Block-delete.** `op=delete` on `kind='opening'` rejected at
  the action layer. Use cases for deletion (redo opening, start
  over) are addressed by edit + regenerate-opening (wizard
  followup) or by creating a new story / branch — never by
  emptying the branch.
- **Branching.** Forking from the opening copies it forward
  (existing branch-copy logic handles this — opening behaves
  like any entry being copied into the new branch).
- **Rollback.** Can target entry 1 (leaves only the opening);
  can never go below.

### 9. AI-generated openings emit minimal classification inline

When the wizard's AI-assist path generates the opening, the
generation call uses **structured output** to emit prose AND minimal
scene metadata in one call:

```ts
{
  prose: string,
  sceneEntities: string[],          // subset of cast entity ids
  currentLocationId: string | null, // one of the cast location ids
  worldTime: 0                      // story start; always 0
}
```

The model is constrained to reference only wizard-curated cast in
the metadata refs (passed as enum-shaped reference data in the
generation context). Prose can mention unbacked names freely
("Old Jorin was sleeping at the bar") — only the metadata refs are
constrained.

**No separate classifier pass on the opening (v1).** The
inline-emitted metadata is what the opening starts with. User-written
openings get empty metadata (`worldTime: 0`, `sceneEntities: []`,
`currentLocationId: null`); turn 2's classifier pass populates scene
presence going forward. The first AI reply's prompt context includes
the opening prose verbatim (recent buffer covers it), so the AI
grounds itself from prose regardless of whether metadata is
populated.

A future
[classifier-on-opening retrofit](../followups.md) adds a separate
tagging pass if entry-1 metadata becomes load-bearing for downstream
features.

### 10. Wizard creation is exempt from the delta log

The wizard's commit transaction writes the stories row, branch,
initial entities, initial lore, and the opening entry — all in one
atomic SQLite transaction, **no deltas written**. They're baked in
as the story's initial state.

Implications:

- Earliest possible delta in the log is the user's first turn (a
  `user_action` create).
- CTRL-Z in a freshly-wizard-created story is a no-op until the
  user takes a turn.
- Rollback can never reach below the opening.
- Branching from the opening copies wizard-created rows + the
  (empty) delta log up to that point — clean handoff.

Subsequent edits to wizard-created rows (text edits on opening,
field edits on initial entities, body edits on initial lore) follow
**normal delta semantics** — only the wizard's _creation_ is exempt;
update / delete operations on those rows produce deltas as usual.

This makes the data-model rule "delta log starts at first turn,
never reaches into wizard creation" explicit and removes the
awkward "what would CTRL-Z right after wizard even do?" edge case.

### 11. Cross-field constraint: narration → lead

Adds an enforceable cross-field rule on `definition`:

```
narration ∈ { 'first', 'second' }  →  leadEntityId != null
```

The existing
[principle](../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts)
already states "a first- or second-person story still has a lead";
this turns the principle into a hard zod constraint at the
`definition` boundary. Wizard rejects commit; Story Settings rejects
save. Coexists with the existing `mode='adventure' →
leadEntityId != null` rule (both can apply; either alone is
sufficient to require a lead).

**Creative + third-person + null lead remains valid** — the
omniscient-narrator ensemble case (literary fiction tradition).
Forcing a lead for it is artificial; users would pick one
arbitrarily and ignore the field. Future tightening is easy if
real-world usage shows nobody uses the empty-lead path.

## Trade-offs explored & rejected

### Why not S1 (status quo, everything in `settings`)

Status-quo+ would just drop the `genre` column and add the new
fields inside the existing `settings` JSON. Path of least
resistance, but leaves the "settings JSON contains both
definitional content AND operational config" semantic mess in
place. The Story Settings UI already separates the two; the data
shape should mirror the user-facing structure rather than fight it.

### Why not S3 (promote definitional fields to columns)

Each definitional field as its own column (some `text`, some `json`
for compound shapes). Maximally first-class — but:

- `genre` / `tone` / `worldTimeOrigin` need JSON-typed columns
  anyway, so the column-vs-JSON-key benefit shrinks to zero for
  those.
- Adds schema rigidity: every new definitional field is a migration.
  S2's JSON keeps the shape additive.
- Doesn't actually improve the "what we have isn't enough" problem
  any better than S2 — that's a field-set question, not a storage
  question.

### Why setting is freeform-only (not preset+prose like genre/tone)

Genre and tone cluster naturally — many stories share "Noir" or
"Cozy fantasy" as the dominant flavor. Setting is genuinely unique
per story (the world being depicted is rarely interchangeable). A
preset catalog for setting either stays generic ("medieval / sci-fi
/ contemporary" — which users override anyway) or balloons to
unmaintainable specificity. Freeform respects the field's nature.

### Why opening is `story_entries[1]`, not a `settings` string

Two paths considered:

- Settings field (`settings.opening: string`) — opening is config.
  Story starts with empty `story_entries`; AI consumes opening at
  first generation but no entry exists for it.
- **Entry 1** (chosen) — opening IS the first narrative beat. Lives
  in the log, edits work like any entry's text-edit side-channel,
  branching/rollback semantics are uniform with the rest of the
  log, and the reader renders it without a special "look up the
  opening from settings" path.

The chosen path is cheaper everywhere except the new
`kind='opening'` enum value — minor cost for substantial
simplification.

## Edge cases & invariants

Recap of constraints the design enforces; full discussion in the
relevant decision sections above.

- Wizard creation is atomic — all writes succeed together or none
  do.
- Opening is permanent within its branch (block-delete) and always
  position 1 (action-layer enforced).
- `definition.leadEntityId` resolves to an entity with
  `kind='character'` in the same story.
- AI-generated opening metadata refs constrained to the
  wizard-curated cast; prose mention of unbacked names permitted.
- Empty cast in creative mode allowed only when `narration='third'`
  (per the cross-field constraint).
- Empty lore allowed (world rules optional).
- `definition` is story-level, not branch-level; all branches share
  the same mode/narration/genre/tone/setting. Editing definition
  propagates to all branches. Per-branch override is a future hook
  if real demand surfaces.
- Definitional-change confirmation modal scope **unchanged** —
  genre/tone/setting prose changes do NOT trigger the modal; they
  shift AI output from the next turn forward without coherence
  breaks. Soft warn-box on the Generation tab is sufficient.

## Generated followups

New entries for `followups.md`:

- **Vault genre + tone preset content types** — post-v1 user-
  authored preset content, parallel to user-authored calendars.
- **Vault setting templates** — post-v1 reusable setting prose,
  parallel to other Vault content types.
- **Optional user-side scene tagging on user-written openings** —
  wizard concern: let users pick `sceneEntities` /
  `currentLocationId` on user-written openings if they want to skip
  classifier-on-turn-2.
- **Regenerate-opening affordance** — wizard / reader-chrome path
  for re-running AI-assisted opening generation post-wizard.
- **Classifier-on-opening retrofit** — separate tagging pass for
  user-written openings if entry-1 metadata becomes load-bearing
  for any feature later.
- **Per-branch definition override** — speculative; tonal experiments
  via branch instead of new story. Low priority.
- **Opening generation structured-output fallback** — if the model
  fails to emit valid structured output during AI-assisted opening
  generation, fall back to prose-only and treat the opening as
  user-written for metadata purposes.
- **Per-story export envelope verification** — confirm the `.avts`
  per-story export envelope handles the new `definition` JSON column
  generically (it should, since it iterates story columns; verify
  during integration write-up).

Resolved:

- **Story definition baseline** — closed by this design.

Acknowledged but deliberately not parked (rejected outright,
reopenable from this record if real demand surfaces post-launch):

- Premise / themes / atmosphere / extras as definitional fields.
- Content controls / style mechanics as per-story fields (kept as
  pack territory).

## What this design does not do

- Does not design the Wizard's flow / step ordering / per-field
  AI-assist UX. Wizard pass owns that work; this design locks
  **what** the wizard collects and the storage / pipeline shape.
- Does not specify `entities.state` discriminated-union shape. The
  initial cast is populated as `entities` rows; field-level
  composition stays parked.
- Does not specify HOW genre/tone/setting reach the prompt — that's
  injection-mechanics territory (template authorship, Liquid
  rendering, context groups) and was explicitly carved out by the
  user mid-session.
