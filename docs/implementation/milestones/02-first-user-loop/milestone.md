# Milestone 2: First user loop

## Goal

Smallest end-to-end story loop with a real provider. A user on a
clean install configures an OpenAI-compatible provider, completes
the wizard's minimum-viable path, writes entries in the reader,
gets streamed responses from a real LLM, saves the story, and sees
it on the story list. No memory pipeline, no awareness graph, no
chapter management — each turn sends the last N entries verbatim
as context. Stories made in M2 are short-and-incoherent by design;
the point is to validate the loop, not the storytelling.

## Why now

Validates the full request path — UI → action layer → pipeline
framework → real provider → entry write → diagnostics — end-to-end
with a human-perceptible outcome, replacing M1's fault-injection
stub. Produces the first real-story data the memory pipeline (M3)
needs to tune against. Every downstream milestone assumes this
loop exists; M2 is the first milestone where a defect in the M1
spine or the M1.5 substrate surfaces against real traffic instead
of vitest fixtures.

## Narrative / overview

M2 is wide-then-converge. Eight of ten slices are day-one
startable because M1.5 front-loaded the schema, stores, and CRUD
arms; the milestone converges on [Slice 2.7](./slices/07-wiring.md),
which swaps the stub provider for the real chain and tears down
the M1 smoke scaffolding.

Three build tracks run in parallel. The **AI track** fills in the
provider layer: [Slice 2.1](./slices/01-provider.md) lands the
OAI-compat provider, the agent→profile→provider resolution chain,
the provider-config mutators (deliberately excluded from the M1.5
gate), an interim provider-setup form (the full providers tab is
M7.1), and the `callWithRetry` hardening. Two pure framework
pieces ride alongside: the ID-substitution library
([Slice 2.8](./slices/08-id-substitution.md)) and the
resolver-input declaration + config pre-flight
([Slice 2.9](./slices/09-preflight.md)).

The **content track** builds what the loop renders and writes:
the remaining `story_entries` arms and the rollback-to-entry
action ([Slice 2.2](./slices/02-entry-arms.md)), the
pack-template / Liquid engine with the bundled pack
([Slice 2.6](./slices/06-pack-engine.md)), and the
minimum-viable wizard ([Slice 2.3](./slices/03-wizard.md)) —
which also scaffolds the `lib/calendar` substrate. Per the
planning decision recorded in this doc, the M2 wizard carries a
**minimal lead-character input**, so adventure-mode and
first/second-person stories are creatable in M2 without the full
cast editor (M3.6).

The **UI track** ships the two real surfaces: the story list with
the stories store ([Slice 2.4](./slices/04-story-list.md)) and the
reader-composer minimum ([Slice 2.5](./slices/05-reader.md)) —
entry window + scroll model, composer with send-time mode
wrapping, markdown rendering, Harper spellcheck, edit / delete /
rollback, and basic CTRL-Z. The crash-recovery modal and the
per-story settings parse-failure badge land in
[Slice 2.10](./slices/10-recovery-ui.md) over the slots 1.7a
shipped. The UI slices consume heavily from the shipped compound
inventory (EntryCard, StoryCard, CalendarPicker,
GenerationStatusPill, ScreenShell, Toolbar) — they wire, not
build, wherever a compound exists.

What changes from "before" to "after": the app goes from "spine +
complete data layer, stub LLM only" to "a stranger can install
the app, point it at an OAI-compat endpoint, create a story, and
play it." M3 then layers memory on top of real story data.

Two deliberate M2 simplifications are worth naming. Rollback and
undo use the **naive positional suffix sweep** — correct in M2
because no `periodic_classifier` deltas exist yet; M3.3 / M3.9
add the survival-anchor refinement. And the per-turn pipeline's
`user-action-translation` phase implements **only the
same-language short-circuit** — the phase slot exists so the M8.1
translation call drops in without reshaping the pipeline, but no
translation settings UI exists before M7.2, so the short-circuit
is the only reachable path.

## Slices

- [Slice 2.1](./slices/01-provider.md) — OAI-compat provider,
  resolution chain, config mutators + interim setup form,
  `callWithRetry` hardening
- [Slice 2.2](./slices/02-entry-arms.md) — entry delete /
  content-update arms, opening invariants, rollback-to-entry
  action
- [Slice 2.3](./slices/03-wizard.md) — minimum-viable wizard
  (steps 1, 2, 5 + minimal lead input), creation mutators,
  `lib/calendar` substrate
- [Slice 2.4](./slices/04-story-list.md) — story list as a real
  surface; owns the stories store
- [Slice 2.5](./slices/05-reader.md) — reader-composer minimum:
  entry window, composer + mode wrap, markdown pipeline, Harper,
  edit / delete / rollback, CTRL-Z
- [Slice 2.6](./slices/06-pack-engine.md) — Liquid engine, macro
  resolver, bundled pack, include-compatibility validator
- [Slice 2.7](./slices/07-wiring.md) — end-to-end wiring: per-turn
  pipeline declaration, real provider swap, hydrate-on-story-open,
  smoke-scaffolding teardown
- [Slice 2.8](./slices/08-id-substitution.md) — `IdBiMap` +
  `substituteIds` + reverse substitution (pure library)
- [Slice 2.9](./slices/09-preflight.md) — phase resolver-input
  declaration + config pre-flight validation
- [Slice 2.10](./slices/10-recovery-ui.md) — crash-recovery modal
  - story-settings parse-failure badge

## Dependency graph

```
day-one: 2.1  2.2  2.4  2.6  2.8  2.9   (+ 2.5-bulk, 2.10-modal-half)

2.1, 2.6, 2.8 ───────────────► 2.3
2.2, 2.6, 2.3 ───────────────► 2.5    (partial gates; bulk is day-one)
2.1, 2.3, 2.5, 2.6, 2.8, 2.9 ► 2.7
2.4 ─────────────────────────► 2.10   (badge host)
2.7 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄► 2.10   (badge-state feed; kill-mid-turn AC)
2.5 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄► 2.4    (debug-button removal task only)
```

- **Day-one startable:** 2.1, 2.2, 2.4, 2.6, 2.8, 2.9, and the
  bulk of 2.5 (entry window, scroll model, markdown pipeline,
  Harper wiring, composer chrome — against the M1
  `registerStubProvider()` seam). 2.10's recovery-modal half is
  also day-one (the `pendingRecoveryReport` slot shipped in 1.7a).
- **2.3 (wizard)** gates on 2.1 (opening generation resolves
  through the chain and the interim config), 2.6 (wizard templates
  render through the engine), and 2.8 (placeholder substitution on
  the opening call's structured output). Steps 1–2 and the
  `lib/calendar` substrate can start before those land.
- **2.5 (reader)** takes three late inputs: the edit / delete
  actions and rollback-confirm modal consume 2.2's arms and
  rollback action; the composer mode wrap consumes 2.6's bundled
  wrap macros; the time chrome consumes 2.3's `lib/calendar`.
- **2.7 (wiring)** converges: it needs 2.1 (real provider), 2.3
  (a creatable story to open), 2.5 (the reader it wires), 2.6
  (the per-turn template), 2.8 (idMap on the per-turn context),
  and 2.9 (the declaration shape the per-turn pipeline registers
  with).
- **2.10 (recovery UI)** gates on 2.4 for the parse-failure badge
  (the story list hosts it) and on 2.7 for the badge half's
  integration verification (2.7's story-open path is what writes
  the failure state, and 2.10's kill-mid-turn criterion needs the
  real per-turn pipeline); the modal half has no M2 dependency.
- **2.4's debug-button removal** is ordered after 2.5 merges (the
  M1 landing button is the only reader entry until the real
  navigation path exists); the rest of 2.4 is independent.
- **2.3 ∥ 2.4** is a [doc-as-contract](../../conventions.md#sequencing-vs-doc-as-contract)
  pair over C1 (the stories store API) and C5 (the wizard-session
  prompt seam).

## Slice contracts

### C1 — Stories store API

[Slice 2.4](./slices/04-story-list.md) owns the stories store
(library working set): hydrate-at-boot / landing, list selectors
(filter / sort / search inputs in, rows out), and single-column
UI-field writes (`favorite`, `status`, `last_opened_at`).
[Slice 2.3](./slices/03-wizard.md) consumes a pinned
**creation-refresh surface**: after the wizard's commit
transaction (and after save-as-draft), the new / updated `stories`
row must appear in the store via one named call — either an
upsert taking the full row or a targeted re-read by id; 2.4 picks
the shape, 2.3 calls it.

Three further pins on this store:

- **Open-story action.** 2.4 exports a single open-story action —
  resolve the story's current branch, touch `last_opened_at`,
  navigate to the reader route — used identically by the
  story-list card click and the wizard's Finish routing.
  [Slice 2.7](./slices/07-wiring.md) extends the open path (not
  the callers) with the `definition` / `settings` parse,
  `hydrate(branchId)`, and the failure write below.
- **Open-failure state.** Shape pinned:
  `{ storyId: string; kind: 'definition-corrupt' | 'settings-corrupt' }`
  (one entry per failed story; cleared on successful open or
  reset). 2.7 writes it through a store-exported mutator — never
  ad-hoc `setState` from outside the store —
  [Slice 2.10](./slices/10-recovery-ui.md) renders and resolves
  it.
- **Externally-called mutators.** The store exports exactly two
  mutators for non-owner slices: the `last_opened_at` touch and
  the open-failure write / clear. Names fixed in 2.4's first
  commit; 2.7 imports them.

### C2 — Pack-engine render surface

[Slice 2.6](./slices/06-pack-engine.md) owns the engine module.
Pinned boundary: a render entry point taking
`(templateId, context)` and returning the rendered string,
synchronous-or-promise per LiquidJS; template ids and macro ids
are exported constants from the engine module (consumers never
inline string literals); the bundled pack ships one composer-wrap
macro per `(mode × wrapPov)` cell — `Do` / `Say` / `Think`
crossed with `first` / `third`, `Free` bypasses the engine. Wrap
macros take `{ text: string; leadName: string }` (`leadName`
required for third-person wraps).
Consumers: [Slice 2.3](./slices/03-wizard.md) (wizard-group
templates), [Slice 2.5](./slices/05-reader.md) (send-time wrap),
[Slice 2.7](./slices/07-wiring.md) (per-turn narrative template).
Exact constant names are fixed in 2.6's first commit; the
contract here is the surface shape, not the literals.

The `generationContext`-group **variable names** are part of this
boundary: the M2 subset follows
[`architecture.md → v2 shape of generationContext`](../../../architecture.md#v2-shape-of-generationcontext--whats-carried-over-what-changes)
(`entries`, `entities`, definition fields, `userSettings`,
intermediates). 2.6's snapshot-test fixtures and 2.7's context
builder must use the same names — reconciled against 2.6's first
commit, since a name mismatch passes both slices' own tests and
fails only at integration.

### C3 — Model resolution surface

[Slice 2.1](./slices/01-provider.md) owns `resolveModel`. Pinned
boundary: `resolveModel(agentId | 'narrative')` walks
`stories.settings.models[agentId]` → `assignments[agentId]` →
`profile.modelRef` per
[`architecture.md → Settings`](../../../architecture.md#settings-strict-types-defaults-at-load),
returning the resolved `{ providerId, modelId }` plus the profile
parameters, or a **typed failure** naming the first missing link.
The failure-kind literals are pinned so 2.1 and 2.9 ship
identical discriminants:
`'no-profile-assigned' | 'profile-missing' | 'provider-missing'`
— the same vocabulary the
[error surface](../../../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill)
and [Slice 2.9](./slices/09-preflight.md)'s pre-flight consume
(2.9 delegates to this resolver rather than re-implementing the
walk, so the vocabularies cannot drift).

### C4 — Resolver-input declaration shape

[Slice 2.9](./slices/09-preflight.md) owns the `Pipeline` /
`PhaseNode` addition by which phases declare the agents they
resolve. [Slice 2.7](./slices/07-wiring.md) authors the per-turn
declaration against it. The walk behavior (selective per kind,
halt before phase 0, `run_complete(failed)` with the first
failing resolver in phase order) is canonical in
[`generation-pipeline.md → Config pre-flight validation`](../../../generation-pipeline.md#config-pre-flight-validation);
the contract pinned here is only that the declaration is **data
on the declaration object**, not code inside phase bodies, so the
pre-flight can walk it without executing phases.

2.9 also owns the **system-entry write helper** (compose the
existing entry-create arm into a `kind='system'` entry with the
failure metadata): pre-flight failure on turn-blocking kinds is
its first caller, and [Slice 2.7](./slices/07-wiring.md)'s
runtime resolver / provider failures reuse the same helper so the
two paths produce identical entry shapes.

### C6 — Turn-submit dispatch surface

[Slice 2.7](./slices/07-wiring.md) owns the named turn-submit
action; [Slice 2.5](./slices/05-reader.md) calls it from the
composer day-one (over the stub seam until 2.7 swaps the provider
underneath). Pinned signature: the action takes the **final
wrapped content string** (2.5 applies the C2 wrap before
dispatch) plus the composer-mode metadata it needs for
diagnostics; the action owns the `user_action` entry write
(inheriting `worldTime` from the preceding entry) and the
pipeline kick under one turn `actionId`. Whether the entry write
happens before `runPipeline` or inside phase 0 is 2.7-internal
(its open question) — the call surface 2.5 codes against doesn't
change either way.

### C7 — Calendar formatter surface

[Slice 2.3](./slices/03-wizard.md) owns `lib/calendar`'s public
formatter; [Slice 2.5](./slices/05-reader.md) consumes it
label-opaque. Pinned shape: one exported function taking
`(worldTime, calendarSystem, worldTimeOrigin)` and returning the
rendered display string (the
[canonical rendering pipeline](../../../calendar-systems/spec.md#rendering-pipeline)
fixes the algorithm); a formatter failure returns / throws a
typed miss the host maps to "no footer label" per
[`reader-composer.md → Per-entry world-time footer`](../../../ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer).
Exact name fixed in 2.3's first `lib/calendar` commit.

### C8 — Entries working-set store ownership

[Slice 2.2](./slices/02-entry-arms.md) creates `lib/stores/entries`
(hydrate + patch + `getById` selectors) and registers it as the
`story_entries` delta patcher, so create / update / delete mirror
through it. [Slice 2.5](./slices/05-reader.md) owns the consuming
surface — the entry-window selectors, scroll model, and the
hydrate-on-story-open trigger; it **extends** this store rather than
re-creating it.

### C5 — Wizard-session prompt seam

[Slice 2.3](./slices/03-wizard.md) owns the wizard auto-save
session (persistence, the session-exists selector, and the
concurrent-state prompt component).
[Slice 2.4](./slices/04-story-list.md) wires the two triggers —
`+ New story` and draft-card click — invoking the prompt when a
session exists, per
[`story-list.md → Unfinished wizard session`](../../../ui/screens/story-list/story-list.md#unfinished-wizard-session-automatic-safety-net).
The selector (session-exists boolean) and the prompt component
(props: trigger variant `'new-story' | 'draft'` + per-resolution
callbacks) are exported from 2.3's modules under names fixed in
its first commit — 2.4 imports both rather than re-implementing
either side.

## Definition of done

- **The loop, on both platforms.** On Electron desktop and an
  Android device / emulator, from a clean database: the user adds
  an OAI-compat provider in the interim form, creates a story
  through the wizard (including an AI-generated opening via
  `wizard-assist`), sends a turn, watches the reply stream in,
  closes and reopens the app, sees the story on the list, reopens
  it, and the entries are intact.
- **Adventure path.** An adventure-mode, first-person story is
  creatable via the minimal lead input; the composer mode picker
  appears and `Do` / `Say` / `Think` wraps apply per
  [`principles.md → Composer mode`](../../../ui/principles.md#composer-mode--send-time-transform-narration-aware).
- **Failure vocabulary.** Pre-flight failure (e.g. assignment
  removed) halts before phase 0 — no HTTP call, no deltas — and
  emits the system-entry vocabulary; a mid-stream provider error
  surfaces the LLM-call-failed system entry; user cancel aborts
  cleanly with no orphan placeholder.
- **Recovery.** Kill mid-turn; on next boot the orphaned run
  reverse-replays and the recovery modal shows the per-turn copy
  naming the story.
- **Rollback / undo.** Entry delete routes through the
  rollback-confirm modal with bucket counts matching the spec;
  CTRL-Z reverses the last turn (entry + delta) and redo restores
  it.
- **Observability.** Real provider traffic populates
  `httpCallSink` (key value-redacted — the M1.4 suite extended
  with OAI-compat scenarios passes) and a `turnCapture` per turn.
- **Delta-log exemptions hold.** Wizard creation writes zero
  deltas; entry content edits write zero deltas; both verified by
  test.
- **Bundled-pack invariant.** The structural-floor
  `active+in-scene` injection test passes against the bundled
  per-turn template.
- **Teardown.** `components/reader/smoke/`, the reader-route
  smoke trigger, the `registerStubProvider()` seam, and the M1
  landing debug button are gone; the
  [`followups.md`](../../../followups.md) smoke-scaffolding entry
  is resolved and removed.
- **Hygiene.** Storybook stories exist for every compound M2
  introduces (expected set: interim provider form, wizard step
  bodies + AI-assist popover, rollback-confirm modal, recovery
  modal, parse-failure badge — plus any compound extracted while
  building); every new chrome string routes through `t()`;
  `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, and the full
  vitest suite pass on every slice's PR.

## Open questions

- **M2 chapter chrome.** ScreenShell's in-story variant always
  renders the token-progress strip, but token counting
  (`js-tiktoken`) lands in M3.4 and chapters don't close before
  M5. Decide in [Slice 2.5](./slices/05-reader.md) planning how
  the strip and chapter chip render in the interim (zero-fill
  strip + static `Chapter 1 · in progress` chip is the default
  assumption).
- **Story delete on library cards.** The story-list spec lists
  `Delete` in the card overflow menu; M2.4 scope keeps it out
  (archive is the M2 cleanup affordance) since story-cascade
  deletion has no dedicated spec section. Pull it in during
  [Slice 2.4](./slices/04-story-list.md) planning if junk-story
  cleanup proves annoying while testing the loop.
- **Three-step wizard presentation.** With steps 3–4 deferred to
  M3.6, whether the M2 step indicator renders `step N of 3` or
  shows all five pills with two disabled. Resolve in
  [Slice 2.3](./slices/03-wizard.md) planning.
