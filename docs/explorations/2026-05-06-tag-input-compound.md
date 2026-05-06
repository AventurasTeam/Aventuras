# 2026-05-06 — TagInput compound

Design pass to resolve the
[`component-inventory.md → Compounds — needs design`](../ui/component-inventory.md#compounds--needs-design)
hypothesis that TagInput dissolves into a config of
[Autocomplete-with-create](../ui/patterns/forms.md#autocomplete-with-create-primitive).
Outcome: hypothesis refuted. TagInput is its own compound.

## Why it isn't an Autocomplete config

Autocomplete is shaped for **single-value, terminal "search-or-create"**
interactions — its phone Sheet closes on commit, its desktop popover
goes away. Tag entry is **multi-value, iterative, stay-open** —
type, commit, repeat, eventually move on. Different verbs.

The decisive factor is the v1 lean: tags are **free-form string
arrays** (per [`data-model.md`](../data-model.md) — `tags json` on
`stories`, entities, lore, threads, happenings) with no canonical
pool, no per-app taxonomy, no curated suggestion source. With
suggestions out of scope, Autocomplete's whole reason to exist (the
suggestion popover combined with tail-create) is gone — what
remains is a chip-row alongside an input, a peer composition of
[Tag](../ui/patterns/chips.md#tag--pill-labeled-content) and
[Input](../ui/patterns/forms.md#input-primitive).

A hypothetical "Autocomplete `multi` mode" would force Autocomplete
to bifurcate its lifecycle — `commit closes` vs `commit clears,
stay open` — for a feature that doesn't share its core. Bloats the
primitive, blurs the contract. Cleaner to leave Autocomplete alone.

## Compound contract

```ts
type TagInputProps = {
  value: string[] // controlled
  onChange: (next: string[]) => void // fires on add or remove only

  placeholder?: string
  disabled?: boolean
  disabledReason?: string // web title-tooltip, parity with Input/Autocomplete
  'aria-invalid'?: boolean | 'true' | 'false'

  className?: string
  inputClassName?: string

  maxCount?: number // total tags ceiling, default unlimited
  maxTagLength?: number // per-tag char cap, default unlimited
}
```

Internal state is `typed: string` — current draft. Private; not
exposed to consumers.

**Three deliberate omissions:**

1. **No `inputValue` controlled prop.** Hosts control the array,
   not the typing draft. Two-axis controlled is bloat for v1
   consumers.
2. **No `onCommit(tag)` callback** separate from `onChange`. Hosts
   diff the array if they need to derive what changed.
3. **No `commitOnBlur` toggle.** Blur-commits is the default and
   not configurable — see _Interaction model_ below for why.

## Interaction model

### Commit triggers

- **Enter / Return** — typed text (trimmed) commits if non-empty
  and non-duplicate. Input clears. Keyboard stays up
  (`blurOnSubmit={false}`) so iterative entry works without a
  re-tap.
- **Comma** — same as Enter, but the comma keystroke is consumed
  (doesn't render in the input).
- **Blur** — typed text commits if non-empty and non-duplicate.
  Input clears.
- **Paste** containing commas or newlines — split on `[,\n]+`,
  trim each piece, push the non-empty non-dupes in order.

### Why blur-commits is the default

The mobile convention across iOS Mail, Apple Notes, iOS Reminders,
Material chip-input, and Mantine TagsInput is overwhelmingly
**blur commits**. Reason: on mobile, the user's "I'm done with
this field" signal is dismissing the keyboard or tapping elsewhere,
not pressing a special key.

Without blur-commit:

1. User types `fantasy`.
2. Taps the page's Save button before pressing Enter.
3. `onChange` array is missing the typed-but-uncommitted tag —
   silent data loss.

The asymmetry favors blur-commit:

- **No blur-commit** — common case ("I moved on") loses data
  silently.
- **Blur-commits** — rare case ("I typed half a word and got
  distracted") commits a junk chip the user can immediately × off.

The chip's × is the safety net; the data loss has no safety net.

### Removal triggers

- **× on chip** (Tag primitive's `removable` affordance) — removes
  that chip. Input keeps focus.
- **Backspace on empty input** — removes the last chip. Web fires
  this via `onKeyPress`. Native iOS has a known RN gotcha where
  `onKeyPress` doesn't fire for Backspace on an already-empty
  input — workaround is `onSelectionChange` detecting selection
  at `{start: 0, end: 0}` after an unchanged content event. Web
  baseline; native parity is best-effort.

### Dedupe

Case-insensitive: `array.some(t => t.toLowerCase() === typed.toLowerCase())`.
On dedupe-rejection, **input clears anyway** — the user already
has that tag, no need for an error message.

For v1, `toLowerCase()` (ASCII case fold) is sufficient. Multi-byte
Unicode case folding (`İstanbul` vs `istanbul`) is a one-line
upgrade to `toLocaleLowerCase()` if the failure mode surfaces.

### Caps

- `maxCount` reached — input visually disabled (faded), commits
  become noops. Chip × still works.
- `maxTagLength` — underlying TextInput's `maxLength` prop.
  Paste-split pieces over the cap are truncated.

## Cross-tier shape

**Inline at every tier. No Sheet, no Popover.** The compound
renders directly inside whatever form-row hosts it.

- **Phone** — input min-height `control-lg` (44 px touch floor).
- **Tablet / Desktop** — input min-height `control-md`.
- **Stacked vs 2-col** — handled by
  [FormRow](../ui/patterns/forms.md#form-rows--stacked-on-narrow-container)
  at the host level; TagInput just fills the input slot the same
  way Input and Autocomplete do.

No `useTier()` dispatch inside the compound. Same component, same
layout, density-driven sizing.

## Visual layout

Single bordered surface (Input-shaped border, matching focus-ring).
Contents wrap inline with the typing input:

```
┌──────────────────────────────────────────────────┐
│ [sci-fi ×] [fantasy ×] [dystopia ×] [type tag…]  │
└──────────────────────────────────────────────────┘
```

- Chips: `flex-row flex-wrap items-center gap-1.5`.
- Inline TextInput appended after the last chip with
  `flex-1 min-w-[60px]` so it grows but never disappears when
  chips fill the row.
- Focus state lifts to the wrapper (same pattern Input uses when
  adornments are present).

**Alternative considered:** chips above the input as a separate
row. Less common idiom, takes more vertical space when chip count
is low, breaks the tokenized-input mental model. Rejected.

## What this design defers

- **Suggestions source** — if a host later wants reuse-from-pool
  (canonical taxonomy, project-wide dedupe), TagInput grows an
  optional `suggestions: string[]` prop with a popover or sheet
  beneath the input. Out of scope per the free-form-strings v1
  lean.
- **Click-to-edit chip** — tap a chip to edit its text in-place.
  Today: × and re-add. v2+.
- **Drag-reorder** — order-preserving array, no UI for moving.
  Today: order-of-entry. v2+.

None of these block v1; all are clean extension axes.

## Implementation flag

Tag primitive's chip text behavior at long content needs verifying
during the build pass — confirm whether long single tags wrap chip
width past the surface or truncate cleanly. Apply `numberOfLines={1}`
together with truncate-with-ellipsis on the chip if needed.

## Adversarial summary

**Load-bearing assumption:** tags are free-form strings, no
canonical pool. If wrong — TagInput grows a `suggestions` prop and
a popover. Core compound shape doesn't change. Robust.

**Verified:** Autocomplete's source shape, Tag primitive's API,
`tags` as `string[]` in data-model, the existing forms.md note
flagging tag pickers as a future Autocomplete consumer (which this
design explicitly resolves the other way).

**Assumed:** tags don't need translation (domain hint: metadata,
not narrative content). Probably safe; not blocking.
