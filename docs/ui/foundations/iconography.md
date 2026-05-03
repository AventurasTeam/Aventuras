# Iconography

The icon contract for v1. Sister to [`tokens.md`](./tokens.md)
(slot inventory) and [`motion.md`](./motion.md) (the other half of
session 5). This file commits the icon set, stroke weight, sizing
scale, and the canonical Lucide-name mapping for every scratch
glyph in use across the wireframes.

## Icon set — Lucide

**Lucide.** Open-source (ISC), actively maintained, ~1,500 icons
designed for UI; cross-platform packages — `lucide-react` for web
and `lucide-react-native` for native. Default icon companion in
shadcn/ui projects, which the project's stack note in
[`../../tech-stack.md`](../../tech-stack.md) commits to ("shadcn-
style theme CSS vars").

Considered alternatives:

- **Heroicons** (Tailwind's official) — narrower set (~300
  icons), only outline + solid variants; less coverage of v1's
  vocabulary (no clear `git-branch`, no `command`, etc.).
- **Phosphor** — broader set + multiple weights, but multi-
  weight works against the locked single-stroke-weight identity;
  adds bundle size for an axis we don't use.
- **Tabler** — Lucide-comparable in scope and quality but
  smaller adoption in the React/RN ecosystem; less precedent for
  shadcn-aligned projects.

Lucide wins on shadcn-canonical, react/RN parity, tree-shakeable
(only imported icons ship), single-weight default matching the
locked identity.

### What the icon-set choice commits

- v1 ships Lucide as the icon set across web + native.
- All wireframe scratch glyphs (`⚙` / `⛭` / `⎇` / `✎` / etc.) map
  to specific Lucide names in the
  [Glyph vocabulary](#glyph-vocabulary) below.
- Future expansions (custom brand glyphs, marketing
  illustrations) are out of scope; Lucide covers v1's vocabulary.

## Stroke weight + sizing scale

### Stroke weight

**2 px.** Lucide's default — uniform across the entire set. Don't
customize per icon; uniform stroke is the visual identity. The
2 px stroke reads consistently at the three sizing tokens (16 /
20 / 24 px) without per-size adjustment.

`strokeWidth` can be overridden per-use if a specific surface
demands it (rare). Default is 2; any override is justified at
use-site review.

### Sizing scale

Three tokens, structurally locked (per the
[token-class taxonomy](./tokens.md#three-classes)):

| Token       | Value | Use                                                                    |
| ----------- | ----- | ---------------------------------------------------------------------- |
| `--icon-sm` | 16 px | inline with body text, badge icons, list-row glyphs                    |
| `--icon-md` | 20 px | default chrome — buttons, in-line action rows, smaller top-bar buttons |
| `--icon-lg` | 24 px | emphasis chrome — top-bar primary icons, hero glyphs, section heads    |

16 / 20 / 24 is the cross-platform standard progression — Material,
iOS HIG, Android Material all use these or close variants. Lucide
ships at 24 px viewport native; rendering at 16 / 20 px scales
the SVG proportionally with the 2 px stroke remaining visually
consistent.

No `--icon-xl` — v1 surfaces don't need >24 px icons; if a
future hero / illustration surface emerges, the slot can be
added. Same minimal-slot principle that drove session 3's
`--font-display` skip.

### What the sizing scale commits

- 2 px stroke uniform across all icons.
- Three sizing tokens; structurally locked.
- No per-theme variation in stroke or sizing.

## Glyph vocabulary

Maps every scratch glyph in active use across the wireframes to a
canonical Lucide name. Wireframes (`.html` mocks, ASCII layouts in
`.md` docs) **continue to render the scratch glyphs** for visual
placeholder consistency per the
[wireframe-authoring rule](../../conventions.md#wireframe-authoring);
this table is the authoritative reference for component
implementation.

Source-of-truth scratch tables for two specific concern groups
already live in their respective canonical homes — iconography
adds the Lucide-name mapping without duplicating the scratch
content:

- **Per-entry actions** — scratch in
  [`../patterns/icon-actions.md → Glyph vocabulary`](../patterns/icon-actions.md#glyph-vocabulary).
- **Entity kind indicators** — scratch in
  [`../patterns/entity.md → Entity kind indicators`](../patterns/entity.md#entity-kind-indicators--icons-not-text).
- **Top-bar / chrome** — scratch in
  [`../principles.md → Settings icon scope`](../principles.md#settings-icon-scope).

The remaining categories (directional / disclosure / status /
common UI) don't have prior scratch homes; iconography is the
single canonical reference for them.

### Top-bar / chrome

| Concern                                                  | Scratch | Lucide name       |
| -------------------------------------------------------- | ------- | ----------------- |
| App Settings                                             | `⚙`     | `Settings`        |
| Story Settings                                           | `⛭`     | `SlidersVertical` |
| Actions menu (chrome overflow + Cmd-K palette)           | `⚲`     | `MoreVertical`    |
| Return / back                                            | `←`     | `ArrowLeft`       |
| Branch (chip + per-entry; reserved for branch semantics) | `⎇`     | `GitBranch`       |
| Row-level overflow                                       | `⋯`     | `MoreHorizontal`  |

#### Story Settings glyph rationale

`SlidersVertical` (three vertical sliders, classic equalizer /
preferences glyph) was picked over alternatives:

- **Distinct from `Settings` (cog)** — geometrically different
  (parallel lines vs circular form). Honors `principles.md →
Settings icon scope`'s "both icons being 'geary' defeats the
  rule's purpose" rule.
- Still reads as "settings / preferences" — sliders are
  universal settings imagery across modern UI.
- Avoids book/document iconography that would conflate
  "story settings" with "story content."

Considered and rejected: `BookOpen` (reads as "story" not
"settings"), `BookMarked` (same), `Wand2` (reads as "create" not
"configure"), `Layers` (too abstract for top-bar at small sizes).

#### Actions menu glyph rationale

`MoreVertical` (`⋮`) was picked over alternatives:

- **Universal "more options" reading** — no platform coding (Mac
  vs Windows vs Linux all read three-vertical-dots as "more
  options").
- **Clean visual distinction from row-level `MoreHorizontal`
  (`⋯`)** — chrome-level uses vertical dots; row-level uses
  horizontal. Internal consistency without ambiguity.
- The Cmd-K / Ctrl-K shortcut association lives in tooltip +
  onboarding, not in the icon itself.

Considered and rejected: `Command` (Mac-canonical `⌘` symbol;
unfamiliar to Windows/Linux users), `Zap` (lightning; reads
ambiguously as "energy / performance"), `Menu` (hamburger;
conflates with sidebar nav), `Wand2` (too playful for the "flat,
nothing flashy" identity).

### Directional / navigational

| Concern                                    | Scratch | Lucide name                      |
| ------------------------------------------ | ------- | -------------------------------- |
| Forward / "advances to" / right-arrow link | `→`     | `ArrowRight`                     |
| Back / left-arrow link                     | `←`     | `ArrowLeft` (shared with Return) |
| Up / sort-up / scroll-up                   | `↑`     | `ArrowUp`                        |
| Down / sort-down / scroll-down             | `↓`     | `ArrowDown`                      |

### Disclosure carets

| Concern                                          | Scratch   | Lucide name    |
| ------------------------------------------------ | --------- | -------------- |
| Dropdown caret (Select primitive)                | `▾` / `▼` | `ChevronDown`  |
| Disclosure right (collapsed → expanded sideways) | `▸`       | `ChevronRight` |
| Disclosure up (expanded → collapsing upward)     | `▴` / `▲` | `ChevronUp`    |

**Chevrons are distinct from arrows.** Chevrons are
typographically lighter; consistently used for disclosure
semantics across modern UI. Arrows are reserved for navigation /
movement. Mixing them confuses the affordance class.

### Status / state

| Concern                                         | Scratch | Lucide name     |
| ----------------------------------------------- | ------- | --------------- |
| Warning / caution                               | `⚠`     | `AlertTriangle` |
| Confirm / success                               | `✓`     | `Check`         |
| Close / cancel / dismiss (distinct from delete) | `×`     | `X`             |
| Lead character indicator                        | `⭐`    | `Star`          |
| Reasoning indicator (reader-composer)           | `🧠`    | `Brain`         |
| Info / help (reserved)                          | (none)  | `Info`          |

**`X` (close) and `Trash2` (delete) are distinct affordance
classes.** The wireframe scratch `×` is currently shared across
both contexts; foundations splits the canonical Lucide names so
implementation doesn't conflate them:

- `X` = "close this dialog / dismiss this banner / remove this
  chip from a multi-select."
- `Trash2` = "permanently delete this entity / branch / row."

### Per-entry actions

Source scratch in
[`../patterns/icon-actions.md → Glyph vocabulary`](../patterns/icon-actions.md#glyph-vocabulary).

| Action                 | Scratch                   | Lucide name                                   |
| ---------------------- | ------------------------- | --------------------------------------------- |
| edit / rename          | `✎`                       | `Pencil`                                      |
| regenerate             | `↻`                       | `RotateCw`                                    |
| branch                 | `⎇`                       | `GitBranch` (shared with top-bar branch chip) |
| delete                 | `×` (in this row context) | `Trash2`                                      |
| flip era (conditional) | `📅`                      | `CalendarClock`                               |

### Entity kind glyphs

Source scratch in
[`../patterns/entity.md → Entity kind indicators`](../patterns/entity.md#entity-kind-indicators--icons-not-text).

| Kind      | Scratch | Lucide name |
| --------- | ------- | ----------- |
| character | `☺`     | `User`      |
| location  | `⌂`     | `MapPin`    |
| item      | `◆`     | `Package`   |
| faction   | `⚑`     | `Flag`      |

### Common UI affordances

Glyphs that don't have unicode-glyph scratch placeholders in
wireframes (they render as text labels — `Search…`, `+ Add …` —
or inline mini-icons). Foundations names them so component
implementation has the canonical reference.

| Concern                 | Lucide name |
| ----------------------- | ----------- |
| Search input glyph      | `Search`    |
| Add / new / `+` buttons | `Plus`      |
| Filter (chip / button)  | `Filter`    |
| Time chip / clock       | `Clock`     |

## Per-entry icon row composition

The reader's per-entry icon row carries:

- **Standard 4 icons on AI rows:** `edit` (`Pencil`),
  `regen` (`RotateCw`), `branch` (`GitBranch`),
  `delete` (`Trash2`).
- **Conditional 5th icon:** `flip era` (`CalendarClock`) —
  visible only when `story.calendarSystem.eras !== null`.

User rows carry only `edit` and `delete`; regen / branch /
flip-era don't apply.

### Flat 5-icon row

When the 5th icon is active, the row stays **flat — no overflow
menu introduced.** Width budget at 20 px (`--icon-md`) icons +
8 px gaps: 5 × 20 + 4 × 8 = **132 px** total. Comfortable on
desktop and on 375 px mobile viewports next to entry prose; the
everyday case (no era-flip) is 4 icons = 104 px.

Rejected at session 5: the 4-inline + per-entry-overflow-menu
refactor (introduces a new pattern) and the 4-inline + chip-class
hybrid (introduces an affordance-class distinction without enough
motivation). The flat-row choice is the simplest viable
composition; if more conditional actions accrue later and density
pressure becomes real, refactoring to overflow is mechanical.

### Branch glyph reuse

The `branch` action shares `GitBranch` with the top-bar branch
chip — same semantic, same glyph. Per `principles.md`'s "`⎇`
(branch) MUST NOT be reused for Actions or any non-branch
surface" rule, `GitBranch` is reserved for branch semantics
across both top-bar and per-entry use sites.

## Implementation notes

### Web / Electron

`lucide-react` package. Tree-shakeable — only imported icons ship
in the bundle. Component pattern:

```tsx
import { Settings, GitBranch, Pencil } from 'lucide-react'
;<Settings size={20} strokeWidth={2} />
```

`size` consumes `--icon-md` (etc.) at the use site; `strokeWidth`
is locked at 2 by convention.

### Native (Expo)

`lucide-react-native` package. Same icon names, RN-compatible
component shape. Color-token runtime parity on native was
characterized during phase 1 foundations bring-up
([`theming.md → Switching mechanism`](./theming.md#switching-mechanism));
icon-color theming inherits from the same mechanism via the parent's
`color` style and falls under the same contract.
