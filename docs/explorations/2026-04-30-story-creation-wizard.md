# Story creation wizard

Spec for the Story creation wizard — the canonical creation path
from `+ New story` to first reader entry. Resolves the
[`Story creation wizard` UI inventory entry](../ui/README.md#screens)
(currently `pending`), the
[`Wizard worldTimeOrigin input UX per calendar`](../calendar-systems/spec.md#open-questions)
calendar-systems open question, and the
[`Calendar picker — wizard slot worldTimeOrigin`](../ui/patterns/calendar-picker.md#wizard--calendar-selection-slot)
deferral.

Lays down: chrome (full-page replacement, top-bar + step indicator

- footer), the `wizard-assist` agent + AI-assist pattern, 5-step
  grouping, per-step composition, save / cancel / draft semantics,
  the wizard's atomic commit transaction.

## Background

Today's wizard surface doesn't exist — `+ New story` is a stub. The
data shape it needs to author is settled in
[`2026-04-29-story-definition-baseline.md`](./2026-04-29-story-definition-baseline.md)
(definition / settings split, genre+tone preset+prose, setting
freeform, opening as `story_entries[1]` with `kind='opening'`,
atomic transaction exempt from delta log). The calendar picker slot
is settled in
[`2026-04-28-calendar-picker.md`](./2026-04-28-calendar-picker.md)
(picker render mode + summary panel + Vault tail hidden in wizard).
The `entities.state` shape is settled in
[`2026-04-29-entities-state-shape.md`](./2026-04-29-entities-state-shape.md)
(per-kind discriminated union; user-via-form is a valid first-write
path). The drafts pattern (auto-saved session + explicit
`status='draft'` rows) is settled in
[`story-list.md`](../ui/screens/story-list/story-list.md#drafts--wizard-session--explicit-draft).

What's still open and this design owns:

- **Chrome** — full-page replacement, top-bar shell, step indicator,
  footer, navigation (linear-with-back-jump), cancel/save/draft
  semantics, concurrent-state prompts.
- **AI-assist pattern** — the `wizard-assist` agent, trigger UI,
  guidance popover, three result shapes (prose / list / chips),
  refine flow, cost-on-user, pagination on lists.
- **5-step grouping** — Frame, Calendar, World, Cast, Opening &
  finish. Per-step composition for each.
- **`worldTimeOrigin` input UX per calendar** — derived from the
  picked calendar's `tiers[]` definition.
- **`CalendarSystem.exampleStartValue` field** — mandatory addition
  to the calendar definition shape; seeds the wizard's default
  origin tuple.

## Scope

**In:**

- Wizard chrome and navigation.
- The `wizard-assist` agent + AI-assist trigger pattern.
- Per-step composition for all 5 steps.
- `worldTimeOrigin` per-calendar input UX.
- `CalendarSystem.exampleStartValue` data-model addition.
- Atomic commit transaction shape.
- Cancel / save-as-draft / discard flow + concurrent-state prompts.

**Adjacent (cited, not redesigned):**

- Calendar picker primitive ([already designed](../ui/patterns/calendar-picker.md)).
- Drafts auto-save session + draft-row pattern ([already designed in story-list.md](../ui/screens/story-list/story-list.md#drafts--wizard-session--explicit-draft)).
- Story `definition` JSON shape and opening-as-entry-1 contract
  ([already designed in baseline](./2026-04-29-story-definition-baseline.md)).
- `entities.state` shape and authorship contract
  ([already designed](./2026-04-29-entities-state-shape.md)).
- Lore detail-pane composition (visible in World panel post-creation;
  wizard-time editing is a simpler subset).

**Out of scope:**

- Story Settings · About edit surface for tags / accent_color /
  author_notes (those are deferred from wizard entirely; users add
  later).
- Cover / asset gallery (asset-gallery surface is post-v1).
- Pack selection at wizard time (operational config copies from app
  defaults).
- Reader-composer routing post-Finish (already designed).

## Decisions

### 1. Full-page replacement chrome

The wizard takes over the viewport. App's normal top-bar (Actions /
Settings gear / story breadcrumb) is replaced by a wizard-specific
shell:

```
[← Cancel]               New story · step N of 5
```

Centered title + step counter; `← Cancel` left-aligned. **No Actions
menu, no Settings gear** — wizard is its own surface, the chrome IS
the action vocabulary, and a near-empty Actions menu would be worse
than no menu. Cmd/Ctrl-K muscle memory loss is the cost; acceptable.

Why full-page over modal-on-dim or routed view: modal feels
claustrophobic for a substantive multi-step flow with prose fields
and previewable opening output; routed view tempts mid-flow
navigation that fights the single-active-session pattern. Full-page
gives breathing room while preserving "wizard is its own thing."

### 2. Step indicator — named pills, hybrid navigation

Below the top-bar:

```
[Frame ●] [Calendar ○] [World ○] [Cast ○] [Opening ○]
```

- **Filled dot** = completed step.
- **Hollow dot** = pending.
- **Active step** gets accent treatment (separate from the dot).
- **Backward-jump** clickable on completed pills.
- **Forward-jump** disabled — must advance via `Next →` (which
  validates current step).
- **Auto-save** fires on any nav (Next / Back / pill click).

Named-not-numbered: 5 steps fit comfortably; names give spatial
sense ("ah, almost done, on Opening").

### 3. Footer — Save as draft + Back/Next + Finish

```
[Save as draft]                          [← Back]  [Next →]
```

- **`Save as draft`** anywhere in the flow. Creates a `stories` row
  with `status='draft'`, clears the auto-save session, returns to
  story-list with the draft card visible. Validation does NOT gate
  save-as-draft — drafts allow incomplete state; missing title
  defaults to `Untitled story`.
- **`← Back`** previous step. Hidden on step 1.
- **`Next →`** advances on validation pass. On step 5, becomes
  **`Finish`** — fires the atomic commit transaction (decision 14).

### 4. Cancel / save-as-draft / session matrix

| Action                | Auto-save session | `stories` row created   | Where user lands                |
| --------------------- | ----------------- | ----------------------- | ------------------------------- |
| `Next`                | updated           | no                      | next step                       |
| `← Back` / pill click | updated           | no                      | target step                     |
| `Save as draft`       | cleared           | yes (`status='draft'`)  | story-list (draft card visible) |
| `← Cancel`            | preserved         | no                      | story-list                      |
| Window/tab close      | preserved         | no                      | (n/a)                           |
| `Finish`              | cleared           | yes (`status='active'`) | reader-composer with story open |

The auto-save session and explicit drafts are **two separate
concepts** (per
[story-list.md → Drafts](../ui/screens/story-list/story-list.md#drafts--wizard-session--explicit-draft)):

- **Session** = transient, anonymous, auto-managed, single-instance.
- **Draft** = persistent `stories` row, named (or `Untitled story`),
  explicit, multi-instance.

The only bridge is `Save as draft` (session → new draft row).

**Implementation note:** persist the session only after the first
meaningful state change. Otherwise a user who opens the wizard,
glances at it, and cancels gets a "Continue unfinished session?"
prompt next time with literally nothing in it. The trigger is any
field commit — `Next` from step 1 with defaults DOES count as
"meaningful" because the user explicitly chose to proceed.

### 5. Concurrent-state prompts

Two trigger paths fire the same prompt shape when an auto-save
session exists:

| Trigger from story-list | Session exists? | Behavior                                                                                                                                             |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+ New story`           | no              | wizard opens fresh                                                                                                                                   |
| `+ New story`           | yes             | prompt → `[Continue]` (resume session) / `[Discard session & start fresh]` (discard, open fresh wizard)                                              |
| Click draft card        | no              | wizard opens with draft pre-populated                                                                                                                |
| Click draft card        | yes             | prompt → `[Continue session]` (resume session, draft click no-ops) / `[Discard session & open <DraftName>]` (discard session, open the picked draft) |

**Destructive labeling.** Both prompts have explicit `Discard
session` copy in the destructive button. The prompt text reinforces
that the session will be lost. Users with valuable in-flight state
who realize mid-prompt can dismiss → return to the wizard via
`+ New story` (re-fires the prompt → `Continue`) → save-as-draft
explicitly → re-trigger their original click.

A **third button** (`Save session as draft and continue with X`) is
deferred to v2 — captured as a [followup](../followups.md). The
two-button + destructive-labeling shape is the v1 floor; signal-
driven addition if users report losing work.

### 6. The `wizard-assist` agent

A new entry in the [agent registry](../data-model.md#app-settings-storage),
distinct from `narrative` / `classifier` / `lore-mgmt`. **All wizard
AI calls route through it** — title chips, description prose, genre
prose, tone prose, setting prose, lore list, cast list, opening
prose with structured metadata.

Onboarding's silent-assignment matrix gains `wizard-assist → <profile>`
seed (default: `Fast tasks` profile). Users can re-assign via App
Settings · Profiles like any other agent.

**v1 trade-off:** one agent + one assigned profile means one model
serves both 5-token title chip generation AND 800-word opening
structured-output prose. Profile tuning is the single lever; if
output quality varies pathologically, the architecture supports
splitting into `wizard-assist-light` / `wizard-assist-prose` later.
Captured as a [followup](../followups.md). v1 ships single-agent.

### 7. AI-assist pattern — trigger + guidance + result + refine

The unifying primitive across all wizard AI call sites:

**Trigger.** Inline `✨` icon-button at the field's label/control
area. Always visible; opt-in. Coexists with manual entry.

**Guidance popover.** Click → small popover anchored to the trigger:

```
✨ Suggest setting

Optional guidance
[_______________________]
e.g. "Norse-flavored, post-apocalypse"

   [Cancel]  [Generate]
```

Empty guidance allowed; default behavior is "use whatever wizard
context you have." Soft cap ~200 chars.

**Loading.** Popover swaps to spinner showing the wizard-assist
profile's active model name. Cancellable.

**Result presentation.** Three result shapes by trigger:

| Shape     | Examples                                             | Preview UI                                                            | Actions                                                  |
| --------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **Prose** | genre body, tone body, setting, description, opening | Read-only preview pane                                                | `Discard / Refine… / Regenerate / Use this`              |
| **List**  | cast suggestions, lore suggestions                   | Per-row checkboxes on condensed cards; pagination via `Generate more` | `Discard / Regenerate / Generate more / Import selected` |
| **Chips** | title suggestions                                    | 5–10 clickable label chips                                            | Click to pick; `Regenerate`; `Discard`                   |

**Refine** (prose-result only). Fourth action button on prose
preview opens an iteration-framed popover:

```
✨ Refine setting

How should this change?
[_______________________]
e.g. "make it darker"

   [Cancel]  [Refine]
```

Cumulative — user can refine multiple times. Each refine is its own
wizard-assist call; current preview + refinement instructions →
new preview. Refine doesn't apply to list or chips (`Regenerate`
suffices for those).

**Failure.** Inline error in the popover: `Couldn't generate.
<reason>. [Try again] [Cancel]`. No silent failure.

**Provider not configured.** Click-time check; popover shows
`AI is not configured. [Set up in Settings] [Cancel]`. Doesn't
block manual wizard completion.

**Cost.** Each generation, regenerate, and refine call costs
tokens. **No metering, no caps** — cost is on the user. UI doesn't
surface per-call cost (would be noisy + provider-dependent).

**Pagination on list results.** `Generate more` after import
preserves already-imported rows; same dedupe rule (case-insensitive
name match) applies.

**Context-shaping rule.** Each call's prompt context is built from
**current wizard state at call time**. By step 5, calls see
everything (mode/narration/calendar/genre/tone/setting/lore/cast/
opening). Quality compounds as the wizard progresses.

### 8. Five-step grouping

| #   | Step                 | Holds                                                                                           |
| --- | -------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **Frame**            | `mode`, `narration` (today; future: image modes, HTML formatting)                               |
| 2   | **Calendar**         | `calendarSystemId` + `worldTimeOrigin` (picker + summary + start moment)                        |
| 3   | **World**            | `genre`, `tone`, `setting`, initial `lore` rows                                                 |
| 4   | **Cast**             | initial `entities` rows + lead picker                                                           |
| 5   | **Opening & finish** | opening prose (AI-generate / refine / regenerate / manual) + `title` + `description` + `Finish` |

**Identity at the end** (title + description inlined into step 5,
not a separate Identity step) — so the opening prose stays visible
while the user names the story and AI-suggest sees full context.

**Frame future-proofing** — narration is one field today; image
modes / HTML formatting land in this step when shipped, without
restructure.

### 9. Step 1 — Frame

Two segment pickers, prominent treatment.

```
Mode
[ Adventure | Creative ]
  You play           You write the prose
  a character        AI helps draft
  AI runs world

Narration
[ First | Second | Third ]
  "I drew…"  "You drew…"  "Aria drew…"
```

Two-line segment cells: label + pithy explanation. Self-documenting;
no separate explainer block per option.

**Defaults.** `mode='creative'`, `narration='third'`. Most permissive
combination — no lead required by either rule. User who hits Next
without touching anything ends up with a valid frame.

**Cross-field forward-pointer.** When `mode='adventure'` OR
`narration ∈ {first, second}`, an inline informational chip appears:

> ⓘ This combination will require a lead character in Cast.

Surfacing the consequence at the choice site (rather than only at
enforcement on step 4) lets users self-correct early. Phrasing as
forward-pointer (`will require`) rather than warning (`requires`)
avoids alarmism for what's a normal flow path.

**`← Back` hidden on step 1.** Cleaner than disabled-grey.

**No AI-assist on this step** — both pickers are short enumerated
options with no prose to suggest.

**Future growth slot.** When image modes / HTML formatting land,
they slot in as additional sections below Narration. The "How is
this story told?" step heading already covers them all. The step
name `Frame` accommodates structural-frame-of-the-story decisions
broadly.

### 10. Step 2 — Calendar

Picker primitive is canonical in
[`patterns/calendar-picker.md`](../ui/patterns/calendar-picker.md);
the wizard slot was already half-spec'd there.

This step settles the **`worldTimeOrigin` input UX** that the
picker pattern deferred to "the wizard pass."

**Input shape — derived from `tiers[]`.** One control per tier,
top-down, in a horizontal row (wraps on narrow viewports):

- **Tier without `labels`** → numeric input. Validates per the
  tier's `rollover` (range computed cascading from coarser tiers).
- **Tier with `labels`** → dropdown rendering the labeled values
  (months named, custom-cycle names, etc.). Selection writes the
  underlying integer value into the tuple.

Examples:

| Calendar               | Inputs (top-down)                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Earth (Gregorian)      | `Year` numeric · `Month` dropdown · `Day` numeric · `Hour` numeric · `Minute` numeric · `Second` numeric |
| Shire Reckoning        | `Year` numeric · `Month` dropdown · `Day` numeric                                                        |
| Stardate               | `count` numeric                                                                                          |
| Warhammer 40K Imperial | `Millennium` numeric · `Fractional year` numeric                                                         |

Runtime reads `Tier.labels`, `Tier.startValue`, `Tier.rollover` and
renders accordingly. Wizard never hard-codes per-calendar shapes.

**Defaults.** Initial `calendarSystemId` = `app_settings.default_calendar_id`
(copy-at-creation). Initial `worldTimeOrigin` = the picked calendar's
**`exampleStartValue`** (decision 11 below). User edits freely.

**Calendar swap inside wizard** (e.g., user picks Earth, sets
origin, switches to Stardate):

- **Disjoint tier sets** (Earth → Stardate): origin tuple resets
  to new calendar's `exampleStartValue`. Inline notice:
  `Origin reset for the new calendar.`
- **Subset match** (Earth → Shire): preserve overlapping tier values
  (year/month/day), drop hour/minute/second. No notice.
- **Superset** (Shire → Earth): preserve overlapping, fill missing
  tiers from new calendar's `exampleStartValue`.

No swap warning modal here (unlike Story Settings) — wizard's swap
is always re-pick during construction; no in-flight story state to
protect.

**Validation gate on `Next`:** all required tiers must have valid
values per their `rollover` rules. Inline error per-input on blur;
`Next →` blocks until clean.

**No AI-assist on this step.** Origin is a specific date — AI
suggestion would be guessing. Genre/tone/setting that would inform
date suggestions don't land until step 3.

### 11. `CalendarSystem.exampleStartValue` — mandatory new field

Adds a required field to the `CalendarSystem` shape:

```ts
type CalendarSystem = {
  id: string
  displayName: string
  baseUnit: string
  secondsPerBaseUnit: number
  tiers: Tier[]
  exampleStartValue: TierTuple // NEW — sensible default origin for new stories
  displayFormat: string
  eras: EraDeclaration | null
}
```

`Tier.startValue` semantics clarified: "where the tier counter
starts" (typical 0 or 1) — NOT a sensible per-story default. The
two concepts diverged because:

- `startValue` is a **structural** property of the tier (e.g., Earth
  months start at 1, not 0). Necessary for rollover math.
- `exampleStartValue` is a **narrative** property of the calendar
  (e.g., Earth stories typically start in modern times, so
  `{year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0}`
  is a sensible seed). Authoring concern.

**Built-ins** (currently just `earth-gregorian`) ship with their
`exampleStartValue` declared in JSON.

**Vault calendar editor** (already designed at
[`screens/vault/calendars/`](../ui/screens/vault/calendars/calendars.md))
must require `exampleStartValue` at save — user-authored calendars
can't ship without it. Editor adds an
`Example start value (for new stories)` field.

### 12. Step 3 — World

Four sections: Genre, Tone, Setting, Initial lore.

**Genre and Tone — preset+prose hybrid.** Three input paths per
field, all writing into `{ label, promptBody }`:

1. **Manual** — user types both directly.
2. **Browse presets** (`📚`) — opens a popover with bundled presets;
   pick → `displayName` copies to `label`, `promptBody` copies to
   `promptBody`.
3. **AI-suggest** (`✨`) — guidance popover → result is **prose**
   (label preview + body preview together). Standard prose actions:
   `Discard / Refine / Regenerate / Use this`.

**Replace-on-existing.** If the user picks a preset OR accepts an
AI-suggest while `label` or `promptBody` is non-empty, a confirm
modal fires:

```
Replace genre with "Hard sci-fi"?
Your current label and body will be lost.
                        [Cancel]  [Replace]
```

v1 safeguard against accidental loss; remove if it proves noisy.

**Setting — freeform.** Single textarea, AI-suggest only (no
preset). Same prose result UX.

**Initial lore — list with inline editor.** Section header carries
two affordances:

- `✨ Suggest lore` — AI-assist → list result (paginated, default
  5 rows). Per-row checkboxes on condensed cards (title + truncated
  body + category chip). Actions: `Discard / Regenerate / Generate
more / Import selected`. Imported rows append.
- `+ Add lore` — creates a blank row in expanded edit state at the
  bottom.

**Row shape (compact view):**

```
{title}                                                ✕
{body, truncated to ~2 lines}
{if non-default: category · injection_mode chip}
```

Click → expands to inline editor:

```
Title           [_________________________]
Body            [textarea, multi-paragraph]
Category        [_________________________]
▼ More options
  Tags           [chip input]
  Injection mode [keyword_llm ▾]
  Priority       [0]
```

Defaults are sensible (`keyword_llm`, priority `0`, no tags, no
category). 80%+ of users skip the disclosure.

**Long scroll.** No pagination chrome on the lore list — typical
wizard counts are 0–5 rows; scroll handles the edge case (20+).
Virtualization, if it bites, lands via the existing
[virtual-list followup](../followups.md#virtual-list-library-choice).

**Validation:** any lore rows present must have `title` + `body`
non-empty (per
[2026-04-30 lore detail-pane decision 7](./2026-04-30-lore-detail-pane.md)).
Empty rows surface inline errors on `Next`.

**`Next` gate (overall step 3):** none required strictly. `genre.label`
and `setting` are encouraged but don't block — story works (poorly)
without. Lore rows must validate if present.

### 13. Step 4 — Cast

Most semantically rich step. Mixed-list of entities (characters /
locations / items / factions), insertion-ordered, kind-iconed per
[`patterns/entity.md`](../ui/patterns/entity.md). Long scroll.

**Add affordances:**

- `✨ Suggest cast` — AI-assist → list result (paginated, default
  5 rows mixed across kinds). Guidance steers ("more characters",
  "fantasy nobility roles"). Cross-kind references (location's
  `parent_location_name`, character's faction) resolve at import
  time by name within the suggested batch + existing cast.
- `+ Add ▾` — dropdown of `Character / Location / Item / Faction`.
  Click → blank row appended in expanded edit state.

**Per-kind row editors surface `entities.state` identity fields**
(per the
[authorship contract](../data-model.md#authorship-contract): user
via form is a valid first-write path for `visual.*`, `traits`,
`drives`, `voice`, `parent_location_id`, `condition`, `standing`,
`agenda`).

#### Character editor

```
Name        [______________________________]  [Active ▾]
Description [textarea — user-authoritative who]

Voice       [optional, e.g. "clipped, formal"]
Traits      [chip input — soft cap 8]
Drives      [chip input — soft cap 6]

▼ Visual
  Physique       [______________________________]
  Face           [______________________________]
  Hair           [______________________________]
  Eyes           [______________________________]
  Attire         [______________________________]
  Distinguishing [chip input]

▼ More options
  Tags          [chip input]
  Faction       [pick from cast ▾]

⭐ Set as lead   (button outside disclosure, character-only,
                 visible when no other character is the lead
                 AND status='active')
```

**Tier rationale:**

- **Always-visible identity (`Voice` / `Traits` / `Drives`)** —
  personality essentials, compact. Directly mitigates the
  "dry character" risk; wizard-authored values seed
  `CharacterState` at first-write.
- **`▼ Visual` disclosure** — six sub-fields would dwarf the
  editor expanded. Defaulted closed.
- **`▼ More options`** — tags + faction. Faction picker reads
  currently-authored factions in the wizard's cast list;
  `(no factions yet — add one with + Add)` empty state when none
  exist. `null` = unaffiliated.

**Not in wizard editor** (per the authorship contract,
classifier-managed per-turn): `current_location_id`,
`equipped_items`, `inventory`, `stackables`, `lastSeenAt`. All
dynamic, populated by classifier once narrative starts; wizard-time
pre-population would be meaningless (no scenes yet).

#### Location editor

```
Name        [______________________________]  [Active ▾]
Description [textarea]

▼ More options
  Tags             [chip input]
  Parent location  [pick from cast ▾]
  Condition        [______________________________]
```

`parent_location_id` enables containment hierarchy at creation
("Shop in Town Square in City"); picker reads currently-authored
locations only. `condition` is dynamic-state-shaped — usually
classifier-evolved but user can seed at wizard time. Both under
More options because typical wizards just set name + description.

#### Item editor

```
Name        [______________________________]  [Active ▾]
Description [textarea]

▼ More options
  Tags         [chip input]
  Condition    [______________________________]
```

`at_location_id` excluded — per-turn classifier-managed (where the
item is right now). Items wizard-authored have no scene presence
until prose introduces them.

#### Faction editor

```
Name        [______________________________]  [Active ▾]
Description [textarea]
Agenda      [chip input — soft cap 4]

▼ More options
  Tags        [chip input]
  Standing    [______________________________]
```

`agenda` is identity-shaped (faction's goals — parallel to character
`drives`); always visible. `standing` is dynamic-state ("ascendant
after the coup") — under More options.

#### Status field — `active` / `staged`

Default `status='active'`. User can flip to `'staged'` for
not-yet-introduced entities — particularly useful for IP-based
stories where the cast roster is known but only some enter the
opening scene. `'retired'` not reachable at wizard time.

Editor placement: small dropdown adjacent to the Name input, not
buried in More options. Discoverable but visually subordinate to
name/description.

**Compact-row presentation — non-default chip pattern** (mirrors
the [lore detail-pane `injection_mode` chip rule](./2026-04-30-lore-detail-pane.md#8-entity-overview-gains-non-default-injection_mode-chip)):

```
[👤] Aria Stoneheart  ⭐ lead                     ✕
A young blacksmith from a fallen kingdom…

[👤] Gandalf  STAGED                              ✕
A wandering wizard, gray of cloak and white of…
```

`STAGED` chip + muted row content = scan-distinguishable. `Active`
shows no badge (default = no chrome).

**Cascading behaviors:**

- **Lead requires `status='active'`.** A staged character can't be
  the protagonist — they're not on stage. `⭐ Set as lead` button
  hidden on staged-character rows. Marking the current lead as
  staged auto-unmarks lead with toast: `Lead unset — staged
characters can't be lead.`
- **Lead-required gate tightens.** "At least one **active**
  character marked as lead" — staged characters don't satisfy.
  Lead-required notice resurfaces with `(active characters only)`
  clarifier if the user stages every character in a first/second-
  person or adventure-mode story.
- **Opening generation enum-list filters to active.** Wizard-assist's
  structured-output schema for opening generation passes only
  `status='active'` cast as the enum for `sceneEntities`. Staged
  characters can't appear in opening scene metadata. Prose can
  still mention staged entities by name (per the existing rule —
  prose can name unbacked entities); only structured refs constrain.
- **Stage promotion is classifier-per-turn.** When prose introduces
  a staged entity (it appears in `metadata.sceneEntities` of a new
  entry), the classifier promotes status: `staged` → `active` on
  the spot. Lore-mgmt at chapter close handles slower compaction
  (traits / drives consolidation), not lifecycle. The wizard's
  staged-flag is just the seed; the agent loop drives the arc.

#### AI-suggest for cast — structured identity output

Updated wizard-assist call returns structured output per kind:

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
staged outputs: `"Suggest 6 characters; 2 introduced later"` →
4 active + 2 staged.

**Cross-batch reference resolution.** Suggested locations may
declare `parent_location_name` referring to another location in the
same batch (or existing cast). Import resolves names → entity ids;
unresolved fall back to `null` with muted "(parent location not
found)" inline note.

Why structured at wizard time: skips the "classifier extracts from
prose at first generation" hop. Wizard-authored entities arrive
with traits / drives / visual already populated. Classifier's
first-turn work is incremental.

#### Lead-required gating recap

- **Trigger** (set in step 1): `mode='adventure'` OR
  `narration ∈ {first, second}`.
- **Inline notice** at top of step 4 when triggered AND no active
  character marked as lead.
- **`Next →` validation** blocks until satisfied when required.
- **Cascading from back-jump.** If user revisits step 1 and changes
  mode/narration, step 4's pill demotes from `✓` to `○` if the new
  rule isn't satisfied. User walks forward to satisfy.

#### Validation gates on `Next`

- Each row: `name` non-empty. Empty-name rows surface inline error;
  fixable or `✕`-removable.
- Lead requirement satisfied iff applicable.
- Otherwise no blocks; cast can be empty for creative + third.

### 14. Step 5 — Opening & finish

The wizard's payoff. Two halves on one scrolling step: opening
prose authoring, then identity inputs, then `Finish`.

**Opening surface — three-state textarea.**

**Empty (initial):**

```
Generate with ✨, or start typing below.
[textarea — empty]
```

**AI-generated preview** (after `✨` → guidance → Generate):

```
Suggested opening
[scrollable prose preview]

Scene metadata:
  Cast in scene: Aria Stoneheart
  Location: Mornstone Keep

[Discard] [Refine…] [Regenerate] [Use this]
```

The metadata block surfaces the structured-output refs
(`sceneEntities`, `currentLocationId`) emitted by wizard-assist,
resolved to entity names. Read-only — generation owns the refs.
Constrained to wizard-curated cast with `status='active'` per
decision 13's enum-filter rule; prose can mention unbacked or
staged names freely.

**Committed prose** (after `Use this` OR after manual typing):

```
Opening                                          [✨]

[textarea, editable, contains the prose]

Scene metadata: Aria Stoneheart · Mornstone Keep
  (visible only if AI-generated; user-written = empty)
```

User edits prose freely after committing. Editing AI-generated
prose does **not** clear metadata refs — refs stay intact (user
might tweak prose without invalidating cast/location grounding).
For fresh metadata, user regenerates via `✨`.

`✨` button stays available in committed state — regenerate /
refine entry point. Click on existing committed prose → confirm-on-
replace if existing prose is non-empty (consistent with genre/tone
replace pattern).

**AI-assist for opening — structured output.** Wizard-assist
emits:

```ts
{
  prose: string,
  sceneEntities: string[],          // subset of active cast entity ids
  currentLocationId: string | null, // one of the active location ids
  worldTime: 0                      // story start; always 0
}
```

Standard `Discard / Refine / Regenerate / Use this` actions.
Failure path: inline error in popover. Implementation-level
fallback (treat as user-written prose on malformed structured
output) tracked in
[opening generation structured-output fallback](../followups.md#opening-generation-structured-output-fallback).

**Refine on opening keeps metadata refs aligned.** Each refine call
includes the current metadata as context so refs aren't broken by
prose refinement. Implementation note.

**Title + description — inlined below the opening.**

```
─── Story name ───  [✨]
Title       [______________________________]
Description [______________________________]
```

Both have AI-suggest:

- **Title** — chips result. Wizard-assist generates 5–10 candidate
  titles. Click chip to fill the field. `Regenerate` for fresh
  batch. Manual override always allowed.
- **Description** — prose result (short). 1–3 sentences synthesizing
  the story. Standard prose actions.

Both calls fire from this step → see EVERYTHING (mode/narration/
calendar/genre/tone/setting/lore/cast/opening). Resolves the
"title generation with no prior data" concern that drove placing
identity at the end.

**Validation gate on `Finish`:**

- Opening prose non-empty.
- `title` non-empty.
- Lead-character constraint satisfied (re-checked from step 4).
- `description` optional (library card has muted "(no description
  yet)" fallback).

### 15. Atomic commit transaction on `Finish`

One SQLite transaction, all or none:

1. Insert `stories` row with:
   - `status='active'`
   - `definition` JSON (`mode`, `narration`, `leadEntityId`,
     `genre {label, promptBody}`, `tone {label, promptBody}`,
     `setting`, `calendarSystemId`, `worldTimeOrigin`)
   - `settings` JSON copied from
     `app_settings.default_story_settings` (operational config)
   - identity columns (`title`, `description`, `tags=[]`,
     `accent_color` defaulted from mode, etc.)
2. Insert initial `branches` row.
3. Insert wizard-authored `entities` rows (initial cast). Per-row:
   `kind`, `name`, `description`, `status`, `state` JSON
   (per-kind shape per
   [data-model.md → World-state storage](../data-model.md#world-state-storage)).
4. Insert wizard-authored `lore` rows (initial world). Per-row:
   `title`, `body`, `category`, `tags`, `injection_mode`,
   `priority`.
5. Insert `story_entries[1]` with `kind='opening'`, prose,
   `metadata.worldTime=0`, `metadata.sceneEntities` and
   `metadata.currentLocationId` (if AI-generated; else empty),
   `metadata.model = <wizard-assist profile model>` if AI else
   `null`.
6. **No deltas written.** Per
   [baseline doc decision 10](./2026-04-29-story-definition-baseline.md),
   wizard creation is delta-log-exempt.
7. Clear the auto-saved session.
8. Route to reader-composer with the story open.

If any step fails, the transaction rolls back; user remains on
step 5 with an inline error.

## Trade-offs explored & rejected

### Why not modal-on-dim chrome (like onboarding)

Modal feels claustrophobic for a substantive multi-step flow with
prose fields and previewable opening output. Onboarding's modal
shape works for 3 fast steps with skip-friendly defaults; the
wizard's step 5 alone (opening preview + identity inputs) needs
breathing room a modal can't give. Chosen: full-page replacement.

### Why not routed view with persistent app top-bar

Tempts the user to navigate elsewhere mid-flow (→ App Settings to
"check something" → wizard state lingers → confusion). Fights the
single-active-session pattern documented in story-list.md.
Chosen: full-page replacement that locks the user into the wizard
unless they explicitly Cancel.

### Why not separate Identity step at the end

A 6-step structure with a final Identity step (title + description

- tags + accent + author_notes) was considered. Three reasons
  against:

* **Anti-climactic.** Opening is the wizard's emotional payoff
  (story's first words materialize). Putting tags / accent / author
  notes after deflates the moment.
* **Tags / accent / author_notes don't justify a full step.** Most
  users skip them; deferring to Story Settings · About is honest.
* **Title + description benefit from full context.** Inlining them
  into the Opening step lets AI-suggest see everything (full-context
  generation was the original argument for moving identity to the
  end).

Chosen: 5 steps with title + description inlined into step 5;
tags / accent / author_notes deferred to Story Settings · About.

### Why not title at start

Title-at-start was the original lean (anchors the session, save-as-
draft renders immediately). Rejected when designing AI-assist —
title-suggest at step 1 sees only `mode` + `narration`, which is
nearly nothing. Suggestions would be generic. By the time the user
has authored World + Cast + Opening, AI has full context for
meaningful suggestions. Authors who don't have a title yet at
step 1 use the placeholder `Untitled story` for save-as-draft;
rename in step 5 (or later in Story Settings · About).
Chosen: title at end.

### Why not per-kind tabs in step 4 (Cast)

Tabs (Characters | Locations | Items | Factions) felt heavy at
typical wizard counts (3–10 entities). Mixed list with kind icons
preserves authoring order, scans well at typical counts, and
matches the entity row pattern already documented. Tabs would be
chrome over content for the median case.
Chosen: mixed list with kind icons.

### Why not separate `wizard-assist-light` and `wizard-assist-prose`

Considered for v1 but rejected. Single agent + single profile is
cheaper to model, simpler to onboard (one default seed in the
silent assignment matrix), and the user can re-tune the profile if
output quality varies. If real signal post-launch shows a single
profile can't simultaneously serve title chips and opening prose
well, the architecture supports splitting cleanly. Captured as a
[followup](../followups.md).

### Why not a third button (`Save session as draft & continue`) on the concurrent-state prompt

Three buttons is borderline busy on a fork-in-the-road decision.
Two-button + destructive labeling (`Discard session & start fresh` /
`Discard session & open <DraftName>`) is the v1 floor. Users with
valuable in-flight state can dismiss the prompt → return to wizard
→ save-as-draft explicitly → re-trigger their original click.
If real signal shows users losing work via the destructive path,
the third button lands. Captured as a
[followup](../followups.md).

### Why structured-identity AI-suggest for cast

Considered prose-only suggestions that classifier extracts identity
from at first generation. Rejected — wizard-authored entities
should arrive with identity already populated so first-turn prose
quality doesn't depend on classifier extraction reliability. The
authorship contract permits user-via-form first-writes for the
identity fields (`visual.*`, `traits`, `drives`, `voice`,
`parent_location_id`, `condition`, `standing`, `agenda`); structured
AI-suggest is "user via form, but the user delegated authoring to
wizard-assist."
Chosen: structured-identity output.

### Why no metering / capping on AI-assist regenerate

Cost is on the user. Each click is intentional; warning UI on
every call would be noise. v1 ships without per-call cost surfacing
(would be provider-dependent, hard to model accurately, and noisy
for the common case). Users who burn tokens are responsible for
their token budget.
Chosen: no metering.

## Edge cases & invariants

Recap of constraints the design enforces; full discussion in the
relevant decision sections above.

- **Wizard creation is atomic** — all writes succeed together or
  none do.
- **Opening is permanent within its branch** (block-delete) and
  always position 1.
- **`definition.leadEntityId` resolves to an active character**
  in the same story.
- **AI-generated opening metadata refs** constrained to
  wizard-curated active cast; prose can mention unbacked or staged
  entities freely.
- **`worldTimeOrigin`** must satisfy each tier's `rollover` rule.
- **Lead requirement** satisfied iff `mode='adventure'` OR
  `narration ∈ {first, second}` is FALSE, OR at least one
  `status='active'` character has been marked lead.
- **Stage promotion** (`staged` → `active`) is classifier-per-turn
  on prose introduction.
- **Save-as-draft skips validation** entirely — drafts allow
  incomplete state.
- **Auto-save session** persists only after first meaningful state
  change.
- **Replace-on-existing** confirm modal fires for genre / tone
  preset+AI-suggest replacements when label or body is non-empty.
- **Lead unset toast** fires on multiple paths (kind change away
  from character, status flip to staged, row deletion).

## Generated followups

**New entries** (per
[`docs/conventions.md → Followups vs parked`](../conventions.md#followups-vs-parked)):

- **Wizard-assist agent profile splitting** — if a single profile
  can't simultaneously serve fast title-chip generation AND
  structured-output opening prose well, split into
  `wizard-assist-light` and `wizard-assist-prose`. Parked-until-
  signal.
- **Concurrent-state prompt third button** —
  `[Save session as draft & continue]` as a v2 escape valve from
  the discard-or-continue fork. Parked-until-signal.
- **Cast / lore reorder in wizard** — drag-to-reorder within
  wizard list. Parked-until-signal.
- **Cast / lore section-collapse toggle in wizard** — collapse the
  section to a one-liner if user accumulates many rows.
  Parked-until-signal.
- **Per-kind grouping or tabs in wizard step 4** — if cast counts
  grow past comfortable mixed-list density. Parked-until-signal.
- **Wizard session storage cleanup** — sessions sitting in storage
  indefinitely accrue. Cleanup pass (TTL-based, or on app start
  age check). Active (post-v1).
- **Wizard-time pack selection** — operational config (pack)
  copies from app defaults at creation, but a power user might
  want to pick a pack at wizard time. Parked-until-signal.
- **Chip input vs comma-separated string** — wizard surfaces
  several string-array fields (`traits`, `drives`, `agenda`,
  `visual.distinguishing`, `tags`) as chip inputs. Cross-cutting
  reconsideration: a simple comma-separated single-line string
  may be cheaper to author, simpler to implement, and adequate
  for the underlying data shape. Affects entity / lore / wizard
  surfaces uniformly. Parked-until-signal.

**Resolved** (or partially resolved):

- **UI inventory #2 — `Story creation wizard`** in
  [`ui/README.md`](../ui/README.md). Updates from `pending` to a
  real link.
- **`Wizard worldTimeOrigin input UX per calendar`** in
  [`calendar-systems/spec.md → Open questions`](../calendar-systems/spec.md#open-questions).
  Removed.
- **`worldTimeOrigin` deferral text** in
  [`patterns/calendar-picker.md → Wizard — calendar selection slot`](../ui/patterns/calendar-picker.md#wizard--calendar-selection-slot).
  Replaced with concrete link to this wizard doc.
- **`Regenerate-opening affordance`** in
  [`parked.md`](../parked.md) — partially resolved. The "wizard
  one-shot regenerate" sub-bullet is closed by decision 14
  (the `Regenerate` action on the opening preview). The
  "post-commit regenerate from reader chrome" sub-bullet remains
  parked-until-signal. Edit the entry to remove the closed
  sub-bullet.

**Already exist in `parked.md` (NOT touched by this design)**:

- **`Optional user-side scene tagging on user-written openings`**
  — wizard surfaces AI-generated metadata refs but doesn't add
  user-side tagging on user-written openings. Parked entry stands.
- **`Classifier-on-opening retrofit`** — design doesn't add a
  classifier pass on the opening; user-written openings get empty
  metadata, classifier picks up at turn 2. Parked entry stands.

Acknowledged but deliberately not parked:

- Mobile layout. Project's general mobile-deferred stance applies;
  no wizard-specific mobile design here. Reopens when mobile
  surfaces are designed.
- Internationalization (i18next-bundled wizard copy). Implementation
  concern; not a design open question.
- Storybook entries for wizard components. Tracked under existing
  [Storybook design-rules pattern setup](../followups.md#storybook-design-rules-pattern-setup).

## What this design does not do

- Does not redesign the calendar picker primitive
  ([already canonical](../ui/patterns/calendar-picker.md)).
- Does not redesign the `entities.state` shape or the authorship
  contract ([already canonical in data-model.md](../data-model.md#world-state-storage)).
- Does not redesign the drafts pattern ([already canonical in
  story-list.md](../ui/screens/story-list/story-list.md#drafts--wizard-session--explicit-draft)).
- Does not specify mobile layouts (deferred per project stance).
- Does not specify keyboard shortcuts beyond standard form
  navigation. Cmd-Enter to advance / Cmd-S to save-as-draft are
  reasonable defaults but not designed here.
- Does not specify the wizard-assist profile's per-call max-tokens
  budget. Implementation tunes per-call; if structured-output
  truncates pathologically, the wizard-assist profile is the user
  lever.
- Does not specify accessibility behaviors (keyboard nav, screen
  reader announcements). Follows the project's general a11y stance;
  detail lands at implementation.
- Does not specify error-recovery beyond "rollback on transaction
  failure, surface inline error on step 5." Implementation handles
  retry semantics.

## Integration plan

### Canonical doc changes

| Surface                                        | Change                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ui/screens/wizard/wizard.md` (NEW)       | Full per-screen doc citing this exploration as the design source. Standard per-screen layout: principles cited, layout sketches per step, cross-references to patterns.                                                                                                                                                                                                                  |
| `docs/ui/screens/wizard/wizard.html` (NEW)     | Interactive wireframe — review-controls bar, vanilla JS, monochrome. Renders all 5 steps as switchable views; chrome (top-bar + step indicator + footer) constant. Per-step composition matches this design's sketches.                                                                                                                                                                  |
| `docs/ui/README.md`                            | Update Wizard inventory entry #2 from `pending` to `[screens/wizard/](./screens/wizard/wizard.md)`.                                                                                                                                                                                                                                                                                      |
| `docs/data-model.md`                           | Add `wizard-assist` to the agent registry alongside `narrative` / `classifier` / `lore-mgmt`. Add `exampleStartValue: TierTuple` as a mandatory field on `CalendarSystem`; clarify `Tier.startValue` semantics ("where the tier counter starts" — NOT the per-story default). Add a brief note that wizard authoring is delta-log-exempt (already covered in baseline; cross-reference). |
| `docs/calendar-systems/spec.md`                | Add `exampleStartValue` field to the `CalendarSystem` shape; add migration note for existing built-ins (only `earth-gregorian` today; trivial). Update Open Questions: remove the resolved `Wizard worldTimeOrigin input UX per calendar` entry (replace with link to wizard doc).                                                                                                       |
| `docs/ui/patterns/calendar-picker.md`          | Replace the wizard-slot `worldTimeOrigin` deferral text ("Designed alongside the wizard pass; tracked in open questions") with a concrete link to the wizard doc's `worldTimeOrigin` section. Update host-adaptation table's Wizard row Notes.                                                                                                                                           |
| `docs/ui/screens/vault/calendars/calendars.md` | Add a brief note to the Definition section that `exampleStartValue` is a mandatory calendar-definition field, displayed read-only in v1, with editable from-scratch authoring deferred to L3. Built-ins ship with sensible values; clones inherit from the source built-in.                                                                                                              |
| `docs/ui/screens/onboarding/onboarding.md`     | Update the `What gets seeded silently` section to include `wizard-assist → <default profile>` in the silent assignment matrix.                                                                                                                                                                                                                                                           |
| `docs/ui/screens/story-list/story-list.md`     | Update `Drafts — wizard session + explicit draft` section: confirm session is mutually exclusive with any specific wizard target, and the concurrent-state prompts now exist on draft-card-click too (not just `+ New story`). Add cross-reference to wizard doc. Cite the `Untitled story` placeholder rule for draft cards with empty title.                                           |
| `docs/followups.md`                            | **Remove** resolved entries (3, listed above). **Add** active follow-ups (3, listed above).                                                                                                                                                                                                                                                                                              |
| `docs/parked.md`                               | **Add** the parked-until-signal entries (5, listed above).                                                                                                                                                                                                                                                                                                                               |

**Renames:** none.

**Patterns adopted on a new surface.** The wizard cites
`entity`, `lists`, `forms`, `calendar-picker`, and `icon-actions`
from `wizard.md` via anchor links. NOT `save-sessions` (wizard
uses its own atomic-commit-on-Finish + auto-save-session shape,
distinct from the save-session pattern) or `data` (no raw JSON
viewer or import counterparts).

Reciprocal Used-by edits land only on patterns that carry an
explicit `Used by:` list or host-adaptation table:

- `patterns/icon-actions.md` Used-by: wizard added (✨ trigger +
  ⭐ lead + ✕ delete are inline icon actions).
- `patterns/calendar-picker.md` host-adaptation table Wizard row:
  refreshed with the wizard.md `worldTimeOrigin` spec link.

`patterns/entity.md`, `patterns/lists.md`, and `patterns/forms.md`
do NOT carry explicit Used-by lists — they cite surfaces inline
via `Where it applies in v1` sub-sections that aren't comprehensive
indices. Wizard's anchor-link citations land without reciprocal
edits on those patterns; no Used-by structure to add to.

**Followups resolved:**

- **UI inventory #2 — `Story creation wizard`** in
  [`ui/README.md`](../ui/README.md). Currently `pending`; updates
  to a real link.
- **`Wizard worldTimeOrigin input UX per calendar`** in
  [`calendar-systems/spec.md → Open questions`](../calendar-systems/spec.md#open-questions).
  Removed; replaced with a link to this wizard doc's decision 10.
- **`worldTimeOrigin` deferral text** in
  [`patterns/calendar-picker.md → Wizard — calendar selection slot`](../ui/patterns/calendar-picker.md#wizard--calendar-selection-slot).
  Replaced with a concrete link to this wizard doc.

**Not resolved by this pass:**

- **`Calendar picker primitive — open shape decisions`** in
  [`followups.md`](../followups.md#calendar-picker-primitive--open-shape-decisions)
  — that followup's two sub-questions (Select-extension vs.
  Picker-fork; search-bar threshold) are about the Select primitive
  - popover-search threshold, not about `worldTimeOrigin`. The
    wizard pass doesn't touch them; the followup stands as-is.

**Followups introduced** (new):

- `Wizard-assist agent profile splitting` — `parked.md` →
  Parked until signal → UX.
- `Wizard concurrent-state prompt third button` — `parked.md` →
  Parked until signal → UX.
- `Wizard cast / lore reorder` — `parked.md` → Parked until
  signal → UX.
- `Wizard cast / lore section-collapse toggle` — `parked.md` →
  Parked until signal → UX.
- `Wizard per-kind grouping or tabs in step 4` — `parked.md` →
  Parked until signal → UX.
- `Wizard session storage cleanup` — `followups.md` → UX
  (active; post-v1 cleanup pass).
- `Wizard-time pack selection` — `parked.md` → Parked until
  signal → UX.
- `Chip input vs comma-separated string` — `parked.md` → Parked
  until signal → UX.

**Followups partially resolved** (edit-in-place):

- `parked.md → Regenerate-opening affordance`: remove the
  "wizard one-shot regenerate" sub-bullet (resolved by decision
  14). Keep the "post-commit regenerate from reader chrome"
  sub-bullet.

**Followups removed entirely:**

- `calendar-systems/spec.md → Open questions →
Wizard worldTimeOrigin input UX per calendar` — content moves
  to the wizard doc; entry deleted.
- `ui/README.md → Wizard inventory #2 (pending)` — pending status
  cleared; row updated to point to the new screen doc.

**Wireframes updated:**

- `docs/ui/screens/wizard/wizard.html` — NEW. Comprehensive
  wireframe covering all 5 steps + chrome.

**Intentional repeated prose:** none expected. The wizard doc
cites canonical patterns / principles / data-model rather than
restating them. Cross-doc references should keep prose duplication
to inline placeholders ("see X for details") rather than full
restatement.
