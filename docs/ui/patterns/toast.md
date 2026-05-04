# Toast pattern

Ephemeral, top-anchored, auto-dismissing notification surface for
fire-and-forget signalling. Sister patterns:
[`overlays.md`](./overlays.md) (persistent overlay primitives —
Sheet / Popover; toast is the ephemeral counterpart),
[`save-sessions.md`](./save-sessions.md) (save success fires a
toast).

Toast covers things that don't fit a banner. Banners stay anchored
to a surface and persist until the underlying state changes (App
Settings global error banner, reader gen-banner,
branch-navigator gen-banner). Toasts appear on action, auto-dismiss,
and live above all surfaces.

Used by:

- [Save sessions](./save-sessions.md) — save success.
- Granular errors across surfaces (anywhere a transient failure
  doesn't warrant a banner).
- [Onboarding](../screens/onboarding/onboarding.md) — completion
  confirmation.
- [Wizard](../screens/wizard/wizard.md) — lead-unset cascade.

Toasts deliberately do **not** cover:

- **Reader peek lead change** — re-anchored narration is the
  feedback ([reader-composer.md](../screens/reader-composer/reader-composer.md)).
- **Persistent errors** — banners.
- **Undo affordance** — not a v1 UI pattern; rollback lives in the
  History tab.

## Placement

Top-center on every tier. Avoids the save-bar at the bottom and the
on-screen keyboard region on mobile; trades the desktop-corner
convention for cross-tier consistency.

- **Phone** — full container width minus 16px gutters.
- **Tablet / desktop** — `max-width: 400px`, horizontally centered.

## Severity

Three v1 severities mapped to existing color slots:

| Severity | Background tint    | Border      | Foreground     | Leading glyph        |
| -------- | ------------------ | ----------- | -------------- | -------------------- |
| success  | `--success` tinted | `--success` | `--success-fg` | lucide `Check`       |
| error    | `--danger` tinted  | `--danger`  | `--danger-fg`  | lucide `AlertCircle` |
| info     | `--info` tinted    | `--info`    | `--info-fg`    | lucide `Info`        |

Adding a `warning` severity is additive — extra row + extra branch
in the variant resolver. Specific lucide names land during the
visual-identity pass; the slot wiring is the contract.

## Auto-dismiss + manual close

Per-severity duration:

- **success** — 3000ms.
- **info** — 5000ms.
- **error** — 7000ms (long enough to act on, still bounded — avoids
  the stuck-toast graveyard a manual-only sticky-error policy
  produces on flaky-network conditions).

Always-visible × close button on every toast regardless of severity.
Universal escape hatch; touch target ≥ 44px floor per
[`touch.md`](../foundations/mobile/touch.md). Hover-pause /
touch-pause on the auto-timer is deferred — see
[`parked.md → Toast — auto-timer pause`](../../parked.md#toast--auto-timer-pause-on-hover--touch).

## Mobile dismiss gesture

**Swipe up + ×, both available** on phone / tablet. Native-feeling
primary gesture (semantically "push it back where it came from"
since the entry slides in from the top); × as fallback.

- **Threshold** — 50% of toast height OR 50px translation,
  whichever fires first.
- **Below threshold** — spring back to rest position.
- **Above threshold** — continue translation off-screen, then
  unmount.
- **Stack interaction** — swipe affects only the swiped toast; the
  stack reflows.
- **Implementation** — reuses the pan-gesture + spring-back pattern
  from [Sheet's drag-to-dismiss](./overlays.md#sheet--api-surface).
  Same `withSpring` damping, same dismiss-threshold shape.

Desktop has no swipe; × is the only manual dismiss.

Race rule: gesture wins. Swipe-dismiss commit cancels the
auto-timer.

## Queue

- **Max simultaneous: 3.** New arrival on a full queue accelerates
  the oldest toast's auto-dismiss to ~200ms remaining, then slots
  in.
- **Stack direction: newest at top.** Toasts enter from the top
  edge; new arrivals push existing ones down. Bottom-most toast was
  first to land and dismisses soonest.
- **Spacing: 8px** between stacked toasts.
- **No primitive-level dedupe.** Call sites are responsible for not
  double-firing (e.g. save shouldn't fire if no diff).

## Content

- **Single message string by default**, multi-line wrap when copy
  demands.
- **No title / body split** for v1 — every documented call-site is
  single-message.
- **No action button slot** for v1 — no documented use case. Adding
  an `action` prop later is additive without breaking existing
  sites.
- **No height cap.** Long copy wraps freely. Combined with the
  3-toast queue cap, worst-case stack height is bounded by viewport
  and by user dismissal.

## API

Imperative module-level singleton:

```ts
import { toast } from '@/lib/toast'

toast.success('Saved.')
toast.error('Connection failed. Retry?')
toast.info('Provider connected. Default model: <auto-pick>.')
```

Reachable from anywhere without context plumbing; matches sonner /
react-hot-toast / sonner-native conventions.

Backed by:

- A singleton emitter / store (Zustand or a tiny custom emitter —
  decide at scaffold).
- A `<Toaster />` component mounted once at the app root that
  subscribes to the store and renders the visible queue.

No `useToast` hook in v1. Add later if a consumer needs
context-bound dispatching (e.g. a theme-scoped toast for a sandboxed
preview).

## Accessibility

- **`role="status"`** on each toast container.
- **`aria-live="polite"`** for success / info — announced when the
  AT is idle, doesn't interrupt the user's reading position.
- **`aria-live="assertive"`** for error — announced immediately.
- **Dismiss × button** — `aria-label="Dismiss"`, focusable, 44px
  touch floor.
- **Focus management** — toasts are not keyboard-focused on mount
  (would steal focus from the user's current task). The × is
  focusable via Tab once the user reaches the toast region.

## Cross-platform animation

Same web/native split as Sheet / Popover / Skeleton:

- **Native** — reanimated layout-animations: `SlideInUp.duration(250)`
  / `SlideOutUp.duration(200)` for entry / exit. Stack-reflow on
  neighbor mutation uses `Layout.duration(200)` (reanimated's
  automatic-layout transition).
- **Web** — CSS keyframes equivalent to the reanimated values.
  Adds a `slide-in-from-top` keyframe to
  [`tailwind.config.js`](../../../tailwind.config.js) alongside the
  existing `slide-in-from-bottom` / `slide-in-from-right` /
  `fade-in` entries.
- Platform dispatch via the `NativeOnlyAnimatedView` wrapper, same
  shape as Sheet uses today.

## Z-index

Toaster portal renders at **z-100**, above Sheet (z-50), Popover
(z-50), and AlertDialog. The z-index strata are reserved as
structural slots in
[`tokens.md → Structural slot families`](../foundations/tokens.md#structural-slot-families)
and refine concrete values per primitive as they ship.

## Storybook

`Primitives/Toast` with stories: severity matrix (success / error /
info), single-line / multi-line, queue 3-stack, swipe-dismiss
(native-only verification), ThemeMatrix per-theme severity
contrast.
