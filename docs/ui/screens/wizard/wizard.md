# Story creation wizard

**Wireframe:** [`wizard.html`](./wizard.html) — interactive

The canonical creation path from `+ New story` to first reader
entry. Five-step linear-with-back-jump flow that authors a
complete story (definition + initial cast + initial lore +
opening) in one atomic commit.

Cross-cutting principles that govern this surface live in
[principles.md](../../principles.md). Relevant sections:

- [Mode, lead, and narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts)
  (cross-field constraint enforced at step 4 / step 5)
- [Settings architecture — split by location](../../principles.md#settings-architecture--split-by-location)
  (definitional fields wizard-authored, operational copies from
  app defaults)
- [Icon-actions pattern](../../patterns/icon-actions.md) (governs
  ✕ / ⭐-set-as-lead row affordances on the cast and lore lists)

Design rationale, alternatives explored, and adversarial findings
in [`explorations/2026-04-30-story-creation-wizard.md`](../../../explorations/2026-04-30-story-creation-wizard.md).

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [← Cancel]               New story · step N of 5             │  ← wizard chrome
├──────────────────────────────────────────────────────────────┤
│ [Frame ●] [Calendar ○] [World ○] [Cast ○] [Opening ○]        │  ← step indicator
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   {step heading: "How is this story told?" / etc.}             │
│   {step body — composition varies per step}                    │
│                                                                │
│                                                                │
│                                                                │
├──────────────────────────────────────────────────────────────┤
│ [Save as draft]                          [← Back]  [Next →]   │  ← footer
└──────────────────────────────────────────────────────────────┘
```

Full-page replacement. App's normal top-bar (Actions / Settings
gear / story breadcrumb) is hidden — wizard chrome IS the action
vocabulary.

## Top-bar shell

Wizard-specific:

- **`← Cancel`** (top-left) — returns to story-list, **preserves
  the auto-saved session** (per
  [story-list.md → Concurrent-state prompts](../story-list/story-list.md#unfinished-wizard-session-automatic-safety-net)).
  Window/tab close has identical semantics.
- **`New story · step N of 5`** centered — title with step counter.
  Replaces the usual story-title breadcrumb (no story exists yet).
- **No `Actions ⎇` menu, no `⚙` Settings gear.** Wizard isn't a
  story context, the chrome IS the action surface, and a
  near-empty Actions menu would be worse than no menu.

## Step indicator

Horizontal pill row below the top-bar:

- **Filled dot (●)** = completed step.
- **Hollow dot (○)** = pending.
- **Active step** gets accent treatment.
- **Backward-jump clickable** on completed pills.
- **Forward-jump disabled** — must advance via `Next →` (which
  validates current step).
- **Auto-save** fires on any nav (Next / Back / pill click).

Named-not-numbered: 5 steps fit comfortably; names give spatial
sense ("ah, almost done, on Opening").

## Footer

```
[Save as draft]                                [← Back]  [Next →]
```

- **`Save as draft`** — anywhere in flow. Creates `stories` row
  with `status='draft'`, clears auto-save session, returns to
  story-list. Validation does NOT gate save-as-draft.
- **`← Back`** — previous step. Hidden on step 1.
- **`Next →`** — advances on validation pass. On step 5, becomes
  **`Finish`** — fires the atomic commit.

## Save / cancel / draft semantics

| Action                | Auto-save session | `stories` row created   | Where user lands                |
| --------------------- | ----------------- | ----------------------- | ------------------------------- |
| `Next`                | updated           | no                      | next step                       |
| `← Back` / pill click | updated           | no                      | target step                     |
| `Save as draft`       | cleared           | yes (`status='draft'`)  | story-list (draft card visible) |
| `← Cancel`            | preserved         | no                      | story-list                      |
| Window/tab close      | preserved         | no                      | (n/a)                           |
| `Finish`              | cleared           | yes (`status='active'`) | reader-composer with story open |

**Auto-save session** persists only after the first meaningful
state change. Opening the wizard, glancing, and cancelling does
NOT create a session.

**Concurrent-state prompts** (session vs draft mutual exclusion)
live in [story-list.md → Unfinished wizard session](../story-list/story-list.md#unfinished-wizard-session-automatic-safety-net).
Both `+ New story` and click-a-draft trigger the same prompt
shape when a session exists.

## Step 1 — Frame

Step heading: **How is this story told?**

Two segment pickers ([Select primitive](../../patterns/forms.md#select-primitive)
in `segment` render mode):

- **Mode** — `Adventure` / `Creative`. Two-line cells: label +
  pithy explanation.
  - Adventure: "You play a character. AI runs the world."
  - Creative: "You write the prose. AI helps draft."
- **Narration** — `First` / `Second` / `Third`. Two-line cells.
  - First: `"I drew…"`
  - Second: `"You drew…"`
  - Third: `"Aria drew…"`

**Cross-field forward-pointer.** When `mode='adventure'` OR
`narration ∈ {first, second}`, an inline informational chip
appears beneath the pickers:

> ⓘ This combination will require a lead character in Cast.

Surfacing the consequence at the choice site lets users
self-correct early. Forward-pointer phrasing avoids alarmism for
what's a normal flow.

**Defaults.** `mode='creative'`, `narration='third'` — the most
permissive combination, no lead required.

**`← Back` hidden** on step 1.

**No AI-assist** — both pickers are short enumerated options.

**Future growth slot.** Image modes / HTML formatting / other
output-shape decisions land in this step when shipped, without
restructuring the wizard.

## Step 2 — Calendar

Step heading: **When does this story take place?**

The calendar picker primitive is canonical in
[`patterns/calendar-picker.md`](../../patterns/calendar-picker.md).
The wizard hosts it with:

- **Picker dropdown** + **always-visible adjacent summary panel**.
- **No `Manage calendars in Vault →` tail** (mid-wizard nav to
  Vault is out of scope).

```
Calendar system
<copy>
[picker dropdown — Earth (Gregorian) ▾]   [summary panel adjacent]

Story start moment
<copy>
{tier-derived inputs}
```

### `worldTimeOrigin` input — tier-derived

The input form is **derived from the picked calendar's `tiers[]`**.
One control per tier, top-down, in a horizontal row (wraps on
narrow viewports):

- **Tier without `labels`** → numeric input. Validates per the
  tier's `rollover` (range computed cascading from coarser tiers).
- **Tier with `labels`** → dropdown rendering the labeled values.
  Selection writes the underlying integer value into the tuple.

Examples:

| Calendar               | Inputs (top-down)                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Earth (Gregorian)      | `Year` numeric · `Month` dropdown · `Day` numeric · `Hour` numeric · `Minute` numeric · `Second` numeric |
| Shire Reckoning        | `Year` numeric · `Month` dropdown · `Day` numeric                                                        |
| Stardate               | `count` numeric                                                                                          |
| Warhammer 40K Imperial | `Millennium` numeric · `Fractional year` numeric                                                         |

Runtime reads `Tier.labels`, `Tier.startValue`, `Tier.rollover`
and renders accordingly. Wizard never hard-codes per-calendar
shapes.

**Defaults.** Initial `calendarSystemId` = `app_settings.default_calendar_id`
(copy-at-creation pattern). Initial `worldTimeOrigin` = the picked
calendar's mandatory
[`exampleStartValue`](../../../calendar-systems/spec.md#calendar-definition)
`TierTuple`.

### Calendar swap inside wizard

If user changes the calendar pick after editing the origin:

- **Disjoint tier sets** (Earth → Stardate): origin tuple resets
  to new calendar's `exampleStartValue`. Inline notice:
  `Origin reset for the new calendar.`
- **Subset match** (Earth → Shire): preserve overlapping tier
  values, drop tiers not in the new shape. No notice.
- **Superset** (Shire → Earth): preserve overlapping, fill
  missing tiers from new calendar's `exampleStartValue`.

No swap warning modal here (unlike Story Settings) — wizard's
swap is always re-pick during construction; no in-flight story
state to protect.

### Validation gate on `Next`

All required tiers must have valid values per their `rollover`
rules (e.g., day ≤ month-length for Earth Gregorian). Inline
error per-input on blur; `Next →` blocks until clean.

### No AI-assist

Origin is a specific date — AI suggestions would be guessing.

## Step 3 — World

Step heading: **What's the world like?**

Four sections, vertical scroll:

### Genre / Tone — preset + prose hybrid

```
Genre
[label input]                       [📚 Browse presets]  [✨]
[promptBody textarea — multi-paragraph]

Tone
[label input]                       [📚 Browse presets]  [✨]
[promptBody textarea]
```

Three input paths per field, all writing into `{ label, promptBody }`:

1. **Manual** — user types both directly.
2. **Browse presets** (`📚`) — opens picker popover with bundled
   presets. Each row: `displayName · 1-line tagline · preview body`
   on hover. Pick → copies to label + promptBody.
3. **AI-suggest** (`✨`) — see [AI-assist pattern](#ai-assist-pattern).
   Result is **prose** (label preview + body preview together).

**Replace-on-existing.** If the user picks a preset OR accepts an
AI-suggest while `label` or `promptBody` is non-empty, a confirm
modal fires:

```
Replace genre with "Hard sci-fi"?
Your current label and body will be lost.
                           [Cancel]  [Replace]
```

v1 safeguard against accidental loss.

### Setting — freeform

```
Setting                                              [✨]
[setting textarea — multi-paragraph freeform prose]
```

Single textarea, AI-suggest only (no preset). Same prose-result UX.

### Initial lore — list with inline editor

```
─── Initial lore ─────────  [✨ Suggest lore]  [+ Add lore]

┌─ Magic systems ─────────────────────────────────┐  ✕
│ Magic flows from sealed wells across the realm…│
│ category: cosmology · keyword_llm              │
└─────────────────────────────────────────────────┘

┌─ The Old Empire ────────────────────────────────┐  ✕
│ A thousand years ago, the Empire ruled most of…│
└─────────────────────────────────────────────────┘
```

Per-row compact view: title + truncated body + non-default chips.
Click expands to inline editor:

```
Title           [_____________________________]
Body            [textarea, multi-paragraph]
Category        [_____________________________]

▼ More options
  Tags           [chip input]
  Injection mode [keyword_llm ▾]
  Priority       [0]
```

Defaults sensible (`keyword_llm`, priority `0`, no tags / category).
80%+ skip the disclosure.

**Long scroll** — no pagination chrome on the lore list, per the
[lists pattern](../../patterns/lists.md). Virtualization, if it
bites at high counts, lands via the existing
[virtual-list followup](../../../followups.md#virtual-list-library-choice).

### Validation gates on `Next`

- `genre.label`, `setting`: encouraged, **not** gated.
- Lore rows present must have `title` + `body` non-empty (per the
  [lore detail-pane decision](../../../explorations/2026-04-30-lore-detail-pane.md)).
  Empty rows surface inline errors.

## Step 4 — Cast

Step heading: **Who's in this story?**

Mixed list of entities (characters / locations / items / factions),
insertion-ordered, kind-iconed per
[`patterns/entity.md`](../../patterns/entity.md). Long scroll.

```
[lead-required notice if applicable]

                          [✨ Suggest cast]   [+ Add ▾]

[entity rows…]
```

### Add affordances

- **`✨ Suggest cast`** — AI-assist → list result (paginated,
  default 5 mixed across kinds). Guidance steers ("more
  characters", "fantasy nobility roles"). Cross-batch references
  (location's `parent_location_name`, character's faction)
  resolve at import time by name.
- **`+ Add ▾`** — dropdown of `Character / Location / Item /
Faction`. Click → blank row appended in expanded edit state.

### Compact row presentation

```
[👤] Aria Stoneheart  ⭐ lead                          ✕
A young blacksmith from a fallen kingdom…

[👤] Old Jorin                                          ✕
The grizzled barkeeper of the Iron Tankard…
                                       [⭐ Set as lead]

[📍] Mornstone Keep                                     ✕
The fortified seat of House Aerwyn…

[👤] Gandalf  STAGED                                    ✕
A wandering wizard, gray of cloak and white of beard…
```

- Kind icon + name + chips (`⭐ lead` / `STAGED` non-default).
- Truncated description.
- `⭐ Set as lead` button on character rows when no other
  character is the lead AND status is `active`.
- `STAGED` chip + muted row content for staged entities.
- `✕` deletes (no confirm — wizard-time, no entries depend yet).

Click row → expand to inline editor.

### Character editor

```
Name        [_________________________________]  [Active ▾]
Description [textarea — user-authoritative who]

Voice       [optional, e.g. "clipped, formal"]
Traits      [chip input — soft cap 8]
Drives      [chip input — soft cap 6]

▼ Visual
  Physique       [_____________________________]
  Face           [_____________________________]
  Hair           [_____________________________]
  Eyes           [_____________________________]
  Attire         [_____________________________]
  Distinguishing [chip input]

▼ More options
  Tags          [chip input]
  Faction       [pick from cast ▾]

⭐ Set as lead   (button outside disclosure, character-only,
                 visible when no other character is the lead
                 AND status='active')
```

Maps to [`CharacterState`](../../../data-model.md#characterstate-shape).

**Tier rationale:**

- **Always-visible identity** (`Voice` / `Traits` / `Drives`) —
  personality essentials, compact. Wizard-authored values seed
  `CharacterState` at first-write per the
  [authorship contract](../../../data-model.md#authorship-contract);
  classifier extracts incrementally at runtime.
- **`▼ Visual` disclosure** — six sub-fields would dwarf the editor
  expanded. Defaulted closed.
- **`▼ More options`** — tags + faction. Faction picker reads
  currently-authored factions in the wizard's cast list;
  `(no factions yet — add one with + Add)` empty state when none
  exist. `null` = unaffiliated.

**Not in wizard editor** (per the authorship contract,
classifier-managed per-turn): `current_location_id`,
`equipped_items`, `inventory`, `stackables`, `lastSeenAt`. All
dynamic, populated by classifier once narrative starts.

### Location editor

```
Name        [_________________________________]  [Active ▾]
Description [textarea]

▼ More options
  Tags             [chip input]
  Parent location  [pick from cast ▾]
  Condition        [_____________________________]
```

Maps to [`LocationState`](../../../data-model.md#locationstate-shape).
`parent_location_id` enables containment hierarchy at creation;
picker reads currently-authored locations only.

### Item editor

```
Name        [_________________________________]  [Active ▾]
Description [textarea]

▼ More options
  Tags         [chip input]
  Condition    [_____________________________]
```

Maps to [`ItemState`](../../../data-model.md#itemstate-shape).
`at_location_id` excluded — per-turn classifier-managed.

### Faction editor

```
Name        [_________________________________]  [Active ▾]
Description [textarea]
Agenda      [chip input — soft cap 4]

▼ More options
  Tags        [chip input]
  Standing    [_____________________________]
```

Maps to [`FactionState`](../../../data-model.md#factionstate-shape).
`agenda` is identity-shaped (always visible); `standing` is
dynamic-state (under More options).

### Status field — `active` / `staged`

Default `active`. User can flip to `staged` for entities-not-yet-
introduced — particularly useful for IP-based stories where the
cast roster is known but only some enter the opening scene.
`retired` not reachable at wizard time.

**Cascading behaviors:**

- **Lead requires `status='active'`.** A staged character can't
  be the protagonist. `⭐ Set as lead` button hidden on
  staged-character rows. Marking the current lead as staged
  auto-unmarks lead with toast: `Lead unset — staged characters
can't be lead.`
- **Lead-required gate tightens** — "at least one **active**
  character marked as lead." Staged characters don't satisfy.
- **Opening generation enum-list filters to active.** Wizard-assist's
  structured-output schema for opening generation passes only
  `status='active'` cast as the enum for `sceneEntities`. Staged
  characters can't appear in opening scene metadata.
- **Stage promotion is classifier-per-turn.** When prose introduces
  a staged entity (it appears in `metadata.sceneEntities` of a
  new entry), the classifier promotes status `staged` → `active`
  on the spot. Lore-mgmt at chapter close handles compaction
  (traits / drives consolidation), not lifecycle.

### AI-suggest — structured identity

`✨ Suggest cast` returns structured output per kind:

```ts
{
  entities: Array<
    | {
        kind: 'character'
        name
        description
        status?: 'active' | 'staged'
        voice?
        traits?
        drives?
        visual?: { physique?; face?; hair?; eyes?; attire?; distinguishing? }
      }
    | {
        kind: 'location'
        name
        description
        status?: 'active' | 'staged'
        parent_location_name?
        condition?
      }
    | { kind: 'item'; name; description; status?: 'active' | 'staged'; condition? }
    | { kind: 'faction'; name; description; status?: 'active' | 'staged'; agenda?; standing? }
  >
}
```

`status` defaults to `'active'` when omitted. Guidance can drive
staged outputs (`"6 characters; 2 introduced later"` → 4 active +
2 staged).

Cross-batch reference resolution: location's
`parent_location_name` resolves at import time to entity ids
(matching by name within the suggested batch + existing cast);
unresolved fall back to `null`.

### Lead-required gating

- **Trigger** (set in step 1): `mode='adventure'` OR
  `narration ∈ {first, second}`.
- **Inline notice** at top of step when triggered AND no active
  character marked lead. Copy varies by reason.
- **`Next →` validation** blocks until satisfied when required.
- **Cascading from back-jump.** If user revisits step 1 and
  changes mode/narration, step 4's pill demotes from `✓` to `○`
  if the new rule isn't satisfied.

### Validation gates on `Next` (Cast)

- Each row: `name` non-empty.
- Lead requirement satisfied iff applicable.
- Otherwise no blocks; cast can be empty for creative + third.

## Step 5 — Opening & finish

Step heading: **How does this story begin?**

Two halves on one scrolling step: opening prose authoring, then
identity inputs, then `Finish`.

### Opening surface — three states

#### Empty (initial)

```
Generate with ✨, or start typing below.
[textarea — empty]
```

#### AI-generated preview (after `✨` → guidance → Generate)

```
Suggested opening
[scrollable prose preview]

Scene metadata:
  Cast in scene: Aria Stoneheart
  Location: Mornstone Keep

[Discard] [Refine…] [Regenerate] [Use this]
```

The metadata block surfaces structured-output refs
(`sceneEntities`, `currentLocationId`) emitted by wizard-assist,
resolved to entity names. Read-only — generation owns the refs.
Constrained to **active** wizard-curated cast; prose can mention
unbacked or staged names freely.

#### Committed prose (after `Use this` OR after manual typing)

```
Opening                                            [✨]

[textarea, editable, contains the prose]

Scene metadata: Aria Stoneheart · Mornstone Keep
  (visible only if AI-generated; user-written = empty)
```

User edits prose freely after committing. Editing AI-generated
prose does **not** clear metadata refs — refs stay intact (user
might tweak prose without invalidating cast/location grounding).
For fresh metadata, user regenerates via `✨`.

`✨` button stays available in committed state — regenerate /
refine entry point. Click on existing committed prose →
confirm-on-replace if non-empty (consistent with genre/tone
replace pattern).

### AI-assist for opening — structured output

Wizard-assist emits:

```ts
{
  prose: string,
  sceneEntities: string[],          // subset of active cast entity ids
  currentLocationId: string | null, // one of the active location ids
  worldTime: 0                      // story start; always 0
}
```

Standard `Discard / Refine / Regenerate / Use this` actions.
Failure path: inline error in popover. On malformed structured
output, the implementation falls back to treating the prose as
user-written (empty `sceneEntities` / `currentLocationId`); turn-2
classifier picks up scene metadata from there. The data shape
(per [`data-model.md → Opening entry`](../../../data-model.md#opening-entry))
already accommodates both populated and empty metadata without
ceremony.

### Title + description — inlined below opening

```
─── Story name ───                                     [✨]
Title       [_________________________________]
Description [_________________________________]
```

Both have AI-suggest:

- **Title** — chips result. Wizard-assist generates 5–10 candidate
  titles. Click chip to fill. `Regenerate` for fresh batch.
- **Description** — prose result (short). 1–3 sentences synthesizing
  the story.

Both calls fire from this step → see EVERYTHING (mode/narration/
calendar/genre/tone/setting/lore/cast/opening). Resolves the
"title generation with no prior data" concern that drove placing
identity at the end.

### Validation gate on `Finish`

- Opening prose non-empty.
- `title` non-empty.
- Lead-character constraint satisfied (re-checked from step 4).
- `description` optional (library card has muted "(no description
  yet)" fallback).

### What `Finish` does — atomic commit

One SQLite transaction, all or none:

1. Insert `stories` row with `status='active'`, `definition` JSON,
   `settings` JSON copied from
   `app_settings.default_story_settings`, identity columns.
2. Insert initial `branches` row.
3. Insert wizard-authored `entities` rows (initial cast). Per-row:
   `kind`, `name`, `description`, `status`, `state` JSON.
4. Insert wizard-authored `lore` rows (initial world).
5. Insert `story_entries[1]` with `kind='opening'`, prose,
   metadata. `metadata.model = <wizard-assist profile model>` if
   AI-generated; else `null`.
6. **No deltas written.** Per
   [baseline doc decision 10](../../../explorations/2026-04-29-story-definition-baseline.md),
   wizard creation is delta-log-exempt.
7. Clear the auto-saved session.
8. Route to reader-composer with the story open.

If any step fails, transaction rolls back; user remains on step 5
with an inline error.

## AI-assist pattern

The unifying primitive across every wizard AI call site. Backed
by the [`wizard-assist` agent](../../../data-model.md#app-settings-storage).

### Trigger

Inline `✨` icon-button at the field's label/control area. Always
visible; opt-in. Coexists with manual entry.

### Guidance popover

```
✨ Suggest setting

Optional guidance
[_______________________]
e.g. "Norse-flavored, post-apocalypse"

   [Cancel]  [Generate]
```

Empty guidance allowed. Soft cap ~200 chars on the input.

### Loading

Popover swaps to spinner showing the wizard-assist profile's
active model name. Cancellable.

### Result presentation — three shapes

| Shape     | Where                                                | Preview UI                                                            | Actions                                                  |
| --------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **Prose** | genre body, tone body, setting, description, opening | Read-only preview pane                                                | `Discard / Refine… / Regenerate / Use this`              |
| **List**  | cast suggestions, lore suggestions                   | Per-row checkboxes on condensed cards; pagination via `Generate more` | `Discard / Regenerate / Generate more / Import selected` |
| **Chips** | title suggestions                                    | 5–10 clickable label chips                                            | Click to pick; `Regenerate`; `Discard`                   |

### Refine — prose-result only

Fourth action button on prose preview opens an iteration popover:

```
✨ Refine setting

How should this change?
[_______________________]
e.g. "make it darker"

   [Cancel]  [Refine]
```

Cumulative — user can refine multiple times. Each refine is its
own wizard-assist call with current preview + refinement
instructions. Refine doesn't apply to list or chips
(`Regenerate` suffices).

### Failure

Inline error in the popover: `Couldn't generate. <reason>.
[Try again] [Cancel]`. No silent failure.

### No provider configured

Click-time check; popover shows `AI is not configured.
[Set up in Settings] [Cancel]`. Doesn't block manual wizard
completion.

### Cost

Each generation, regenerate, and refine call costs tokens.
**No metering, no caps** — cost is on the user. UI doesn't
surface per-call cost.

### Pagination on list results

`Generate more` after import preserves already-imported rows;
case-insensitive name dedupe applies (collisions show
`(already exists)` muted; checkbox auto-disabled).

### Context-shaping

Each call's prompt context is built from **current wizard state at
call time**. Quality compounds as the wizard progresses; by step
5, calls see everything (mode/narration/calendar/genre/tone/
setting/lore/cast/opening).

## Trigger inventory

| Step     | Field                  | Trigger | Result shape               |
| -------- | ---------------------- | ------- | -------------------------- |
| Frame    | `mode`, `narration`    | —       | —                          |
| Calendar | picker, origin         | —       | —                          |
| World    | `genre` (label + body) | yes     | prose                      |
| World    | `tone` (label + body)  | yes     | prose                      |
| World    | `setting`              | yes     | prose                      |
| World    | lore rows              | yes     | list                       |
| Cast     | entity rows            | yes     | list                       |
| Cast     | `leadEntityId`         | —       | —                          |
| Opening  | opening prose          | yes     | prose (with metadata refs) |
| Opening  | `title`                | yes     | chips                      |
| Opening  | `description`          | yes     | prose (short)              |

## Edge cases

- **Empty session.** Wizard opens, user touches nothing,
  cancels — no session persists, no resume prompt fires next time.
- **Concurrent draft + session.** Mutually exclusive; user
  resolves via the [concurrent-state prompts](../story-list/story-list.md#unfinished-wizard-session-automatic-safety-net).
- **Mode/narration change via back-jump that adds the lead
  requirement.** Step 4's pill demotes; user walks forward to
  satisfy.
- **AI-assist call mid-flight on Cancel.** Call cancels; session
  preserves at last committed state.
- **Save-as-draft with no title.** Draft card renders
  `Untitled story` placeholder; rename when resumed.
- **Replace-on-existing on genre/tone.** Confirm modal fires when
  preset OR AI-suggest accept would overwrite non-empty content.
- **Lead unset cascade.** Multiple paths can unmark lead (kind
  change, status flip to staged, row deletion). Same toast copy
  ("Lead unset — ...") on each.

## Data-model touchpoints

- Wizard's atomic transaction populates `stories`, `branches`,
  `entities`, `lore`, `story_entries[1]` per
  [data-model.md → World-state storage](../../../data-model.md#world-state-storage)
  - [Story settings shape](../../../data-model.md#story-settings-shape).
- `wizard-assist` agent in the
  [agent registry](../../../data-model.md#app-settings-storage),
  seeded by [onboarding](../onboarding/onboarding.md#what-gets-seeded-silently).
- `CalendarSystem.exampleStartValue` (mandatory; per
  [calendar-systems/spec.md](../../../calendar-systems/spec.md#calendar-definition))
  seeds the step-2 origin tuple.

## Screen-specific open questions

Tracked centrally:

- **Wizard-assist agent profile splitting** — see
  [parked.md](../../../parked.md#wizard-assist-agent-profile-splitting).
- **Concurrent-state prompt third button** — see
  [parked.md](../../../parked.md#wizard-concurrent-state-prompt-third-button).
- **Step 3-4 long-list ergonomics** (reorder / section-collapse /
  per-kind grouping) — see
  [parked.md](../../../parked.md#wizard-step-3-4-long-list-ergonomics).
- **Wizard session storage cleanup** — see
  [parked.md](../../../parked.md#wizard-session-storage-cleanup).
- **Wizard-time pack selection** — see
  [parked.md](../../../parked.md#wizard-time-pack-selection).
- **Chip input vs comma-separated string** — see
  [parked.md](../../../parked.md#chip-input-vs-comma-separated-string).
- **Optional user-side scene tagging on user-written openings** —
  see [parked.md](../../../parked.md#optional-user-side-scene-tagging-on-user-written-openings).
- **Regenerate-opening from reader chrome** (post-commit) — see
  [parked.md](../../../parked.md#regenerate-opening-affordance--post-commit-from-reader-chrome).
- **Classifier-on-opening retrofit** — see
  [parked.md](../../../parked.md#classifier-on-opening-retrofit).
