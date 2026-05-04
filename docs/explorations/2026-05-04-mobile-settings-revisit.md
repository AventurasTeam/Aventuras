# Mobile settings revisit — form-row substrate + settings list-state nav

Follow-up to
[`2026-05-02-mobile-group-d-settings.md`](./2026-05-02-mobile-group-d-settings.md).
Group D landed the master-detail collapse for
[story-settings](../ui/screens/story-settings/story-settings.md) and
[app-settings](../ui/screens/app-settings/app-settings.md) — list-first
on phone, tap a section to drill into a tab as inner full-screen route.
The collapse mechanic is sound; what's wrong is what's _inside_ each
state. The current shape reuses the desktop preferences-pane row
primitives verbatim — uppercase 11 px monospace labels, 7 px input
padding, 2-col `120 px label / 1fr input` form rows, ~38 pt nav-rows
with desktop chrome (left-bar accent, muted ink, no chevron). Both
list and detail states read as a desktop pane shrunk to phone width
rather than a mobile-native surface.

This revisit pins two structural changes — one at the substrate
(form rows, all four 2-pane surfaces) and one settings-local (the
list-state nav row). No new chrome layer, no new tokens, no card
inset. Density tier defaults stay as they are (compact desktop /
regular phone+tablet) — mobile native rides the platform tap-target
floor, not above it.

## What this changes

| Concern                                  | Before                                                        | After                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Form-row layout at narrow widths         | 2-col grid (`120 px label / 1fr input`) on tablet+phone       | Stacked single-column when form container `< 640 px`; 2-col when `≥ 640 px`. Container-query-keyed, not viewport-keyed.   |
| Form label aesthetic on narrow container | Uppercase 11 px monospace, muted ink                          | Sentence-case sans, 14 px / `text-sm`, `font-medium`, `--fg-primary`. Same hint stays beneath label, sentence-case sans.  |
| Settings list-state nav row on phone     | 12 px py × 12.5 px muted ink, left-bar accent slot, no glyph  | 12 px py × 16 px / `text-base` `font-medium` primary ink, optional secondary value line, chevron-right glyph, no left-bar |
| Group separators on phone (settings)     | Uppercase 10 px monospace muted (`STORY`, `GENERATION`, etc.) | Sentence-case caption, `text-xs` `--fg-secondary`, generous gap above each group                                          |
| Density default per tier                 | compact desktop / regular phone+tablet                        | **Unchanged**. Mobile rides the 44 pt floor; user can override                                                            |

## Substrate change — stacked form-row rule

Today's `.field-row` is a 2-col CSS grid sized `180px 1fr` on desktop,
shrinking to `120px 1fr` at `< 1024 px`. The same primitive is
consumed by all four 2-pane surfaces:
[story-settings](../ui/screens/story-settings/story-settings.md),
[app-settings](../ui/screens/app-settings/app-settings.md),
[world](../ui/screens/world/world.md),
[plot](../ui/screens/plot/plot.md), plus
[vault calendar detail](../ui/screens/vault/calendars/calendars.md).
Group D's tighter 90 px label override scoped to `.profile-body` and
`.narrative-card` accordions sits on top of this base.

### Container-keyed form-row layout

Form rows render as a 2-col grid (label-left, input-right) when their
container is `≥ 640 px` wide, and as a stacked single-column block
(label-above, input-below) when their container is `< 640 px` wide.
Keyed on the **form container's** width via container queries, not
on viewport tier. This separates two concerns cleanly:

- **Viewport size** drives the master-detail split (list ↔ detail
  as separate phone screens vs. side-by-side rail+content on
  tablet+desktop) — already pinned by
  [`mobile/collapse.md → Two-pane navigation surfaces`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
- **Container size** drives the form-row layout inside whichever
  detail surface the user is looking at.

Result: tablet portrait detail panes (~544 px on iPad mini, ~620 px
on iPad portrait — both narrower than the phone tier boundary) get
stacked rows automatically. Tablet landscape detail panes (~820 px)
stay 2-col. Phone (full-bleed ~360-430 px) stacks. Desktop (form
max-width ~920 px) stays 2-col. A user resizing a desktop window
narrow, or splitting the screen vertically, also gets stacked rows
if their form container drops below the threshold.

### Stacked-row visual treatment

When stacked:

- **Label** sits on its own line above the input. Sentence-case,
  `--font-ui` (system sans), 14 px / `text-sm`, `font-medium`,
  `--fg-primary`. Drops the uppercase / monospace / letter-spacing
  chrome the desktop pane carries.
- **Hint** sits beneath the label, above the input. Sentence-case
  sans, 12 px / `text-xs`, `--fg-secondary`. No monospace.
- **Input** consumes the full content width of the form container.
  Control height inherits from the active density (regular default
  on phone = 44 px, meeting the tap-target floor).
- **Spacing.** ~6 px between label and input, ~16 px between rows.

When 2-col (container `≥ 640 px`):

- Existing desktop aesthetic preserved — 11 px uppercase monospace
  label, label-left / input-right grid, 90 px override inside
  accordion bodies for the densest editors. No change.

### Inline-row exceptions (stay inline regardless of container width)

- **[`SwitchRow`](../ui/patterns/forms.md#switchrow-pattern)** —
  label+hint on the left, switch on the right. Already mobile-native
  by design.
- **Slider rows** — `[—————O—————] [42]`. Slider track + numeric
  input stay inline with each other; the **label** above them
  follows the stacked rule on narrow containers.
- **Segment selectors** — segment IS the input. Label above on
  narrow containers, segment as a single inline strip below.
- **Select (radio mode)** — option list is already vertically
  stacked tappable cards. Label above the list on narrow
  containers, list below. Within each option row, **label and
  description stack vertically next to the radio dot** at every
  tier, not just narrow — that's the real component shape; the
  current wireframe rendering them side-by-side is incorrect and
  gets corrected during wireframe updates.
- **Select (dropdown / segment mode)** — trigger is one line,
  composes naturally with the stacked rule.

### Group D's 90 px override scope narrows

`.profile-body .field-row` and `.narrative-card .field-row` keep
their 90 px label-column override **only when the container is
`≥ 640 px`**. Below the threshold the stacked rule subsumes it —
the tighter override is meaningless when there's no label column to
shrink. Net: the override now applies on tablet landscape and
desktop accordion-body editors only; tablet portrait and phone
accordion bodies stack like everything else.

## Settings-specific — list-state nav row, phone shape

Settings (story-settings, app-settings) is the only surface family
whose list-state surfaces a vertical scroll list of section-grouped
tab labels.
[World](../ui/screens/world/world.md) and
[plot](../ui/screens/plot/plot.md)'s list panes are entity-row
content with the
[entity row pattern](../ui/patterns/entity.md) carrying the visual
weight (kind icons, indicators, recently-classified accent) — they
have their own row primitive and aren't in scope for this section.

### Phone nav-row shape

On phone tier, the settings list-state's `.nav-item` rows render
as:

- **Tap target ≥ 44 pt** (12 px row-py at regular density × 16 px
  label / `text-base` × ~24 px line-height = ~48 pt total). Above
  the floor with typography-driven margin; no padding overshoot.
  Hard `min-height: 44 px` floor enforced on the row to protect
  against compact-density user override.
- **Label** sentence-case sans, 16 px / `text-base`, `font-medium`,
  `--fg-primary`. Drops the muted ink — labels are the row's
  primary content, not chrome.
- **Optional secondary line** — small caption, `text-sm`,
  `--fg-secondary`, single-line ellipsis on overflow. Surfaces a
  current-value hint where one obviously exists. Examples:
  - Appearance → theme name (`Default Light`).
  - Language → language code or name (`en-US`).
  - Calendar → calendar name (`Earth (Gregorian)`).
  - Memory / Translation / Composer / Providers / Profiles /
    Diagnostics / About / Data → no secondary (multi-setting tabs
    with no single representative value). Surfaces decide per row;
    default is omit.
- **Chevron-right `›`** at the row's right edge, `--fg-muted`.
  Standard drill-down affordance. Phone-only — absent on
  tablet+desktop where the rail stays in place and the row doesn't
  drill anywhere.
- **No left-bar accent on phone.** Active state lives only on
  tablet+desktop where the rail persists. Phone has no "current"
  row — the user tapped, drilled, and is now in the detail screen;
  the list isn't visible.
- **Row dividers** — thin `--border` line between rows within a
  group; absent at group boundaries (the gap below carries the
  separation).

### Group separators

Replace the uppercase chrome treatment with a sentence-case caption
header:

- Sentence case: `Story`, `Settings`, `Generation`, `Story defaults`,
  `App`. Drops the uppercase letter-spacing.
- Caption styling: `text-xs` / 12 px, `--fg-secondary`,
  `font-medium`, `--font-ui` (no monospace).
- ~24 px gap above each group header (between previous group's
  last row and this header), ~8 px gap below header (between header
  and the group's first row).
- First group's header still renders even though there's no group
  above — visual consistency, not functional necessity.

### Tablet+desktop list-state nav row stays as-is

Rail is always visible at those tiers; the existing `.nav-item`
shape (compact, muted, left-bar accent on active) reads cleanly in
a side-rail context. No reason to change. Phone-only redesign.

## Cross-surface ripple

The stacked form-row rule is a substrate change consumed by every
surface that uses `.field-row`:

| Surface          | Mobile expression touch                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| story-settings   | List-state nav row redesign + form-row stacked rule                                                                                                                                                                                                                                                    |
| app-settings     | List-state nav row redesign + form-row stacked rule                                                                                                                                                                                                                                                    |
| world            | Form-row stacked rule (no list-state nav row redesign — entity rows stay)                                                                                                                                                                                                                              |
| plot             | Same as world                                                                                                                                                                                                                                                                                          |
| vault (calendar) | Form-row stacked rule (single-pane, no list-state)                                                                                                                                                                                                                                                     |
| wizard           | Per Group A's `.field-row` consumer note in [`2026-05-01-mobile-group-a-entry-flow.md`](./2026-05-01-mobile-group-a-entry-flow.md), the calendar pickrow's two-column stack already shipped. Form-row rule applies if any other 2-col `.field-row` lives in the wizard; verify during wireframe update |

The rule lands canonically in
[`patterns/forms.md`](../ui/patterns/forms.md) under a new
`## Form rows — stacked-on-narrow-container` section. Per-screen
mobile-expression sections in the five surfaces above amend their
existing form-row prose to cite the new rule rather than restating
it. Group D's "intentional repeated prose" pattern between
story-settings and app-settings continues — story-settings is the
primary, app-settings cross-references for shared parts, distinct
prose only where the surface diverges.

## Adversarial pass

**Load-bearing assumption.** Container-query support varies by
platform. NativeWind 4 supports container queries on web (where it
compiles to CSS); on native it has to fall back to width-measurement
via `onLayout` or a `useFormWidth()` hook. First-paint flicker is
possible if the measurement runs after initial mount. The doc
treats this as an implementation detail rather than a hard
guarantee — production may pick `useTier()`-driven gating
(`isPhone || (isTablet && railVisible)`) on native and miss the
"narrow desktop window" edge case gracefully. Worth flagging in
the patterns/forms.md prose so the rule isn't read as
"container queries everywhere or bust."

**Edge cases.**

- **Phone landscape** (~700-900 px, lands in tablet tier per
  [`mobile/responsive.md`](../ui/foundations/mobile/responsive.md)).
  Detail pane width with rail visible: ~500-700 px. Container query
  picks the right shape regardless of tier classification — narrow
  detail pane stacks even though the surrounding chrome is
  tablet-tier rail+content. Continuous rotation behavior; no
  surprise.
- **Tablet portrait, rail collapsed.** No collapse-rail toggle
  exists on tablet today. If one ever ships, detail pane jumps
  ~544 → ~744 px crossing the 640 container threshold. Form rows
  re-flow live. Correct behavior.
- **Phone with very long secondary line.** "Calendar — A Very
  Long Custom Calendar Name" overflows. Single-line ellipsis
  truncation. Tap-to-tooltip (per
  [`mobile/touch.md → Tap-to-tooltip on inert chrome text`](../ui/foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text))
  is for inert chrome text — secondary line on a tappable row is
  semantically part of the tappable affordance, so no tooltip
  needed; the row drills into the tab where the full value is
  editable.
- **Empty state** for a tab whose secondary would otherwise show
  a value (e.g. Calendar before any calendar is configured).
  Secondary omitted, label alone renders. Surfaces don't lie about
  state.
- **Long translated labels.** German equivalents that double word
  length compose better with stacked-on-narrow-container than 2-col
  — stacked label gets its own line, doesn't fight input width.
  Incidental i18n win.
- **SwitchRow inside a stacked-form context.** SwitchRow is its
  own row primitive, not a `.field-row` consumer; it doesn't
  compose inside a `.field-row`. The two coexist at the same
  vertical level inside a form. No nesting or layout collision.
- **Compact density user override on phone** drops list-nav row
  to ~32 pt (well below 44 pt floor). The hard `min-height: 44 px`
  on phone-tier `.nav-item` rows protects this; form input
  controls likewise enforce a 44 px floor on phone (they
  already use `--control-h-md`; adding a hard floor at the
  phone-tier wrapper protects against the user override).

**Read-site impact.**

- `app-settings.md → Mobile expression` currently says: _"The 120
  px label rule that applies to the main settings rows ... shrinks
  further to 90 px inside `.profile-body` and `.narrative-card`."_
  Rephrase: stacked single-column on narrow containers; on wide
  containers (tablet landscape, desktop) the 90 px override applies
  inside accordion editor bodies.
- `story-settings.md → Mobile expression` says: _"Form-field rows
  in detail content use the same `.field-row` shape as the World /
  Plot detail panes — 180 px label column on desktop, shrinking to
  120 px on tablet and phone."_ Rephrase to cite the stacked rule.
- `world.md`, `plot.md`, vault `calendars.md` — each gets a
  one-line amendment to their mobile expression's form-row prose.

**Doc-integration cascades.**

- **New rule home.**
  [`patterns/forms.md`](../ui/patterns/forms.md) is the canonical
  home — it already hosts the Select primitive and the SwitchRow
  pattern. Add a `## Form rows — stacked-on-narrow-container`
  section. [`mobile/touch.md`](../ui/foundations/mobile/touch.md)
  picks up a brief cross-reference under its tier-shape coverage.
- **Wireframe updates.** Five wireframes get touched:
  - `app-settings.html`, `story-settings.html` — phone-tier
    @container blocks redo the form-row CSS for stacked + new
    label aesthetic; phone-tier nav-row CSS implements the
    redesigned shape (chevron, secondary line, sentence-case
    caption headers, drop left-bar accent on phone-only).
  - `world.html`, `plot.html`, `calendars.html` (vault) —
    container-query rule on the form wrapper picks up stacked
    layout when the detail pane is narrow.
  - **All five also get the Select radio mode wireframe correction**
    (label+description stacked vertically next to the radio dot,
    not side-by-side) where the radio mode appears.
- **Heading rename impact.** None. No existing headings rename;
  new sections added.

**Followups in / out.**

- **Out (partial resolution).**
  [`Settings screens — adopt SwitchRow pattern`](../followups.md#settings-screens--adopt-switchrow-pattern)
  remains open — it tracks the screen-side implementation work
  (wiring SwitchRow into Story Settings panels, normalizing label
  / hint copy, ensuring full-panel-width rows). This redesign
  doesn't do that wiring, but firms the visual context SwitchRow
  sits inside on phone (sibling rows above and below stack
  label-on-top). Followup entry stays.
- **In (none).** Nothing genuinely deferred by this design.

**Patterns adopted on a new surface.** The new
`## Form rows — stacked-on-narrow-container` section in
`patterns/forms.md` gets cited by five surfaces' mobile-expression
sections (story-settings, app-settings, world, plot, vault
calendars). The pattern's `Used by` list (or equivalent), if it
maintains one, gets all five added.

**Boilerplate detection — incoming.** Both settings docs'
`## Mobile expression` sections share substantial prose by Group D's
explicit choice. Continuing that pattern: story-settings is the
primary canonical statement; app-settings cross-references for the
form-row rule and for the list-state nav row redesign (the rules
themselves apply identically). Distinct prose only where the
surface diverges (top-bar variant, error banner, provider
accordion, profile editors).

**Missing perspective.**

- **Wireframe hardcoded values.** Wireframes use vanilla CSS, not
  density tokens. The current values (7 px input padding, 14 px
  row gap, 11 px monospace label) bake in the desktop aesthetic.
  Updating the phone-tier @container blocks to render the new
  stacked aesthetic is part of the wireframe-update step — so
  reviewers see what the spec means visually rather than reading
  the prose against an unchanged wireframe.
- **Density toggle UI itself.** App Settings → Appearance hosts
  the density toggle. The toggle UI inherits the new look on
  phone (its own form rows stack, its own switch row stays
  inline). No functional change to the toggle's semantics.
- **Cross-platform.** Identical rule on iOS / Android / Electron.
  Implementation mechanism varies (CSS container queries on web,
  measurement hook on native) but the behavior is the same.

**Verified vs. assumed.**

- **Verified.** SwitchRow is a separate row primitive with its
  own inline shape — confirmed in
  [`components/ui/switch-row.tsx`](../../components/ui/switch-row.tsx).
  Stacked form-row rule doesn't propagate into it. Density tokens
  exist for compact / regular / comfortable per `--control-h-*`
  / `--row-py-*` / `--row-px-*` and are consumed by the existing
  density provider. Tier defaults (compact desktop / regular
  phone+tablet) are pinned in
  [`spacing.md → Density toggle`](../ui/foundations/spacing.md).
- **Assumed.** Production form-row implementation can adopt the
  stacked variant via Tailwind class composition + container query
  on web, with a width-measurement hook fallback on native. Not
  yet implemented for any v1 surface; the design treats it as
  achievable, not yet exercised. Implementation-cost surprises
  during phase 3 settings wiring would be the place to revise.

## Integration plan

**Files changed.**

- [`docs/ui/patterns/forms.md`](../ui/patterns/forms.md) — add
  `## Form rows — stacked-on-narrow-container` section with the
  rule, the visual treatment for stacked + 2-col, the inline-row
  exceptions list, and the implementation note (CSS container
  queries on web, measurement hook on native).
- [`docs/ui/foundations/mobile/touch.md`](../ui/foundations/mobile/touch.md)
  — add a one-line cross-reference under tier-shape coverage
  pointing to the new forms.md section. The tap-target floor
  enforcement (44 px hard min-height on phone list-nav rows
  regardless of density override) lands here, since touch-target
  policy is touch.md's home.
- [`docs/ui/screens/story-settings/story-settings.md`](../ui/screens/story-settings/story-settings.md)
  — `## Mobile expression` section gets two amendments:
  list-state nav row redesign (label aesthetic, secondary line
  rule, chevron, group separators); form-field rows cite the
  new stacked-on-narrow-container rule and drop the desktop-pane
  120 px description.
- [`docs/ui/screens/story-settings/story-settings.html`](../ui/screens/story-settings/story-settings.html)
  — phone-tier @container block: new nav-item CSS, container query
  on the form wrapper for stacked rows, Select radio mode label
  +description stacked layout.
- [`docs/ui/screens/app-settings/app-settings.md`](../ui/screens/app-settings/app-settings.md)
  — same two amendments as story-settings, cross-referencing where
  prose overlaps (form-row rule cited, list-state nav row redesign
  cited, distinct prose for top-bar variant + error banner +
  provider accordion).
- [`docs/ui/screens/app-settings/app-settings.html`](../ui/screens/app-settings/app-settings.html)
  — same wireframe updates as story-settings.html.
- [`docs/ui/screens/world/world.md`](../ui/screens/world/world.md),
  [`docs/ui/screens/plot/plot.md`](../ui/screens/plot/plot.md) —
  `## Mobile expression` form-row prose amends to cite the new
  rule. Single-line edit each.
- [`docs/ui/screens/world/world.html`](../ui/screens/world/world.html),
  [`docs/ui/screens/plot/plot.html`](../ui/screens/plot/plot.html)
  — container query on the form wrapper; Select radio mode
  correction where present.
- [`docs/ui/screens/vault/calendars/calendars.md`](../ui/screens/vault/calendars/calendars.md)
  — `## Mobile expression` form-row prose amends to cite the new
  rule.
- [`docs/ui/screens/vault/calendars/calendars.html`](../ui/screens/vault/calendars/calendars.html)
  — container query on form wrapper; Select radio mode correction
  where present.

**Renames.** None. New sections added; no headings renamed.

**Patterns adopted on a new surface.** The new
`## Form rows — stacked-on-narrow-container` rule in `forms.md`
gets cited by five surfaces (story-settings, app-settings, world,
plot, vault calendars). Each adoption noted in the pattern's
`Used by` accounting if `forms.md` maintains one.

**Followups resolved.** None. (The `Settings screens — adopt
SwitchRow pattern` followup stays open — it covers screen-side
implementation, not the design pinned here.)

**Followups introduced.** None.

**Wireframes updated.** Five — story-settings, app-settings,
world, plot, vault calendars. Each gets:

- (story-settings, app-settings only) phone-tier nav-item CSS
  rewrite per Section 2.
- Container-query-driven stacked form-row CSS per Section 1.
- Select radio mode correction (label + description stacked next
  to the radio dot) where the radio mode appears. This is a
  wireframe-bug fix, not a design rule change.

**Intentional repeated prose.** story-settings.md and
app-settings.md `## Mobile expression` sections deliberately share
prose for the form-row rule and the list-state nav row redesign —
the rules apply identically. story-settings is canonical;
app-settings cross-references. Distinct prose only where the
surface diverges (top-bar variant, error banner copy, provider /
profile accordion specifics).
