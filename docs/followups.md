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

## UX

- **Theme is never persisted/restored, and Generate can flip it.**
  `ThemeProvider` seeds its active theme once from `useColorScheme()` into
  local state and never reads or writes `app_settings.themeId` — the column
  is effectively dead (schema default `'system'`, yet a runtime value such as
  `'aventuras'` can exist with no write path from settings). Nothing calls
  `setTheme` at runtime outside the Storybook theme-picker, yet pressing
  Generate in the wizard AI-assist popover was observed flipping light→dark.
  The assist code touches nothing theme-related, so a provider remount
  re-seeding from `useColorScheme()` is the likely trigger — needs a live
  desktop repro to confirm. Fix: wire the provider to persisted `themeId`
  (restore on boot, persist on change) and identify the remount. Pre-existing
  (the theme system predates M2.3); the M7.1 appearance tab builds on the
  persistence wiring, so land it before then. Surfaced by Slice 2.3.
- **Jump-to-bottom's `End` key and Actions-menu entry aren't wired.**
  Slice 2.5's `reader-composer.md#jump-buttons` scope names all three
  affordances (floating button, `End` key, Actions-menu "Jump to
  bottom"), but only the floating button is wired
  (`app/reader-composer/[branchId].tsx`) — no `End`-key handler, and
  `AppActionsMenu` has no reader-contextual entries yet. Low priority
  (the button alone satisfies the slice's acceptance criteria); wire
  the other two whenever the reader's Actions-menu contextual zone is
  next touched.

## Tooling

- **Scoped coverage is not push-button reproducible.** The
  dual-project vitest setup (storybook browser + unit node) drops a
  single `lib/*` module from the merged `--coverage` report, and CLI
  `--coverage.include` overrides crash the storybook project loader.
  Slices that assert per-module line coverage (e.g.
  [Slice 2.8](./implementation/milestones/02-first-user-loop/slices/08-id-substitution.md))
  can only confirm the bar by inspection, and the gap recurs in every
  milestone that sets a coverage bar. Fix: a `lib`-only coverage
  script or vitest project so the bar is verifiable on demand.
  Surfaced by Slice 2.8.
