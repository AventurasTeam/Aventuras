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
- [Wide-table scroll containment](./table-scroll-containment.md)
  — wide tables wrap in their own `overflow-x: auto`; horizontal
  scroll must not bubble.

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

### Testing / module graph

- [Keep `vitest.setup.ts`'s import graph thin](./test-setup-import-graph-breaks-mocks.md)
  — an eager setup import (e.g. an action pulling a heavy barrel) loads
  modules before test files register their `vi.mock`, silently breaking
  the mocks; relocate the offending symbol to a light module.

### Native deps / install ritual

- [Native-module RN libs need a dev-client rebuild](./native-dep-expo-link.md)
  — `pnpm add` alone crashes Android for libs with native
  modules; config-plugin step is per-library, not universal.

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
