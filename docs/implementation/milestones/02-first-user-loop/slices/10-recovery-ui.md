# Slice 2.10 — Crash-recovery modal + story-settings parse-failure badge

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** [Slice 2.4](./04-story-list.md) for the badge
  half (the story list hosts it) and
  [Slice 2.7](./07-wiring.md) for the badge half's integration
  (2.7's story-open path writes the C1 open-failure state, and
  the kill-mid-turn criterion needs the real per-turn pipeline;
  the badge UI itself develops against a fixture-written state).
  The recovery-modal half is day-one: 1.7a shipped the recovery
  pass, but its bootstrap currently discards the returned
  `RecoveryReport`, so this slice also owns the missing UI-state
  handoff.
- **Blocks:** none

## Goal

The missing recovery-report UI handoff and the two user-facing
recovery surfaces: publish bootstrap's reversed-run report into a
`pendingRecoveryReport` UI-state slot; drain it into a
kind-aware **crash-recovery modal** naming the affected story; and
render the **per-story config parse-failure badge** on the story
list. Desktop offers `Open file` for both failure kinds; Android
omits it because the mobile database-repair path is not designed.
Only corrupted `settings` offers `Reset settings for this story`,
because wizard-authored `definition` has no recoverable default. The
boot ordering, loading-until-render, recovery pass, and boot-blocking
`app_settings` recovery screen shipped in 1.7a; this slice completes
the canonical user-facing recovery contracts.

## Background

Startup recovery reverse-replays orphaned runs and produces a
`RecoveryReport`. The current bootstrap awaits that pass but
discards its return value; this slice restores the missing
handoff by publishing reports with at least one reversed orphan
to a `pendingRecoveryReport` UI slot. The first user-facing
surface after boot drains that slot into a modal. Zero-reverse
orphans and recovery failures stay observability-only and never
enter the slot. Separately, the per-story Zod parse of
`stories.definition` / `settings` can fail at story-open; the
affected story must fail to open with a badge on its card while
other stories stay usable — the app-settings half of this
contract (the blocking recovery screen) already exists, and this
slice completes the story-open half. The open path that detects
the failure is [Slice 2.7](./07-wiring.md)'s story-open wiring;
the failure state slot lives in the stories store (C1).

## Required reading

- [`generation-pipeline.md → Recovery modal`](../../../../generation-pipeline.md#recovery-modal)
  — drain semantics, kind-aware copy table, multi-orphan
  concatenation, the zero-reverse silence rule.
- [`generation-pipeline.md → Recovery-failure policy`](../../../../generation-pipeline.md#recovery-failure-policy)
  — what stays observability-only (the modal must not surface
  these).
- [`architecture.md → Settings: strict types, defaults at load`](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — the three parse-failure sites and the per-story recovery
  contracts (manual repair only for `definition`; reset preserving
  narrative content for `settings`).
- [`ui/patterns/alert-dialog.md → Rich content via composition`](../../../../ui/patterns/alert-dialog.md#rich-content-via-composition)
  — the primitive both surfaces compose.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  — the strict, non-recoverable `definition` shape and the
  copy-on-create defaults the `settings` reset action reapplies.

## Scope: in

- **Recovery-report handoff:** a `pendingRecoveryReport` slot in
  the UI-state store plus bootstrap wiring that publishes the
  report only when `reversed.length > 0`. Failure-only and
  zero-reverse reports remain observability-only; the bootstrap
  keeps its never-block-boot behavior.
- **Recovery modal:** atomic `useEffect` drain of the slot on the
  first user-facing surface; AlertDialog with single `OK`;
  kind-aware copy — `per-turn` is the only kind producible in M2,
  but the copy map carries all three canonical variants so M3 /
  M5 add no UI work; `{storyName}` resolution from the orphan's
  `story_id` with the non-named fallback; multi-orphan
  single-paragraph concatenation.
- **Parse-failure badge:** story card error badge driven by the C1
  open-failure state; card click while failed re-surfaces the failure
  (no navigation). `definition-corrupt` reads _"Couldn't open — story
  definition corrupted"_; desktop offers `Open file`, while Android
  has no repair action. No reset appears on either platform.
  `settings-corrupt` reads _"Couldn't open — settings corrupted"_ and
  offers `Reset settings for this story` behind a destructive-action
  confirm on both platforms; desktop additionally offers `Open file`,
  deep-linking the SQLite file in the OS file manager. Reset rebuilds
  `StorySettings` from the current app-level defaults through the
  creation path, preserving definition and all delta-replayable
  narrative content.
- i18n strings for all copy; Storybook stories for both surfaces'
  states.

## Scope: out

- The boot-blocking `app_settings` recovery screen — shipped
  (1.7a).
- The story-open detection path itself —
  [Slice 2.7](./07-wiring.md) writes the failure state; this
  slice renders and resolves it.
- Recovery-failure admin affordances (drop-orphan etc.) —
  explicitly not v1 per the canonical policy.

## Acceptance criteria

- Fixture-injected `RecoveryReport` with one reversed `per-turn`
  orphan renders the modal with the per-turn copy and the story
  name; with two reversed orphans, one concatenated paragraph.
- Bootstrap publishes a recovery report to the UI-state slot iff
  it contains at least one reversed orphan; a zero-reverse pass,
  failure-only report, or empty report leaves the slot empty and
  boot proceeds normally.
- The slot drains exactly once — re-render / re-navigation does
  not re-show the modal.
- A story row with corrupted `settings` JSON (fixture) badges on
  the list, other stories open normally; `Reset` rewrites
  current app-level defaults through the copy-on-create path, the
  story opens, and its definition / entries / entities are intact;
  the confirm gate fires before any write.
- A story row with corrupted `definition` JSON badges distinctly;
  its failure surface offers no reset action, and other stories open
  normally.
- `Open file` launches the OS file manager at the DB path on
  desktop. Android omits `Open file` for both per-story failure kinds;
  `settings-corrupt` still offers reset, while `definition-corrupt`
  has no mobile repair path in v1.
- Kill-mid-turn manual test (with [Slice 2.7](./07-wiring.md)
  merged): next boot shows the modal naming the story.

## Tests

- Vitest: bootstrap-to-slot publication gate, drain-once logic,
  copy selection per kind, reset action's preserve-narrative
  assertion (definition and entries untouched, settings rebuilt
  through copy-on-create), and the `definition-corrupt` no-reset
  surface.
- Storybook: modal variants (single / multi / non-named),
  badge + failed-open card states.

## Open questions

None.

## Implementation notes

Resolved developer decisions and notable implementation details.

- **Recovery handoff.** M2.10 repairs the 1.7a bootstrap seam by publishing only reports with reversed deltas. The UI store uses a pending-to-active claim so React Strict Mode can replay the host's async effect without losing or duplicating the notice; explicit acknowledgement is the only terminal drain.
- **Definition recovery.** `stories.definition` remains strict and non-recoverable because wizard-authored identity has no valid default. Desktop exposes the existing database-file reveal bridge for manual repair; Android has no definition-repair affordance in v1, and neither platform offers reset.
- **Settings recovery.** `stories.settings` reset reuses `buildStorySettings` with the current app-level defaults, matching copy-on-create. The action updates only the settings and timestamp, preserving the definition and all narrative/world rows; reset is gated by confirmation on both platforms.
- **Recovery request lifetime.** Landing opens and reset-then-reopen flows share a latest-intent coordinator, with cancellation checked before action-layer store and navigation publication. Same-story reset writes remain coalesced until their owning operation settles, even if the dialog is dismissed; stale failures stay silent, while a current reopen failure uses the ordinary story-open diagnostic instead of claiming the reset failed.
- **Mobile file repair.** Per-story `Open file` is feature-detected from Electron's injected bridge and intentionally absent on Android; no un-designed mobile export/share path was added.
