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

V1 contract — final inventory locked at session 2; **25 slots
total.** Per-slot purpose, contrast targets, state treatments, and
the accent-derivation algorithm live in [`color.md`](./color.md);
the inventory below is the slot list at a glance.

- **Backgrounds (5).** `--bg-base` (canvas), `--bg-raised`
  (cards / inputs / dialogs above canvas), `--bg-sunken` (input
  wells, code blocks, system-entry chrome), `--bg-overlay`
  (modal / popover surfaces), `--bg-disabled` (disabled-control
  surface).
- **Foregrounds (4).** `--fg-primary` (default text),
  `--fg-secondary` (less-emphasized text), `--fg-muted`
  (placeholders, low-emphasis labels), `--fg-disabled`
  (disabled-control text).
- **Accent group (3).** `--accent` (primary action / brand),
  `--accent-hover` (hover state on accent surfaces), `--accent-fg`
  (text rendered on accent backgrounds). When the active theme
  has `accentOverridable: true` and the user has customized
  accent, the entire accent group plus `--focus-ring` and
  `--selection-bg` is **derived from one input** — see
  [`theming.md → Accent override (opt-in)`](./theming.md#accent-override-opt-in)
  and
  [`color.md → Accent-derivation algorithm`](./color.md#accent-derivation-algorithm).
- **Semantic states (8).** `--success`, `--warning`, `--danger`,
  `--info`, each with its own `-fg` pair for text-on-state.
- **Borders (2).** `--border` (default), `--border-strong`
  (emphasis; hover, focus surrounds, table heads).
- **Focus (1).** `--focus-ring` — keyboard-focus indicator. Own
  slot; not aliased to `--accent` (themes get tone control).
- **Selection (1).** `--selection-bg` — text-selection background.
- **Pattern-driven (1).** `--recently-classified-bg` — row tint
  for the recently-classified pattern (per
  [`../patterns/entity.md`](../patterns/entity.md)). Two visual
  states (fresh + fading) render from this single slot — fading
  is the same color at 0.5 alpha. Spec in
  [`color.md → Recently-classified slot`](./color.md#recently-classified-slot).

The inventory is **extensible.** Future patterns may add their
own slots under the same convention (`--<pattern>-<role>`);
foundations records each addition's existence and the per-pattern
semantics.

## Font-family slots

Three slots — concrete default stacks locked at session 3 in
[`typography.md → Default font stacks`](./typography.md#default-font-stacks).

- `--font-reading` — body prose. **Load-bearing for the primary
  reading activity.** Default: serif system-stack (Charter / Iowan /
  Source Serif / Georgia / Cambria / Liberation / Noto / serif).
- `--font-ui` — chrome, labels, buttons, list rows. Default:
  `system-ui` chain.
- `--font-mono` — code, system-entry chrome, technical readouts
  (raw JSON viewer, delta log). Default: `ui-monospace` chain.

**Font tokens declare stacks, not single names.** A theme
introducing a custom font for `--font-reading` declares it as
`"Lora", Charter, ..., serif` — never as `"Lora"` alone. Guards
against font-load failures and platform variance (mobile native
may not have the font bundled).

`--font-display` was evaluated and **skipped** at session 3 — v1
surfaces are covered by `--text-2xl` / `-3xl` against `--font-ui`;
no hero-scale typography demand emerged. Revisitable if a future
surface materializes.

## Structural slot families

Slot families exist in the contract; values are deferred to the
relevant session:

- **Type scale** (`--text-xs` / `-sm` / `-base` / `-lg` /
  `-xl` / `-2xl` / `-3xl`, paired `--leading-*` tokens, four
  `--font-weight-*` tokens at 400 / 500 / 600 / 700). Final scale
  locked at session 3 — see
  [`typography.md → Type scale + weights`](./typography.md#type-scale--weights).
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
