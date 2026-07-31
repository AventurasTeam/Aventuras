# Lessons learned

Implementation pitfalls, runtime gotchas, and library workarounds
collected while building Aventuras. Each entry captures a trap
that bit someone — usually with a "Why" (the root cause) and a
"How to apply" (the rule for next time). Read before touching the
substrate the entry references; cite from convention docs and
slice plans when relevant.

## What belongs here

- Runtime behaviour that resists static reasoning (RN / RN-Web
  divergence, native-vs-JS thread races, library bugs with
  documented workarounds, platform-specific rendering quirks).
- Substrate gotchas discovered during compound construction
  (slot props, portal context, layout-leaking Fragments).
- Subtle pattern violations whose fix isn't obvious from the code
  alone.

## What doesn't

- Conventions (state placement, action layer, folder taxonomy,
  commenting discipline) — those live in `docs/code-conventions.md`
  (lands in Milestone 1, slice 1.1).
- One-off bug fixes whose context lives in the commit message.
- Spec decisions — those land in canonical docs
  ([data-model.md](../../data-model.md),
  [architecture.md](../../architecture.md), etc.) and are tracked
  via [`followups.md`](../../followups.md) / [`parked.md`](../../parked.md).

## Index

### RN / RN-Web patterns

- [TextClassContext + bare strings](./textclasscontext-bare-strings.md)
  — wrap labels in `<Text>`; bare strings don't inherit text-color
  context.
- [State-layer vs filled-surface hover](./state-layer-vs-filled.md)
  — `bg-tint-hover` works on neutral surfaces only; filled
  surfaces use `hover:opacity-90` / `active:opacity-90`.
- [Icon `fill="currentColor"`](./icon-fill-currentcolor.md) —
  broken on Android; drive fill via Tailwind `fill-*` className.
- [Raw HTML islands need an explicit theme baseline](./raw-html-island-theme-baseline.md)
  — web inherits `body { color: var(--fg-primary) }`, native
  RenderHTML always gets a `baseStyle` color; never patch color
  per-island.
- [Wide-table scroll containment](./table-scroll-containment.md)
  — wide tables wrap in their own `overflow-x: auto`; horizontal
  scroll must not bubble.
- [Chrome scroll anchoring doesn't fire for RN-Web trees](./scroll-anchoring-rnweb-tree.md)
  — engine anchoring silently skips RN-Web wrapper trees; opt out
  with `overflow-anchor: none` and compensate deterministically,
  never mid-gesture.
- [`BackHandler` is not inert on web](./backhandler-web-console-error.md)
  — RN-Web's shim `console.error`s on every subscribe; gate the
  subscribe on `Platform.OS === 'android'`, not the handler.

### rn-primitives substrate

- [`disabled` doesn't fully gate clicks on web](./rn-primitives-disabled.md)
  — use inline `pointerEvents: 'none'` style.
- [Portal drops custom contexts on native](./rn-primitives-portal-context.md)
  — resolve above the Portal and thread as props, or re-provide
  inside.
- [`asChild` slot props need rest-spreading](./aschild-slot-props.md)
  — Slot-injected ref + handlers get silently dropped without it.
- [Substrate fragment layout leak](./substrate-fragment-layout-leak.md)
  — substrate must emit exactly one React element per tier;
  Fragments leak siblings into consumer layout.
- [Input adornment DOM identity](./input-adornment-dom-identity.md)
  — always render adornments, toggle visibility; conditional
  render re-keys TextInput and loses focus.
- [Dialog claims the touch responder](./dialog-content-responder-claim.md)
  — native `Content` blocks ScrollView scroll interception on
  Android; scrolling is flaky to start, fine once moving.
- [Layout props on a compound trigger](./compound-trigger-flex-reach.md)
  — `flex-1` lands on the inner element, not the Header that sits in
  your row; the web tree survives only because the wrapper adds its
  own web-only `flex-1`, and Yoga collapses the native one.
- [Portaled overlays outlive screen focus](./portaled-overlay-outlives-screen-focus.md)
  — a Stack keeps pushed-under screens mounted, so their portaled
  modals float over the new screen; gate on `useIsFocused()`.

### Animation / gesture

- [Reanimated 4 async SV write](./reanimated4-async-sv-write.md)
  — JS-side `sv.value = X` is async on native; use `runOnUISync`
  when children mounting in the same render must read fresh.
- [`reanimated-dnd` unstable extractor](./reanimated-dnd-unstable-extractor.md)
  — leave `itemKeyExtractor` inline; lifting it breaks
  fresh-mount layouts.
- [Drag-height constant drift](./drag-height-constant-drift.md)
  — measure or enforce row height; assumed-vs-actual mismatch
  produces release-time pixel snaps.
- [KAV `automaticOffset` × layout-entering animation race](./kav-automatic-offset-animation-race.md)
  — `react-native-keyboard-controller` KAV measures once;
  Reanimated-entry containers drive `paddingBottom` off
  `useReanimatedKeyboardAnimation` directly.

### State / data discipline

- [No "harmless" id leaks](./no-harmless-id-leaks.md) — prune
  ids from Sets / Maps on disappearance; reset / undo / reload
  can resurrect them and inherit leaked state.

### Desktop / Electron

- [Running ONNX inside Electron main](./onnx-in-electron-main.md)
  — the CPU memory arena SIGTRAPs the process with no JS error,
  and config-driven external-data fetch hangs forever; neither
  reproduces under `ELECTRON_RUN_AS_NODE`.

### Testing / module graph

- [Keep `vitest.setup.ts`'s import graph thin](./test-setup-import-graph-breaks-mocks.md)
  — an eager setup import (e.g. an action pulling a heavy barrel) loads
  modules before test files register their `vi.mock`, silently breaking
  the mocks; relocate the offending symbol to a light module.
- [Known-answer vectors can share a blind spot](./known-answer-vectors-share-blind-spots.md)
  — the published xxh32 vectors all hash below `0x80000000`, so a
  signed-int32 leak survived a green suite; assert format
  invariants over a sweep, not just point values.
- [Staleness flags are cleared by the drain](./staleness-flags-are-cleared-by-the-drain.md)
  — `embedding_stale` is a handoff signal, not a durable property, so a
  post-hoc E2E assertion on it tests drain scheduling; assert the initial
  write or the settled end state, never the handoff.
- [A literal NUL in a plan file silently rewrites the code it specifies](./plan-file-nul-corruption.md)
  — `file .impl-plans/*.md` should never say `data`; reading tools disagree
  about a raw NUL and each renders a different separator.
- [Xvfb does not hide Electron on a Wayland session](./xvfb-does-not-hide-electron-on-wayland.md)
  — `xvfb-run` sets only `DISPLAY`, which Electron ignores in favour of
  the compositor; pin `--ozone-platform=x11` at launch, and verify by
  where the window rendered, not that Xvfb is running.
- [Vite eagerly bundles a runtime-guarded `require()`, Metro doesn't](./storybook-vite-eager-guarded-require.md)
  — a `typeof window` guard around a Node-only `require()` is safe under
  Metro but can crash every Storybook story importing that module; alias
  the specifier to a stub in `viteFinal`, don't touch the guard.

### Native deps / install ritual

- [Native-module RN libs need a dev-client rebuild](./native-dep-expo-link.md)
  — `pnpm add` alone crashes Android for libs with native
  modules; config-plugin step is per-library, not universal.
- [`pnpm patch-commit` drops files you added](./pnpm-patch-drops-added-files.md)
  — only edits to existing files land in the `.patch`; verify the
  file list and hand-append new-file hunks.
- [Metro's native resolution ignores browser-targeted builds](./metro-native-ignores-browser-builds.md)
  — the `browser` main field and `browser` exports condition are
  web-only, and a map that keys on `node` drops native onto its web
  `default`; a dep can work on web and break every Android bundle.
  Deep-import the client build or pin it via `resolveRequest`; if the
  web dist then trips Hermes on `import.meta`, reach for the
  babel-preset-expo polyfill, not a redirect. Verify with a real
  `expo export --platform android`.

### Doc authoring

- [Prettier wrap-mangling traps](./prettier-prose-wrap-traps.md)
  — avoid `+` as a word separator in list items and long
  inline-backtick prose at end of paragraphs; this repo's
  prettier reflows them in distinctive bad ways.

### Meta-rules

- [Library-first defaults](./library-first-defaults.md) —
  exhaust documented library workarounds before rewriting from
  scratch. "Do it correctly" usually means "use the library
  correctly."

## Adding a new entry

1. New file at
   `docs/implementation/lessons-learned/<kebab-slug>.md`. Title is
   the lesson stated as a rule. Body covers Why and How to apply;
   include code where it tightens the point.
2. Cross-reference related lessons with relative-path markdown
   links (`[label](./other-slug.md)`).
3. Add a one-line entry under the relevant section in this
   README's Index.

Prefer lifting a recurring shim into the substrate over
documenting it here — the [substrate fragment leak](./substrate-fragment-layout-leak.md)
lesson IS the meta-lesson that this directory shouldn't grow
forever.
