# Calendar picker — shared primitive across three hosts (2026-04-28)

## Why this exists

Resolves the followup `Calendar picker — App Settings + Story
Settings + Wizard`, which named a single primitive shared across
three host surfaces but punted the design to "its own pass." The
calendar-systems spec
([`calendar-systems/spec.md → Authoring (UI)`](../calendar-systems/spec.md#authoring-ui))
also defers the picker design with the same language.

This exploration designs the picker primitive (option-row content,
summary panel, render mode) and its adaptations across the three
hosts (App Settings default-calendar, Story Settings active-calendar
with swap warnings, Wizard calendar-selection slot).

## Scope

**Covered:**

- The picker primitive — option-row content, summary panel,
  render mode, tail action.
- Host adaptations — App Settings, Story Settings, Wizard.
- Story Settings swap warnings (origin mismatch, era mismatch,
  display-format change).
- Interaction with the
  [edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation).

**Not covered (deferred):**

- **`worldTimeOrigin` input UX** — the calendar-specific date
  picker in Wizard and in Story Settings origin re-confirmation.
  Sister primitive; per-calendar input shape (date picker for
  Earth, tier-by-tier for Tolkien, bare integer for Stardate).
  Already a documented open item in
  [`calendar-systems/spec.md → Open questions → Wizard worldTimeOrigin input UX per calendar`](../calendar-systems/spec.md#open-questions);
  picked up alongside the wizard's full design pass.
- **Wizard's full flow** — the picker slot's shape is specified;
  the wrapper around it (wizard step ordering, navigation,
  cancel semantics, in-flight state) is the wizard's own pending
  design.
- **Vault calendar editor** — already designed at
  [`ui/screens/vault/calendars/`](../ui/screens/vault/calendars/calendars.md).
  This exploration cites it (the picker's tail action routes
  there) but doesn't redesign it.

## The picker primitive

### Render mode — dropdown across all hosts

One render mode for all three host surfaces: **dropdown with rich
popover rows**. The Select primitive's `radio` mode was considered
for Wizard's "definitional moment" framing but rejected for
scaling: 20 calendars × multi-line rows = a vertical wall the user
must scroll through, exactly when comparison matters most.

Wizard's definitional weight is carried by **wrapper styling**
(full-width control, generous padding, explanatory copy,
always-visible adjacent summary panel), not by render mode.

This makes the picker a single primitive across all hosts with no
mode-switching logic. At higher cardinality, the popover gains a
search/filter bar at the top — a natural extension toward the
Picker / Autocomplete pattern (per
[`patterns/forms.md → What stays separate`](../ui/patterns/forms.md#what-stays-separate))
without changing host integration. The search-bar threshold
(rough lean: ≥ 8 options) lands at the implementation pass.

The Select primitive itself is extended (or a sibling variant
created) to support rich-row content and a popover tail action.
Implementation concern; design holds either way.

### Option-row content

Two-line rows. Top line: name + type chip. Bottom line: tier path
as one-liner.

```
┌──────────────────────────────────────────────────────────┐
│ Earth (Gregorian)                          [built-in]    │
│   year → month → day → hour → minute → second            │
├──────────────────────────────────────────────────────────┤
│ Shire Reckoning (my variant)               [custom]      │
│   year → month → day                                     │
├──────────────────────────────────────────────────────────┤
│ Stardate                                   [built-in]    │
│   count                                                  │
├──────────────────────────────────────────────────────────┤
│ Warhammer 40K Imperial                     [built-in]    │
│   millennium → fractional-year                           │
└──────────────────────────────────────────────────────────┘
[ Manage calendars in Vault → ]
```

**Why the tier path** — it's the calendar's structural signature.
Distinguishes Earth-shaped from Stardate-shaped instantly without
secondary attributes. Single-line readout is information-dense.

**Avoided framings:**

- "Earth-shaped" and similar shape-words conflate sequentiality
  with naming-renamed-Earth. Misleading.
- Tier count alone (`6 tiers`) is too coarse to differentiate.
- Sample render (`April 28, 2026`) requires an origin tuple to
  render against; not all hosts have one (Wizard pre-selection).

**Truncation rule:** standard CSS end-truncation with ellipsis
when the path overflows the row width. For pathologically deep
calendars (8+ tiers), the row reads `year → month → day → hour →`
and trails off; full structure recoverable from the summary panel
(and optionally a `title` attribute tooltip on the row showing
the full path string — polish detail, not v1-blocking).

End-truncation rather than middle-truncation: simpler (one CSS
rule, no JS measurement), uniform row height, predictable layout.
Loses the base unit on overflow — accepted because (a) most
calendars are short, (b) summary panel surfaces it, (c)
middle-truncation has its own "what's in the middle?" cost.

### Tail action

`Manage calendars in Vault →` — fixed at the popover bottom.
Routes to the
[vault calendar editor](../ui/screens/vault/calendars/calendars.md),
where users can clone built-ins, edit user-authored calendars,
and (eventually) author from scratch.

**Hidden in Wizard.** Routing to Vault mid-creation requires
preserving in-flight wizard state across navigation — broader
problem than this design solves. v1's near-zero custom-calendar
count makes the omission near-invisible: if a user wants a custom
calendar, they cancel the wizard, author it in Vault, restart.
The link surfaces on App Settings' picker and Story Settings';
Wizard is the one omission.

### Summary panel

Always visible alongside the picker (placement varies per host —
adjacent in App Settings and Story Settings; always-on adjacent
in Wizard).

Content sections:

- **Tier list with rollover descriptions** — one row per tier;
  rollover detail beside (`year` (rule: Gregorian leap),
  `month` (table: 28–31 days), `day` (constant: 24 hours), …).
- **Sub-divisions** — `weekday: Sun–Sat (7-day cycle)` or `none`.
- **Eras** — `enabled (preset names: First Age, Second Age, …)`,
  `enabled (free-form)`, or `disabled`.
- **Sample render** — current `worldTime` rendered through the
  calendar's `displayFormat` (Story Settings, against the story's
  origin); a placeholder render (App Settings, since no specific
  story is implicit). Wizard, if implementations want a sample,
  uses a generic placeholder until origin is picked.
- **Status / actions** — `built-in (read-only)` with a `Clone & edit`
  button (clones the built-in, routes to vault editor for the new
  clone) OR `custom` with `Manage in Vault →` link (routes to
  vault editor for that calendar).

The summary's tier list intentionally duplicates the row's tier
path — different fidelity tiers serving different cognitive needs
(row = "which one am I selecting from"; summary = "this is exactly
what I'm getting").

## Host adaptations

| Host           | Picker mode | Summary panel      | Vault tail link | Swap warnings | Edit-restrictions gating | Notes                                                                        |
| -------------- | ----------- | ------------------ | --------------- | ------------- | ------------------------ | ---------------------------------------------------------------------------- |
| App Settings   | dropdown    | adjacent / below   | yes             | none          | n/a (out-of-story)       | "Default for new stories" framing                                            |
| Story Settings | dropdown    | adjacent / below   | yes             | W1 / W2 / W3  | yes (gates picker)       | New Calendar tab in Settings section                                         |
| Wizard         | dropdown    | adjacent always-on | no              | none          | n/a (no story yet)       | Wrapper carries definitional weight; worldTimeOrigin sister-control adjacent |

### App Settings — default calendar

Lives in **App Settings · Default story settings** tab (per
[`ui/principles.md → Settings architecture`](../ui/principles.md#settings-architecture--split-by-location))
— that tab's the explicit home for values that seed new stories
on creation, not propagate to existing ones. Sits alongside
memory knob defaults, translation config defaults, suggestions
toggle.

Field shape:

```
Default calendar
[picker dropdown — Earth (Gregorian)]      [chip: built-in]
─────────────────────────────────────────────────────────
[summary panel — tier list, sub-divisions, eras, sample render]

Default for new stories. Existing stories keep their current picks.
```

The framing line is load-bearing. The principles split
(copy-at-creation vs override-at-render) is non-obvious from
inside App Settings alone; without the line, a user changing the
default could plausibly expect propagation.

No swap-warning UX — changing the App Settings default is a
re-seed for future stories, never a swap on an existing one.
Save semantics inherit App Settings' ambient pattern (instant
commit vs save bar — design pass for App Settings' overall
shape settles that).

### Story Settings — active calendar with swap warnings

Lives on a **new Calendar tab** in the Settings section of Story
Settings. The existing tabs (`Models | Memory | Translation |
Pack | Advanced`) become `Models | Memory | Translation | Pack |
Calendar | Advanced` — Calendar fits between Pack and Advanced
(config-shape, not deeply technical).

Tab content:

```
Calendar
This story's active calendar.

[picker dropdown — Earth (Gregorian)]      [chip: built-in]
─────────────────────────────────────────────────────────
[summary panel — tier list, sub-divisions, eras, sample render
 against this story's worldTime, status + actions]
```

#### Edit-restrictions interaction

The picker control + the summary's `Clone & edit` action are
covered by the
[edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation):
they disable when a generation pipeline is in flight, with the
universal tooltip `Generation is in flight. Cancel to edit.`

The summary panel itself stays **visible and read-only** during
the gate — the user can still inspect what calendar is active,
just can't act on it. Only mutating affordances disable.

This is the only edit-restrictions surface bespoke to calendar;
calendar swap is one of the canonical instances the principle's
followup originally cited.

#### Swap-induced warnings

A swap can trigger any of three structural concerns. Each fires
as a section in a single combined confirmation modal (rather than
sequential modals — power-user action; one decision shouldn't
become 2–3 dialog clicks).

**(W1) Origin-tuple mismatch.** Per
[`data-model.md → Story settings shape`](../data-model.md#story-settings-shape),
`stories.settings.worldTimeOrigin` is a `TierTuple` keyed by tier
names. A new calendar with a different tier set leaves the
existing origin partially or wholly unmatched. Two cases:

- **Subset match** (Shire → Earth): existing `{year, month, day}`
  is missing `hour/minute/second`. Default fill (0 each) is
  sensible; surface for user awareness.
- **Disjoint** (Earth → Stardate): existing
  `{year, month, day, hour, minute, second}` shares nothing with
  Stardate's `{count}`. Re-pick required.

**(W2) Era support mismatch.** Triggered when current calendar
has eras enabled, existing
[`branch_era_flips`](../data-model.md#era-flips) rows exist, and
the new calendar has `eras: null`. Existing flip rows are kept in
storage (per
[`calendar-systems/spec.md → Adversarial check`](../calendar-systems/spec.md#adversarial-check))
but become invisible until a calendar with eras is re-selected.

**Asymmetric trigger.** Going FROM no-eras TO with-eras has no
flips to orphan — no warning fires.

**(W3) Display-format change.** Triggered on every actual swap.
The integer `worldTime` per entry is preserved, but display
reformats under the new calendar's template. Sample render
before/after gives concrete preview.

#### Combined modal shape

```
┌──────────────────────────────────────────────────────────┐
│  Switch calendar to Stardate?                             │
│                                                            │
│  Origin tuple — Stardate's tier set differs.              │
│   You'll need to re-pick the story-start moment.          │
│  ─────                                                    │
│  Era flips — Stardate doesn't support eras.               │
│   3 existing era flips will be hidden.                    │
│  ─────                                                    │
│  Display format — dates reformat under Stardate.          │
│   Latest entry: 'April 28, 2026' → '12345.6'              │
│                                                            │
│             [Cancel]  [Continue & re-pick origin]          │
└──────────────────────────────────────────────────────────┘
```

Continue button label adapts:

- W1 applies → `Continue & re-pick origin` (routes to origin
  re-pick affordance after swap).
- Only W2 / W3 apply → `Continue & swap`.

Modal sections render only the warnings that apply. Display
format (W3) is the minimum case — it always fires on a real swap.

#### Same-calendar no-op

Re-selecting the active calendar in the picker is a no-op — no
modal, no swap. Implementation detail: identity-equal
new-pick short-circuits the swap flow.

### Wizard — calendar selection slot

The wizard isn't designed yet. What's in scope here is the slot
the picker occupies, not the wizard's surrounding flow. When the
wizard pass happens, it picks up:

- **Initial value** — App Settings' `default_calendar_id` (per
  copy-at-creation pattern).
- **Picker** — same dropdown primitive as Settings.
- **Summary panel** — always-visible adjacent. This is the
  radio-mode replacement; user sees full structural detail of
  their current pick as they click through options.
- **No `Manage calendars in Vault →` tail** — Vault routing
  mid-creation needs wizard state preservation, out of scope.
- **Wrapper styling** — full-width control, generous padding,
  section heading `Calendar system`, 2–3 lines of explanatory
  copy.

**worldTimeOrigin sister-control adjacency:**

```
┌──────────────────────────────────────────────────────────┐
│ Calendar system                                           │
│ <explanatory copy>                                        │
│                                                            │
│ [picker dropdown]            [summary panel adjacent]     │
│                                                            │
│ Story start moment                                        │
│ <calendar-specific worldTimeOrigin input — design pending> │
└──────────────────────────────────────────────────────────┘
```

The worldTimeOrigin input's UX is per-calendar-shaped. That input
lives in
[`calendar-systems/spec.md → Open questions → Wizard worldTimeOrigin input UX per calendar`](../calendar-systems/spec.md#open-questions)
— picked up alongside the wizard pass. This design notes
adjacency so the wizard pass knows the relationship; doesn't
design the input.

**No edit-restrictions gating** — wizard targets a story that
doesn't exist yet; no in-flight pipeline can overlap.

## Implementation notes (forward-looking)

- **Select primitive extension** — the picker assumes Select
  gains rich-row content + popover tail action support, OR a
  Picker-pattern variant is created (per
  [`patterns/forms.md → What stays separate`](../ui/patterns/forms.md#what-stays-separate)).
  Either is fine; the design holds.
- **Search-bar threshold** — popover gains a search/filter bar at
  some option-count threshold (rough lean: ≥ 8). Implementation
  pass picks the actual number.
- **Tier-path tooltip** — optional polish: native `title` attribute
  on the row showing the full tier path string. Recovers detail
  on hover for very-deep calendars whose row is end-truncated.
- **Mobile shape** — dropdown becomes bottom sheet per existing
  responsive conventions. No bespoke mobile UX in this design;
  inherits Select primitive's responsive treatment when that
  lands.
- **Keyboard accessibility** — arrow keys, Enter to select, Esc
  to close, search-bar focus on open when present. Inherits from
  Select / Picker primitive base.

## Followups generated

None new. The picker design surfaces no concerns the existing
followups don't already cover:

- `worldTimeOrigin` input UX → already in
  [`calendar-systems/spec.md → Open questions`](../calendar-systems/spec.md#open-questions).
- Wizard full design → already pending per
  [`ui/README.md`](../ui/README.md) inventory entry #2.
- Storybook setup → already in
  [`followups.md → Storybook design-rules pattern setup`](../followups.md#storybook-design-rules-pattern-setup).

Resolving (removing from `followups.md`):

- `Calendar picker — App Settings + Story Settings + Wizard` —
  the design defined here.

## Integration map

- **`docs/ui/patterns/calendar-picker.md`** (new file) — the
  canonical pattern spec. Contains: render mode, option-row
  content, tail action, summary panel, host-adaptation table,
  Story Settings swap warnings, edit-restrictions interaction.
- **`docs/ui/patterns/README.md`** — adds the new entry to the
  file list under "Files".
- **`docs/calendar-systems/spec.md → Authoring (UI)`** —
  current text says "L1 surface is the calendar picker… its
  design lands as a separate pass." Replace the deferral
  language with an anchor link to the new pattern doc.
- **`docs/ui/screens/story-settings/story-settings.md`** —
  add a **Calendar** tab to the Settings section's tab list
  (placement: between Pack and Advanced). Brief tab description
  citing the pattern doc; full picker spec lives in patterns.
- **`docs/ui/screens/app-settings/app-settings.md`** — adds a
  brief `### Calendar` sub-section under the existing
  `## STORY DEFAULTS` section (likely between Translation and
  Composer prefs), noting that the calendar default lives there
  and citing the pattern doc for the picker spec.
- **`docs/followups.md`** — remove the resolved entry. No new
  followups added.

**`docs/ui/screens/story-settings/story-settings.html`** — adds
the Calendar tab to the wireframe (review-controls bar entry,
left-rail nav-item, tab panel content, header-data entry) so the
wireframe stays consistent with the per-screen doc. App Settings'
wireframe gains a Calendar field under Story Defaults on its own
next review pass; not bundled here. The picker primitive itself
becomes a Storybook entry when components are built (existing
followup).
