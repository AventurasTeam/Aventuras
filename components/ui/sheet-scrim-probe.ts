import { expect, userEvent, waitFor } from 'storybook/test'

// Play helpers for an open bottom Sheet's scrim. Stories import this; app code never does.

// CI runs plays several times slower than local.
const SCRIM_WAIT = { timeout: 3000 }

// Below the lightest scrim (0.4), above the opening animation's first frames.
const SCRIM_SETTLED = 0.39

/** Longer than a dismissible sheet takes to close, so a close that was coming has landed. */
export const SHEET_NO_CLOSE_MS = 2000

// Every scrim is a black fill: gorhom's opaque and faded by opacity, Radix's translucent. A held
// sheet's refusal layer is a transparent child of gorhom's, so the hit is the scrim or that child.
const SCRIM_FILL = /^rgba?\(0, 0, 0(?:, ([\d.]+))?\)$/

/** How dark the scrim at `hit` paints (fill alpha times opacity), or null if `hit` isn't one. */
function scrimDarkness(hit: HTMLElement): number | null {
  for (const el of [hit, hit.parentElement]) {
    if (el == null) continue
    const style = getComputedStyle(el)
    const fill = SCRIM_FILL.exec(style.backgroundColor)
    const alpha = fill == null ? 0 : Number(fill[1] ?? 1)
    if (alpha > 0) return alpha * Number(style.opacity)
  }
  return null
}

/** `scrim` is the topmost element there, which a press targets: the scrim or its refusal layer. */
export type SheetScrimHit = { scrim: HTMLElement; coords: { clientX: number; clientY: number } }

/**
 * Hit-tests the centre of `landmark` (canvas above an open bottom Sheet) as a real tap lands;
 * resolves once the scrim is topmost there and has faded in. Not merely "not the canvas": a
 * sheet springing past its detent can put its drag handle over the landmark.
 */
export async function findSheetScrim(landmark: HTMLElement): Promise<SheetScrimHit> {
  const box = landmark.getBoundingClientRect()
  const coords = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
  const scrim = await waitFor(() => {
    const hit = document.elementFromPoint(coords.clientX, coords.clientY)
    expect(hit).toBeInstanceOf(HTMLElement)
    // A press before the sheet finishes opening reaches a sheet that can't close yet.
    expect(scrimDarkness(hit as HTMLElement)).toBeGreaterThanOrEqual(SCRIM_SETTLED)
    return hit as HTMLElement
  }, SCRIM_WAIT)
  return { scrim, coords }
}

/** A tap outside the sheet: presses the scrim where it covers `landmark`. */
export async function pressSheetScrim(landmark: HTMLElement): Promise<void> {
  const { scrim, coords } = await findSheetScrim(landmark)
  await userEvent.pointer([{ keys: '[MouseLeft]', target: scrim, coords }])
}

/** Asserts a real tap at the centre of `el` lands on it: stacked over a Sheet, not mounted under. */
export function expectTopmost(el: HTMLElement): void {
  const box = el.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  expect(el.contains(hit)).toBe(true)
}

/** The black fill a Radix modal's scrim paints (Dialog, AlertDialog, right Sheet), or null. */
export function modalScrimColor(): string | null {
  for (const el of Array.from(document.body.querySelectorAll('div'))) {
    const color = getComputedStyle(el).backgroundColor
    if (/^rgba\(0, 0, 0, 0\.\d+\)$/.test(color)) return color
  }
  return null
}
