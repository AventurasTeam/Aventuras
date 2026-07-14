# Actions menu

**Wireframe:** [`actions-menu.html`](./actions-menu.html) — interactive

The Actions menu (`⚲` / `Cmd-K`) is the app's universal command
surface — one searchable place that reaches every self-contained
command the current context supports. It is **not** a true command
palette: it is a deliberately curated, two-zone menu.

The platform-agnostic philosophy — desktop overlay opened by
`Cmd/Ctrl-K` or the top-bar icon, mobile bottom sheet, the user
label "Actions" — lives in
[`principles.md → Actions`](../principles.md#actions--platform-agnostic-action-directory).
This doc owns the menu's content, structure, and behavior.

Used by: every screen with chrome — reader-composer, world, plot,
chapter-timeline, story-settings, app-settings, story-list,
diagnostics. The curated-core zone renders on all of them; the
contextual zone varies by surface (per
[Contextual zone](#contextual-zone)
below).

## The two zones

The menu is a **hybrid**: a global **curated core** plus a
screen-specific **contextual zone**. Both zones are governed by one
rule.

**Inclusion test.** An action is menu-eligible iff it is a
**self-contained command** — invokable in one step, operating on
the story or the current screen as a whole, with no pre-selected
target and no dependence on a focused UI element. Disqualified by
construction:

- **Per-item actions** — need a target selected first (`Edit this
entry`, `Delete this entity`). There is no "this" without a
  selection.
- **Live view-state controls** — filter chips, sort toggles,
  search. These are display state, not discrete commands.

The test partitions the zones: the **curated core** is the
self-contained commands that are _global_ (available regardless of
screen); the **contextual zone** is the self-contained commands
that are _screen-specific_. Curation stays a per-screen judgment —
a screen author lists their commands and marks which are primary —
but it is bounded and testable, not a blank page.

## Anatomy

Top to bottom:

1. **Search field** — pinned at the top, filters live across both
   zones as the user types.
2. **Contextual zone** — header `ON THIS SCREEN`, then the current
   screen's contextual entries. **Omitted entirely** — header
   included — when the screen has no contextual entries.
3. **Separator**.
4. **Curated core** — grouped `GO TO` / `STORY TOOLS` / `APP`.

**Ordering.** Contextual zone first (relevance — the screen's own
actions are the likely target), core second (stable). The core's
vertical position shifts slightly with contextual count; this is
acceptable because contextual zones are small (0–4 entries) and
keyboard users type-to-filter.

**Self-omit.** A navigation entry omits itself on its own surface
— `Open World` does not appear in World's menu — mirroring the
`Story Settings` gear's absence on Story Settings
([`Settings icon scope`](../principles.md#settings-icon-scope)).

**Search.** Filtering is a case-insensitive substring match on the
rendered (translated) label, across both zones. A group whose
entries all filter out collapses away — header included; clearing
the field restores the full structure. The menu opens **fresh**
each time — no sticky query, scroll position, or recents.

## Open surface — composes SearchableOverlayList

The menu composes
[`SearchableOverlayList`](./searchable-overlay-list.md) in
`searchPlacement: 'in-overlay'` mode — per-tier popover/Sheet
dispatch, type-to-filter, virtualization, keyboard nav — the same
way [`provider-model-picker`](./provider-model-picker.md) does:
reuse the substrate, own the domain layer. It does **not** compose
the [`Autocomplete-with-create`](./forms.md#autocomplete-with-create-primitive)
primitive directly (that is a single-value form control with a
`+ Add new` tail row — wrong semantics; the Actions menu fires
commands and has no create row).

- **Trigger** — the `⚲` top-bar icon
  ([`iconography.md`](../foundations/iconography.md#top-bar--chrome))
  plus `Cmd/Ctrl-K`; the menu owns the keybind and drives the
  substrate's controlled `open`.
- **Desktop / tablet (web)** — anchored **Popover**, ~340 px wide.
  `autofocusSearch: 'web-only'` — search autofocused (`Cmd-K`
  expects to type).
- **Tablet / phone (native)** — Popover (tablet) or bottom **Sheet**
  (phone, `sheetSize` tracking content volume). Search **not**
  autofocused — `autofocusSearch: 'web-only'` keeps the soft keyboard
  down so the action list stays visible; the menu is browse-first on
  touch regardless of form factor.

## Inventory

### Curated core

Three groups.

**`GO TO`** — story-scoped navigation. Present only when a story is
open. Each entry self-omits on its own surface.

- Open Reader · Open World · Open Plot · Open Chapter Timeline ·
  Open Story Settings

**`STORY TOOLS`** — story-scoped commands. Present only when a
story is open.

- **Set lead character…** — opens the character picker. Gated:
  ≥ 1 character entity exists.
- **Flip era…** — opens the era-flip modal. Gated: the active
  calendar has `eras !== null`.
- **Close chapter…** — opens the chapter-close modal. Gated by the
  chapter-close feature's own availability predicate.

**`APP`** — always present wherever the menu renders. Each entry
self-omits on its own surface.

- Return to Library · Open App Settings · **Open Diagnostics Hub**
  (gated: `app_settings.diagnostics.enabled`)

**Off-story collapse.** On Story List, App Settings, and
Diagnostics no story is active — `GO TO` and `STORY TOOLS` vanish
entirely; only `APP` survives. The menu is rich in-story, thin
off-story, by design.

`Close chapter` and `Flip era` are story-wide mutations (Chapter
Timeline closes chapters too; era-flip is a universal route), so
they are core `STORY TOOLS` available on every in-story surface —
not reader-contextual.

### Contextual zone

| Surface                                                             | `ON THIS SCREEN` entries                            |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| [Reader / composer](../screens/reader-composer/reader-composer.md)  | Jump to bottom                                      |
| [World](../screens/world/world.md)                                  | Add entity… · Add lore…                             |
| [Plot](../screens/plot/plot.md)                                     | Add thread… · Add happening…                        |
| [Story List](../screens/story-list/story-list.md)                   | New story… · Import story…                          |
| [Chapter Timeline](../screens/chapter-timeline/chapter-timeline.md) | _(empty — zone omitted)_                            |
| [Story Settings](../screens/story-settings/story-settings.md)       | _(empty — all actions are per-tab edits / per-row)_ |
| [App Settings](../screens/app-settings/app-settings.md)             | _(empty for v1 — see below)_                        |
| [Diagnostics](../screens/diagnostics/diagnostics.md)                | _(empty — all actions are view-state / per-row)_    |

App Settings' `Full backup` / `Restore` / `Export all` pass the
inclusion test, but Actions-menu surfacing of backup/export is
already deferred in [`parked.md`](../../parked.md) pending its own
pass — they stay out of the v1 menu. When that pass lands, App
Settings' contextual zone gains them.

The `…` suffix marks an entry that opens a further surface
(picker, modal, flow). Plain navigation and immediate commands
(`Jump to bottom`) carry no suffix.

## Surface coverage

The menu renders on **every surface with top-bar chrome**. The
only opt-outs are the **Wizard** (focused modal flow — chrome _is_
its action vocabulary) and **Onboarding** (chromeless), both
already documented in
[`principles.md → Top-bar design rule`](../principles.md#top-bar-design-rule).
App Settings and Diagnostics keep the menu despite thin contents:
the wizard's "near-empty is worse than no menu" reasoning is
modal-flow-specific, an icon that appears and disappears across
ordinary destinations is the worse papercut, and the thinness
self-corrects as parked backup/export features land.

**Scope follows screen class, not story-booted state.** App-level
surfaces (Story List, App Settings, Diagnostics) show only `APP`
plus their contextual zone, even when a story is booted in the
background — mirroring
[`Settings icon scope`](../principles.md#settings-icon-scope).

Worst case: App Settings with diagnostics off shows a single
`APP` entry (`Return to Library`). Accepted — the menu stays
consistent and fills in as parked features land; do not pad it.

## Behavior

**Open / close.** Desktop: `⚲` click or `Cmd/Ctrl-K` toggles the
Popover; `Esc`, outside-click, or activating any entry closes it,
returning focus to `⚲`. Phone: `⚲` tap opens the Sheet; drag-down,
scrim-tap, system-back, or activating an entry closes it.

**Inert under a blocking overlay.** `Cmd/Ctrl-K` and the `⚲`
trigger do nothing while a modal, AlertDialog, or other Sheet owns
the surface — Sheet-over-Sheet is disallowed per
[`overlays.md`](./overlays.md).

**Activation** — three outcomes, all of which **close the menu
first**:

- _Navigation_ (`Open World`, `Return to Library`…) → route via the
  standard navigation path, inheriting any
  [stack-aware Return](../principles.md#stack-aware-return) and
  navigate-away guards. The menu adds no bespoke guard.
- _Opens a further surface_ (`Set lead character…`, `Flip era…`,
  `New story…`, `Add entity…`…) → open that modal / picker / flow.
- _Immediate_ (`Jump to bottom`) → perform at once.

## Gating

Two distinct mechanisms — do not conflate them:

- **Capability gating** — the feature does not apply here
  (`eras: null`, diagnostics off, no character entity for
  `Set lead`). The entry is **hidden / omitted entirely**. A
  directory should not list dead entries, and search must not
  surface un-actionable results.
- **In-flight gating** — the feature applies but a pipeline is
  running. Mutating entries (`Flip era`, `Close chapter`,
  `Set lead`, `Add entity/lore/thread/happening`) render
  **disabled with the uniform tooltip** per
  [`Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation)
  — shown, not hidden, because the block is temporary. Navigation
  and the jump commands are never in-flight-gated.

In-flight gating is **reactive** — entries enable/disable live
while the menu is open, driven by the pipeline event stream.

## Keyboard & ARIA

The combobox/listbox ARIA shape, `aria-activedescendant` highlight
tracking, the auto-highlight rule, the focus trap, and `Esc`-to-close
are all provided by
[`SearchableOverlayList`](./searchable-overlay-list.md#structure--aria)
— this menu is the substrate's Shape 2 (`in-overlay`) at every tier.
It is the combobox + listbox pattern, not the menu pattern (a
`role="menu"` forbids a textbox child), so the container keeps
`role="dialog"` and does **not** use the `accessibilityRole="menu"`
override. The menu takes the substrate defaults
`escClearsQueryFirst: false` (`Esc` closes in one press) and
`autofocusSearch: 'web-only'`.

Actions-menu-specific ARIA: the zone and group sections carry
`role="group"` with an `aria-label` (`On this screen`, `Go to`,
`Story tools`, `App`). Entry labels, group headers, the search
placeholder, and the `No actions match` empty line are translatable
user-facing strings, routed through the standard translation
surface.
