# Era flip affordance — in-story trigger + flip list

Specs the user-facing UI for triggering era flips (writing a row to
[`branch_era_flips`](../data-model.md#era-flips)) and browsing /
deleting existing flips. Resolves the "Era flip affordance
(in-story)" followup.

## Background

The era system is spec'd in
[`calendar-systems/spec.md → Eras`](../calendar-systems/spec.md#eras-hoisted-out-manually-triggered):
flips are user-triggered narrative events — Japanese imperial
reigns, Tolkien's Ages, Warhammer cataclysm-style resets — where
the user marks "from this point on, the era is X." Each flip writes
one row to `branch_era_flips` (`at_worldtime` from a chosen entry's
`metadata.worldTime` + `era_name` free-text). Display semantics are
calendar-driven via `flipMode` (`display-label` / `elapsed-from-flip`
/ `calendar-aligned`); the renderer consults the flip log
automatically.

What's missing: every UI surface that lets a user trigger a flip,
see existing flips on the active branch, or delete one. Today users
have no path. This design fills that gap.

## Decisions

### 1. Three trigger surfaces

The flip is reachable from three places that funnel into the same
modal — only the default anchor entry differs.

- **Time-chip popover — `Flip era…` action.** The reader's existing
  time chip becomes interactive when the calendar has affordances
  to surface (today: era flip on calendars with `eras !== null`).
  Click → small popover anchored to the chip with a `Current era:
<name>` read-only label and the `Flip era…` action. Symmetric
  with the chapter chip ▾ pattern; doesn't add a new chrome
  element. The chip stays passive (no `▾`, no hover affordance,
  no popover) when nothing is surfacable — e.g., `eras: null`
  calendars today.
- **Actions menu — `Flip era…`.** Universal route, also gated by
  `eras !== null`. Mirror of how chapter close exists in both the
  chapter popover and the Actions menu.
- **Per-entry icon — `📅 Flip era from this entry`.** New entry in
  the [icon-actions glyph vocabulary](../ui/patterns/icon-actions.md#glyph-vocabulary).
  Renders on user and AI rows when the active calendar has eras;
  hidden otherwise. Covers the retcon case without needing the
  deferred entry-ref picker — clicking a specific entry's icon
  defaults the modal's anchor to that entry.

The time-chip popover and Actions paths default the modal's anchor
to the **latest entry's `worldTime`**. The per-entry path defaults
to the chosen entry's `worldTime`.

The time-chip popover positions naturally as the home for **other
calendar-time affordances** when they land — the deferred
[manual `worldTime` correction](../followups.md#manual-worldtime-correction--cascade-vs-jump--downstream-blast-radius)
fits here directly, instead of growing chrome again at that pass.

#### Per-entry icon — interaction with the existing icon row

AI entries currently carry edit / regen / branch / delete (4
icons). Adding `📅 Flip era` makes 5 — but only when the active
calendar has eras. User entries today carry edit / delete (2);
adding the flip icon makes 3 conditional. The conditional clutter
appears only where the feature is active, matching how the reader's
branch chip is conditional on branch count.

Visual identity will need to ensure the 5-icon row reads cleanly;
flagged as a follow-up rather than blocking this design.

### 2. Era name input — Autocomplete-with-create primitive

Reuses a new shared primitive landing in
[`patterns/forms.md`](../ui/patterns/forms.md) as part of this
integration: **Autocomplete-with-create**. Already foreshadowed in
that file's "What stays separate" section ("typeahead, async
loading, large datasets, 'create new' tail action") — promoting to
a full pattern section now since it's the cleanest fit for
narrative free-text-with-canonical-suggestions inputs and is
likely to recur (entity-link pickers, tag inputs, future entry-ref
pickers).

For era flip specifically, the primitive is configured with:

- **Source list** = `EraDeclaration.presetNames` (may be empty /
  absent — the primitive collapses cleanly to a free-form input
  in that case).
- **Casing normalization** = canonical (commit form snaps to the
  preset's canonical case on case-insensitive match).
- **Create-tail label** = `Add new era: "<typed>"`.

Full pattern spec — match algorithm, dropdown behavior, casing
normalization, default Enter handling, empty-list collapse — lives
in [`patterns/forms.md`](../ui/patterns/forms.md#autocomplete-with-create-primitive).
This design only configures it.

### 3. Modal — flip-era form

Same modal shape as the
[branch-creation modal](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal):

```
┌──── Flip era ─────────────────────────── × ─┐
│                                              │
│   Flipping at entry 47 (Day 12, Reiwa 6).    │  ← read-only context line
│                                              │
│   Era name *                                 │
│   ┌────────────────────────────────────┐     │
│   │ Hei                                │     │  ← typing
│   └────────────────────────────────────┘     │
│   ┌────────────────────────────────────┐     │
│   │ Heisei                             │     │  ← suggestion (matches preset)
│   │ + Add new era: "Hei"               │     │  ← create-new option
│   └────────────────────────────────────┘     │
│                                              │
│                       [ Cancel ]  [ Flip ]   │
└──────────────────────────────────────────────┘
```

- **Width** ~400px. Centered. Backdrop dim.
- **Context line** — formatted via the active calendar's renderer
  on the chosen entry's `worldTime`. Read-only. Says "start of
  story" instead of `entry 1` when `at_worldtime ≈ 0`.
- **Era name autocomplete** — see [decision 2](#2-era-name-input--autocomplete-with-create-primitive).
  Required; focused on open. Empty-input state shows the full
  `presetNames` list (or just "type a new era name" hint when
  empty/absent presets).
- **Flip button** — disabled until input is non-empty (whitespace
  doesn't count). Enter inside the input also confirms (per default
  behavior above).
- **Cancel** — closes; no row written. Esc and click-outside also
  Cancel.
- **Disabled during in-flight pipelines** — the
  [edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation)
  applies; tooltip copy is principle-owned.

#### Collision guard

`branch_era_flips` enforces unique `(branch_id, at_worldtime)`. If
the chosen anchor entry's `worldTime` matches an existing flip's
`at_worldtime` on the current branch, the modal blocks save with an
inline error:

> An era flip already exists at this moment: **"Heisei"**. Delete it
> from Story Settings → Calendar before flipping again.

Rare in practice (latest-entry default + per-entry trigger keep
flips at distinct times), but enforced cheaply at the modal layer.

### 4. Confirmation flow

No separate "are you sure" step. The modal's form IS the
confirmation. Effects of the flip are immediately visible in the
next render of the time chip and any inline time displays — that's
the feedback. Reversible via CTRL-Z (one delta) per the
[data-model decision](../data-model.md#era-flips).

Same pattern the
[branch-creation modal](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal)
uses, and the same no-toast / no-confirm precedent set by
[lead switching](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).

### 5. Visibility — calendars with `eras: null`

All three trigger surfaces hide when the active calendar has
`eras: null`:

- **Time chip** stays passive (no `▾`, no hover affordance, no
  popover) — there's nothing to surface today. Becomes interactive
  again when a future affordance (e.g., manual `worldTime`
  correction) lands in its popover.
- **Actions menu** entry hides.
- **Per-entry icon** hides on every row.

The flip-list sub-section in Story Settings (see
[decision 6](#6-flip-list--story-settings--calendar-sub-section))
still renders when there are orphan flips to surface for cleanup;
otherwise the sub-section itself hides.

Codified once here rather than repeated per surface.

### 6. Flip list — Story Settings · Calendar sub-section

A new sub-section under the existing
[Calendar tab](../ui/screens/story-settings/story-settings.md#calendar-tab--picker--summary)
in Story Settings. Lives below the calendar picker + summary,
labeled `Era flips on this branch`. Renders only when the current
branch has at least one flip OR the active calendar has eras
(empty-state otherwise hidden — see below).

**Per-row anatomy:**

- **Era name** — the canonical commit form (normalized to preset
  casing where applicable).
- **Anchor display** — `at_worldtime` rendered via the active
  calendar's formatter (e.g., `Reiwa 1 · May 1, 2019`). Shows
  `Start of story` when `at_worldtime = 0`.
- **Inline `×` delete icon** — follows the
  [icon-actions pattern](../ui/patterns/icon-actions.md)
  (always-visible-muted, brighten on hover; disabled during
  in-flight pipelines per
  [hidden-vs-disabled rule](../ui/patterns/icon-actions.md#disabled-vs-hidden)).
- **No inline rename in v1.** Defer; the row is structurally
  simple, deletes are cheap, CTRL-Z is universal. Promote to a
  followup if real demand surfaces.

**Sort.** `at_worldtime` ascending — chronological.

**Branch scope.** The list reflects flips on the **current
branch** only (branch-scoped table). Switching branches via the
reader's branch navigator + returning to Story Settings reloads
the list against the new branch's flips.

**Empty state.** When the active calendar has `eras !== null` but
the branch has no flips:

> No era flips on this branch yet. Use **Flip era…** in the reader
> to mark a new era.

When the active calendar has `eras: null` AND no orphan flips
exist, the sub-section is **hidden entirely** (no header, no body)
— there's nothing meaningful to surface.

**Delete behavior.** Click `×` → inline confirm in place (matching
the [branch-navigator inline delete pattern](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#inline-delete-confirm)):

```
   Reiwa · Reiwa 1 · May 1, 2019
   Delete this flip?       [ Cancel ]  [ Delete ]
```

`Cancel` reverts to the read-only row. `Delete` writes a delete-row
delta and removes the row from the list. CTRL-Z restores.

### 7. Orphan flip handling

When the active calendar has `eras: null` but the branch carries
flips from a previously-active era-supporting calendar (the swap
path documented in
[`calendar-picker.md`](../ui/patterns/calendar-picker.md)),
the flip-list sub-section renders the orphan rows with an inline
annotation:

> **Reiwa** · `Reiwa 1 · May 1, 2019` · `[from previous calendar]` · `×`

Annotation is muted text after the anchor display. Delete still
works the same way. Gives the user a cleanup path; aligns with the
calendar-picker's "kept as orphaned data" decision.

The `at_worldtime` formatting for orphan flips uses the
**previously-active** calendar's renderer if it's still available
(it is — calendar definitions live in `app_settings.calendars` /
`vault_calendars`, not on the story). If the previous calendar was
deleted from Vault, fall back to the raw integer worldTime with a
small `(raw)` annotation.

### 8. Edit-restrictions inheritance

Every trigger surface and the delete affordance disable when a
pipeline transaction is in flight, per the
[edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation).
No new policy — direct inheritance. Tooltip copy is principle-owned
("Generation is in flight. Cancel to edit." / "Chapter close in
progress. Cancel to edit.").

## Adversarial check

Things considered, with verdicts:

- **Three trigger surfaces feels like a lot.** Could collapse to
  chrome-only or Actions-only. Each surface fills a real need:
  chrome is the primary in-narrative tap; Actions is the universal
  route reachable everywhere; per-entry covers the retcon case
  without forcing the deferred entry-ref picker. Symmetric with
  chapter close. Verified, not a regression.
- **Per-entry 5th icon clutter.** AI rows grow from 4 to 5 icons
  on era-supporting calendars. Same conditional-visibility logic
  as the reader's branch chip (only renders when relevant). Visual
  identity will own the row layout when it lands; flagged as a
  followup rather than a blocker.
- **Autocomplete-with-create as a new component.** No precedent in
  current patterns. Adding the spec inline rather than promoting to
  `patterns/forms.md` until a second use case appears. Avoids
  premature abstraction.
- **Casing normalization on preset match.** Could surprise the user
  if they type lowercase and see uppercase commit. Mitigated by:
  the autocomplete dropdown shows the canonical preset case, so the
  user sees the normalized form before committing.
- **`at_worldtime` collision.** Constraint enforced at the modal
  layer with an inline error pointing at the existing flip's name.
  User can resolve by deleting the existing flip first.
- **Flip at 0** (overrides `defaultStartName`). Allowed by
  data-model. Modal's context line reads "start of story" rather
  than "entry 1" — behaviorally identical, just clearer.
- **Calendars without eras getting a stale flip-list section.**
  Empty + no-orphans = sub-section hidden. Empty + orphans = list
  renders so user can clean up. No phantom empty section.
- **Branch switch consistency.** Flip list is branch-scoped by
  construction (`branch_era_flips` keys on `branch_id`). Switching
  branches changes the visible list. Same pattern as every other
  branch-scoped table.
- **Delete during in-flight pipeline.** Disabled per edit-
  restrictions; tooltip explains. No special case.
- **Flip list ordering vs the reader's chronological narrative.**
  Sort `at_worldtime` ascending matches story chronology. Matches
  the data-model invariant that `worldTime` is monotonically non-
  decreasing.
- **Mobile.** Chrome `Flip era…` link adapts to mobile reader
  chrome (tap target sizing); Actions menu adapts as the existing
  mobile pattern does; per-entry icon already follows
  [icon-actions cross-device rules](../ui/patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover).
  Modal already works the same on mobile. Out of scope here in the
  same way the existing wireframes are: desktop-first.
- **Translation.** Era names are **not subject to translation** —
  they function as proper-noun labels (a story event marks the
  start of "Post-Cataclysm" the same way a calendar's preset list
  carries "Reiwa" / "Heisei" — culturally-specific names, not
  translatable copy). The LLM consumes them as labels, not as
  descriptions to comprehend. Decided here to forestall the
  question; no followup needed.

Verified vs assumed:

- **Verified**: data-model schema for `branch_era_flips`, the
  `eras: null` swap behavior in calendar-picker, the
  edit-restrictions principle's gating contract, the existing
  branch-creation modal pattern (used as the form template), the
  icon-actions pattern (used as the per-entry-icon and inline
  delete templates).
- **Assumed but low-risk**: the autocomplete component renders
  cleanly in the calendar's preset-list edge cases (empty / single
  / many). No mockup beyond the wireframe; trust the spec until
  implementation. Visual identity owns the precise treatment.

## New followups generated

- **Per-entry icon-row layout with 5 conditional icons.** Once
  visual identity lands, audit whether 5 icons read cleanly on AI
  rows for era-supporting stories. Possibly group with the
  per-entry overflow menu question (which doesn't currently exist).
- **Inline rename for flips in the Story Settings list.** Deferred
  in v1; revisit if real demand surfaces.

Resolving (removing from `followups.md`):

- "Era flip affordance (in-story)" — designed here.

## Integration plan

One focused commit. Files affected:

**`docs/ui/screens/reader-composer/reader-composer.md`**

- Update the existing `## Top-bar — in-world time display` section
  to note the time chip becomes interactive when there are
  surfaceable affordances (today: era flip on calendars with
  `eras !== null`); add a small sub-section describing the
  time-chip popover (Current era label + `Flip era…` action; future
  affordances anchor here).
- Add a new `## Era flip` section covering: per-entry
  `📅 Flip era from this entry` icon, the flip-era modal spec
  (form, autocomplete reference to forms.md, collision guard,
  Cancel/Flip behavior), edit-restrictions gating.
- Update the per-entry icon-set table to add the conditional
  `📅 flip era` row with a note that it renders only when
  `eras !== null`.

**`docs/ui/screens/reader-composer/reader-composer.html`**

- Make the time chip interactive in the wireframe: add `▾`
  indicator when `eras !== null` (toggle this state via review-bar);
  click opens a small popover with Current era + `Flip era…`
  action.
- Add the per-entry `📅` icon to one example AI/user row in the
  wireframe to show the row composition with eras enabled.
- Add the flip-era modal markup (initially hidden), with a
  review-bar toggle to show / hide / show-with-suggestions /
  show-with-collision-error states.

**`docs/ui/patterns/forms.md`**

- Add a new top-level `## Autocomplete-with-create primitive`
  section as a sibling to the Select primitive. Spec covers: text
  input + filtered dropdown, `+ Add new: "<typed>"` tail option
  appearing when no exact match, case-insensitive matching with
  canonical-case commit, default Enter behavior, empty-source-list
  collapse, edit-restrictions inheritance.
- Update the existing "What stays separate" sub-section to
  cross-reference the new pattern (the autocomplete primitive
  promotion is the resolution of that bullet's TBD).

**`docs/ui/screens/story-settings/story-settings.md`**

- Extend the `## Calendar tab — picker + summary` section by
  appending a `### Era flips on this branch` sub-section. (Heading
  not renamed — preserves the inbound anchor used by
  `calendar-picker.md` and other docs.) Sub-section describes the
  flip-list (per-row anatomy, sort, branch scope, empty state,
  orphan handling, delete flow).

**`docs/ui/screens/story-settings/story-settings.html`**

- Extend the Calendar tab body with the flip-list sub-section
  rendering 2-3 example flips (mix of canonical preset and
  free-form, with one orphan example to demonstrate the swap-aware
  case). Include the inline-delete-confirm state via review-bar
  toggle.

**`docs/ui/patterns/icon-actions.md`**

- Add `📅 flip era` to the
  [glyph vocabulary](../ui/patterns/icon-actions.md#glyph-vocabulary)
  table.

**`docs/calendar-systems/spec.md`**

- Add a one-line cross-reference under
  [`### Eras: hoisted out, manually triggered`](../calendar-systems/spec.md#eras-hoisted-out-manually-triggered)
  pointing at the reader-composer Era flip section for the UI
  surface (rule pattern: schema in calendar-systems, UI in
  ui/screens; the cross-reference makes the round-trip findable).

**`docs/followups.md`**

- Remove the "Era flip affordance (in-story)" entry under UX
  (resolved).
- Add the new followups listed above.

**No principles.md changes.** This design is screen-specific; no
new cross-cutting rule emerges that wouldn't get demoted by the
"single-surface stays single-surface" heuristic.

## Disposition

Per project convention, exploration docs are kept as a record or
removed once integrated — user's call. Default: keep, since this
design touches multiple canonical sections and the doc is the
narrative for the change.
