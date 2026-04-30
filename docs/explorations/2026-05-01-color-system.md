# Visual identity — color system + accessibility (session 2)

Session 2 of the multi-session visual-identity design pass (per
[`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions)).
Output is the **color contract** — final slot inventory, per-pair
WCAG contrast targets, focus / disabled / hover state recipes,
accent-derivation algorithm with locked constants, recently-
classified pattern slot, dev-only theme audit utility.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/color.md`](../ui/foundations/color.md).

## Decisions locked entering this session

- **Decay-pair model.** One slot + reduced opacity for the fading
  tier. Rejected: two literal slots (no real per-tier hue need),
  generalized `--decay-fade-alpha` (premature; one consumer).
- **Contrast governance.** Document targets + ship dev-only
  `pnpm themes:audit` utility. Rejected: docs-only (under-
  specifies the risk session 1 flagged), CI gate now (would block
  legitimate AAA-failing palettes like Catppuccin Latte before
  session 6 lands real palette data).
- **Disabled state policy.** Explicit `--bg-disabled` +
  `--fg-disabled` slots. Rejected: blanket `opacity: 0.5` (fights
  other translucent surfaces; loses tunability per palette).
- **Slot consolidation.** Drop `--fg-on-accent` alias; keep
  `--accent-fg`. Convention is `<group>-fg` paired with
  `<group>` background slot — symmetric with `--success-fg`,
  `--warning-fg`, etc. Accent-fg also groups with the rest of the
  accent derivation set when override fires.
- **Focus-ring slot.** Own slot, not aliased to `--accent`.
  Themes get tone control. Accent-override derivation still
  drives it from the user's accent on accent-overridable themes.
- **Active / pressed state.** Deferred. No `--accent-active`
  slot for v1; if real need surfaces, session 5 (motion) is the
  better landing pad.

## Final slot inventory — 25 slots

Counted relative to session 1's "approximate 18–22":

- Net `−1` from dropping `--fg-on-accent` alias.
- Net `+3` from `--bg-disabled`, `--fg-disabled`,
  `--recently-classified-bg`.

Full list with rationale lives in
[`../ui/foundations/color.md → Final slot inventory`](../ui/foundations/color.md#final-slot-inventory);
this exploration records only the deltas above.

## Contrast targets — three-rung structure

Per-pair WCAG-derived. Three rungs:

1. **Text-on-background.** AAA 7:1 target on body prose
   (`--fg-primary` × `--bg-base`); AA 4.5:1 floor everywhere else;
   3:1 floor on disabled (WCAG-exempt).
2. **Non-text contrast (WCAG 1.4.11).** 3:1 on borders,
   focus-ring, accent-as-button-bg, selection-bg perceivability.
3. **Faint-signal exception.** `--recently-classified-bg` ×
   `--bg-base` — author-judged, no gate (the tint must whisper,
   not shout).

Full table in
[`color.md → Contrast targets`](../ui/foundations/color.md#contrast-targets).

The AAA body-prose target is reach-where-feasible. Opinionated
palettes that fail it (Catppuccin Latte, etc.) remain valid — AA
4.5:1 is the firm floor, AAA is documented as "aim for it on body
prose" so theme authors prioritize the right pair when tuning.

## State treatments

Locked at contract level; per-platform glue is implementation
detail.

- **Focus.** `:focus-visible` only (not click). 2px solid
  `--focus-ring`, 2px positive offset (ring outside element on
  canvas — locks the contrast pair as ring × surrounding-surface).
  Web: `outline`. Native: `box-shadow` equivalent.
- **Disabled.** `--bg-disabled` + `--fg-disabled`. Border reuses
  `--border` (no separate disabled-border slot). No hover, no
  focus ring. Web `cursor: not-allowed` is a nicety.
- **Hover.** Per-surface recipe — primary buttons swap
  `--accent → --accent-hover`; secondary buttons emphasize border
  (`--border → --border-strong`); list rows fill
  `--bg-raised`; inputs emphasize border; inline links
  underline-only; disabled has no hover.

Hover transition timing references the motion budget (session 5
deferral); section 3 commits which tokens swap, not the duration.

## Accent-derivation algorithm — locked constants

Pure function `deriveAccent(accent, mode, bgBase) → { accentHover,
accentFg, focusRing, selectionBg }`. Runs at theme-application
time when accent-override fires.

| Output        | Color space | Constant                                       |
| ------------- | ----------- | ---------------------------------------------- |
| `accentHover` | HSL         | `±10` L delta, sign by mode                    |
| `accentFg`    | WCAG L_rel  | threshold `0.5`; outputs `#ffffff` / `#0a0a0a` |
| `focusRing`   | —           | direct passthrough                             |
| `selectionBg` | RGB linear  | accent share `0.20` (light) / `0.30` (dark)    |

**Color-space rationale.** HSL for L delta (well-behaved, no hue
interpolation). RGB linear for selection mix (HSL hue
interpolation produces unexpected intermediate colors). WCAG
relative luminance for auto-flip threshold (WCAG-canonical
bisection). OKLCH considered and rejected for v1 — adds
dependency, complicates web-native parity, no real perceptual
issues observed at session-1 fidelity. Reconsider later if
practice reveals issues.

**Constant rationale.**

- ±10 hover delta: empirically perceivable across saturated and
  pastel inputs without jumping (5% subtle, 15% jarring).
- `#0a0a0a` not `#000000`: shadcn-symmetric, less harsh.
- Selection mix asymmetry (0.20 light, 0.30 dark): dark canvas
  needs more accent saturation to perceive selection.

Full algorithm + edge cases in
[`color.md → Accent-derivation algorithm`](../ui/foundations/color.md#accent-derivation-algorithm).

## Theme audit utility — `pnpm themes:audit`

Dev-only command. Per-theme table of pass/warn/fail across:

1. Every text-on-bg pair (target + floor).
2. Every non-text pair.
3. Faint-signal pair (reports only, never fails).
4. Accent-overridable themes' derivation sweep over a sample
   input set (saturated + pastel; checks derived pairs clear AA).

Exit code 0 even on fails — no CI gate at v1. The CI-gate followup
is parked until session 6 lands real palette data so we know which
themes legitimately exempt vs need fixing.

Full spec in
[`color.md → Theme audit utility`](../ui/foundations/color.md#theme-audit-utility).

## Adversarial-pass findings (recorded)

- **HSL is good-enough for v1.** Edge case: pure-yellow accent at
  the edge of HSL representation produces unintuitive but
  acceptable hover delta; OKLCH improvement is real but not
  load-bearing. Verified.
- **Pure black / pure white as accent.** Hover delta clamps to
  same value; UX degrades gracefully. Documented as known
  limitation; not blocked.
- **Mid-luminance bgBase + accent-override.** Real gap: a Slate
  Dark theme with `--bg-base` near HSL L=50 produces a derived
  `--selection-bg` close to canvas, potentially failing 3:1
  selection-visibility. Resolution: documented as a known
  limitation; theme authors of mid-luminance bgBase should not
  enable `accentOverridable: true`, OR the derived selection sits
  below 3:1 with the audit reporting the failure. Contract
  doesn't try to "fix" this — the input combination is genuinely
  difficult.
- **Accent at exactly WCAG 0.5 threshold.** Deterministic flip
  (`< 0.5` → white, `>= 0.5` → near-black); no run-to-run
  drift. Verified.
- **Read-site impact of dropping `--fg-on-accent`.** Components
  reference `--accent-fg` per the established convention; the
  alias was duplicate. No read-site breaks.
- **`patterns/entity.md` references CSS classes `recent-1` /
  `recent-2`.** Already abstract ("rendering detail"); no change
  needed. Verified.
- **`theming.md` derivation section** describes the abstract
  algorithm with "Session 2 firms the deltas, contrast targets,
  and the precise auto-flip rules." Resolution: replace deferral
  language with link-out to `color.md → Section 4`. Avoids
  duplication.

## Followups generated

- **Theme-audit CI gate** — wire `pnpm themes:audit` into CI (or
  `pnpm test`) as a gate once session 6's curated palettes land.
  Active followup; lands at session 6 + real palette data.

## Parked items added

None this session.

## Integration plan

Files changed:

- **NEW** [`../ui/foundations/color.md`](../ui/foundations/color.md) —
  the canonical color contract: final slot inventory, contrast
  targets, state treatments, accent-derivation algorithm,
  recently-classified slot, theme audit utility.
- **EDIT** [`../ui/foundations/tokens.md → Color slots`](../ui/foundations/tokens.md#color-slots) —
  drop `--fg-on-accent` slot. Add `--bg-disabled`, `--fg-disabled`,
  `--recently-classified-bg` as firm slots. Update preamble:
  "approximate 18–22; firmed in session 2" → "locked at session
  2 (see [`color.md`](../ui/foundations/color.md)); 25 slots".
  Drop the alias / consolidation language on `--accent-fg`.
- **EDIT** [`../ui/foundations/theming.md → Accent override (opt-in)`](../ui/foundations/theming.md#accent-override-opt-in) —
  replace the placeholder derivation section ("Session 2 firms
  the deltas, contrast targets, and the precise auto-flip
  rules") with a link-out to
  [`color.md → Accent-derivation algorithm`](../ui/foundations/color.md#accent-derivation-algorithm).
  Keep the contract description (one input → 5 derived tokens).
- **EDIT** [`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions) —
  flip session 2's status from "pending" to "landed 2026-05-01"
  with link to this exploration record. Same shape as session 1's
  row.
- **EDIT** [`../followups.md`](../followups.md) — add new entry
  under `## UX`: **Theme-audit CI gate**. Position between
  NativeWind runtime parity validation and Storybook design-rules
  setup (keeps foundations-related entries together).

Renames: none.

Patterns adopted on a new surface: none. `color.md` doesn't cite
patterns from `patterns/`; the reverse — `patterns/entity.md`
references `--recently-classified-bg` — was already in place at
session 1's authoring. No `Used by` updates needed.

Followups resolved: none from the existing list. (Session 1 added
the NativeWind parity followup; this session adds one new; no
prior followup is closed.)

Followups introduced: **Theme-audit CI gate** (added to
`followups.md`).

Wireframes updated: none. `theming.html` placeholder palettes
already exercise the slot list at session-1 fidelity; session 2's
slot additions could be added to the demo, but session 1
explicitly punted final-palette work to session 6 — adding more
demo slots without real palette values reinforces the placeholder
framing without proving anything new. Skipped deliberately, not
deferred.

Intentional repeated prose: none planned.

Exploration record fate: keep at integration; per the explorations
README, frozen historical record.
