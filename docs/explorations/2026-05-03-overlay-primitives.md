# Overlay primitives — Sheet + Popover (phase 2 Group A)

First substantive design session of phase 2 of Storybook bring-up,
per the [phase 2 sketch's recommended ordering](./2026-05-03-phase-2-sketch.md#recommended-ordering).
Sheet and Popover are the prerequisite primitives for Group B
(Select) and ~half of phase 3 patterns. Output is the **primitive
contract** for both — split decision, rn-primitives mapping, API
surface, slot/token reshape, behavior contract — landing in a new
`docs/ui/patterns/overlays.md`.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/patterns/overlays.md`](../ui/patterns/overlays.md).

## Decisions locked entering this session

Both came from a quick pre-session pass earlier the same day —
the answers landed directly in
[`docs/ui/components.md`](../ui/components.md):

- **react-native-reusables as scaffold baseline.** Reshape tokens,
  variant API, and accessibility surface; accept structural defaults
  (composition, layout, base interaction). Tokens win on tie-break.
- **Storybook stories are axes-driven.** `Default` is the only
  mandatory section; Variants / Sizes / States / Shapes / ThemeMatrix
  added when the primitive has the corresponding axis.

These two conventions apply to every primitive shipped in phase 2,
including Sheet and Popover.

## Consumer inventory

The shape decision drove off real consumer needs rather than
abstract typology. The canonical decision-tree and surface
bindings already exist in
[`foundations/mobile/layout.md`](../ui/foundations/mobile/layout.md);
this section enumerates only the consumers Group A's primitive
contract has to support.

- **Sheet (cross-platform).** Bottom-anchored on phone (every
  Select with rich content, Actions menu, Branch chip, Chapter
  chip, calendar picker mobile, model picker mobile, settings
  detail panes mobile). Right-anchored on desktop (peek drawer
  ~440px, raw JSON viewer). Mobile and desktop are the same
  primitive with different `anchor` prop values per
  [`layout.md → Mapping`](../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile).
- **Popover (cross-platform).** Anchored, content-sized. Desktop
  is the natural home (every Select, calendar picker desktop,
  chapter chip, time chip, branch chip, actions menu, model
  picker dropdown, help popovers); mobile consumes it for tiny
  content cases (time chip, help popovers, generation-in-flight
  pill expansion).

Out of scope for Group A:

- **Browse rail desktop variant.** Persistent layout panel that
  collapses to an edge strip (per
  [`reader-composer.md → Browse rail collapse / expand`](../ui/screens/reader-composer/reader-composer.md#browse-rail--collapse--expand)).
  Different lifecycle from a transient Sheet — no scrim, no focus
  trap when expanded, persistent rather than open / close. Its
  own primitive in a later session.
- **Modal.** Third overlay primitive in
  [`layout.md`'s decision tree](../ui/foundations/mobile/layout.md#decision-tree)
  (calendar swap warnings, branch creation, rollback confirm,
  save-session guard). Shares
  [`@rn-primitives/dialog`](https://www.npmjs.com/package/@rn-primitives/dialog)
  with Sheet but presents centered with no slide. Will land later
  as a sibling primitive in the same `patterns/overlays.md` doc.
- **Toasts** — future, separate primitive.
- **System entries** — inline reader entries per the
  [reader's error surface decision](../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-not-chrome-indicators),
  not overlays.

A subtle but load-bearing detail surfaced during inventory: on mobile,
the **browse rail → peek drawer** transition is a content-state
swap **within one already-open sheet**, not a sheet replacement.
That tells us Sheet's content area must support state-driven swaps
without remount; the navigation logic itself lives in the consumer's
content tree, not in the primitive. The primitive's contract stays
small (open / close container + lifecycle); the consumer owns the
in-sheet navigation.

## Approach trade-offs

Three ways to express the Sheet / Popover relationship:

- **A. Two siblings.** `<Sheet>` and `<Popover>` as independent
  components. Each has its own API matching its presentation
  contract. rn-primitives provides shared lifecycle under the hood.
- **B. One primitive with a `mode` prop.** A single `<Overlay
mode="sheet">` or `<Overlay mode="popover">` component. Cleaner
  consumer surface; mixes sheet-only and popover-only props that
  no-op in the wrong mode.
- **C. Hybrid.** Internal Aventuras `Overlay` shared lifecycle
  module, thin `Sheet` / `Popover` wrappers, and a
  `ResponsiveOverlay` helper. Three exports.

**Decision: A — two siblings.** Two reasons:

1. Presentation contracts diverge enough that a unified API muddies
   more than it helps. `anchor` on a sheet is meaningless;
   `dragToDismiss` on a popover is meaningless; scrim semantics
   differ (sheet has one, popover doesn't). Forcing one prop bag
   creates dead-prop noise.
2. Sheet is not always a Popover alternative — it sometimes replaces
   non-overlay components entirely (mobile browse rail replaces a
   desktop side-rail layout component). Coupling Sheet to "the
   responsive overlay" misframes its role.

rn-primitives already gives shared lifecycle (focus trap, scroll
lock, dismiss-on-outside, mount/unmount); Aventuras doesn't need
to wrap that into its own internal `Overlay`. The "responsive switch"
question reduces to a small consumer-side helper deferred to
Group B (Select), not a primitive-layer concern.

## Primitive contracts

Spec lives in [`../ui/patterns/overlays.md`](../ui/patterns/overlays.md).
This exploration records only the design choices that drove the
contract:

- **rn-primitives mapping.** Sheet ← `@rn-primitives/dialog` (already
  a dep); Popover ← `@rn-primitives/popover` (needs to be added).
  Reusables CLI scaffolds both; component names verified at scaffold
  time.
- **API shape.** Both expose `open` / `onOpenChange` plus a
  `<X.Trigger>` and `<X.Content>` subcomponent set, mirroring rn-
  primitives convention. Controlled is the canonical entry; trigger
  is optional so consumers like Select can drive open programmatically.
- **Animation.** Sheet slides up from the bottom edge; Popover
  fades and scales near the anchor. Both consume motion tokens
  (`--duration-*`, `--ease-*`).
- **Drag-to-dismiss (Sheet only).** Native-only environment. The app
  ships as Expo native (mobile) and Electron (desktop) — no mobile-
  browser target ever — so `react-native-gesture-handler` is the
  canonical drag path with no web-fallback question. Desktop
  Electron: drag is a no-op; outside-click + Escape dismisses.
- **Free content shape.** Sheet imposes no snap points or layout.
  In-sheet navigation (browse → peek) is consumer territory.
- **Token reshape per
  [`components.md` rules](../ui/components.md#sourcing--react-native-reusables-as-baseline).**
  Scrim, bg, border, radius, shadow, motion read from existing
  slots. Reshape audit happens once at scaffold time.

## Adversarial pass

Once the contract felt right, deliberately tried to break it:

- **Load-bearing assumption — rn-primitives/dialog is sufficient
  for Sheet's lifecycle.** Verified at the dependency layer
  (`@rn-primitives/dialog` is in `package.json`); _not_ verified
  that focus trap, scroll lock, and scrim work as expected on
  Android. Phase 1 scaffold-and-delete cycle didn't characterize
  this. Implementation phase re-confirms before committing.
- **Animation parity on native.** Sheet's slide animation depends
  on motion tokens firing on native, which is the
  [NativeWind transition followup](../followups.md#nativewind-transition--support-on-native).
  Sheet is the v1 surface that forces resolution — earlier than
  the phase 2 sketch projected ("right before Group F"). Surfacing
  in followup body so it's visible from there.
- **Drag-to-dismiss platform reach.** User clarified mid-session:
  no traditional web browser target ever. Removed an
  earlier-noted concern about mobile-web gesture-handler fallback;
  the contract is native-only.
- **Mobile keyboard handling.** Sheet hosting an Input (e.g. search
  field at top of a long Select list): when the keyboard opens,
  does the sheet shift, shrink, or get covered? rn-primitives/dialog
  doesn't ship keyboard-aware behavior. New followup parked for
  the first Sheet implementation pass.
- **Read-site impact.** No existing read sites today — all consumers
  are designed at later passes. Contract changes during
  implementation could ripple, but no shipped code to break.
- **Doc-integration cascades.** Inbound prose mentions of Sheet /
  Popover already exist in `patterns/forms.md` and
  `patterns/calendar-picker.md` — both anchor-link to the new
  `overlays.md` in the same commit.
- **Missing perspective — ARIA roles.** Sheet (`role="dialog"`)
  vs Popover (`role="dialog"` with `aria-haspopup`?) need an
  explicit contract before the first implementation. New followup.

What was verified vs assumed: verified the rn-primitives deps
present, the absence of existing usage. Assumed
rn-primitives/dialog is sufficient for Sheet's lifecycle; assumed
reusables ships scaffolds for both; assumed motion tokens will
fire on native after the transition followup resolves. The first
two are verifiable at implementation; the third is a hard
prerequisite called out in the followup.

## Followups generated

- **Sheet keyboard-handling on mobile.** `KeyboardAvoidingView`
  inside `Sheet.Content` vs a Sheet primitive prop (e.g.
  `avoidKeyboard`?). Lands at first Sheet implementation pass.
  Filed under
  [`followups.md` → UX](../followups.md#sheet-keyboard-handling-on-mobile).
- **Sheet + Popover ARIA contract.** Roles, `aria-labelledby`,
  `aria-describedby`, popover modality semantics. Lands at first
  implementation pass. Filed under
  [`followups.md` → UX](../followups.md#sheet--popover-aria-contract).

The [NativeWind transition followup](../followups.md#nativewind-transition--support-on-native)
is sharpened with a Sheet-specific dependency note rather than
re-filed.

## Parked items added

None. The deferred responsive-switch question (Group B's
ResponsiveOverlay helper or Select-internal logic) is captured as
part of Group B's brainstorm rather than parked separately — it
lives or dies with the Select design pass.
