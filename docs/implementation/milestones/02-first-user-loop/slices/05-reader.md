# Slice 2.5 — Reader-composer minimum

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** [Slice 2.2](./02-entry-arms.md) (edit / delete /
  rollback), [Slice 2.6](./06-pack-engine.md) (composer wrap
  macros), [Slice 2.3](./03-wizard.md) (`lib/calendar` for time
  chrome). The bulk — entry window, scroll model, markdown
  pipeline, Harper, composer chrome — needs only M1.5 substrate
  and starts day-one against the M1 `registerStubProvider()`
  seam.
- **Blocks:** [Slice 2.7](./07-wiring.md) (wires the real
  provider through this surface), [Slice 2.4](./04-story-list.md)'s
  debug-button removal task

## Goal

The core screen, minimum-viable: virtualized entry window with
load-older pagination and scroll-anchoring on prepend, autoscroll
and jump buttons, the composer with send-time mode wrapping and
send→cancel duality, trigger generation, markdown rendering
pipeline (htmlStreaming port), Harper.js spellcheck, basic edit /
delete entry actions with the **rollback-confirm modal compound**,
and CTRL-Z basic single-action undo + redo. Calendar time chrome
(top-bar chip + per-entry footer labels) renders through
`lib/calendar`.

## Background

EntryCard already renders all five entry kinds including
streaming and in-place edit; ScreenShell carries the in-story
chrome and GenerationStatusPill the status surface. What this
slice builds is the screen around them: the loaded-window scroll
machinery (the component-inventory note defers the
virtualized-list shape decision to exactly this pass), the
composer, the markdown tail per platform, and the consent surface
for deletes. Generation triggers dispatch the per-turn run
against the M1 stub seam until [Slice 2.7](./07-wiring.md) swaps
the real provider underneath — the trigger path is built here so
the swap is a provider change, not a UI change. Deferred reader
affordances: suggestions panel (M3.7), refine / regenerate (M3),
per-entry worldTime click-to-edit (M3.8), Browse rail + peek
drawer (M4-era — unpopulated until classifier data exists),
chapter management (M5), branch picker (M6).

## Required reading

- [`reader-composer.md → Loaded-set model`](../../../../ui/screens/reader-composer/reader-composer.md#loaded-set-model),
  [`Autoscroll`](../../../../ui/screens/reader-composer/reader-composer.md#autoscroll),
  [`Jump buttons`](../../../../ui/screens/reader-composer/reader-composer.md#jump-buttons),
  [`Anchor preservation under shifts`](../../../../ui/screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)
  — the scroll machinery contract, including the web prepend
  compensation requirement.
- [`reader-composer.md → Per-entry actions`](../../../../ui/screens/reader-composer/reader-composer.md#per-entry-actions)
  — the M2 subset: edit + delete (regen M3, branch M6, flip-era
  M7.2, probe M3.5 / M7.5).
- [`reader-composer.md → Streaming entry`](../../../../ui/screens/reader-composer/reader-composer.md#streaming-entry--same-structure-live-state)
  and
  [`Top-bar — in-world time display`](../../../../ui/screens/reader-composer/reader-composer.md#top-bar--in-world-time-display).
- [`rollback-confirm.md → Two visible states`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#two-visible-states)
  and [`Counts`](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#counts)
  — hover-preview + modal, the three buckets, what the modal
  deliberately omits.
- [`reader-composer.md → Error surface`](../../../../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill)
  — the system-entry action-button table this slice's M2 subset
  implements.
- [`principles.md → Composer mode`](../../../../ui/principles.md#composer-mode--send-time-transform-narration-aware)
  — wrap semantics, gating (`composerModesEnabled`,
  adventure-only), wrapped text is canonical content.
- [`principles.md → Edit restrictions during in-flight generation`](../../../../ui/principles.md#edit-restrictions-during-in-flight-generation)
  — send / cancel duality, disabled controls during a turn.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — the CTRL-Z algorithm (M2: naive suffix, no
  `periodic_classifier` deltas exist), redo stack semantics,
  content side-channel.
- [`ui/patterns/entry-card.md`](../../../../ui/patterns/entry-card.md)
  — the shipped compound's host contract (action cluster,
  world-time footer label in, reasoning expansion).
- [`ui/patterns/lists.md → Composing virtualization with load-older`](../../../../ui/patterns/lists.md#composing-virtualization-with-load-older)
  — the layered fetching + virtualization pattern.
- [`tech-stack.md`](../../../../tech-stack.md) — the markdown
  rendering + HTML sanitization and Harper spellcheck entries:
  pipeline shape, htmlStreaming port, composer-only Harper scope.
- Background only (composition itself is
  [Slice 2.7](./07-wiring.md)):
  [`memory/cadence.md → User-tunable knobs`](../../../../memory/cadence.md#user-tunable-knobs)
  — the buffer knobs whose degenerate single-open-chapter case
  the M2 prompt uses.

## Scope: in

- **Entry window:** single contiguous ~50-entry window over the
  hydrated entries store; auto-load older / forward on boundary
  approach with shimmer; `@tanstack/react-virtual` (web) +
  `FlatList` with `maintainVisibleContentPosition` (native); the
  web prepend / height-change anchor compensation. No window swap
  or per-branch scroll-position memory — jump-to-top is out (see
  [reader-composer.md → Jump buttons](../../../../ui/screens/reader-composer/reader-composer.md#jump-buttons)),
  so the window never disconnects from the live edge.
- **Autoscroll state machine** (engage / disengage / re-engage,
  per-stream) and a **jump-to-bottom button** (visibility rule,
  smooth scroll, `End` key, Actions-menu entry).
- **Composer:** textarea (Harper.js wired, user-toggleable;
  install lands here per tech-stack), mode picker
  (`Do / Say / Think / Free` — adventure + `composerModesEnabled`
  only; creative hides), send-time wrap through the C2 macros,
  send→cancel transform bound to the run state, edit-restriction
  gating across reader controls.
- **Trigger generation:** submit calls the C6 turn-submit action
  ([Slice 2.7](./07-wiring.md) owns it; this slice codes against
  the pinned signature over the stub seam) and renders the
  streaming lifecycle.
- **System-entry action buttons** — the M2 subset of the error
  surface: `Retry` (re-dispatches the failed turn's stored
  input through the C6 action) / `View details` / `Dismiss` on
  LLM-call-failed entries, and the broken-reference variants'
  fix actions routing to the [Slice 2.1](./01-provider.md)
  interim form (the M2 stand-in for their M7 settings targets).
  Embed-failure variants are M3.1.
- **Markdown pipeline:** `marked` / `markdown-it` → `juice` →
  `DOMPurify` → `dangerouslySetInnerHTML` (web) /
  `react-native-render-html` (native); htmlStreaming
  buffer-until-tag-boundary port feeding EntryCard's streaming
  body.
- **Edit / delete:** in-place edit through EntryCard committing
  via the content side-channel; per-entry `×` →
  **rollback-confirm modal compound** (new compound: AlertDialog
  body with the three count buckets from
  [Slice 2.2](./02-entry-arms.md), desktop hover-preview accent,
  chapter line omitted when `M = 0` — structurally always in
  M2).
- **CTRL-Z / redo:** keyboard binding (desktop), target-group
  selection per the data-model algorithm (naive suffix for prose
  turns), in-memory redo stack cleared on new action.
- **Time chrome:** top-bar time chip (passive — `eras` affordance
  is M7.2) and per-entry world-time footer labels, both rendered
  through `lib/calendar`'s formatter (all-zero worldTime in M2
  renders the origin); chapter chip + progress strip render the
  M2 static interim per the milestone open question.

## Scope: out

- Suggestions panel (M3.7), refine / regenerate (M3), worldTime
  click-to-edit + monotonicity flag (M3.8), Browse rail + peek
  drawer + collapsed strip (M4-era), chapter popover / close /
  insert-break (M5), deep rollback (M5.5), branch chip + picker
  (M6), era-flip surfaces (M7.2), probe affordances (M3.5 /
  M7.5).
- The per-turn pipeline declaration, buffer composition, and the
  real provider call — [Slice 2.7](./07-wiring.md).
- Action-batched CTRL-Z across classifier writes — M3.9.

## Acceptance criteria

- Against a seeded 200-entry branch: open lands at bottom with
  ~50 loaded; scrolling near top prepends the next chunk with no
  visible jump on web and native (manual matrix, both
  platforms, backed by the compensation-math unit test below);
  jump-to-bottom appears once scrolled away from the live edge and
  smooth-scrolls back on click; autoscroll engages at-bottom
  (~80 px tolerance per the spec), disengages on user upscroll
  mid-stream, re-engages when the user returns within the same
  tolerance.
- Composer wrap matrix: `Do` / `Say` / `Think` × `first` /
  `third` produce the principle doc's exact shapes; `Free` and
  creative mode send verbatim; the wrapped text is what lands in
  `story_entries.content`.
- Streamed reply (stub seam): placeholder appears, chunks render
  through the sanitization pipeline (a fixture with inline HTML +
  a half-streamed tag never renders a broken fragment), commit
  finalizes tokens metadata display.
- Delete on entry N: hover accents the suffix (desktop), modal
  counts match [Slice 2.2](./02-entry-arms.md)'s buckets, confirm
  hard-deletes and the window re-renders; Esc / outside-click
  cancel.
- Edit: in-place edit persists via the side-channel (no delta),
  survives reopen.
- CTRL-Z after a stub turn removes the turn (entry + deltas);
  redo restores it; a second unrelated action clears the redo
  stack.
- All reader controls that mutate narrative state disable while
  a run is in flight; cancel via composer and via the status
  pill both abort.
- A failed turn (stub fault injection) renders the
  LLM-call-failed system entry; its `Retry` re-dispatches the
  stored input and a subsequent success replaces the failure
  state; `Dismiss` removes the entry.

## Tests

- Vitest: undo target-group selection, autoscroll state machine
  (extracted pure logic), the web prepend-compensation math
  (given a measured prepend height, computed padding + scroll
  delta cancel to zero apparent shift), htmlStreaming boundary
  buffering, markdown sanitization allowlist (XSS fixture
  stripped).
- Storybook: rollback-confirm modal states, composer (modes
  visible / hidden / disabled), window shimmer states.
- Manual cross-platform matrix: prepend anchoring, keyboard
  avoidance on phone, Harper toggle, autoscroll during a real
  stream (after 2.7).

## Open questions

- Harper.js bundle-size impact on the Android dev client — still
  unmeasured (no Android build ran during this slice's
  implementation); measure before the milestone closes. Tech-stack
  flags WASM weight as composer-only by design.

## Implementation notes

- **Web prepend compensation stays reader-local.** `EntryWindow`
  (`components/reader/entry-window.tsx`) is not extracted into a
  shared `NarrativeStream` component — resolves this slice's own
  open question. Revisit only when a second consumer appears
  (chapter timeline, M5.3).
- **`computePrependCompensation`'s `paddingTopPx` is unused in
  practice.** `@tanstack/react-virtual`'s track height
  (`getTotalSize()`) already grows synchronously with row count on
  prepend, so applying additional top padding on top of that
  double-counts the shift for one frame. `EntryWindow`'s web branch
  applies only `scrollTopDeltaPx`; the padding field survives in
  `lib/reader-scroll/prepend-compensation.ts`'s return shape but has
  no live caller. Left as-is (that module isn't this slice's file to
  unilaterally re-shape) — worth a follow-up doc/type cleanup if a
  second caller never materializes.
- **`submitTurn` delta-logs the `user_action` write, sharing one
  `actionId` with the pipeline run.** The milestone's C6 contract
  ("the pipeline kick under one turn `actionId`") wasn't satisfiable
  with `runPipeline`'s original signature (no caller-supplied
  `actionId`), so `RunCtx` gained an optional `actionId?: string`
  field (additive, `lib/pipeline/runtime/orchestrator.ts`) that
  `submitTurn` populates. This also fixed a real bug: the original
  interim design wrote `user_action` via a raw insert, bypassing the
  delta log entirely, so CTRL-Z could only reverse the `ai_reply`
  and orphaned the user's entry. `lib/undo`'s `selectUndoTarget` was
  corrected in the same pass to anchor a turn at its **earliest**
  `story_entries` create (not the first one encountered in the
  DESC-ordered log), since a turn's action-id group can now
  legitimately contain two creates.
- **Abort-before-stream now reverses the user's typed turn as a side
  effect of the actionId-sharing above** (a preflight failure, e.g.
  no narrative profile resolves, removes the `user_action` entry
  along with the failed generation — not just mid-stream cancel).
  Whether that's the intended UX for this specific case is
  [Slice 2.7](./07-wiring.md)'s own open question already (its
  Open questions section lists abort-before-stream keep-vs-reverse
  as unresolved); this slice's implementation forces "reverse" as
  the interim default because the shared-actionId requirement is
  unconditional. Also logged in
  [`followups.md`](../../../../followups.md).
- **The interim per-turn pipeline lives in `lib/actions/turns/`**
  (`pipeline.ts` + `submit-turn.ts`), not inside
  `components/reader/`. A phase has no direct access to
  `branchId`/`storyId` (`PhaseContext` carries only
  `actionId`/`abortSignal`/`intermediates`/`log`), so the phase
  looks up its own run via
  `generationStore.getTxState().runs` filtered by `actionId` — the
  same lookup shape already used internally by
  `lib/pipeline/runtime/orchestrator.ts`'s `awaitRunTerminal`. Slice
  2.7 replaces this phase's internals (full per-turn declaration,
  buffer composition, real provider wiring) without changing
  `submitTurn`'s call site.
- **`EntryCard` (a Slice 1.x/pre-2.5 compound) never actually
  renders markdown as HTML** — it renders `content` via plain
  `<Text>` in every path. This slice's `lib/markdown` pipeline
  (web sanitize/render, native `react-native-render-html` config,
  the streaming tag-boundary buffer) is fully built and tested but
  has no consumer; the reader's live-streaming preview
  (`app/reader-composer/[branchId].tsx`) buffers raw markdown
  through the tag-boundary guard before handing it to the same
  plain-`Text` render, so it prevents broken HTML fragments without
  actually rendering markdown. Closing this needs a real `EntryCard`
  API change (a platform-split HTML render path) that touches every
  entry kind plus its Storybook stories — out of scope for a
  route-level integration pass. Logged in
  [`followups.md`](../../../../followups.md).
- **Jump-to-bottom and autoscroll are not functionally wired.**
  `EntryWindow` doesn't expose an imperative scroll-to/scroll-state
  API, so `JumpButtons` mounts with heuristic visibility but
  no-op handlers, and the autoscroll state machine
  (`lib/reader-scroll/autoscroll.ts`) isn't consumed by the route at
  all. A future pass needs `EntryWindow` to expose an imperative
  ref (jump-to-bottom, current scroll-edge distance) before this
  closes — not attempted here to avoid re-opening an
  already-reviewed component's contract mid-integration.
- **Composer wrap POV/lead name are hardcoded** (`pov: 'first'`,
  `leadName: 'You'`) since no story-settings/definition read path
  exists in this route yet; swap for real `stories.settings`/
  `stories.definition` values once a settings-read surface lands.
