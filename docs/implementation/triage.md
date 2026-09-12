# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Manual scene edits tint under C1.** (2026-09-11) C1 tints a
  manual scene edit on the last two replies as though it were a
  classifier transition; canon
  ([`entity.md → Recently-classified row accent`](../ui/patterns/entity.md#recently-classified-row-accent))
  says manual edits don't tint. A fix would diff against the pre-edit metadata carried in the
  `user_edit` delta's undo payload. Needs a developer call.
- **`pipeline_runs` has no `action_id` index.** (2026-09-11) The C1
  read's reversed-run subquery scans the table on every refetch
  (~0.6 ms at 10k rows, ~15 ms at 200k, measured on Electron main).
- **UNVERIFIED: reversed-run deltas may confuse rollback.**
  (2026-09-11, read-only finding) Reversed runs keep their deltas, so after an
  aborted turn `selectUndoTarget` may pick the dead turn's deltas as the head
  group; `resolveRollbackWindow` then rejects, and Ctrl-Z returns `integrity`
  until another action lands. A rollback sweeping an aborted run's `delete`
  delta may also re-insert a row the abort already restored. Needs a repro.
- **`CollisionListRow` accessibility role drift.** (2026-09-11)
  The strip uses `accessibilityRole="alert"` (every flagged row
  announces); [`collision-resolve.md → Accessibility`](../ui/patterns/collision-resolve.md#accessibility)
  specs `region`. On Android
  (2026-09-12 emulator smoke) the accessibility tree also reports
  content-desc "Collision warning" on a container spanning the whole
  Active group, not only the strip — cause unverified.
- **Pressable `Tag` misses the phone tap floor.** (2026-09-11) A
  20 dp pill with `hitSlop={8}` reaches only ~36 dp against the
  [tap-target floor](../ui/foundations/spacing.md#tap-target-on-native)
  ([`touch.md`](../ui/foundations/mobile/touch.md#touch-target-floor-on-phone)),
  and Android's `hitSlop` can't extend past the parent anyway. Affects
  the review pill and the generation pill; fix is visible size, not
  more slop.
- **Breadcrumb truncation has no tap-to-tooltip.** (2026-09-11)
  [`principles.md → Breadcrumb tappability`](../ui/principles.md#breadcrumb-tappability)'s
  tap-to-tooltip for a truncated current breadcrumb segment is not
  implemented anywhere.
- **No `Link` primitive; no navigation landmark role.** (2026-09-11)
  Breadcrumb is the fourth hand-rolled link `Pressable`; no
  navigation landmark role exists anywhere in the app.
- **Lead badge looks like the active status pill.** (2026-09-11)
  The lead badge is a default outline `Tag` stand-in (canon: gold
  pill), which looks identical to the `active` status pill; "gold"
  maps to `warning` elsewhere, which means retired. Design call.
- **`ListRow`'s `aria-label` hides its channel content.**
  (2026-09-11) The row's `aria-label` replaces its child content, so
  status, lead and in-scene never reach screen readers.
- **No shared lore kind glyph.** (2026-09-11)
  [`iconography.md → Entity kind glyphs`](../ui/foundations/iconography.md#entity-kind-glyphs)
  has no lore glyph; `BookOpen` (the app logo) is inlined in `LoreRow`
  and `WorldDetailPlaceholder` — needs a shared kind icon covering lore.
- **Reader and Story Settings titles aren't `Breadcrumb`.**
  (2026-09-11) World's top-bar title converted to `Breadcrumb`; the
  reader and Story Settings top-bar titles have not.
- **Breadcrumb's 70% cap measures itself on web.** (2026-09-11)
  `ScreenShell`'s content-sized title slot means the top bar's 70%
  current-segment cap measures the breadcrumb's own text, biting only
  when the current segment is more than ~2.3× the rest (e.g. a
  one-character story title). Fix belongs in the shell's title slot.
- **World's category-label lowercasing is English-only.**
  (2026-09-11) The search placeholder and the empty-list title
  lowercase the category label in code, in the app language, so a
  translation whose nouns keep their capital (German) can't opt out.
  A formatter in the string itself (`{{category, lowercase}}`) would
  hand the choice to translators.
- **Collapsed-tier badge drops focus.** (2026-09-11) Clicking the
  collapsed-tier `⚠ N` badge unmounts it (the tier expands), dropping
  keyboard focus to the page body; move focus to the revealed row
  instead.
- **Collapsed-tier state is keyed by tier only, not per kind.**
  (2026-09-12) `lib/stores/ui/world-list.ts` keys collapse on
  `EntityTier` alone, so collapsing Staged on Characters also
  collapses it on Locations. Canon doesn't say whether collapse should
  be per kind. Needs a design call.
- **DB IPC has no retry for transient failures.** (2026-09-12) A
  one-off rejection on the renderer-to-main SQLite bridge fails the
  operation outright; for a story open it now sends the user back to
  the story list. A bounded retry for transient bridge errors would
  cover every DB call, not just opens. Needs a call on which errors
  count as transient.
- **Back does nothing on a cold-mounted in-story screen.**
  (2026-09-12, pre-existing) After a reload (Ctrl+R replays the URL)
  the stack holds only the current screen, and the reader's, World's
  and Story Settings' Back call `router.back()`, which expo-router
  queues as a `GO_BACK` with no `canGoBack()` check, so nothing
  happens. Read from expo-router's source, not run. A `canGoBack()`
  fallback to the story list would fix all three.
- **Collision strip's role contradicts canon.** (2026-09-12,
  pre-existing)
  [`collision-resolve.md → Accessibility`](../ui/patterns/collision-resolve.md#accessibility)
  specifies `accessibilityRole="region"`, but `CollisionListRow` has
  rendered `role="alert"` since it shipped, which screen readers
  announce assertively as each flagged row mounts. Pick one and align
  the other.
