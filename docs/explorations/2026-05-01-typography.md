# Visual identity — typography (session 3)

Session 3 of the multi-session visual-identity design pass (per
[`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions)).
Output is the **typography contract** — default font stacks for
the three locked slots, type scale + line-heights + weights,
per-font leading multiplier escape valve, reader font-size user
setting (new user-orthogonal axis), implementation notes for
cross-platform font handling.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/typography.md`](../ui/foundations/typography.md).

## Decisions locked entering this session

- **System-stacks for all v1 default fonts.** Zero bundled fonts.
  `--font-reading` defaults to a cross-platform serif chain (Charter
  / Iowan / Source Serif / Georgia / Cambria / Liberation / Noto /
  serif); `--font-ui` to system-ui-shaped sans; `--font-mono` to
  ui-monospace-shaped. Themes opt into bundled fonts at
  theme-author time and pay their own bundle cost.
- **`--font-display` slot — skipped.** v1 surfaces (story-list
  cards, wizard step heads, top-bar story name, settings panel
  root, reader entry titles) all read as medium-emphasis chrome
  covered by `--text-2xl` / `-3xl` against `--font-ui`. Hero
  typography demand can add the slot later with a single
  Theme-interface field; current themes default-inherit, no
  migration cost.
- **Reader font-size setting — new user-orthogonal axis.** User
  surfaced the idea during clarifying questions; lands as a
  `readerFontScale: 'sm' | 'md' | 'lg' | 'xl'` field on
  `app_settings.appearance`, scoped to **reader entry content
  only.** Generalization-to-all-body-prose deferred (parked).

## Default font stacks

Concrete defaults documented in
[`typography.md → Default font stacks`](../ui/foundations/typography.md#default-font-stacks).
This exploration records only the rationale:

- **Serif default for `--font-reading`** — reading-heavy app, prose
  body, traditional reading typography reads better at length than
  sans for most users.
- **Stack design covers iOS / macOS / Windows / Linux / Android**
  with at least one good face per platform; ends in a generic CSS
  family keyword for ultimate fallback.
- **Charter at the head** — modern Apple reading face, bundled with
  iOS / macOS, excellent at body sizes.

## Type scale

Tailwind-aligned at 16 px base, seven sizes (xs through 3xl), four
weights (400 / 500 / 600 / 700). Full table in
[`typography.md → Type scale + weights`](../ui/foundations/typography.md#type-scale--weights).

Key choice: **reading body at `--text-lg` (18 px), not
`--text-base` (16 px)**. Deliberate one-step-up for prose comfort —
reading is load-bearing, user sees this size most. UI body stays at
16 px; the 2 px delta gives chrome adjacent to prose a visually
secondary footprint.

Weight set excludes `300` (light) — system fonts don't all support
light weights cleanly across Linux fallbacks; the "flat, nothing
flashy" identity doesn't need the dramatic light end.

## Per-font leading multiplier

Optional `Theme.leadingMultiplier?: number`, default `1.0`. Scoped
to reading-text line-heights only (UI/mono use locked leading).
Cascades via a CSS custom property `--leading-reading-multiplier`
set at theme-application; reading-text use sites multiply
`--leading-*` tokens by it.

Why optional: most themes inherit defaults; only themes bundling
custom fonts (Parchment-with-Lora, Notebook-with-humanist-sans)
likely benefit from per-font tuning. Default 1.0 makes the field
zero-cost for themes that skip it.

Why scoped to reading: UI text rarely changes face across themes;
mono is mono. Reading-text is the load-bearing font-swap target.

## Reader font-size setting

New user-orthogonal axis. Persists at
`app_settings.appearance.readerFontScale`; four discrete steps
(`sm` / `md` / `lg` / `xl`) mapped to multipliers
`0.85 / 1.0 / 1.2 / 1.4`. Default `'md'` (1.0).

**Cascade:** CSS custom property `--reader-font-scale` set at
document root. Reader components compute reading-text font-size and
line-height as multiplications of locked tokens × theme leading
multiplier × user scale. UI chrome doesn't reference the variable;
unaffected.

**Scope:** reader entry content (prose body, entry titles, entry
meta line). Reader-side chrome stays at chrome-default sizes;
click targets don't shift. Body prose elsewhere (lore detail panes,
entity descriptions, peek drawer, wizard) stays at locked sizes.
Generalization-to-all-body-prose deferred (parked).

**UI surface:** App Settings · Appearance gains a 4-state
segmented control between Density and (conditional) Accent
override.

**First-launch + malformed-fallback** seed `'md'` — consistent
with existing `appearance` invariants.

## Adversarial-pass findings (recorded)

- **Reading body at 18 px while UI body is 16 px.** Intentional 2
  px delta — chrome adjacent to prose sits visually smaller than
  the prose. Verified — that's the intended visual hierarchy.
- **Type scale shares 28 px line-height between `--text-lg` and
  `--text-xl`.** Intentional — preserves vertical rhythm. Tailwind
  precedent. Verified.
- **Reader font-size + leading multiplier compound.** A theme with
  `leadingMultiplier: 1.07` and a user at `xl` scale gets
  `28 × 1.07 × 1.4 = ~42 px` line-height for prose. Correct
  behavior — bigger text + relaxed leading = more comfortable.
  Verified.
- **Reader font-size at extremes.** `xl` (1.4) on a long entry
  produces noticeably tall lines that may push entry meta out of
  single-screen view. UX concern, not contract concern.
  Implementation pass / first reader test surfaces if real.
- **Cross-platform stack mismatch.** Charter / Iowan Old Style
  aren't on Linux / Android by default; chain falls through to
  Liberation Serif / Noto Serif / generic `serif`. Stack design
  accounts for this. Verified.
- **NativeWind font-stack parsing.** Unverified at design pass;
  folded into existing
  [NativeWind runtime theme-swap parity validation](../followups.md#nativewind-runtime-theme-swap-parity-validation)
  followup. No new followup needed.
- **`--font-display` skip is honest.** Re-verified surfaces — none
  demand hero-scale typography distinct from `--text-2xl` / `-3xl`.
  Verified.

## Followups generated

None this session. NativeWind font-stack parsing already covered
by the existing followup.

## Parked items added

- **Reader font-size scaling generalized to all body prose** —
  parked-until-signal. v1 scope is reader entry content only;
  user explicitly noted "if user demand surfaces, we'll tackle
  later." Adding scope means lore detail panes / entity
  descriptions / peek drawer prose / wizard prose all scale with
  the user setting. Risk: scaling things the user didn't intend
  (a 1.4× lore-detail-pane probably looks worse than the
  default). Lands when real demand surfaces.

## Integration plan

Files changed:

- **NEW** [`../ui/foundations/typography.md`](../ui/foundations/typography.md) —
  the canonical typography contract (sections 1–5 above).
- **EDIT** [`../ui/foundations/tokens.md`](../ui/foundations/tokens.md) —
  replace structural type-scale deferral ("Final scale firmed at
  session 3") with link-out to
  [`typography.md → Type scale + weights`](../ui/foundations/typography.md#type-scale--weights).
  Update `--font-reading` / `--font-ui` / `--font-mono` default-stack
  descriptions to link out for concrete values.
- **EDIT** [`../ui/foundations/theming.md`](../ui/foundations/theming.md) —
  (a) add `leadingMultiplier?: number` to the `Theme` interface
  code block. (b) add `readerFontScale: 'sm' | 'md' | 'lg' | 'xl'`
  to the `app_settings.appearance` persistence shape. (c) extend
  the first-launch defaults paragraph to mention `readerFontScale`
  default `'md'`.
- **EDIT** [`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions) —
  flip session 3 from "pending" to "landed 2026-05-01" with link
  to this exploration record.
- **EDIT** [`../data-model.md`](../data-model.md) — line 230 ER
  diagram comment: append `readerFontScale` to the `appearance`
  shape description.
- **EDIT** [`../ui/screens/app-settings/app-settings.md → APP · Appearance`](../ui/screens/app-settings/app-settings.md#app--appearance) —
  add a Reader font size paragraph between Density and Accent
  override sections.
- **EDIT** [`../ui/screens/app-settings/app-settings.html`](../ui/screens/app-settings/app-settings.html) —
  wireframe edit: add Reader font size field-row to the Appearance
  tab-panel, between density and accent rows. Per the
  wireframe-bundling rule, same commit as the .md edit.
- **EDIT** [`../parked.md → UX (parked)`](../parked.md#ux-parked) —
  add new entry: **Reader font-size scaling generalized to all
  body prose**.

Renames: none.

Patterns adopted on a new surface: none.

Followups resolved: none.

Followups introduced: none. (NativeWind font-stack parsing already
covered.)

Wireframes updated: `app-settings.html` (Reader font size control
added). `theming.html` not updated — placeholder palettes don't
need a typography demo at session-3 fidelity, and session 6 owns
gallery-level rework.

Intentional repeated prose: none planned.

Exploration record fate: keep at integration; frozen historical
record.
