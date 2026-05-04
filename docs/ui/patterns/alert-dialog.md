# AlertDialog pattern

Blocking, modal-shaped consent gate. Used for rollback confirms,
delete confirms, calendar swap-warnings, and any "are you sure?"
gate that must interrupt the user's flow.

Distinct from Sheet ([`overlays.md → Sheet`](./overlays.md#sheet--api-surface)):
Sheet is a navigation surface (dismissible, slidable); AlertDialog
is a consent gate (centered, ceremonial, Esc / click-outside
cancels). Use AlertDialog when the user must explicitly choose to
proceed, not when they're just opening a side surface.

Used by:

- [Rollback confirm](../screens/reader-composer/rollback-confirm/rollback-confirm.md) — `Delete from entry <N>?` with bulleted impact list. Destructive CTA.
- [Calendar swap-warning](./calendar-picker.md#combined-modal-shape) — `Switch calendar to <name>?` with three optional structured sub-warning blocks (W1 / W2 / W3). Default CTA.
- Branch delete, entity delete, and other "are you sure?" gates across the app.

## Modal-on-every-tier

AlertDialog renders as a centered modal at every tier — phone gets the modal with margin gutters (`max-w-[calc(100%-2rem)]`), desktop gets the 512px-capped centered shape (`sm:max-w-lg`). No Sheet swap on phone.

Reasoning: AlertDialog's semantics (blocking, ceremonial, Esc cancels, bounded content) read as modal at every tier. Sheet would communicate the wrong affordance — "dismissible action surface" instead of "make a choice to proceed." The layout.md surface-binding rule that routes popover-style menus to Sheet on phone doesn't apply; AlertDialog isn't a menu.

## Rich content via composition

`AlertDialogContent` is a flex column (`gap-4`) accepting arbitrary children between `<AlertDialogHeader>` and `<AlertDialogFooter>`. Rich content drops in directly:

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
        <Button variant="secondary">Cancel</Button>
      </AlertDialogCancel>
      <AlertDialogAction asChild>
        <Button variant="destructive">Delete entries</Button>
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Calendar swap-warning's W1 / W2 / W3 sub-warning blocks compose the same way — three child blocks between header and footer, each rendered with surface-specific layout. The primitive imposes no shape on content beyond the gap.

**Width.** `max-w-lg` (512px) accommodates both v1 consumers (rollback ~440px, calendar ~480px). Single max-width.

**Scroll on overflow.** Not handled in v1. Both v1 consumers have bounded content. If a future site needs unbounded content, see
[`parked.md → AlertDialog scroll-on-overflow`](../../parked.md#alertdialog-scroll-on-overflow).

## Destructive CTA via Button composition

The destructive variant lives on Button, not AlertDialog. Use the radix `asChild` pattern to swap a Button into the action slot:

```tsx
<AlertDialogAction asChild>
  <Button variant="destructive">Delete entries</Button>
</AlertDialogAction>
```

Default (non-destructive) actions use the same pattern with `variant="primary"` (Button's default). `AlertDialogCancel` defaults to `secondary` (the project's bordered/neutral variant — equivalent to the baseline's `outline`); consumers override via the same asChild pattern when needed.

No `tone` / `severity` prop on AlertDialog itself — the variant axis would duplicate Button's, and the asChild composition is idiomatic across rn-primitives.

## Copy contract

- **Title ends with `?`** — consent-gate signal. `Delete from entry <N>?`, `Switch calendar to <name>?`.
- **Body** — one-sentence framing + optional impact list (bulleted) or structured sub-warning blocks.
- **Buttons** — `Cancel` (left, `secondary` Button variant) + verb-shaped action (right, `destructive` or `primary`). Verbs: `Delete entries`, `Switch calendar`, `Delete branch`. Avoid generic `OK` / `Confirm`.
- **Esc + click-outside = Cancel.** Radix default. Don't override.

## Animation

- **Native** — reanimated `FadeIn.duration(200).delay(50)` / `FadeOut.duration(150)` on the overlay. Already wired in the baseline.
- **Web** — fade-in via the existing `animate-fade-in` keyframe ([`tailwind.config.js`](../../../tailwind.config.js); shared with Sheet / Popover / Select dropdown). No zoom — fade-only.

## Storybook

`Primitives/AlertDialog` — basic two-button, destructive (rollback shape with impact list), structured sub-warnings (calendar swap-warning shape), long-content informational, ThemeMatrix.
