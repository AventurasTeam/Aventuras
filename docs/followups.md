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

## Data-model

### Memory architecture — design landed

The memory pipeline (cadence stratification, retrieval ranker,
chapter-close pipeline with lore-mgmt sub-jobs, embedding
infrastructure, pinning, per-type budgets) is designed in
[`docs/memory/`](./memory/README.md). Substantially resolves what
was the "Lore-management agent shape" entry and the nested
"State-field write contract — architecture" sub-entry; both
removed with this commit.

**What's still open** lives in the memory folder's own followups:

- [v1-blocking memory work](./memory/followups.md#v1-blocking) —
  threshold tuning, embedder production integration, embedding
  compute lifecycle, background classifier UX, memory probe
  implementation (contract + screen UX landed; see
  [`memory/probe.md`](./memory/probe.md)), Matryoshka
  effective-dim implementation (contract + UI landed; see
  [`memory/retrieval.md → Matryoshka effective dim`](./memory/retrieval.md#matryoshka-effective-dim)),
  lore-creation cap tuning.
- [Parked / post-v1 items](./memory/followups.md#parked--post-v1) —
  multi-axis salience, pin-contradiction reconciliation, spillover
  policy, polymorphic naming, etc.

The previously-listed "lore.priority retrieval semantics" sub-item
resolves: priority is 0-100, integrated into the ranker as
`sim_blend × (priority/100) + kw_boost` per
[`docs/memory/retrieval.md → The ranker`](./memory/retrieval.md#the-ranker).
The "description revision suggestion-queue" sub-item stays
deferred as a UI concern (independent of memory design) — until
that UI lands, classifier writes description only at first
introduction per the existing authorship contract.

---

## UX

### Accent color picker UI

Two surfaces consume an accent color picker — Story Settings →
About (per-story accent) and App Settings → Appearance (app
theme accent) — but the production UI primitive isn't pinned.
Both wireframes currently render an ad-hoc swatch row of 7 fixed
colors plus `+ custom`, with no spec for:

- **Curated palette source.** Fixed list per
  [`foundations/color.md`](./ui/foundations/color.md)
  or theme-derived? Both screens probably want the same palette.
- **Custom color UI.** Full color picker (hex / HSL fields,
  native HTML5 `<input type="color">`, project-built widget),
  text hex input only, or no custom path?
- **Reset / fallback semantics.** Story Settings says "fallback:
  mode-derived"; App Settings says "visible only when active
  theme is accent-overridable". Different invariants — worth
  resolving in the spec.

Surfaced during Group D mobile retrofit
([exploration record](./explorations/2026-05-02-mobile-group-d-settings.md))
when the swatch row overflowed at narrow tiers and prompted the
question "what's the actual production primitive here?" Lands as
a small design pass — the answer probably extends
[`foundations/color.md`](./ui/foundations/color.md)
with a curated-accent-palette section, plus a new
`patterns/color-picker.md` for the picker primitive itself.

### Classification awareness pattern

The reader-composer's right-side rail collapses to a full-height
edge strip (per
[`reader-composer.md → Browse rail — collapse / expand`](./ui/screens/reader-composer/reader-composer.md#browse-rail--collapse--expand)).
Designing that strip surfaced a tempting but premature feature:
projecting a "what's new on the rail since you last looked"
indicator onto the strip — a dot, a count, or a recently-classified
warmth ([per the entity row indicators pattern](./ui/patterns/entity.md#entity-row-indicators--four-orthogonal-channels)).

The deeper concern: the project has no defined vocabulary for
**classification awareness across surfaces**. The rail rows have
a per-row recently-classified accent that decays over time
(`entity.md`), but there's no aggregate concept, no per-kind
signal, no cross-surface treatment for "what changed since the
user last engaged with this state."

Open questions for the design pass:

- **Granularity.** Per-row, per-kind, per-classifier-pass,
  aggregate? What's the unit being announced?
- **Surfaces.** Does this live on the rail strip, in the top-bar
  status pill, in the peek drawer, in the World panel? Some
  combination? What's authoritative vs derived?
- **Vocabulary.** Dot vs count vs warmth vs pulse — what's the
  visual language, and what does each variant mean?
- **Decay semantics.** When does an awareness signal "expire"?
  On rail-open? On time-elapsed? On user-acknowledge?
- **Interaction with `recently classified` filter chip** — the
  Browse rail already has a filter that surfaces recently-
  classified rows. The awareness pattern needs to compose with
  that, not duplicate it.

Lands when classification awareness becomes the focus of its own
design pass; not subsidiary to any single surface.

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

Concretely needs:

- **Native font bundling.** Use `expo-font` to load the canonical
  font files (Charter / Lora / etc. — whichever the curated themes
  declare) at app startup. Decide whether fonts ship in the app
  bundle or load lazily on first use of a font-overridable theme.
- **Web font loading.** Decide whether to ship the same font files
  via `@font-face` in `global.css` (or a separate font CSS), use a
  CDN-hosted variant, or accept system-fallback rendering on web.
  Has implications for first-paint cost on Electron.
- **License + bundle-size accounting.** Charter, Lora, etc. each
  have their own license terms and weight. Need to confirm
  redistribution rights before bundling.
- **Per-platform font-stack reconciliation.** A stack like
  `Charter, "Iowan Old Style", "Source Serif", Georgia, ...` falls
  through differently across iOS, Android, and web. May want
  per-platform stacks in the registry rather than one stack that
  hopes for the best.
- **Reduced-data-mode / first-launch UX.** What does the user see
  before custom fonts finish loading? Acceptable to render system
  sans first then re-flow once fonts arrive?

Lands when a v1 surface depends on a custom-font theme rendering
correctly. Until then, themes that declare font overrides
function as color-only themes — not a v1 blocker, but worth
calling out so the gallery contract isn't misread as
"font-customization works today."

### Sheet keyboard handling on mobile

[`patterns/overlays.md`](./ui/patterns/overlays.md) ships the
Sheet primitive contract but defers keyboard-aware behavior. When
a Sheet contains an Input (e.g. a search field at the top of a
long Select list) and the on-screen keyboard opens, the
`@rn-primitives/dialog` lifecycle layer ships no keyboard avoidance
— the sheet either gets covered or the input scrolls out of view.

Decisions needed:

- **Avoidance mechanism.** `KeyboardAvoidingView` wrapping
  `Sheet.Content` (consumer-side) vs an `avoidKeyboard` prop on
  Sheet itself (primitive-side). Consumer-side keeps the primitive
  small but forces every Input-hosting consumer to remember the
  wrap; primitive-side adds API surface but localizes the concern.
- **iOS / Android divergence.** Behavior is platform-divergent;
  KeyboardAvoidingView's `behavior` prop (`padding` / `position`
  / `height`) needs different values per platform.
- **Interaction with drag-to-dismiss.** When the keyboard is up,
  drag-to-dismiss must still work without colliding with the
  keyboard's own gesture surface.

Lands at the first Sheet implementation pass with a keyboard-
hosting consumer (likely Select on mobile with a search bar, per
[`calendar-picker.md → Implementation notes`](./ui/patterns/calendar-picker.md#implementation-notes)).

### Sheet + Popover ARIA contract

[`patterns/overlays.md`](./ui/patterns/overlays.md) defers the
explicit accessibility contract for both primitives. Open:

- **Sheet roles.** `role="dialog"` always, or `role="alertdialog"`
  when the sheet is dismiss-blocking? Pre-existing surface bindings
  (calendar swap, branch creation) all use Modal, not Sheet —
  Sheet's dismiss-blocking variant is theoretical for v1.
- **Popover roles.** `role="dialog"` with `aria-haspopup` on the
  trigger? `role="menu"` when the popover content is action-shaped
  (Actions menu, branch chip popover)? rn-primitives may default
  to one shape; consumer-driven override is worth specifying.
- **Labelling.** `aria-labelledby` pointing at a header element
  inside the content vs `aria-label` as a string prop on the
  primitive. Consistency across both primitives matters.
- **Focus-return semantics.** Default is "return to trigger";
  consumer override (e.g. focus a specific element in the parent)
  is sometimes wanted. Whether this is a primitive prop or a
  consumer concern.

Lands at the first Sheet / Popover implementation pass.

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

### Search scope on state fields

Per
[`reader-composer.md → Browse rail — search scope`](./ui/screens/reader-composer/reader-composer.md#browse-rail--search-scope)
and
[`world.md → List pane — search scope`](./ui/screens/world/world.md#list-pane--search-scope),
entity search currently scans `name`, `description`, `tags`. With
the new
[`entities.state` shape](./data-model.md#world-state-storage),
several state fields carry user-facing text content worth
including in search:

- **Likely yes — `traits`, `drives`** (CharacterState chip lists,
  `agenda` for FactionState). Users will want to filter "all
  characters with `former soldier` trait" or "factions whose agenda
  mentions Vex."
- **Likely no — `voice`** (low search-value; prose stylistic note
  rather than searchable identity).
- **Edge cases — `visual.*`** sub-fields. "All red-haired
  characters" feels like a search you'd want, but the chip-style
  noise (every character has 6 visual slots, mostly populated) may
  flood unrelated search results.
- **Stackables keys** — searching "all characters with gold > 0" is
  a different shape (numeric filter, not text search); treat
  separately if real demand surfaces.

Decision lands with the next pass over the World panel + Browse
rail search-scope definition. Lean: include `traits` + `drives` +
`agenda` immediately when implementing the new shape; defer
`visual.*` until UX testing surfaces flooding-or-not-flooding signal.

### Next-turn suggestions — design pass

Reader / composer surfaces a next-turn suggestion affordance. Three
open questions worth a joint design pass rather than ad-hoc
decisions during the reader-composer detail pass:

- **Customizable categories.** Whether the user can tailor what
  categories of suggestion are surfaced (action / dialogue /
  introspection / time-skip / scene-change / custom) and how that
  customization persists (per-story setting, per-branch,
  user-global) is unspec'd. Lean: per-story setting on
  `stories.settings` with a sensible default category set; revisit
  granularity on real signal.
- **User input as guidance.** Letting partial input in the
  composer's input box act as guidance for the suggestion engine
  ("user typed 'Aria approaches the …' → suggest completions") is
  an interaction model worth designing rather than retrofitting.
  Affects refresh cadence (debounce, on-pause), placement relative
  to the input cursor, commit semantics (tap to replace vs merge
  with typed text), and how this composes with category filtering.
- **Suggestion-emission piggyback — fold suggestions into the
  narrative call.** The classifier-fold half is now answered by
  [piggyback mode](./memory/piggyback.md) — capability-gated trailing
  block on the narrative call, with periodic classifier as the
  separate fallback. Suggestion-emission is the natural extension of
  that pattern (lower stakes than classification, lives next to
  narrative output anyway). Open: whether suggestions reuse the same
  trailing block or live in a sibling block; how the suggestion
  surface composes with category filtering and user-input guidance.

The three questions interact: consolidation mode shapes how
suggestions are produced, which constrains how categories can be
filtered and how user-input guidance is fed into the call. Designing
them together avoids painting into a corner.

### Provider / profile / model-profile deletion semantics

No spec'd behavior for deleting a provider, profile, or model
profile that's referenced by stories or assignments. Calendar
deletion (designed in
[`calendar-systems/spec.md`](./calendar-systems/spec.md), folded
into [data-model.md → App settings storage](./data-model.md#app-settings-storage))
sets the stricter precedent — block when references exist.
Provider/profile probably want the same shape but worth a dedicated
pass: orphan handling on import, soft-warn vs hard-block tradeoffs,
what happens to `default_provider_id` if the referenced provider is
deleted, etc.

### Translation graceful degradation

A translation phase fatal failure currently aborts the entire
per-turn pipeline (per the framework's "fatal phase → transaction
abort" contract). User loses their AI response over a translation
provider hiccup. Harsh — the narrative is the primary user value;
translation is a display-time bonus.

The fix: translation phase declares its failures as recoverable at
the phase level (the narrative commits, the translation rows just
don't land for this turn). On next render of an entity / entry, the
translation lookup falls back to source language; the next opportunity
to re-translate (e.g., user edits the entity, or a deliberate
"re-translate this story" action) covers the gap.

Open sub-questions:

- **Where the soft-fail lives.** Inside the translation phase itself
  (catch, log a recoverable_error, return completed with empty
  `translationResult`) or via a wrapper that converts fatal-from-
  translation into recoverable? Probably former — translation phase
  knows its own degradation semantics.
- **Re-translation triggers.** Render-time lazy retry (each missing
  translation kicks off a one-off call) vs explicit user action
  ("retranslate this story"). Render-time lazy gets expensive fast;
  explicit user action is safer but loses the magic.
- **UX surface for failures.** Toast? Silent? Status pill flag for
  "some translations failed this turn"? Probably silent + diagnostic
  in dev mode.

Lands when translation phase is built. The framework already supports
the degradation pattern; this followup pins the policy.

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
