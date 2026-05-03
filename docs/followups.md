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

### Lore-management agent shape

[`data-model.md → Chapters / memory system`](./data-model.md#chapters--memory-system)
declares that a lore-management agent runs at chapter close to
promote staged entities, update lore, and write new lore from
events discovered in the just-closed range. Cadence + scope are
locked; what's deferred is the agent's concrete shape:

- Prompt design — what context does it see (the closed range only?
  the open buffer too? structural floor?), and what's the output
  format (a list of proposed mutations, a delta JSON, free-form
  prose to re-parse)?
- Promotion rules — when does staged → active fire automatically vs
  surface as a suggestion the user confirms? Conservative bias is
  the lean (don't auto-mutate without a high-confidence signal).
- New-lore creation policy — proactive (writes anything novel
  observed) vs conservative (only writes when explicit story-world
  context warrants a new lore entry). Old app erred proactive and
  produced lore noise.
- Failure modes — agent timeouts mid-cadence, partial output,
  contradictions with existing state. Each delta is reversible via
  rollback so the floor isn't catastrophic, but it should still be
  designed not to thrash.
- **Compaction of `traits` / `drives` (CharacterState) and `agenda`
  (FactionState).** Per [`data-model.md → World-state storage`](./data-model.md#world-state-storage),
  these slow-evolving identity arrays are written ONLY at
  chapter-close lore-mgmt — never per-turn. The agent dedupes
  synonyms ("brave" + "courageous" → one), prunes outdated entries
  ("former alcoholic" 10 chapters past sobriety → drop), and
  consolidates overly-specific entries against the soft caps
  (`traits ≤ 8`, `drives ≤ 6`, `agenda ≤ 4`).
- **Stackable-key normalization on `CharacterState.stackables`.** Cross-
  character keys ("gold" / "Gold" / "gold pieces") drift over time;
  the agent normalizes to canonical lowercase keys at chapter close.
- **`lore.priority` retrieval semantics.** The schema declares the
  field but its precise effect is not pinned. UI today (per
  [`world.md → Settings tab — lore`](./ui/screens/world/world.md#settings-tab--lore))
  renders `priority` editable with a working-model tooltip — "higher
  priority preferred when retrieval is token-budget-constrained,
  ties break by recency." Retrieval-side behavior must firm up this
  contract or the UI tooltip diverges from runtime reality. Pairs
  naturally with this entry because lore-mgmt + retrieval are
  designed jointly per the closing note.
- **Description revision suggestion-queue** — the deferred
  autonomous-vs-confirm-mode toggle for classifier-proposed
  description revisions (per the entity description authorship
  contract). Until this UI lands, classifier writes description
  only at first introduction; the agent never amends post-
  establishment.

Lands once the retrieval agent's shape is also pinned (per
[`architecture.md → What this doc does not yet cover`](./architecture.md#what-this-doc-does-not-yet-cover))
— both agents share enough scaffolding (prompt construction,
output validation, delta emission) to design as a pair rather than
sequentially. The write-cadence + state-field authorship contract
below is the architecture-side counterpart to this same design
pass.

#### State-field write contract — architecture

[`data-model.md → World-state storage → Authorship contract`](./data-model.md#authorship-contract)
declares per-field "first write" and "subsequent writes"
authority, but the _enforcement mechanism_ is architecture
territory. Open:

- **Per-turn classifier write contract.** Which agent (per-turn
  classifier vs every-N-turn classifier vs chapter-close
  lore-mgmt) writes which fields, with what cadence? This design
  proposes a stratification (per-turn for scene metadata + visual
  - relationships + stackables; chapter-close-only for traits /
    drives / agenda) but locks neither the agent boundaries nor
    the prompt designs.
- **Manual-edit-vs-classifier-overwrite policy.** v1 lean:
  classifier writes from prose-evidenced changes; user edits
  "stick" only until classifier reads contradicting prose.
  Per-field provenance metadata (parked, see
  [`parked.md → Per-field provenance metadata`](./parked.md#per-field-provenance-metadata-for-entitiesstate))
  is the proper fix; v1 accepts this floor.
- **Concurrency / coordination.** Per the parked
  [Concurrent pipeline / agent coordination](./parked.md#concurrent-pipeline--agent-coordination)
  followup — when background agents enter the picture (style-
  review, standalone memory-compaction), state-field writes from
  multiple agents need conflict policies.

Same design pass as the lore-management agent shape above —
chapter-close lore-mgmt is one of the agents whose write contract
this section locks down.

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

### Virtual-list library choice

`react-window` vs `@tanstack/react-virtual` — both mature, both
solve the same problem. Decision blocked on:

- React Native Web compatibility verification (we render to RN-Web
  for desktop via Electron; library must work there).
- Per-row height handling: uniform vs computed-per-row vs measured.
  Model rows are uniform; history rows might vary slightly. The
  [reader narrative scroll model](./ui/screens/reader-composer/reader-composer.md#scroll-behavior)
  forces **measured** — entries are variable length and reasoning-
  body expansion toggles row height post-mount.
- **Scroll-anchoring on above-viewport mutations.** The reader's
  auto-load-older + reasoning-expansion behaviors require the
  library to preserve native scroll-anchoring when content is
  inserted above the viewport. Libraries that manipulate
  `scrollTop` programmatically and break native anchoring are
  disqualified.
- Bundle size and tree-shaking story.

Lands when the first virtualized component is implemented. v1
surfaces that pull on this: the model picker dropdown, App
Settings · Profiles model list, **and the reader narrative**
(per [`reader-composer.md → Scroll behavior`](./ui/screens/reader-composer/reader-composer.md#scroll-behavior)).

### Calendar picker primitive — open shape decisions

The [calendar picker pattern](./ui/patterns/calendar-picker.md)
uses Select-shaped UI but its row content + tail action go beyond
the current Select primitive. Open shape decision: either Select
gains rich-row content + popover tail-action support (and the
calendar picker is a configuration of Select), or a sibling
`Picker` primitive forks the contract for richer-row use cases
(calendar picker, future multi-line option pickers). Decide when
the second rich-row picker emerges and the trade-off is concrete.

The popover-search threshold sub-question (parked-until-signal)
moved to
[`parked.md → Calendar picker search-bar threshold`](./parked.md#calendar-picker-search-bar-threshold).

Lands with the Select primitive's first implementation pass.

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

Open questions:

- **Reanimated wiring.** `react-native-reanimated@4.x` is a project
  dep; NativeWind 4's transition support on native is documented as
  reanimated-driven. Verify whether the babel plugin is configured
  correctly and whether NativeWind's transition path actually fires
  worklets, or whether it falls through to a web-only code path
  silently.
- **Static class hoisting.** Phase 1's MotionSamples now uses
  literal class strings (`duration-fast`, `ease-emphasis`, etc.) so
  Tailwind's content scan compiles them. With the static names in
  place, native should at least try the transition; characterize
  what actually happens.
- **Alternative animation API.** If NativeWind transitions don't
  pan out on native, decide whether component-internal animations
  use reanimated directly (`useSharedValue` + `useAnimatedStyle`),
  RN's built-in `Animated` API, or a higher-level lib (moti, etc.).
  Phase 1 doesn't have any non-foundations consumers yet, so the
  pattern is unblocked but unsettled.

Lands at phase 2 Group A's Sheet implementation — Sheet's slide-in
animation is the first v1 surface that forces resolution
(scoped in
[`patterns/overlays.md`](./ui/patterns/overlays.md)). Until then,
MotionSamples-as-token-reference is enough.

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
- **Pipeline consolidation — fold classifier (and possibly
  suggestions) into the main narrative prompt.** Today's pipeline
  treats classification as a separate post-generation pass per
  [`architecture.md`](./architecture.md). Folding classification —
  and possibly suggestion-emission — into the narrative call is
  cheaper (one round-trip instead of two or three) but couples
  responsibilities and may degrade output quality, especially on
  smaller models. Inverse intuition: capable models can do it all
  in one pass; smaller models need the split to stay coherent.
  Worth exploring as an optional consolidated mode rather than a
  replacement, and the suggestion-emission half is the natural
  first slice to fold (lower stakes than classification, lives next
  to narrative output anyway).

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
