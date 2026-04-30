# Tokens

The visual identity contract. Tokens are the named values
components consume; themes provide the values; the structural
skeleton stays constant.

## Three classes

Tokens fall into three classes by who/what varies them:

- **Themeable.** Vary per active theme. Two sub-categories: color
  tokens (every theme overrides) and font-family tokens (most
  themes inherit defaults; opinionated themes override).
- **User-orthogonal.** Vary per user setting, independent of
  theme. Today: density-aware spacing tokens.
- **Structurally locked.** Constant across themes and user
  settings. Type scale (sizes / weights / line-heights), radii,
  motion durations + easing, iconography sizing, z-index strata.

The classification governs which authoring surface owns the value
and what migrates when when a theme or user setting changes.

## Naming convention

Semantic, not literal. `--bg-base`, not `--slate-50`. CSS-var
idiom (kebab-case, `--` prefix). The same name applies in:

- The runtime CSS-var application at the document root (web /
  Electron via RN Web).
- NativeWind 4's runtime theming (Expo native).
- The Tailwind config that exposes utility classes backed by
  these vars.

Each theme defines its own color literals and binds them to the
same semantic slots — a component reads `var(--bg-base)`; what
color shows up depends on the active theme. This is the standard
shadcn-style pattern; the project's stack note in
[`../../tech-stack.md`](../../tech-stack.md) commits to
"shadcn-style theme CSS vars."

## Color slots

V1 contract — final inventory firmed in session 2 (color system
design pass). Approximate count: 18–22 slots.

- **Backgrounds.** `--bg-base` (canvas), `--bg-raised`
  (cards / inputs / dialogs above canvas), `--bg-sunken` (input
  wells, code blocks, system-entry chrome), `--bg-overlay`
  (modal / popover surfaces; usually slightly tinted vs raised).
- **Foregrounds.** `--fg-primary` (default text), `--fg-secondary`
  (less-emphasized text), `--fg-muted` (placeholders, disabled
  text, low-emphasis labels), `--fg-on-accent` (text rendered on
  accent backgrounds).
- **Accent.** `--accent` (primary action / selection / brand),
  `--accent-hover` (interactive hover state), `--accent-fg`
  (text rendered on accent backgrounds; alias of
  `--fg-on-accent` for slot symmetry, may consolidate in session
  2). When the active theme has `accentOverridable: true` and the
  user has customized accent, the entire accent group is
  **derived from one input** — see
  [`theming.md → Accent override (opt-in)`](./theming.md#accent-override-opt-in).
- **Semantic states.** `--success`, `--warning`, `--danger`,
  `--info`, each with its own `-fg` pair for text-on-state.
- **Borders.** `--border` (default), `--border-strong`
  (emphasis; hover, focus surrounds, table heads).
- **Focus.** `--focus-ring` (ring color for keyboard focus
  surrounds; usually a tint of `--accent`).
- **Selection.** `--selection-bg` (text-selection background;
  load-bearing for a reading-heavy app where users will spend
  long sessions selecting prose).

Patterns may add their own decay-pair slots when authored — e.g.
`--recently-classified-bg` for the row accent in
[`../patterns/entity.md`](../patterns/entity.md). The contract is
open-ended; growing the slot inventory across sessions is the
expected mode.

## Font-family slots

Three slots:

- `--font-reading` — body prose. **Load-bearing for the primary
  reading activity.** Default stack favors a readable serif or
  humanist sans across platforms.
- `--font-ui` — chrome, labels, buttons, list rows. Default stack
  favors a system-default sans for platform-native feel.
- `--font-mono` — code, system-entry chrome, technical readouts
  (raw JSON viewer, delta log). Default stack favors a system
  mono.

**Font tokens declare stacks, not single names.** A theme
introducing a custom font for `--font-reading` declares it as
`"Lora", Georgia, serif` — never as `"Lora"` alone. Guards
against font-load failures and platform variance (mobile native
may not have the font bundled).

A `--font-display` slot (for headers / hero typography) may be
added at session 3 if real demand surfaces; the body type scale
covers the common case without it.

## Structural slot families

Slot families exist in the contract; values are deferred to the
relevant session:

- **Type scale** (`--text-xs` / `-sm` / `-base` / `-lg` /
  `-xl` / `-2xl` / `-3xl`, with corresponding line-heights and
  weight tokens). Final scale firmed at session 3 (typography).
- **Radii** (`--radius-sm`, `--radius-md`, `--radius-lg`,
  `--radius-full`). Session 4.
- **Motion** (`--duration-fast`, `--duration-base`,
  `--duration-slow`, `--easing-standard`, `--easing-emphasis`).
  Session 5.
- **Iconography sizing** (`--icon-sm`, `--icon-md`, `--icon-lg`).
  Session 5.
- **Z-index strata.** Fixed scale (banner, sticky-header,
  popover, modal, toast). Session 1 reserves the names; values
  refine as components are built.

## Density-aware spacing

The user-orthogonal class. Density toggle (per
[`theming.md → Density-token policy`](./theming.md#density-token-policy))
selects between `comfortable` and `compact` variants on
component-internal padding tokens — `--row-pad-y`, `--row-pad-x`,
`--input-pad-y`, `--input-pad-x`, `--button-pad-y`,
`--button-pad-x`, `--gap-sm`, `--gap-md`, `--gap-lg`. Final
slot list and values firmed at session 4.
