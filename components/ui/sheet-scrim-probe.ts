import { expect, userEvent, waitFor } from 'storybook/test'

// Play helpers for an open bottom Sheet's scrim. Stories import this; app code never does.

// CI runs plays several times slower than local.
const SCRIM_WAIT = { timeout: 3000 }

// Below the lightest scrim (0.4), above the opening animation's first frames.
const SCRIM_SETTLED = 0.39

/** Longer than a dismissible sheet takes to close, so a close that was coming has landed. */
export const SHEET_NO_CLOSE_MS = 2000

export type SheetScrimHit = { scrim: HTMLElement; coords: { clientX: number; clientY: number } }

/**
 * Hit-tests the centre of `landmark` (canvas above an open bottom Sheet) as a real tap lands;
 * resolves once the scrim, not the canvas, is topmost there and has faded in.
 */
export async function findSheetScrim(landmark: HTMLElement): Promise<SheetScrimHit> {
  const box = landmark.getBoundingClientRect()
  const coords = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
  const scrim = await waitFor(() => {
    const hit = document.elementFromPoint(coords.clientX, coords.clientY)
    expect(hit).toBeInstanceOf(HTMLElement)
    expect(landmark.contains(hit)).toBe(false)
    // A press before the sheet finishes opening reaches a sheet that can't close yet.
    expect(Number(getComputedStyle(hit as HTMLElement).opacity)).toBeGreaterThanOrEqual(
      SCRIM_SETTLED,
    )
    return hit as HTMLElement
  }, SCRIM_WAIT)
  return { scrim, coords }
}

/** A tap outside the sheet: presses the scrim where it covers `landmark`. */
export async function pressSheetScrim(landmark: HTMLElement): Promise<void> {
  const { scrim, coords } = await findSheetScrim(landmark)
  await userEvent.pointer([{ keys: '[MouseLeft]', target: scrim, coords }])
}
