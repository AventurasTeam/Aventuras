# Visual identity — iconography + motion (session 5)

Session 5 of the multi-session visual-identity design pass (per
[`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions)).
Two distinct domains landing as separate canonical files:

- **Iconography contract** — icon set, stroke weight, sizing
  scale, full glyph vocabulary across top-bar / directional /
  disclosure / status / per-entry / entity-kind / common-UI
  categories, per-entry icon row composition resolution.
- **Motion contract** — motion budget tokens (durations +
  easings), reduced-motion behavior with transform-vs-opacity
  distinction, per-use-site guidance.

This file is an exploration record. Once integrated, the canonical
homes are
[`../ui/foundations/iconography.md`](../ui/foundations/iconography.md)
and [`../ui/foundations/motion.md`](../ui/foundations/motion.md).

## Decisions locked entering this session

- **Per-entry icon row composition — flat 5-icon row** when
  era-flip is active. No overflow menu introduced. Resolves the
  parked entry; removed from `parked.md` on integration.
- **Icon set — Lucide.** shadcn-canonical, react/RN parity,
  tree-shakeable, single-weight default. Heroicons / Phosphor /
  Tabler considered and rejected.
- **2 px stroke uniform; sizing scale 16 / 20 / 24 px**
  (`--icon-sm` / `-md` / `-lg`). No `--icon-xl` slot for v1.
- **Story Settings glyph — `SlidersVertical`.** Distinct from
  `Settings` (cog) per principles.md's "geary" rule;
  geometrically different (parallel lines vs circular form);
  still reads as settings / preferences.
- **Actions menu glyph — `MoreVertical`.** Considered and
  rejected `Command` (too Mac-coded — `⌘` unfamiliar to
  Windows/Linux users); also rejected `Zap` (ambiguous
  energy/performance reading), `Menu` (hamburger conflates with
  sidebar nav), `Wand2` (too playful). `MoreVertical` reads
  universally as "more options" with clean visual distinction
  from row-level `MoreHorizontal`.
- **`X` (close) split from `Trash2` (delete)** as distinct
  affordance classes. Wireframes share `×` scratch; foundations
  splits the Lucide names so implementation doesn't conflate
  close-buttons with destructive deletes.
- **Motion budget — three durations + two easings.** 150 / 250 /
  400 ms; standard ease-in-out + emphasis ease-out. Material
  Design's curve set.
- **Reduced-motion — transform-vs-opacity distinction.** Clamp
  transform-based motion to 1 ms when reduced; keep opacity
  transitions at `--duration-fast`. Apple HIG + Material
  Accessibility recommendation; better than blanket "all motion
  off."

## Glyph vocabulary expansion — beyond the original session 5 scope

The original session-5 scope (per `foundations/README.md`) named
"top-bar glyph vocabulary" + "per-entry icon row composition."
User pushback during clarifying questions surfaced that the audit
was under-scoped — many additional glyphs are in active use
across the wireframes that needed canonical Lucide names.

`grep` across `docs/ui/**/*.{md,html}` produced the inventory
that informed the expanded section 3 in `iconography.md`. The
expansion now covers:

- **Top-bar / chrome** (6 glyphs) — App Settings, Story
  Settings, Actions, Return, Branch, Row overflow.
- **Directional / navigational** (4) — `ArrowRight` /
  `ArrowLeft` / `ArrowUp` / `ArrowDown`.
- **Disclosure carets** (3) — `ChevronDown` / `ChevronRight` /
  `ChevronUp`. Distinct from arrows; chevrons own disclosure,
  arrows own movement.
- **Status / state** (6) — `AlertTriangle` / `Check` / `X` /
  `Star` / `Brain` / `Info` (reserved).
- **Per-entry actions** (5) — references `patterns/icon-actions.md`.
- **Entity kind glyphs** (4) — references `patterns/entity.md`.
- **Common UI affordances** (4) — `Search` / `Plus` / `Filter` /
  `Clock`. No prior scratch home; iconography names them.

## Adversarial-pass findings (recorded)

- **Lucide bundle size on native.** Tree-shakeable; only imported
  icons ship. v1's vocabulary (~30+ icons across all categories)
  is well under any bundle-size concern. Verified.
- **Story Settings glyph (`SlidersVertical`) confused with
  "audio settings" or "filters."** Real risk on first encounter.
  Mitigated by top-bar position semantics + tooltip /
  accessibility label + first-use recognition curve. Verified —
  judgment call, not a bug.
- **Actions menu `MoreVertical` vs row `MoreHorizontal`.** Three-
  vertical-dots vs three-horizontal-dots. Some apps swap these
  conventions; internal consistency is what matters. Our app:
  vertical = chrome-level, horizontal = row-level. Documented
  rule. Verified.
- **5-icon flat row on extreme narrow viewports.** 132 px icon
  block + entry prose competing for ~375 px iPhone SE width. Q1
  reasoning verified the budget. If real demand surfaces (Android
  narrow phones, split-screen), refactor to overflow per the
  resolved-now-deleted parked entry. Not a v1 contract concern.
- **Reduced-motion transform-vs-opacity distinction.** Adds
  implementation complexity (every animation has to choose its
  property). Acceptable cost for the accessibility win.
  Alternative — blanket "all motion off when reduced" — was
  rejected because instant opacity changes feel like content
  "popping" and degrades UX for non-vestibular users who enable
  reduced motion for other reasons (battery, distraction).
  Verified.
- **Motion timing on slow devices.** Durations are wall-clock;
  on a slow device the animation may stutter at the same 250 ms
  while a fast device feels smooth. Implementation pass can opt
  to scale durations on detected device performance, but that's
  runtime adaptation, not contract. v1 contract specifies wall-
  clock targets; runtime tuning is implementation territory.
- **Doc cascade — keep scratch tables, add Lucide-name link-out.**
  `principles.md → Settings icon scope`,
  `patterns/entity.md → Entity kind indicators`, and
  `patterns/icon-actions.md → Glyph vocabulary` all keep their
  scratch glyph tables for wireframe-consistency (per the
  wireframe-authoring rule). Each gets a one-paragraph link-out
  to `iconography.md` for the canonical Lucide-name mapping.
  No table rewrites.
- **Parked entry resolution.** "Per-entry icon-row composition
  with conditional 5th icon" resolves at session 5 (Q1 lock);
  removed from `parked.md`.
- **`X` vs `Trash2` semantic split.** Wireframes use `×` for
  both "close" and "delete row." Foundations names them
  separately. Implementation should use `X` for close /
  dismiss / chip-removal, `Trash2` for destructive deletes.
  Pattern docs that currently say "delete: `×`" stay (wireframe
  scratch) but the iconography table is the implementation
  reference.

## Followups generated

None this session. The NativeWind runtime parity followup
absorbs motion-token validation as part of "Font-family token
swap behaves equivalently to color-token swap" — extends
naturally; no edit to the followup needed.

## Parked items added

None. The 5-icon-row refactor reversibility (overflow menu) is
signal-driven, not tracked.

## Parked items resolved

- **Per-entry icon-row composition with conditional 5th icon** —
  resolved at session 5 with the flat-5-icon-row decision.
  Removed from `parked.md`.

## Integration plan

Files changed:

- **NEW** [`../ui/foundations/iconography.md`](../ui/foundations/iconography.md) —
  canonical iconography contract: icon set, stroke + sizing,
  full glyph vocabulary across 7 categories, per-entry row
  composition, implementation notes.
- **NEW** [`../ui/foundations/motion.md`](../ui/foundations/motion.md) —
  canonical motion contract: budget tokens, reduced-motion,
  use-site guidance, implementation notes.
- **EDIT** [`../ui/foundations/tokens.md`](../ui/foundations/tokens.md) —
  Structural slot families: replace **Iconography sizing** and
  **Motion** entries' "Session 5" placeholders with link-outs to
  iconography.md / motion.md respectively.
- **EDIT** [`../ui/principles.md → Settings icon scope`](../ui/principles.md#settings-icon-scope) —
  keep the scratch glyph table; append a one-paragraph link-out
  to `iconography.md → Top-bar / chrome` for the canonical
  Lucide names.
- **EDIT** [`../ui/patterns/icon-actions.md → Glyph vocabulary`](../ui/patterns/icon-actions.md#glyph-vocabulary) —
  keep the scratch glyph table; append a one-paragraph link-out
  to `iconography.md → Per-entry actions` for the canonical
  Lucide names.
- **EDIT** [`../ui/patterns/entity.md → Entity kind indicators`](../ui/patterns/entity.md#entity-kind-indicators--icons-not-text) —
  keep the scratch glyph table; append a one-paragraph link-out
  to `iconography.md → Entity kind glyphs` for the canonical
  Lucide names. (NEW edit beyond original session 5 plan;
  surfaced when the glyph audit found entity-kind glyphs needed
  Lucide names.)
- **EDIT** [`../parked.md`](../parked.md) — remove the
  **Per-entry icon-row composition with conditional 5th icon**
  entry (resolved at session 5).
- **EDIT** [`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions) —
  flip session 5 from "pending" to "landed 2026-05-01" with
  link to this exploration record. Update Files inventory to add
  iconography.md + motion.md.

Renames: none.

Patterns adopted on a new surface: none. Foundations cites
`patterns/icon-actions.md` and `patterns/entity.md` for the
existing scratch glyph tables, but that's a foundations-firms-
the-pattern relationship, not foundations-adopting-the-pattern.

Followups resolved: none directly.

Followups introduced: none.

Wireframes updated: none. Per `conventions.md → Wireframe
authoring`, wireframes stay low-fidelity until consumer code
lands; the scratch glyph vocabulary remains the wireframe
convention. Mock surfaces don't need to be rewritten with Lucide
SVGs at design pass.

Intentional repeated prose: none planned.

Exploration record fate: keep at integration; frozen historical
record.
