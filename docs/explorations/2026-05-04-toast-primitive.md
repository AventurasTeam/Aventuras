# Toast primitive

Design record for the Toast primitive — ephemeral, top-anchored,
auto-dismissing notification surface used for fire-and-forget
signalling that doesn't fit a banner (persistent, anchored) or an
inline error state.

Context: [`component-inventory.md → Primitives — needs design`](../ui/component-inventory.md#primitives--needs-design).
No `react-native-reusables` baseline exists for toast, so this is a
from-scratch design; the primitive borrows animation + gesture
patterns from the Sheet primitive ([`sheet.tsx`](../../components/ui/sheet.tsx)).

## V1 use cases

Surveying the docs surfaced four call-sites that fit toast
semantics:

1. **Save success** — every dirty session that saves cleanly. The
   save-bar disappearing is feedback, but a green toast reinforces
   the signal (especially on long-form surfaces where the save-bar
   is far from the user's gaze). Replaces the implicit "no toast on
   save" precedent in [`save-sessions.md`](../ui/patterns/save-sessions.md).
2. **Granular errors** — non-persistent failures that don't warrant
   a banner. (Banners stay the right surface for persistent errors
   — App Settings global error banner, reader gen-banner,
   branch-navigator gen-banner.)
3. **Onboarding completion** ([`onboarding.md → Brief toast`](../ui/screens/onboarding/onboarding.md)) — `<Provider> connected. Default model: <auto-pick>. Change anytime in Settings.`
4. **Wizard lead-unset cascade** ([`wizard.md → Lead-required gating`](../ui/screens/wizard/wizard.md#lead-required-gating)) — `Lead unset — staged characters can't be lead.`

Toasts deliberately do **not** cover:

- **Reader peek lead change** ([reader-composer.md → no-toast precedent](../ui/screens/reader-composer/reader-composer.md)) — re-anchored narration is the feedback.
- **Persistent errors** — banners. Different primitive, different
  contract.
- **Undo affordance** — not a documented UI pattern in v1; rollback
  lives in the History tab.

## Placement

**Top-center on every tier.** Reasoning:

- Avoids structural collision with the save-bar (anchored to the
  bottom of every dirty surface).
- Avoids the on-screen keyboard pushing content up on mobile.
- Trades the desktop convention (top-right / bottom-right corner)
  for cross-tier consistency. Toast fires rarely; the unfamiliarity
  cost is small.

Phone: full container width minus 16px gutters. Tablet / desktop:
`max-width: 400px`, horizontally centered.

## Severity → token mapping

Three v1 severities, mapped to existing color slots from
[`foundations/color.md`](../ui/foundations/color.md):

| Severity | Background tint    | Border      | Foreground     | Leading glyph                 |
| -------- | ------------------ | ----------- | -------------- | ----------------------------- |
| success  | `--success` tinted | `--success` | `--success-fg` | lucide `Check`                |
| error    | `--danger` tinted  | `--danger`  | `--danger-fg`  | lucide `AlertCircle` (or `X`) |
| info     | `--info` tinted    | `--info`    | `--info-fg`    | lucide `Info`                 |

Specific glyph names land during the visual-identity pass; the slot
wiring is the contract.

Adding a new severity (e.g. `warning`) is additive — extra row in
this table + extra branch in the variant resolver. No structural
change.

## Auto-dismiss + manual close

Per-severity auto-dismiss durations:

- **Success** — 3000ms (feedback for an action the user just took).
- **Info** — 5000ms (carries content, needs reading time).
- **Error** — 7000ms (longer to act on, but still bounded — avoids
  the stuck-toast graveyard a manual-only sticky error policy
  produces on flaky-network conditions).

**Always-visible × close button** on every toast regardless of
severity. Universal escape hatch; consistent contract; touch target
≥ 44px floor per [`touch.md`](../ui/foundations/mobile/touch.md).

**Hover-pause / touch-pause on auto-timer** — deferred to v1.1.
Nice-to-have, not blocking.

## Mobile dismiss gesture

**Swipe up + ×, both available.** Native-feeling primary gesture
(swipe up — semantically "push it back where it came from" since
the entry slides in from the top) with × as fallback.

- **Threshold** — 50% of toast height OR 50px translation,
  whichever fires first.
- **Below threshold** — spring back to rest position.
- **Above threshold** — continue translation off-screen, then
  unmount.
- **Stack interaction** — swipe affects only the swiped toast; the
  stack reflows.
- **Implementation** — reuses the pan-gesture + spring-back pattern
  from [Sheet's drag-to-dismiss](../../components/ui/sheet.tsx)
  (lines ~107–140). Same `withSpring` damping, same dismiss-threshold
  shape.

Desktop has no swipe; × is the only manual dismiss.

## Queue behavior

- **Max simultaneous: 3.** New arrival on a full queue accelerates
  the oldest toast's auto-dismiss to ~200ms remaining, then slots
  in.
- **Stack direction: newest at top.** Toasts enter from the top
  edge; new arrivals push existing ones down. Bottom-most toast was
  first to land and dismisses soonest.
- **Spacing: 8px** between stacked toasts.
- **No call-site dedupe.** Call sites are responsible for not
  double-firing (e.g. save shouldn't fire if no diff). The
  primitive doesn't try to detect duplicate messages.

## Content shape

- **Single message string by default**, multi-line wrap when copy
  demands.
- **No title / body split** for v1 — all four call-sites are
  single-message.
- **No action button slot** for v1 — no use case (undo isn't a v1
  affordance; banners cover persistent error CTAs). Adding an
  `action` prop later is additive without breaking existing sites.
- **No height cap.** Long copy wraps freely. Combined with the
  3-toast queue cap, worst-case stack height is bounded by viewport
  and by user dismissal.

## API shape

**Imperative module-level singleton** as the primary surface:

```ts
import { toast } from '@/lib/toast'

toast.success('Saved.')
toast.error('Connection failed. Retry?')
toast.info('Provider connected. Default model: <auto-pick>.')
```

Idiomatic for fire-and-forget signalling; matches sonner /
react-hot-toast / sonner-native conventions; reachable from anywhere
without context plumbing.

Backed by:

- A singleton emitter / store (Zustand or a tiny custom emitter —
  decide at scaffold).
- A `<Toaster />` component mounted once at the app root that
  subscribes to the store and renders the visible queue.

No `useToast` hook needed for v1. Add later if a consumer needs
context-bound dispatching (e.g. a theme-scoped toast for a sandboxed
preview).

## Accessibility

- **`role="status"`** on each toast container.
- **`aria-live="polite"`** for success / info — announced when the
  AT is idle, doesn't interrupt the user's reading position.
- **`aria-live="assertive"`** for error — announced immediately;
  the user likely wants to know about a failure right now.
- **Dismiss × button** — `aria-label="Dismiss"`, focusable, 44px
  touch floor.
- **Focus management** — toasts are not keyboard-focused on mount
  (would steal focus from the user's current task). The × is
  focusable via Tab once the user reaches the toast region.

## Cross-platform animation dispatch

Same web/native split as Sheet / Popover / Skeleton:

- **Native** — reanimated layout-animations: `SlideInUp.duration(250)`
  / `SlideOutUp.duration(200)` for entry / exit. Stack-reflow
  animations on neighbor mutation use `Layout.duration(200)`
  (reanimated's automatic-layout transition).
- **Web** — CSS keyframes equivalent to the reanimated values.
  Reuses `slide-in-from-bottom` keyframe inverted, OR adds a new
  `slide-in-from-top` keyframe to [`tailwind.config.js`](../../tailwind.config.js).
  The new keyframe lands during build; the design contract is just
  "match the native duration / easing".
- **NativeOnlyAnimatedView** wrapper provides the platform dispatch
  — same shape as Sheet uses today.

## Z-index

Toaster portal renders at **z-100**, above Sheet (z-50) and
AlertDialog (TBD, expected z-50). Tracked as a token in
[`foundations/tokens.md`](../ui/foundations/tokens.md) under the
`Z-index strata` block — Toast slot to be added.

## Adversarial pass

- **Load-bearing assumption — call-site set stays narrow.** Verified:
  action button, title+body split, new severities all add without
  breaking the v1 contract.
- **Toast over Sheet / AlertDialog.** Solvable with the z-100 token
  (above). Specifically called out so the implementation site
  doesn't ship z-50 by default.
- **Mobile keyboard up.** Top-center placement is above the keyboard
  region. ✓
- **Long copy + 3 stacked.** Worst-case stack height approaches
  half the phone viewport on translated languages with tall
  multi-line copy. No height cap; rely on the queue limit + user
  swipe / × to clear. Acceptable for v1.
- **Rapid-fire saves.** 3 toasts stack, oldest accelerates. Call
  sites dedupe at source — save shouldn't fire if no diff. No
  primitive-level dedupe.
- **Swipe vs auto-dismiss timer race.** Gesture wins; auto-timer
  cancels on swipe-dismiss commit.
- **Route change with active toasts.** Toaster mounted at app root
  persists across routes; toasts survive route transitions. Matches
  the onboarding-completion call-site intent (toast is meant to
  land after the routing). If a future surface-bound error needs
  scope-coupling, that's a follow-up.
- **Visibility-API tab-pause.** Out of v1; nice-to-have follow-up.
- **Banners are also undocumented as a primitive.** Toast doc
  references banners as the persistent counterpart, but the banner
  primitive design pass is separate. Banners aren't in the v1
  inventory's primitive needs-design list because they're
  surface-specific today; consolidate later if a third banner site
  appears.

## Integration plan

### New canonical doc

- **`docs/ui/patterns/toast.md`** — promote this exploration to a
  pattern doc once approved. Anchor structure follows the section
  outline above.

### Updates to existing canonical docs

- **`docs/ui/component-inventory.md`** — move Toast from
  Primitives — needs design to Primitives — build-ready, citing
  `patterns/toast.md`.
- **`docs/ui/patterns/save-sessions.md`** — flip the implicit
  "no toast on save" precedent. Add a sentence after the save-bar
  visual section noting that save success fires a `toast.success`
  in addition to the bar disappearing.
- **`docs/ui/patterns/README.md`** — add `toast.md` to the index
  with a one-line description.
- **`docs/ui/foundations/tokens.md`** — add Toast slot to the
  `Z-index strata` block at z-100.
- **`docs/ui/screens/onboarding/onboarding.md`** — anchor the
  existing toast mention to `patterns/toast.md`.
- **`docs/ui/screens/wizard/wizard.md`** — anchor the existing
  toast mentions to `patterns/toast.md`.

### Followups

- New: hover-pause / touch-pause on auto-timer (v1.1).
- New: visibility-API tab-pause for web (deferred).
- Existing: lucide glyph names land during the visual-identity
  pass — already covered by the iconography session, no new
  followup.

### Wireframes

No screen-level wireframe affected — toast renders above all
surfaces and isn't part of the wireframe primitives. The Toast
primitive's own visual contract is the design above; storybook
stories will be the visual record.

### Storybook story shape

`Patterns/Toast` with stories: severity matrix (success / error /
info), single-line / multi-line, queue (3-stack), swipe-dismiss
(native-only verification), ThemeMatrix (per-theme severity
contrast).
