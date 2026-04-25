# Form-control patterns

Input primitives reused across settings, entity forms, and any
"pick a value" interaction. Sister patterns to
[`entity.md`](./entity.md) (entity-form generation rules that
consume these), [`lists.md`](./lists.md), and
[`data.md`](./data.md).

---

## Select primitive

One primitive, three render modes. Component used everywhere a
"pick one of N values to commit" interaction surfaces in the app.

**Render modes:**

- **`segment`** — horizontal bordered button group. Best for ≤3
  options, label-only.
- **`dropdown`** — collapsed picker. Best for ≥4 options, or any
  cardinality where horizontal space is scarce (chrome carve-out
  below).
- **`radio`** — vertical list with explanatory copy per option.
  Triggered by content shape, not cardinality — when each option
  carries a `description` the segment/dropdown can't surface.

**Auto-derivation cascade:**

```
1. Explicit `mode` prop → use as-is.
2. Any option has a description field → radio.
3. Else if option count ≤ 3 (≤ 2 on mobile, deferred) → segment.
4. Else → dropdown.
```

Trigger for radio is **content shape**; trigger for segment vs
dropdown is **cardinality**. Independent axes.

**Cardinality threshold of 3** is the default for desktop; **bumps
to 2 on mobile** where horizontal real estate is tighter. Mobile
threshold finalizes with the responsive pass.

### Chrome carve-out

The cardinality rule applies in the **content area** — list panes,
detail panes, settings tabs, dialogs, drawers, form fields.

**In chrome** — top bars, sub-headers, toolbars, breadcrumbs —
**dropdown is allowed regardless of cardinality**, because
horizontal space is genuinely scarce.

The boundary is concrete: top of screen vs body. Story-list's sort
dropdown sits in the toolbar above the grid (chrome → dropdown OK
even at 3 options). Plot's segment toggle sits in the list-pane
controls (body → cardinality rule applies).

For genuinely ambiguous cases, **default to the primary cardinality
rule**; the carve-out is for clear chrome cases (top-bar, breadcrumb-
line dropdowns), not "anywhere wide-ish."

### What stays separate

- **Autocomplete / Picker** — own primitive (typeahead, async
  loading, large datasets, "create new" tail action). Used for
  entity-link pickers (`current_location_id`, `equipped_items`,
  etc.) and tag inputs. Same conceptual family as Select but
  different surface area.
- **Filter chips** — own primitive (rounded, wrap-capable layout,
  often paired with `All` accordion behavior). Filtering-centric
  concern, not "pick a value to commit." Folding into Select as a
  `chips` render mode is a possible future move; deferred until
  enough chip-using surfaces converge.

### Storybook

Live demos of each render mode + the auto-derivation rule belong in
a `Patterns/Form controls/Select primitive` MDX page when component
implementation begins. The page cites this principle as canonical
and embeds component stories — no prose duplication. See
[`followups.md → Storybook design-rules pattern setup`](../../followups.md#storybook-design-rules-pattern-setup).
