# Phase 2 sketch — primitives + cross-cutting bring-up

Phase 1 closed: foundations runtime (theming, tokens, css-generator,
themes:audit), one primitive (Button) plus its text-rendering
dependency (Text), Storybook tree reorganized as
`Foundations / Primitives / Patterns / Screens`, foundations
explorer, native dev routes, NativeWind theme-swap parity
characterized on web + Android (recorded in
[`theming.md → Switching mechanism`](../ui/foundations/theming.md#switching-mechanism)).

This session sketches what comes next. Phase 2 is about **filling
out the remaining primitives** so phase 3 can build patterns on
top of them, with two cross-cutting open items resolved along the
way (custom-font loading, native animation).

Not a spec — a scoping doc. Real decisions land at phase 2's own
brainstorm + design pass.

## Scope candidates

The plan that ran phase 1 lists primitives, patterns, screens as
the descending tiers. Phase 1 only shipped Button + Text. The
primitives still missing for v1 patterns to consume:

### Group A — overlay primitives (Sheet + Popover)

The two surfaces v1 uses for transient floating UI. Sheet is the
mobile bottom-sheet shape; Popover is the desktop floating-panel
shape. They share lifecycle (open/close, focus trap, dismiss-on-
outside) but differ in presentation tier.

`@rn-primitives/dialog` is already a project dep — the underlying
mechanism for both is likely `@rn-primitives/popover` (rn-primitives
analogues for radix-ui). Phase 2 confirms the mapping and locks the
contract.

**Why first.** Select (Group B) needs Sheet on mobile / Popover on
desktop; calendar-picker pattern (phase 3) needs both. Other
primitives don't depend on either, but ~half of phase 3 patterns do.

### Group B — Select primitive

Already flagged in
[`followups.md → Calendar picker primitive — open shape decisions`](../followups.md#calendar-picker-primitive--open-shape-decisions)
as load-bearing for the calendar-picker pattern shape decision
(does Select gain rich-row content + popover tail-actions, or does
a sibling `Picker` primitive fork off?). Lands together with the
Sheet / Popover pair from Group A.

This is the most complex single primitive in phase 2 — keyboard
nav, focus trap, scroll behavior, virtualization for long lists
([virtual-list library choice](../followups.md#virtual-list-library-choice)
becomes ripe here), accent / focus-ring styling, accessible-name /
value coupling. Lands as one focused phase 2 pass.

### Group C — text input primitives (Input + Textarea)

Single-line and multi-line text inputs. Most v1 forms (story
settings, app settings, wizard) consume both. Reasonably contained
in surface area; cross-platform nuance lives in focus-ring,
autocomplete, password-style inputs, RN keyboard-handling.

`react-native-reusables` ships an Input scaffold that's likely the
starting point — same adapt-not-rebuild pattern phase 1 used for
Button.

### Group D — choice primitives (Switch + Checkbox)

Boolean inputs. v1 surfaces using these: appearance toggles (App
Settings), per-story toggles (Story Settings), wizard steps. Same
scaffold-adapt pattern.

**Standalone Radio dropped from this group.** Select's `radio`
render mode covers every "pick one of N with descriptions" case
in v1 wireframes; no per-screen surface uses a radio group outside
Select. Group D's contribution to the radio pattern is internal:
Select.radio + Select.segment retrofit to compose
`@rn-primitives/radio-group` for arrow-key navigation, roving
tabindex, and ARIA role wiring. If a non-description radio case
ever surfaces (rare), extend Select rather than duplicating the
primitive — keeps the "pick one" vocabulary single-sourced.

### Group E — visual primitives (Avatar + Icon)

`Icon` is the slot phase 1 explicitly punted on — the
`[&_svg:not([class*='size-'])]:size-4` rule got dropped from
Button when ActivityIndicator's intrinsic 20px collided with it.
Phase 2 picks the icon library
([`iconography.md`](../ui/foundations/iconography.md) declares
`lucide-react-native`) and ships a typed Icon primitive with the
canonical sizing slots (`--icon-sm`, `--icon-md`, `--icon-lg`).

`Avatar` is small (image + fallback initials, with sizing tied to
`--icon-*`-adjacent slots). Bundles naturally with Icon.

### Group F — loading primitives (Skeleton + Spinner)

`Spinner` becomes its own primitive, replacing the
`ActivityIndicator` workaround currently in Button — proper
`currentColor`-friendly CSS spinner on web, RN-driven spinner on
native, unified API. Worth doing because Button isn't the only
surface that needs a loading affordance.

`Skeleton` is the placeholder-while-loading shape — a colored block
that pulses subtly. Used throughout v1 list rendering during
hydration. NativeWind's `animate-pulse` + the active-bg slot covers
it on web; native variant uses reanimated.

## Recommended ordering

Critical path:

1. **Group A (Sheet + Popover)** — prerequisite for B + several
   phase 3 patterns. Land first.
2. **Group B (Select)** — depends on A; unblocks the calendar-picker
   shape decision; characterizes virtualization.
3. **Group C (Input + Textarea)** — independent of A/B. Can run in
   parallel with B if subagent-driven; else after B.
4. **Group D (Switch + Checkbox)** — independent. Parallel with C.
   Bundles a Select.radio + Select.segment retrofit to compose
   `@rn-primitives/radio-group` (no standalone Radio primitive
   shipped — see group description).
5. **Group E (Icon + Avatar)** — depends on the Icon primitive
   being designed (icon-set choice + sizing contract). Independent
   of A–D otherwise.
6. **Group F (Skeleton + Spinner)** — depends on motion-token
   parity being settled (Skeleton's pulse is animated). Land
   after the cross-cutting motion characterization.

Hard dependency: A → B. Soft dependencies: E → consumers in phase
3 (entity rows need icons), F → motion characterization.

## Cross-cutting concerns to resolve in / before phase 2

These aren't "primitives" — they're the open contracts that phase
1 left partial.

### Custom-font theme support

Phase 1 found that the `--font-reading` slot swap fires correctly
but the resolved typeface doesn't change because the named fonts
aren't bundled. Tracked under
[`followups.md → Custom-font theme support`](../followups.md#custom-font-theme-support).

Decisions phase 2 needs:

- Bundle Charter / Lora / etc. via `expo-font` at app startup, OR
  load lazily on first use of a custom-font theme.
- Web font-loading mechanism — `@font-face` in `global.css`, CDN,
  or accept system-fallback.
- License + bundle-size accounting.
- Per-platform stack reconciliation.

Lands as a small focused pass before any v1 surface depends on
custom-font typography. Until then, font-overridable themes
function as color-only themes (the gallery still works visually;
only the font dimension is inert).

### NativeWind transition support on native

Phase 1's MotionSamples gates animations to web only. Tracked
under
[`followups.md → NativeWind transition-* support on native`](../followups.md#nativewind-transition--support-on-native).

Decisions phase 2 needs:

- Verify reanimated babel-plugin wiring; trace whether NativeWind
  4's transition path actually fires worklets on native.
- If transitions don't pan out: pick the alternative animation API
  (reanimated direct, `Animated`, moti). Reconcile with
  `animate-pulse` for Skeleton.
- Update MotionSamples on the foundations explorer to mirror
  whatever native actually does.

Lands when Group F (Skeleton + Spinner) needs native motion, or
sooner if a v1 surface forces it. Likely the natural slot is
right before Group F.

### Accent-overridable derivation

[`color.md → Accent-derivation algorithm`](../ui/foundations/color.md#accent-derivation-algorithm)
designs the `deriveAccent` function that runs at theme-application
time when (a) the active theme has `accentOverridable: true` AND
(b) `app_settings.appearance.accentOverride` is set. Phase 1
ships the registry data with `accentOverridable: true` on the
default-light + default-dark pair only, but no UI consumes the
override and `deriveAccent` is unimplemented.

Phase 2 doesn't strictly need this, BUT — when the
[Accent color picker UI](../followups.md#accent-color-picker-ui)
lands (which is itself a separate followup design pass), the
runtime-side `deriveAccent` work it needs to consume. Worth
queuing as a small phase 2 sub-task once that picker design lands.

### Theme-audit CI gate

[`color.md → Theme audit utility`](../ui/foundations/color.md#theme-audit-utility)
ships as a dev command in phase 1; CI gating is its own followup
([Theme-audit CI gate](../followups.md#theme-audit-ci-gate)).
Independent of phase 2 primitive work but ripe for design now
that real palette data is in hand. Could land in any phase 2
slot or run as a parallel docs/CI workstream.

## Open questions for phase 2's brainstorm

Worth surfacing here so they're not discovered mid-implementation:

1. **react-native-reusables policy.** Phase 1 used the reusables CLI
   to scaffold Button + Text + dialog/popover/etc., kept Button +
   Text, deleted the rest. Phase 2 will pull more components from
   the CLI (Sheet, Popover, Select, Input, Switch). Worth deciding
   upfront: do we always reshape to canonical slots (slow but
   consistent), or accept the reusables defaults where they don't
   conflict (faster but produces drift)?
2. **Storybook story conventions.** Phase 1 settled on Default,
   Variants, Sizes, States, Shapes, ThemeMatrix as the Button
   story shape. Are all six load-bearing for every primitive, or
   does each primitive get a story shape that fits its axes?
   Worth a convention pass.
3. **Phase boundaries for primitives that compose.** Sheet + Popover
   share lifecycle but differ in presentation. Are they one
   primitive with a mode prop, or two siblings? Calendar picker is
   the next consumer — its shape decision feeds back into this.
4. **Native virtualization library choice.** Per
   [`followups.md → Virtual-list library choice`](../followups.md#virtual-list-library-choice).
   Becomes load-bearing during Select implementation (long lists +
   measured rows + scroll-anchoring). Decide before Group B starts.
5. **Cross-platform spinner shape.** Phase 1 uses RN's
   `ActivityIndicator` with theme-driven color; the visual differs
   between platforms (RN-Web's SVG arc vs Android's native spinner).
   Phase 2 Group F either accepts this divergence as "acceptably
   platform-native" or ships a custom unified spinner. Worth a
   short call.

## Out of scope for phase 2

- **Patterns.** Entity rows, lists, calendar picker, forms,
  icon-actions, save-sessions, data viewer — phase 3.
- **Screens.** Story List, Reader/Composer, App Settings, etc. —
  phase 4.
- **Theme persistence.** Still tied to broader app-settings
  storage design.
- **Internationalization.** `nameKey` policy on theme entries
  is in the registry types but no i18n library is wired.

## Followups generated

None this session. The cross-cutting items that came out of phase
1 bring-up (custom-font support, transition-\* on native) are
already tracked as their own followups; this doc just sequences
them against phase 2 group ordering.

## Parked items added

None.
