# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

---

## UX

### Custom-font theme support

Themes can declare font-family overrides in their registry entry
(e.g. Parchment maps `--font-reading` to a serif stack); the
runtime swap mechanism applies these overrides at theme-swap time.
**Verified during phase 1 native bring-up: the slot swap works,
but the resolved typeface doesn't change** because the font stacks
declared in [`themes.md`](./ui/foundations/themes.md) reference
fonts that aren't bundled with the app. Both web (Electron, RN-Web
in Storybook) and Android fall through to the same system
sans-serif default for every theme.

Open design questions:

- **Bundling strategy.** Ship font files in the app bundle (larger
  binary, fonts available immediately) or load lazily on first use
  of a font-overridable theme (smaller binary, first-render
  fallback flicker)?
- **Web loading strategy.** `@font-face` in `global.css`, separate
  font CSS, CDN-hosted variants, or accept system-fallback on web?
  Each has different first-paint implications for Electron.
- **Per-platform font-stack reconciliation.** A stack like
  `Charter, "Iowan Old Style", "Source Serif", Georgia, ...` falls
  through differently across iOS, Android, and web. Single stack
  with hopeful fallbacks vs per-platform stacks in the registry?
- **First-launch / reduced-data-mode UX.** What does the user see
  before custom fonts finish loading? Acceptable to render system
  sans first then re-flow once fonts arrive?

License + bundle-size accounting (redistribution rights for
Charter / Lora / etc., binary-weight impact) is implementation
work that follows from the bundling-strategy decision.

Lands when a v1 surface depends on a custom-font theme rendering
correctly. Until then, themes that declare font overrides function
as color-only themes — not a v1 blocker, but worth calling out so
the gallery contract isn't misread as "font-customization works
today."

### Theme-audit CI gate

[`ui/foundations/color.md → Theme audit utility`](./ui/foundations/color.md#theme-audit-utility)
ships `pnpm themes:audit` as a dev-only command — runs over the
theme registry, prints pass/fail/warn per pair per theme, exits 0
even on failures (never blocks). Wiring it into CI (or
`pnpm test`) as a gate is **ripe for design** now that session 6
landed the curated gallery (per
[`ui/foundations/themes.md`](./ui/foundations/themes.md)). Real
palette data informs the exempt-list shape: Catppuccin Latte and
Catppuccin Mocha fail or sit close to AAA on body prose by
canonical design and need to be marked exempt before the gate
fires; other themes clear AAA with margin and don't.

Decisions needed at gate-wiring time:

- Which contrast targets gate (likely AA floors only; AAA target
  stays warning).
- Per-theme exempt list shape — a `theme.audit.exempt: [...]`
  field on the theme module, an external allow-list, or
  per-theme tags surfaced from the `Theme` type.
- The accent-overridable derivation sweep — does it gate, or
  stay informational-only?
- Whether the gate runs in pre-commit, in `pnpm test`, or as a
  dedicated CI job.

Lands at the gate's own design pass — session 6's palette data
is in hand, ready to inform the exempt-list shape.

### Translation rows in per-story export / import

Per-story exports now strip `stories.settings.models`,
`stories.settings.embedding_*`, and vec0 vectors (folded into
[`data-model.md → Backup & export format`](./data-model.md#backup--export-format)
during the provider/profile deletion-semantics design). Cached
translation rows weren't addressed — open whether they travel with
a per-story export and how they reconcile with the importer's
translation backend + language settings on the receiving end.
Lands at the next pass over translation pipeline / export format.

### Actions menu broader design pass

The
[Diagnostics Hub](./ui/screens/diagnostics/diagnostics.md)
adds a single entry (`Open Diagnostics Hub`) to the global Actions
(⚲) menu. The menu has not yet had a focused design pass — its
full inventory, organizational shape (groups, separators, mobile
expression), and contextual variants per screen are
unspecified. Surfaced during the observability design
session; lands as its own pass when the next set of Actions-menu
candidates is ready (or when the menu's current sparseness
becomes a UX friction in real use).
