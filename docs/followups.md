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

### Manual worldTime correction — cascade vs. jump + downstream blast radius

Per [In-world time tracking](./data-model.md#in-world-time-tracking)
users can manually edit `metadata.worldTime` on a single entry to
correct classifier drift. The edit is delta-logged like any metadata
mutation. What's NOT specified: what happens to subsequent entries
and to anything that derives time from them. Two options, both with
real costs:

- **Cascade correction** — shift every entry after N by the
  correction delta. Preserves the monotonically non-decreasing
  invariant. Costs: one user edit produces N writes; either each
  gets its own delta (loud log) or they batch under a single
  `action_id` (cleaner, but a larger atomic operation). Also racy
  if a classifier pass is mid-stream on a new entry.
- **Jump (leave subsequent alone)** — only entry N changes;
  entries > N retain their original worldTimes. Breaks the
  "monotonically non-decreasing" promise between N and N+1.
  Downstream consumers reading worldTime arithmetic (character
  ageing, scheduled-happening firing checks, freshness-based
  retrieval decay) misbehave in subtle ways.

Secondary concerns the design needs to answer:

- **Derived happening times.** A happening with
  `occurred_at_entry = E` derives its in-world time from entry E's
  worldTime (per the [`happenings` decision](./data-model.md#happenings--character-knowledge)).
  Editing entry E's worldTime semantically shifts every such
  happening's time. The shift is audit-visible via the delta log,
  but the UX needs to surface "this edit changes N derived times"
  before the user commits.
- **Flashback / non-linear corrections.** The classifier emits `0`
  for detected flashbacks, but a user might manually set a
  worldTime on a flashback entry to mean "this scene depicts 1872
  AR." That collides with the "metadata.worldTime is always
  main-timeline elapsed" contract. The future `sceneTime` exit
  (documented in
  [`data-model.md → In-world time tracking`](./data-model.md#in-world-time-tracking))
  is the cleaner home for this — manual worldTime edits on
  flashback entries should probably be blocked with guidance
  pointing at sceneTime once it lands.
- **Non-linear narratives** generalize the flashback case.
  Single-`worldTime` was already flagged a v1 limitation; manual
  correction makes the limitation more user-visible, since users
  in those genres will reach for the edit affordance.

Decisions needed:

- Cascade vs. jump (or a third option — interactive confirmation
  showing the affected entries + happenings and letting the user
  pick).
- UX for blast-radius preview before commit.
- Guardrails (if any) blocking edits that would break
  monotonicity or shift derived times the user didn't intend.
- How `sceneTime` (when it lands) co-exists with manual
  `worldTime` edits.

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

### Delta diff cache for history surfaces

The [`deltas`](./data-model.md#diagram) table stores `undo_payload` —
the data needed to reverse a change — but not the post-state. To
render the host-formatted `summary` strings the
[DeltaLogRow pattern](./ui/patterns/delta-log-row.md) takes opaque
(e.g., `Added "former soldier"; was ["brave", "loyal"]`), the host
needs both the OLD value (in `undo_payload`) and the NEW value
(absent). Walking the deltas chain forward to derive each
post-state on read is fine for a single per-target history view,
but expensive for the cross-cutting global delta-log surface.

Direction agreed (informal — pending design pass for schema and
SQL shape):

- **Cache shape: post-state JSON, separate table.** Mirror the
  shape of `undo_payload` but for the new value, in a separate
  cache table (e.g., `delta_redo` or `delta_snapshots`). Keeps
  the `deltas` table narrow as the canonical reversal log; cache
  is fully disposable + rebuilable from `deltas` + current target
  state.
- **Per-field, not full row.** Match `undo_payload`'s scope —
  only the touched fields. Tiny edits don't blow up to full-row
  snapshots.
- **Lazy population.** Fill on first view of a target chain;
  history surfaces sort newest → oldest so a user typically only
  pages a small window before navigating away. Write-time
  population was rejected because most deltas are never browsed.
- **Display layer formats prose at render time** from `(old, new)`
  diff inputs. Keeps the cache language- and format-agnostic;
  translation and prose-tuning don't need cache rebuilds.

Decisions deferred to the design session:

- Concrete table schema (PK shape, indexes, branch-scoping).
- Eviction / bounded-size policy, or unbounded with vacuum on
  manual command.
- Cold-read strategy for the global delta-log surface — does it
  precompute on idle, constrain to the most recent N deltas with
  on-demand expansion, or accept the first-paint cost?
- Backfill / rebuild ergonomics — single command, branch-scoped,
  per-target?
- Concurrency between an in-progress walk and a fresh delta write
  on the same target (single-writer SQLite makes this less
  fraught, but the policy still needs to be named).

Lands before any history surface goes interactive in v1
(World history tab, Plot history tab, future global delta-log).

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

### Reader narrative scroll-anchoring on prepend

Library choice resolved on 2026-05-06:
**`@tanstack/react-virtual`** on web (validated inside
Autocomplete's portaled popover via Electron's RN-Web build) +
**`FlatList`** on native. Variable-height rows handled by
`measureElement` on web and FlatList's native layout on phone.

What **isn't** resolved: when the reader narrative auto-loads older
entries (insertion above the viewport) or when a reasoning body
expands above the current scroll, the user's apparent scroll
position must stay anchored — content above the fold can shift, but
what's in front of the user must not jump.
`@tanstack/react-virtual` does not preserve native browser
scroll-anchoring across prepend out of the box; community recipes
(measure prepended block, add equivalent top padding, scroll by
the same delta, then drop the padding) work but need careful
glue. FlatList's `maintainVisibleContentPosition` covers the
native side. Lands when reader-composer is built and a real
prepend stream exists to validate against.

Reference: [reader narrative scroll model](./ui/screens/reader-composer/reader-composer.md#scroll-behavior).

### Calendar swap-warning AlertDialog (W1 / W2 / W3)

The [calendar picker pattern](./ui/patterns/calendar-picker.md#story-settings--swap-warnings)
specifies a combined confirmation modal that fires on Story
Settings calendar swaps — origin-tuple mismatch (W1), era support
mismatch (W2), display-format change (W3). Intentionally NOT part
of the `CalendarPicker` compound that shipped (the modal is a
Story-Settings-specific composition layer wrapping the swap path).
Build it as a dedicated `CalendarSwapDialog` compound on top of
the AlertDialog primitive when Story Settings · Calendar tab
lands. The Continue button label adapts (`Continue & re-pick origin`
when W1 applies, `Continue & swap` otherwise) and modal sections
render only the warnings that apply.

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

### NativeWind transition-\* support on native

The foundations explorer's MotionSamples section gates `transition-*`

- `transform` animations to web only on phase 1 because the
  combination triggered a `Maximum call stack` error on Android during
  bring-up — likely an interaction between dynamic class names + the
  NativeWind runtime fallback path, but not narrowed precisely.
  Animations are static (a colored bar with no movement) on native.

**Animation-API decision settled** (phase 2 Groups A + F):
component-internal animations use **reanimated directly**
(`useSharedValue` + `useAnimatedStyle` + `withRepeat` /
`withTiming`) rather than depending on NativeWind transitions on
native. Sheet's slide-in (Group A) and Skeleton's pulse (Group F)
both ship via [`NativeOnlyAnimatedView`](../components/ui/native-only-animated-view.tsx)
with web/native branches that emit CSS keyframes on web and
reanimated worklets on native. Spinner (Group F) uses a similar
per-platform dispatch (CSS `animate-spin` on web, RN
`<ActivityIndicator>` on native — battle-tested platform shape
beats wiring a custom rotation worklet for one consumer).

Open characterization (low priority — primitives ship without it):

- **Whether NativeWind's transition path actually fires on
  native.** With static class names hoisted in MotionSamples,
  reanimated babel-plugin in place, and reanimated 4 as a dep,
  the transition should at least attempt to fire. Useful to
  characterize: confirm whether transitions are silently no-op'd
  or genuinely run on native, and whether the `Maximum call
stack` blocker is fixed in current NativeWind / reanimated
  versions. Outcome would unblock terser declarative styling
  (`transition-colors duration-fast`) on a few state-feedback
  surfaces — but doesn't unblock anything v1 needs.

The MotionSamples web-gating remains in place until that
characterization runs.

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

### Storybook design-rules pattern setup

Storybook's tree is set up as **Foundations / Primitives /
Patterns / Screens** (phase 1). What's still pending is the
Patterns branch — MDX pages prose-citing the corresponding
[`docs/ui/patterns/`](./ui/patterns/README.md) file as canonical
(per the pattern README's dual-source rule) and embedding live
component stories beneath — render-mode demos, side-by-side
comparisons, accessibility checks.

Lands when patterns become consumers in phase 3. Premature to
scaffold before patterns exist; the live embedding is the whole
point.

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

### Crash recovery for in-flight transactions

A crash mid-transaction leaves a partially-applied `action_id` in
the delta log: some deltas committed, the transaction never reached
commit-tx. On next app boot, recovery must detect the in-flight
`action_id` and replay-in-reverse to restore pre-transaction state
— the same reverse-replay an orchestrator-driven abort uses, just
triggered by recovery on startup rather than at runtime.

[`ui/principles.md → Edit restrictions during in-flight generation`](./ui/principles.md#edit-restrictions-during-in-flight-generation)
assumes this hook exists; it doesn't ship it. Belongs alongside
startup / migration flow design (per
[`architecture.md → What this doc does not yet cover`](./architecture.md#what-this-doc-does-not-yet-cover)).

Open sub-questions:

- How is "in-flight" detected — a flag on a `transactions` table, a
  sentinel column on the latest delta, or scanning for an `action_id`
  whose deltas form an unfinished transaction?
- User-facing surface — silent recovery, or a "your last action was
  reverted on restart" toast?
- Interaction with chained transactions (per-turn → chapter-close):
  does recovery treat them as one unit or two?

### Settings screens — adopt SwitchRow pattern

Story Settings and App Settings render their boolean toggles as a
label + hint row with a switch on the right (per wireframes —
both swept during the
[mobile settings revisit](./explorations/2026-05-04-mobile-settings-revisit.md)
to use SwitchRow consistently, replacing the older standalone-
toggle-with-adjacent-label and `[off | on]` segment-as-boolean
idioms). Group D shipped the
[`SwitchRow` pattern](./ui/patterns/forms.md#switchrow-pattern) as
the canonical row-tappable shape. The screen-side rework — wiring
the pattern into Story Settings and App Settings panels,
normalizing label / hint copy, ensuring the row spans the full
panel width — lands as part of phase 3 settings implementation.
Tracked here so it doesn't get lost between primitive landing
(done) and screen integration (pending).

Cross-platform: SwitchRow is the canonical shape on every tier
(phone, tablet, desktop). Settings layouts should NOT use a
standalone Switch with an adjacent label — that pattern is
deprecated for v1. The
[Switch primitive](./ui/patterns/forms.md#switch-primitive) stays
exported as a building block for non-row cases (toolbar quick-
toggles, inline status indicators) but no v1 wireframe needs that
shape.

### Checkbox without v1 consumer

The Checkbox primitive (Phase 2 Group D) shipped without a v1
wireframe consumer — added on speculation that a multi-select list
or "I agree" gating shape would surface during phase 3 screen
implementation. If phase 3 lands without a real consumer, candidate
to park or drop (parallel to how standalone Radio was dropped from
Group D in favor of Select.radio).

Tracking surface: when reviewing each phase 3 screen, note any
multi-select or boolean-list shape that would naturally use
Checkbox. If the count stays at zero after all screens land, drop
in a Phase 3 cleanup pass. If a consumer surfaces, this entry
resolves silently — Checkbox stays.

### Density-aware input component height sweep

Cross-primitive audit of every density-aware interactive control
to verify heights are consistent and the density-token system
covers all the shapes consumers actually compose together.

**Surfaced during the Toolbar build pass:** filter chips and the
Sort dropdown trigger sit on the same row at narrow tiers and
read as different types of controls because of a height
mismatch. Chip's natural height (~34 px) doesn't align with
either `h-control-sm` (~32 px) or `h-control-md` (~40 px) — it
sits between, because Chip's padding (`px-row-x-sm
py-row-y-xs`) plus `text-xs` line-height plus border resolves
to a value the density-token system doesn't carry. Toolbar.Sort
had to use `h-9` (36 px) to get within 2 px of Chip's natural
height — closest match without a primitive change. A
`h-control-sm` override on Sort wouldn't conflict with
`h-control-md` in tailwind-merge (custom utility tokens aren't
recognized as exclusive); the merge just keeps both classes and
CSS source-order picks the winner.

The sweep covers every density-aware interactive primitive and
asks the same questions per component:

- Input — uses `h-control-sm/md/lg`. Verify the underlying
  px values per density.
- Textarea — multi-line; height is content-driven via `rows` and
  `maxRows`. Confirm the per-row computation respects density.
- Select trigger — uses `h-control-md` default with `size="sm"`
  → `h-control-sm`. Verify size variants are reachable from the
  public Select API (currently only the internal Trigger
  function takes `size`).
- Button — has `size` variants. Confirm they map to the same
  control-h tokens.
- IconAction — size variants. Same question.
- Switch — density-bound track + thumb dimensions. Verify the
  envelope.
- Checkbox — density-bound box dimensions. Same.
- **Chip — outlier.** Padding-driven natural height doesn't
  align with control-h tokens.
- Tag — same padding pattern as Chip; same outlier shape when
  interactive.
- Autocomplete — wraps Input; inherits.
- TagInput — wraps Input + Tag; inherits the chip-vs-input
  height mismatch internally (input is taller than chips at the
  same density).

**Decisions the sweep needs to settle:**

- Whether all interactive controls within a chrome row should
  share one height token (chrome consistency), or whether
  filter / chip-shaped affordances are intentionally distinct
  (compact secondary identity). The user's lean during the
  Toolbar build pass: same height feels right for adjacent
  controls.
- If aligning: which token wins (`h-control-sm` for compact,
  `h-control-md` for primary), and how the outliers (Chip, Tag)
  rework their padding to match.
- If a new density-token tier is needed (`h-control-xs` at
  ~28 px) to cover the chip-shaped natural height, with Chip
  switching to use it explicitly.
- Whether tailwind-merge needs custom-config additions so
  `h-control-*` tokens conflict like native `h-*` tokens, so
  consumer overrides actually win.

Lands during a primitive consistency sweep — best alongside the
next batch of compounds that mix multiple density-aware
controls in chrome rows (StoryCard's status badges,
DeltaLogRow's op badge — both non-interactive but adjacent to
controls, so visual harmony still matters). The Toolbar's
Sort-vs-chips pairing is the first interactive mismatch
documented; further mismatches likely surface as build-ready
compounds land.

### EmbedderDownloadDialog

- **EmbedderDownloadDialog driver effects for HF-id and import paths.**
  The container's `downloading` and `verifying` effects currently guard
  on `init.kind === 'catalog'`. The HF-id and import paths can enter
  `downloading`/`verifying` states via the reducer but no effect drives
  them through to completion. Wiring lands with the platform-specific
  driver implementations per consumer (Onboarding Step 4 lands first
  per [onboarding.md → Step 4](./ui/screens/onboarding/onboarding.md#step-4--pick-an-embedder)).
- **EmbedderDownloadDialog init prop referential stability.**
  Three container effects depend on the whole `init` object reference.
  If a host re-renders mid-download with a structurally-equal but
  newly-allocated `init` object, the effect's cleanup arm cancels the
  in-flight download and the loop restarts from `files[0]`. The
  cancellation flag preserves correctness-of-state but resets user
  progress. Either narrow the effect deps to stable primitives
  (`init.entry.id`, `init.entry.revision`) or document a host
  requirement to memoize the `init` prop. Defer until a real consumer
  surfaces the regression.

### CollisionResolveDialog

- **Real DB-write drivers per resolution path.** Merge / Rename /
  Keep drivers writing entities + happening_awareness +
  happening_involvements + translations deltas under a single
  `action_id`. World consumer (`app/(story)/world/...` route)
  wires these. Dialog ships with stub drivers in stories only.
- **Phone-tier prose clamp on merge body.** 3-line clamp +
  tap-to-expand on long descriptions per
  [`world.md → Merge`](./ui/screens/world/world.md#merge). Stories
  cover desktop wrap; phone tier deferred to v1 mobile pass.
