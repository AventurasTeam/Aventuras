# Calendar picker

Component-shaped pattern for the calendar-system selector that
surfaces in App Settings, Story Settings, and the Story Creation
wizard. Same primitive across all three; differences are
wrapper-level (framing copy, summary placement, swap warnings,
edit-restrictions gating).

Cites
[`forms.md → Select primitive`](./forms.md#select-primitive) —
the picker extends Select with rich rows + popover tail action,
or implements a Picker variant per
[`forms.md → What stays separate`](./forms.md#what-stays-separate).
The calendar definition shape the picker reads is in
[`calendar-systems/`](../../calendar-systems/README.md);
the upstream editor is the
[Vault calendar editor](../screens/vault/calendars/calendars.md).

Used by:

- [App Settings · Story Defaults · Calendar](../screens/app-settings/app-settings.md#calendar)
  (default-calendar control; primary host)
- [Story Settings · Calendar tab](../screens/story-settings/story-settings.md#calendar-tab--picker--summary)
  (per-story calendar with edit-restrictions wrapper)
- [Wizard · Step 2 — Calendar](../screens/wizard/wizard.md#step-2--calendar)
  (definitional pick at story creation)
- [Vault calendar editor · Set as default](../screens/vault/calendars/calendars.md)
  (deep-link entry that hands off to the App-Settings picker)

Per-host wrapper differences (framing copy, summary placement, swap
warnings, edit-restrictions gating) are detailed in the [Host
adaptations](#host-adaptations) section below.

---

## Render mode — dropdown across all hosts

One render mode across App Settings, Story Settings, and Wizard:
**dropdown with rich popover rows**. Radio-mode side-by-side
comparison was considered for Wizard's "definitional moment"
framing but rejected — at higher cardinality (10+ user-authored
calendars) the radio list becomes a vertical wall the user must
scroll, exactly when comparison matters most.

Wizard's definitional weight is carried by **wrapper styling**
(full-width control, generous padding, explanatory copy,
always-visible adjacent summary), not by render mode. One
primitive, no per-host conditional render logic. At higher
cardinality the popover gains a search/filter bar at the top —
natural extension toward the Picker / Autocomplete pattern (per
[`forms.md → What stays separate`](./forms.md#what-stays-separate))
without changing host integration. Search threshold lands at the
implementation pass (rough lean: ≥ 8 options).

## Option-row content

Two-line rows. Top line: name + type chip. Bottom line: tier path
as a one-liner.

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

**The tier path is the calendar's structural signature.**
Distinguishes Earth-shaped from Stardate-shaped instantly without
secondary attributes. Tier names come from the calendar's own
definition (`Tier.name`).

**Avoided framings:**

- Shape-words like "Earth-shaped" conflate sequentiality with
  Earth-with-renamed-parts. Misleading.
- Tier count alone (`6 tiers`) is too coarse to differentiate.
- Sample render (`April 28, 2026`) requires a tuple to render
  against; not all hosts have one (Wizard pre-selection).

**Truncation rule.** Standard CSS end-truncation with ellipsis
when the path overflows the row width:

```css
.row-tier-path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Pathologically deep calendars (8+ tiers) lose tail tiers in the
row; the summary panel always recovers full structure. Optional
polish: native `title` attribute on the row showing the full
tier-path string for hover-recovery on desktop.

## Tail action

`Manage calendars in Vault →` — fixed at the popover bottom.
Routes to the
[Vault calendar editor](../screens/vault/calendars/calendars.md)
where users can clone built-ins, edit user-authored calendars,
and (when the deferred L3 surface ships) author from scratch.

**Hidden in Wizard** — Vault routing mid-creation requires
preserving in-flight wizard state across navigation, broader
problem than this primitive solves. v1's near-zero custom-calendar
count makes the omission near-invisible; users who want a custom
calendar cancel the wizard, author it in Vault, restart.

## Summary panel

Always visible alongside the picker (placement varies per host —
adjacent in App Settings and Story Settings; always-on adjacent
in Wizard).

Sections:

- **Tier list with rollover descriptions** — one row per tier;
  rollover detail beside.
  ```
  year   · rule: Gregorian leap
  month  · table: 28–31 days
  day    · constant: 24 hours
  hour   · constant: 60 minutes
  minute · constant: 60 seconds
  second · base unit
  ```
- **Sub-divisions** — `weekday: Sun–Sat (7-day cycle)` or `none`.
- **Eras** — `enabled (preset names: First Age, Second Age, …)`,
  `enabled (free-form)`, or `disabled`.
- **Sample render** — current `worldTime` rendered through the
  calendar's `displayFormat` (Story Settings, against the story's
  origin). App Settings uses a placeholder render; Wizard uses a
  generic placeholder until origin is picked.
- **`Edit in Vault →`** — single inline action that routes to the
  [Vault calendar editor](../screens/vault/calendars/calendars.md)
  with the currently-selected calendar opened in edit mode (even
  if the selection is unsaved in this picker host). The editor
  handles the clone-vs-direct-edit fork by calendar type:
  built-ins auto-clone per
  [`calendar-systems/spec.md → Where calendar definitions live`](../../calendar-systems/spec.md#where-calendar-definitions-live)
  ("the 'edit a built-in' affordance always clones first") and
  open the new clone in edit mode; user-authored calendars open
  directly in edit mode. The picker doesn't ask the user to
  pre-classify their intent (clone vs edit vs view) — the editor
  knows.

  The built-in / custom type is already communicated by the chip
  on the picker's selected option; not duplicated here.

The summary's tier list intentionally duplicates the row's tier
path string — different fidelity tiers serving different
cognitive needs (row = "which one am I selecting from"; summary =
"this is exactly what I'm getting"). The row's path is one-liner
identification; the summary's is structured per-tier with
rollover detail.

## Host adaptations

| Host           | Picker mode | Summary panel      | Vault tail link | Swap warnings | Edit-restrictions gating | Notes                                                                                                                          |
| -------------- | ----------- | ------------------ | --------------- | ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| App Settings   | dropdown    | adjacent / below   | yes             | none          | n/a (out-of-story)       | "Default for new stories" framing                                                                                              |
| Story Settings | dropdown    | adjacent / below   | yes             | W1 / W2 / W3  | yes (gates picker)       | Lives on a dedicated Calendar tab                                                                                              |
| Wizard         | dropdown    | adjacent always-on | no              | none          | n/a (no story yet)       | Wrapper carries definitional weight; tier-derived `worldTimeOrigin` input below — see [wizard.md](../screens/wizard/wizard.md) |

### App Settings — default calendar

Lives in the **Default story settings** tab (per
[`principles.md → Settings architecture`](../principles.md#settings-architecture--split-by-location))
— the explicit home for values that seed new stories on creation
without propagating to existing ones.

```
Default calendar
[picker dropdown — Earth (Gregorian)]      [chip: built-in]
─────────────────────────────────────────────────────────
[summary panel]

Default for new stories. Existing stories keep their current picks.
```

The framing line ("Default for new stories…") is load-bearing.
Without it, a user changing the default could plausibly expect
propagation, since the principles split (copy-at-creation vs
override-at-render) is non-obvious from inside App Settings
alone.

No swap-warning UX — changing the App Settings default re-seeds
future stories, never swaps an existing one.

### Story Settings — active calendar with swap warnings

Lives on a dedicated **Calendar** tab in the Settings section.
The tab content is the picker + the summary panel. Calendar swap
is the picker's downstream effect; warnings fire on swap-attempt
as a single combined modal (W1 / W2 / W3 below).

### Wizard — calendar selection slot

The wizard's full flow is designed in
[`screens/wizard/wizard.md`](../screens/wizard/wizard.md). What's
specified here is the slot the picker occupies; full step
composition (origin input, validation, swap behavior inside the
wizard) lives there.

- **Initial value** — App Settings' `default_calendar_id` per
  copy-at-creation.
- **Picker** — same dropdown primitive as Settings.
- **Summary panel** — always-visible adjacent. The radio-mode
  replacement; user sees full structural detail of their current
  pick as they click through options.
- **No `Manage calendars in Vault →` tail.**
- **Wrapper styling** — full-width control, generous padding,
  section heading `Calendar system`, 2–3 lines of explanatory
  copy.
- **`worldTimeOrigin` sister-control adjacent** — tier-derived
  input (one control per tier, top-down; numeric input or
  labeled-value dropdown depending on whether the tier carries
  `labels`). Initial values come from the picked calendar's
  `exampleStartValue`. Full spec in
  [`wizard.md → Calendar step`](../screens/wizard/wizard.md).

```
┌──────────────────────────────────────────────────────────┐
│ Calendar system                                           │
│ <explanatory copy>                                        │
│                                                            │
│ [picker dropdown]            [summary panel adjacent]     │
│                                                            │
│ Story start moment                                        │
│ {tier-derived inputs — see wizard.md → Calendar step}     │
└──────────────────────────────────────────────────────────┘
```

## Story Settings — swap warnings

A swap can trigger any of three structural concerns. Each fires
as a section in a single combined confirmation modal — sequential
modals would turn one power-user decision into 2–3 dialog clicks.

### W1 — origin-tuple mismatch

Per
[`data-model.md → Story settings shape`](../../data-model.md#story-settings-shape),
`stories.definition.worldTimeOrigin` is a `TierTuple` keyed by tier
names. A new calendar with a different tier set leaves the
existing origin partially or wholly unmatched:

- **Subset match** (Shire → Earth): existing `{year, month, day}`
  is missing `hour/minute/second`. Default fill (0 each) is
  sensible; surface for user awareness.
- **Disjoint** (Earth → Stardate): existing
  `{year, month, day, hour, minute, second}` shares nothing with
  Stardate's `{count}`. Re-pick required.

### W2 — era support mismatch

Triggered when current calendar has eras enabled, existing
[`branch_era_flips`](../../data-model.md#era-flips) rows exist,
and the new calendar's era set doesn't contain one or more of
those rows' `era_name` values (the trivial case being the new
calendar having `eras: null`). Existing flip rows are kept in
storage and surface as
[orphan flips](../screens/story-settings/story-settings.md#orphan-flips-after-calendar-swap)
in Story Settings · Calendar — `era_name · (orphaned)` with the
raw `at_worldtime` in the tooltip. A later swap to a calendar
whose era set DOES include matching names automatically
un-orphans them.

**Asymmetric trigger.** Going FROM no-eras TO with-eras has no
flips to orphan — no warning fires.

### W3 — display-format change

Triggered on every actual swap. The integer `worldTime` per entry
is preserved, but display reformats under the new calendar's
template. Sample render before/after gives a concrete preview.

### Combined modal shape

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

- W1 applies → `Continue & re-pick origin` (routes to the origin
  re-pick affordance after swap).
- Only W2 / W3 apply → `Continue & swap`.

Modal sections render only the warnings that apply. Display
format (W3) is the minimum case — always fires on a real swap.

### Same-calendar no-op

Re-selecting the active calendar is a no-op — no modal, no swap.
Identity-equal new-pick short-circuits the swap flow at the
implementation layer.

## Edit-restrictions interaction

Per
[`principles.md → Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation),
the picker control + the summary's `Edit in Vault →` action gate
when a generation pipeline is in flight. Universal tooltip on
disabled controls: `Generation is in flight. Cancel to edit.`

The summary panel itself stays **visible and read-only** during
the gate — the user can still inspect what calendar is active,
just can't act on it. Only mutating affordances disable.

Calendar swap is one of the canonical instances the
edit-restrictions principle's followup originally cited; this
primitive's gate is a direct consequence of that principle.

## Implementation notes

- **Tier-path tooltip** — native `title` attribute on each row
  surfaces the full tier path on desktop hover. Useful for
  very-deep calendars where the row's compact preview can't show
  every tier.
- **Mobile shape** — dropdown becomes a bottom sheet per the
  Select primitive's responsive treatment. Sheet and Popover
  primitive contracts (API, rn-primitives mapping, slot reshape)
  live in [`overlays.md`](./overlays.md).
- **Keyboard** — arrow keys navigate options; Enter selects; Esc
  closes the popover; search-bar focus on open when the search
  bar is present (see deferrals below). Inherits from Select /
  Picker base.

Two deferrals — see
[`followups.md → Calendar picker primitive — open shape decisions`](../../followups.md#calendar-picker-primitive--open-shape-decisions):

- whether the picker reuses Select with rich-row + tail-action
  extensions vs. forks into a sibling Picker primitive;
- the option-count threshold at which the popover gains a
  search/filter bar.

## Storybook

Live demos of the picker primitive (per host integration), summary
panel, and the W1 / W2 / W3 swap-modal variants belong in a
`Patterns/Calendar picker` MDX page when component implementation
begins. Page cites this file as canonical and embeds component
stories. See
[`followups.md → Storybook design-rules pattern setup`](../../followups.md#storybook-design-rules-pattern-setup).
