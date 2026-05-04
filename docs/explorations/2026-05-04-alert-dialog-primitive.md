# AlertDialog primitive

Design record for the AlertDialog primitive — blocking,
modal-shaped consent gate. Used for rollback confirms, delete
confirms, and calendar swap-warnings.

Context: [`component-inventory.md → Primitives — needs design`](../ui/component-inventory.md#primitives--needs-design).
Baseline scaffolded from `react-native-reusables`'s `alert-dialog`
component ([`components/ui/alert-dialog.tsx`](../../components/ui/alert-dialog.tsx)),
which wraps `@rn-primitives/alert-dialog` (radix-on-web, native
impl on RN).

## Scope is reshape

The baseline already covers structural concerns: rn-primitives
passthrough (Root / Trigger / Portal / Overlay / Content / Header /
Footer / Title / Description / Action / Cancel slots), iOS
FullWindowOverlay, focus management, ARIA, native fade-in via
reanimated `FadeIn.duration(200).delay(50)`. Four small reshape
decisions land:

1. Token reshape against project slots.
2. Modal-on-every-tier (not Sheet swap on phone).
3. Destructive CTA via Button composition (not a separate prop).
4. Web animation completion (drop `zoom-in-95`, fade-only).

## V1 consumers

Two documented call-sites with rich content:

- **[Rollback confirm](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md)** — `Delete from entry <N>?` modal with one-sentence framing + bulleted impact list (`N entries`, `N classifications`, `N world-state changes`). Destructive CTA: `Delete entries`.
- **[Calendar swap-warning](../ui/patterns/calendar-picker.md#combined-modal-shape)** — `Switch calendar to <name>?` modal with three optional sub-warning blocks (W1 origin-tuple mismatch, W2 era support mismatch, W3 display-format change), each with structured content (sample renders, before/after previews). Default CTA: `Switch calendar`.

Plus other delete confirms across the app (branch delete, entity delete) — same shape, simpler content.

## Modal-on-every-tier

The baseline's responsive contract (`max-w-[calc(100%-2rem)] sm:max-w-lg`) renders modal at every tier — phone gets the centered modal with margin gutters, desktop gets the 512px-capped centered modal.

Sheet swap on phone (the layout.md surface-binding default for popover-style menus) was considered and rejected. AlertDialog is a **consent gate**, not a navigation surface. Its semantics (blocking, ceremonial, Esc / click-outside cancels, bounded content) read as modal at every tier; the Sheet shape would communicate the wrong affordance ("dismissible action surface" rather than "make a choice to proceed"). Keep the centered modal.

## Rich content via composition

The baseline's `AlertDialogContent` is a flex column (`gap-4`) accepting arbitrary children between `<AlertDialogHeader>` and `<AlertDialogFooter>`. Rich content drops in directly:

```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>...</AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete from entry 47?</AlertDialogTitle>
      <AlertDialogDescription>Permanent — rolls back to entry 46.</AlertDialogDescription>
    </AlertDialogHeader>

    {/* Rollback's bulleted impact list */}
    <View className="gap-1">
      <Text size="sm">• 12 entries</Text>
      <Text size="sm">• 4 classifications</Text>
      <Text size="sm">• 23 world-state changes</Text>
    </View>

    <AlertDialogFooter>
      <AlertDialogCancel asChild>
        <Button variant="outline">Cancel</Button>
      </AlertDialogCancel>
      <AlertDialogAction asChild>
        <Button variant="destructive">Delete entries</Button>
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Calendar swap-warning's W1 / W2 / W3 sub-warning blocks compose the same way — three child blocks between header and footer, each rendered with surface-specific layout. The primitive imposes no shape on content beyond gap spacing.

**Width.** `max-w-lg` (512px) accommodates both rollback-confirm (~440px target) and calendar swap-warning (~480px target). Single max-width works for v1.

**Scroll on overflow.** Not handled in v1. Both v1 consumers have bounded content (handful of bullets / three warning blocks). If a future site needs unbounded content, scroll-on-overflow is a v1.1 followup.

## Destructive CTA via composition

The baseline `AlertDialogAction` and `AlertDialogCancel` already pass `className` through, and the radix `asChild` pattern lets consumers swap in `<Button>` directly:

```tsx
<AlertDialogAction asChild>
  <Button variant="destructive">Delete entries</Button>
</AlertDialogAction>
```

Button owns its variants (`default | destructive | outline | ghost`); AlertDialog stays pure dialog chrome. No `tone` / `severity` prop on AlertDialog itself — the variant axis would duplicate Button's, and the composition is already idiomatic across rn-primitives.

`AlertDialogCancel` defaults to outline variant in the baseline; consumers can override via the same asChild pattern when needed.

## Token reshape

Baseline → project slots:

- `bg-background` → `bg-bg-overlay`
- `border-border` → keep (project has same slot)
- `text-foreground` → `text-fg-primary`
- `text-muted-foreground` → `text-fg-muted`
- `bg-black/50` (overlay backdrop) → keep
- `shadow-lg shadow-black/5` → keep

Mechanical sweep applied during scaffolding.

## Web animation

Baseline references `animate-in fade-in-0 zoom-in-95` (Tailwind animate plugin classes that don't exist in this project). Same web-animation gap pattern as Sheet / Popover / Accordion before — except this time the existing `animate-fade-in` keyframe (added in the toast pass) covers the case.

**Drop zoom**, use plain `animate-fade-in` (200ms via `var(--easing-standard)`) on web. The zoom is a minor decoration; fade-in is what communicates "appearing." Stays consistent with Sheet / Popover / Select dropdown's web animation contract.

Native side already fires `FadeIn.duration(200).delay(50)` via reanimated; no change.

## Copy contract

Carried in the pattern doc, derived from rollback-confirm + calendar swap-warning precedents:

- **Title ends with `?`** — consent-gate signal. `Delete from entry <N>?`, `Switch calendar to <name>?`.
- **Body** — one-sentence framing + optional impact list (bulleted) or structured sub-warning blocks.
- **Buttons** — `Cancel` (left, outline) + verb-shaped action (right, destructive or default). Verbs: `Delete entries`, `Switch calendar`, `Delete branch`. Avoid generic `OK` / `Confirm`.
- **Esc + click-outside = Cancel.** Radix default. Don't override.

## Adversarial pass

- **Load-bearing — composition supports all v1 rich-content shapes.** Verified against rollback-confirm (bulleted impact list) and calendar swap-warning (three structured sub-blocks). Both fit `gap-4` flex column between Header and Footer slots.
- **Edge — content overflow on small viewport.** v1 use cases bounded; flagged as v1.1 followup if a future site has unbounded content.
- **Edge — destructive Button color cascades correctly.** Button's `variant="destructive"` sets text color; TextClassContext handles cascade through asChild. ✓
- **Edge — Esc / click-outside during pending action.** Radix's `onOpenChange` lets consumers gate; out of v1 scope unless rollback's pipeline-in-flight gating needs it (see [`reader-composer.md → Edit restrictions`](../ui/principles.md#edit-restrictions-during-in-flight-generation) — that gates the trigger, not the dialog itself, so unaffected).
- **Cascade — Sheet / AlertDialog z-index ordering.** Both currently z-50; if both open simultaneously, last-mounted wins. Not a documented v1 scenario; revisit if it becomes one.
- **Cascade — animation keyframe.** No new keyframe needed; existing `animate-fade-in` covers it. ✓

## Integration plan

### New canonical doc

- **`docs/ui/patterns/alert-dialog.md`** — primitive contract: modal-on-every-tier, rich-content composition, destructive-via-Button, copy contract.

### Updates to existing canonical docs

- **`docs/ui/component-inventory.md`** — move AlertDialog from Primitives — needs design to Primitives — build-ready, citing `patterns/alert-dialog.md`.
- **`docs/ui/patterns/README.md`** — add `alert-dialog.md` to the index.
- **`docs/ui/patterns/calendar-picker.md`** — anchor "Combined modal shape" reference to the new alert-dialog.md.
- **`docs/ui/screens/reader-composer/rollback-confirm/rollback-confirm.md`** — anchor "Confirmation modal — post-click" reference to alert-dialog.md.

### Followups

- **AlertDialog scroll-on-overflow** — parked-until-signal. v1 consumers fit; revisit when a use case has unbounded content.

### Wireframes

No screen-level wireframe affected — wireframes already render the right shape.

### Storybook story shape

`Patterns/AlertDialog` — basic two-button, destructive variant (rollback shape with impact list), structured sub-warnings (calendar swap-warning shape), long-content (informational), ThemeMatrix.
