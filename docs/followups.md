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

- **Rich-entry rendering on native — DOM-component hybrid design pass.**
  Native entry rendering tops out at react-native-render-html's
  translated CSS subset (~76 properties: text, box, flex, transform,
  opacity). Anything past it — grid/positioned layouts, shadows,
  gradients, animations, pseudo-elements, media queries — silently
  degrades on Android while web renders it, which breaks the wanted
  "LLM authors visual elements" use case (layouting, coloring,
  animated elements — not just text styling). Decided direction:
  a **hybrid** — plain markdown entries keep the native RNRH path;
  entries using rich styling render through an Expo **DOM component**
  (`'use dom'`, SDK 55 stable; `dom={{ matchContents: true,
scrollEnabled: false }}`) embedded as an EntryWindow row, running
  the web sanitize pipeline (real DOM: DOMPurify works, `<style>`
  needs no juice) with theme tokens bridged in as CSS variables.
  Design pass owns: the detection rule for which entries get the
  rich card; low-end-Android memory/scroll validation (each card is
  a WebView; FlatList windowing bounds the live count);
  `matchContents` measure-flash vs prepend scroll-anchoring;
  stream-native-then-promote-on-commit; native chrome (actions,
  edit mode, selection) staying outside the card. Prerequisite:
  `react-native-webview` install + dev-client rebuild (see
  [lessons-learned → native deps](./implementation/lessons-learned/native-dep-expo-link.md)).
  Until it lands, the floor is the juice-inlined RNRH subset
  (see [lessons-learned → Metro browser builds](./implementation/lessons-learned/metro-native-ignores-browser-builds.md)).
  Wanted earlier rather than later (user-confirmed 2026-07-18).
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
