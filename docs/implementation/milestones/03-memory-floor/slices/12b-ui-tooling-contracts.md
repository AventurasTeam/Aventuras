# Slice 3.12b — M3 reconciliation: UI, tooling and content contracts

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none — independent of
  [Slice 3.12a](./12a-runtime-integrity.md).
- **Blocks:** none

## Goal

Close the tooling, test, patch and UI-contract debt from the former
Slice 3.12 — the former sweeps C and D. This slice carries all six
of the original slice's decision-first product calls; the
verification pass attached an evidence-favored option to each,
noted per item, and every one needs developer sign-off at this
slice's planning before its item is implemented.

## Background

Split from the unsplit Slice 3.12 at planning (2026-08-19) after a
per-item code-verification pass; the split record and routing table
live in
[Slice 3.12a → Implementation notes](./12a-runtime-integrity.md#implementation-notes).
Several premises below were corrected by that pass — most notably
the `pointerEvents` inventory and the suggestion-macro divergence —
and file/line references are dated 2026-08-19.

## Required reading

- [`testing.md → Coverage: thorough, not exhaustive`](../../../../testing.md#coverage-thorough-not-exhaustive)
- [`wizard.md → Step 3 — World`](../../../../ui/screens/wizard/wizard.md#step-3--world)
- [`probe.md → Simulatable parameters`](../../../../memory/probe.md#simulatable-parameters)

## Scope: in

### Tooling, tests and patches

- **File the two `onnxruntime-react-native` patch gaps upstream.**
  The patch (Gradle-9 `VersionNumber` guard removal, the missing
  `react-native.config.js`) fixes upstream bugs, and nothing is
  filed against microsoft/onnxruntime. Urgency correction: pnpm
  hard-fails install when a patch stops applying, so an ORT bump
  breaks loudly — filing removes the re-derive-by-hand burden on
  each bump, not a silent-break risk. Recommended: file both, diffs
  attached. Surfaced by M3.1a review (2026-07-21).
- **E2E backfill: opening-only-branch turn, settings-corrupt
  recovery, bad-branch hydration.** Corrections from verification:
  settings-corrupt needs a **harness knob**, not an app route —
  `app/_layout.tsx` already gates the tree on `config-corrupt` and
  renders `SettingsRecoveryScreen`; the harness just always seeds a
  healthy DB. The `hydrationFailed` locator
  (`e2e/locators/reader.ts:100-102`) survives with zero spec
  consumers; the packaged `app://` deep-route fix (2026-08-18)
  unblocks the hard-navigation route, but an in-app route to a
  nonexistent branch still needs picking. Opening-only-branch is a
  seed variant of the covered turn path.
  [`testing.md → Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive)
  still names it in scope. `pnpm test:e2e` is a verification command
  for this slice. Surfaced by the M3 E2E harness work (2026-07-24).
- **Resolve the `StreamingReasoning` empty dev-server render —
  falsification first.** Corrected premises: the claimed
  `SuggestionStrip` web/native-split precedent does not exist (no
  Reanimated in that file), and the story file now holds 34 stories,
  not 20. The suspect is the deps-less `useAnimatedStyle` in
  `Pulsing` (`components/compounds/entry-card.tsx:292`), reached
  only by this story. The hypothesis is falsifiable without a
  browser: `suggestion-categories-editor.tsx:408` and `:751` are the
  only other deps-less, web-reachable `useAnimatedStyle` sites — if
  their stories render in the dev server, the deps hypothesis is
  dead and the cause is elsewhere. Surfaced by M3.7a Task 9
  (2026-07-26); sharpened 2026-08-19.
- **Convert the `pointerEvents` prop-form sites — corrected
  inventory.** Fourteen sites, not twelve: 13 string-literal
  (`spellcheck-textarea.tsx` ×2, `story-card.tsx` ×2,
  `list-row.tsx` ×3, `collision-list-row.tsx`, `banner.tsx`,
  `toast.tsx` ×2, `sheet.tsx`, `ai-assist.tsx`) plus the unlisted
  expression form at `components/ui/select.tsx:153`. The original
  entry's residual-warning attribution to globally-mounted
  toast/sheet is wrong — the Storybook preview decorator mounts
  neither, `Toaster` early-returns null on an empty queue, and the
  sheet site is portal-gated; `select.tsx`, on every `Select` render
  path, is the prime suspect. Confirm it before converting anything
  else, or "converted it and the warning stayed" repeats. Five sites
  carry a `style` prop needing a merge, three of those in
  overlay/portal code with no pointer-behavior tests — manual pass
  each, not a drive-by regex. Split out of the save-bar entry
  2026-08-18; inventory corrected 2026-08-19.
- **Narrow-decorator trap — decision, then a small change.** A
  play-driven story that puts a `FormRow` under an effective width
  below 640 and captures a node before typing goes vacuously green
  (the guess-then-correct branch swap remounts `children`). No live
  victim exists today — verified, including `wizard-shell`'s 375 px
  frame (no `FormRow`, no `play`). Options with evidence: a lint
  guard (M, brittle, fires on legitimate narrow decorators); a
  `FormRow` that measures before guessing (S, but pays a
  no-layout-first-frame production cost everywhere for a
  Storybook-only defect); a documented story-authoring rule (S —
  three stories already hand-roll comments about wrapper-versus-
  window width, so the codebase is converging on it by hand).
  Recommended: the authoring rule, plus a lessons-learned pointer.
  Raised 2026-08-15 by the Slice 3.8 Task 4 review.
- **Guard the `js-tiktoken` patch — decision, then a small test.**
  The patch is load-bearing for Android (Hermes property cap;
  `new Tiktoken(o200kBase)` throws `RangeError`), and verification
  widened the blast radius: both the reader route **and**
  story-settings crash (two `countTokens` consumers). No test can
  catch its removal — Node has no property cap, and CI has no
  Android lane. Options with evidence: a bundle-shape assertion (S —
  a unit test asserting the patched dist carries the `Map` staging
  and lacks the object form, running in the existing lane, failing
  on exactly the dangerous event); an Android CI smoke (L, and it
  contradicts
  [`testing.md → E2E target: desktop only`](../../../../testing.md#e2e-target-desktop-only));
  upstreaming the `Map` change (S to file, unbounded to land, does
  not remove the need for a local guard). Recommended: the bundle
  assertion, optionally plus the upstream filing. Exposure note:
  pnpm fails loudly when the patch stops applying, so the silent
  re-break requires a bump where the patch still applies but no
  longer covers the code path — narrower than "any bump", still
  real. Raised 2026-08-16 by the Slice 3.8 Android smoke.

### UI and content contracts

- **`compositeText` separator — spec decision for the M3.1a
  owner.** Verified: the hash input and the embed input are
  byte-identical (`lib/embedder/service.ts` hashes the very
  composite it embeds), so there is no staleness bug; the divergence
  is embedder-visibility of field boundaries, unmeasured. The NUL
  spec citation lives in a gitignored `.impl-plans/` file no
  reviewer can open — the entry's whole paper trail is
  unverifiable from a clean checkout. Options: amend the spec to
  space and delete the NUL rationale (free, recommended); hash
  NUL-joined while embedding space-joined (decouples the two uses,
  forces a full re-index); NUL for both (re-index plus NUL on the
  provider wire). Surfaced by M3.11 Task 4 review (2026-07-22).
- **Focus-gate Ctrl-K.** Corrected scope: the SaveBar Ctrl-S half
  closed in M3.11 itself (`enabled={isFocused}` is threaded through
  `StorySettingsSaveBar`), so the Diagnostics-jump scenario in the
  original entry cannot happen. Ctrl-K remains ungated at **four**
  mounts (`app/index.tsx`, `app/settings/index.tsx`,
  `app/story-settings/[storyId].tsx`,
  `app/reader-composer/[branchId].tsx`) — today's benign behavior is
  an emergent property of expo-router freezing the blurred screen,
  not a guarantee. The fix pattern is already shipped:
  `useGlobalHotkey` has an `enabled` option; add the prop to
  `ActionsMenuProps` / `AppActionsMenuProps` and thread
  `useIsFocused()` from each route (the compound cannot call it —
  Storybook mounts without a navigator). Surfaced by M3.11 Task 9
  (2026-07-22); scope corrected 2026-08-19.
- **Guard Electron reload while a save session is dirty.** Verified
  worse than recorded: on the desktop-bridge path
  `use-unsaved-changes-guard` returns before ever registering
  `beforeunload`, so under Electron Ctrl-R has **no** listener at
  all — not even a silently-cancelling one. Fix shape: register
  `beforeunload` with `preventDefault()` on the bridge path too, and
  add a main-process `webContents.on('will-prevent-unload')` handler
  that runs the same ask chain as `native:close-requested`. An
  in-app reload command alone does not cover Ctrl-R/devtools, which
  are the actual triggers. Browsers are unaffected. E2E candidate:
  a Playwright-driven reload against a dirty session — decide
  feasibility at planning. Surfaced by M3.11 review (2026-07-22).
- **Suggestion-emission worked example — decision.** Corrected
  premise: the JSON macro is **not** example-free — it names `cat1`
  in prose, and `cat1` is slot 1's real ref by construction
  (`lib/piggyback/suggestion-slots.ts` assigns refs by index), so
  both paths already privilege slot 1; only the tagged path shows a
  full worked `<item>`. Removing the tagged exemplar alone would
  create asymmetry rather than remove it. Options: keep both as-is
  and correct the record (recommended — cheapest honest close); make
  both name the slot explicitly; make neither (must first answer
  the literal-placeholder objection the macro's own header records).
  Effect size unmeasured either way. Surfaced 2026-08-01; premise
  corrected 2026-08-19.
- **`probe.md`'s light-mode simulatable list — decision, precedes
  M7.5.** Verified in full: `trace()` stores the pre-MMR raw score
  as `final_score`, `mmrScore` is never captured, and
  `min_score_threshold` compares against `mmrScore` — so of the nine
  listed parameters only the per-type budgets are reproducible from
  a light capture (the budget latch was verified reproducible
  2026-08-09). Options: accept the narrower list — per-type budgets
  only (doc edit, recommended); additionally capture `mmr_score` per
  row (one float; recovers the threshold; a capture-format change,
  so existing captures go mixed-schema); store the kept-set pairwise
  cosine matrix (~80 KB per type; light mode stops being light).
  Recommended: accept the narrower list, and take the `mmr_score`
  float if it proves cheap at implementation. Surfaced during
  Slice 3.5 planning (2026-08-08).
- **Preset-browser preview — decision, and canon moves either
  way.** The shipped rows render label and tagline only;
  `promptBody` is invisible until after the pick the replace-confirm
  protects. But canon's `preview body on hover` cannot exist on
  touch — the phone branch renders in a Sheet — so
  [`wizard.md → Step 3 — World`](../../../../ui/screens/wizard/wizard.md#step-3--world)
  needs amending under every option. Options: hover preview plus a
  touch equivalent (M, likely a `SearchableOverlayList` substrate
  change); amend canon to label-and-tagline and lean on the
  replace-confirm (S, but the confirm then guards an uninformed
  pick); a truncated first line of `promptBody` as a third row line
  via `numberOfLines` (S, cross-platform, matches the row's existing
  truncation idiom — recommended). Surfaced by the Slice 3.6a
  whole-slice review.
- **Dirty generation-sheet dismissal — decision.** Corrected: the
  cast-suggestions exposure is live, not future —
  `components/wizard/cast-list.tsx` already mounts `AiAssist` with
  an accumulating multi-page `listItems` plus per-row selections,
  and there are five mounts total. Every dismiss path routes through
  `resetOnClose`, which aborts and clears unconditionally. Options:
  confirm-before-discard on a dirty overlay (dirty = a result landed
  or `listItems` nonempty; recommended — the abort is already
  seq-guarded, so gating the clear does not touch the request
  lifecycle, and `unsaved-changes-dialog.tsx` is the nested-overlay
  precedent); restore-on-reopen (largest, and ambiguous for results
  the user already rejected); block swipe once a result lands
  (narrowest; leaves Escape and tap-outside destructive). Raised
  2026-08-11.

## Scope: out

- Everything in [Slice 3.12a](./12a-runtime-integrity.md).
- The re-routed items — routing record in
  [Slice 3.12a → Implementation notes](./12a-runtime-integrity.md#implementation-notes).
- Items routed to later milestones or parked during the 2026-08-18
  triage drain.

## Acceptance criteria

- Every decision item above has its decision taken and recorded
  before the item is implemented — the recommendations here are
  evidence-favored options, not resolutions.
- Each behaviour-changing fix carries a test that fails when the fix
  is reverted, mutation-checked rather than assumed.
- The three new E2E specs pass under `pnpm test:e2e`, and the
  `hydrationFailed` locator gains its consumer or is deleted.
- Canon edits (`wizard.md`, `probe.md`, the `source-hash` spec
  record) land in the same commit as the decision they record.
- No item is closed on a premise that was not re-verified against
  the code at pickup.

## Tests

E2E for the backfill item (that is the work); Storybook stories or
play assertions for the interaction fixes (Ctrl-K gating, sheet
dismissal confirm); a unit-level bundle assertion for the
`js-tiktoken` guard; unit coverage on the reload-guard hook plus
manual smoke, with the Playwright reload flow as a candidate. Canon
edits have no behavior to pin.

## Open questions

- None — every decision was signed off at planning (2026-08-21);
  see [Implementation notes](#implementation-notes).

## Implementation notes

Created 2026-08-19 by the Slice 3.12 split; the split record and
routing table live in
[Slice 3.12a → Implementation notes](./12a-runtime-integrity.md#implementation-notes).

**Planning resolutions (2026-08-21).** Every item was re-verified
against the code at pickup; the premise corrections and the calls
taken, one bullet each:

- **`compositeText` separator — space, pinned in canon.** Canon had
  no separator rule at all (`retrieval.md` said
  `xxhash(title + description) or similar`), so this is a first-time
  addition rather than an amendment, and there was never a staleness
  bug: `lib/embedder/service.ts` embeds and hashes the same string.
  NUL — for the hash alone or for both — was rejected because it
  forces a full re-index for an unmeasured field-boundary effect and
  puts a control character on the provider wire. The original NUL
  rationale survives only in a gitignored plan file, which is why
  [`plan-file-nul-corruption.md`](../../../lessons-learned/plan-file-nul-corruption.md)
  exists.

- **`probe.md` light-mode list — narrowed, and `mmr_score` captured.**
  Of the nine listed parameters only per-type budgets reproduced from
  a light capture: `trace()` stored the pre-MMR raw score as
  `final_score`, `mmrScore` was never captured, and
  `min_score_threshold` compares against `mmrScore`. The list now
  names budgets and the threshold as light-simulatable and moves the
  rest to deep mode. The threshold is recovered by one float per row
  (`mmr_score`, `CAPTURE_VERSION` 2 → 3); the read side's version-drift
  warning is advisory only — `assertCaptureShape` tolerates
  field-level drift by design — so a light-mode simulator has to gate
  on `capture_version` itself; `probe.md` records why. No light-mode simulate path exists yet
  (`replayType` refuses light captures) — the field is there so
  captures written before M7.5 are not second-class when it lands.

- **Preset-browser preview — the prompt body clamped onto a third
  row line.** Canon's `preview body on hover` cannot exist on the
  phone Sheet, and the shipped rows showed label and tagline only,
  so the replace-confirm guarded an uninformed pick. A clamped third
  line previews the same thing on every platform; no substrate change
  was needed — `SearchableOverlayList` takes a `renderRow` slot, its
  rows are `min-h`, and the web virtualizer re-measures.
- **Dirty generation-sheet dismissal — confirm-before-discard on the
  implicit paths only.** `AiAssist` has eight production mounts, not
  five; the two `result="list"` ones (lore, cast) accumulate
  multi-page results and selections. Dirty means an unseeded result
  landed or the list / selection is nonempty — guidance text alone
  and a fresh generate in flight are not. The gated paths, traced
  rather than assumed: Escape and tap-outside on the web `Dialog`,
  swipe-down on the phone `Sheet`, and hardware back on the
  tablet-width native `Dialog`. **Hardware back on the phone `Sheet`
  is not covered** — `@rn-primitives/dialog`'s
  `hardwareBackPress` handler lives on `Content`, which the
  bottom-sheet branch never mounts, and `@gorhom/bottom-sheet`
  registers none, so the press falls through to the wizard screen's
  own handler and pops the route. Pre-existing, unchanged by this
  slice, filed to triage. Tap-outside is also inert on both native
  branches (no `backdropComponent` on the sheet; the native overlay
  is an `Animated.View` that ignores `onPress`), so nothing is lost
  there either. Keep editing re-opens the overlay with nothing
  cleared — a sibling rather than a nested dialog because a swiped Sheet is
  already dismissed when `onOpenChange(false)` fires and re-opening is
  the path that already works. Explicit Discard / Cancel / Use this
  stay unconfirmed; the abort stays seq-guarded and only the clear is
  gated.
- **Suggestion-emission worked example — keep both macros.** The
  JSON macro is not example-free: it names `cat1` in prose, and
  `cat1` is slot 1's ref by construction, so both paths already
  privilege slot 1 and removing the tagged exemplar would create the
  asymmetry it claimed to remove. There is no canonical record of
  these macros to correct; the two header comments are the record
  and this bullet is the decision.
- **Narrow-decorator trap — an authoring rule, not a lint or a
  measure-first `FormRow`.** No live victim existed; ~10 stories, not
  3, already hand-roll the window-versus-wrapper caveat, and
  `code-conventions.md` already held the adjacent rule, which now
  carries the `FormRow` case with a lessons-learned entry behind it.
- **`js-tiktoken` guard — a dist-shape unit test.** The app's ESM
  path runs through a hash-named chunk and Metro may resolve the cjs
  entry on Android, so the test globs every dist bundle rather than
  naming one, and fails on exactly the bump that drops the `Map`
  staging while the patch still applies.
- **Upstream filings — won't do, but the stated exposure was wrong.**
  The call stands; its rationale does not. This slice's Scope-in note
  says "pnpm fails loudly when the patch stops applying", and that is
  false for this repo: all four `patchedDependencies` keys are
  version-less, which pnpm 10 maps to `strict: false`, so
  `allowFailure` is `true` and a patch that stops applying only
  `globalWarn`s on an exit-0 install
  (`applyPatchToDir`; verified against pnpm 10.33.1). The real exposure
  is therefore wider than "a bump where the patch still applies but no
  longer covers the code path" — **any** invalidating bump drops the
  patch silently, for all four patches. That widens the value of the
  `js-tiktoken` dist guard and leaves the other three unguarded;
  `ignorePatchFailures: false` would restore the loud failure in one
  line. Filed to [`triage.md`](../../../triage.md) rather than taken
  here, since it changes install behaviour for every contributor.
- **`pointerEvents` — the console cannot go quiet, and that is not a
  failed conversion.** All fourteen first-party prop sites moved, but
  `@gorhom/bottom-sheet` emits the same deprecated prop from its own
  bundle under a `BottomSheetModalProvider` mounted globally in both
  `app/_layout.tsx` and `.storybook/preview.tsx`, and RN-Web keys
  `warnOnce` on the bare string. A before/after console capture showed
  the warning in **both** states. The evidence of record for this item
  is the inventory grep going to zero plus typecheck / lint / the
  storybook lane — not a silent console. Anyone re-opening this item
  should start from the vendor patch, which is filed to triage.
- **Ctrl-K focus gating closed a live bug, not a latent one.** The
  scope note assumed today's behaviour was benign because expo-router
  freezes a blurred screen. It does not: the web `NativeStackView`
  renders every route and hides the unfocused ones with
  `display: none`, there is no `Freeze` in that path and `enableFreeze`
  is called nowhere, and the menu's popover portals to `document.body`
  anyway. Pre-fix, two screens' listeners answered one Ctrl-K — and
  because [`actions-menu.md`](../../../../ui/patterns/actions-menu.md)
  names the Wizard as an explicit opt-out, the shortcut was opening the
  underlying screen's menu from inside a surface that is specified not
  to have one.
- **Bad-branch hydration — hard navigation.** No in-app route can
  reach the reader with an unknown branch: both entry points sit
  behind a successful `loadOpenStory`, so a dangling
  `stories.current_branch_id` surfaces on the landing screen, never
  in the reader. `page.goto` is the only route and, in packaged mode,
  the only end-to-end exercise of the 2026-08-18 `app://` deep-route
  fallback; `testing.md` records it as the one sanctioned URL.
- **Premise corrections on the remaining items.** `select.tsx:153`
  is reached only on native phone tier and was never the residual
  RN-Web warning's source — the warning is `warnOnce`, so any single
  unconverted site keeps it alive, which is why all fourteen moved
  together. The `StreamingReasoning` falsification controls the
  record named (`suggestion-categories-editor.tsx:408/:751`) and the
  alternative (`skeleton.tsx`) are all native-only; `Pulsing` was the
  only web-reachable deps-less `useAnimatedStyle` in the tree, so the
  cause was bisected directly. Under Electron the unsaved-changes
  guard registered no `beforeunload` at all, so the reload guard is
  two dependent halves — the renderer must prevent its own unload
  before main ever sees `will-prevent-unload` — and the same listener
  now sits in front of a confirmed close, which main lets through.
- **Reload guard — the renderer registered no `beforeunload` at all.**
  The item read as "hold a reload behind the ask", but under Electron
  the guard's effect returned on every bridge-path branch before it
  ever reached the listener registration, so Ctrl-R on a dirty surface
  had nothing to prevent it and `will-prevent-unload` never fired. The
  fix is therefore two dependent halves: the renderer must prevent its
  own unload before main can answer. Main's handler fails open on
  `!guard.guarded` — added after review found that asking
  unconditionally leaves a window that cancels its unload without
  arming the guard permanently unquittable, which is worse than the
  bug being fixed. Coverage is honest but partial:
  `e2e/tests/reload-guard.spec.ts` is the only automated evidence
  (there is no unit harness for `main.ts`). Mutation testing over a
  freshly recompiled `electron/dist` leaves four `main.ts` mutations
  alive, and the `confirmedReload ||` arm scores **nondeterministically**
  — surviving twice and dying once on identical input — because whether
  the renderer still holds its `beforeunload` listener when main issues
  the confirmed reload is a race. A single-run verdict on this file is
  therefore evidence in neither direction; that gap is recorded here
  rather than papered over. The
  manual desktop smoke was never run — this environment's Wayland
  session is the developer's own display, which Electron connects to
  directly regardless of `DISPLAY`, so `xvfb` cannot isolate it.
