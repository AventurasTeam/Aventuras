import { expect, userEvent, waitFor } from 'storybook/test'

/**
 * Checks `element` draws no ring until keyboard focus, then tabs to it: the ring is the inset 2 px
 * --focus-ring, not the browser's outline.
 */
export async function expectInsetFocusRing(element: HTMLElement): Promise<void> {
  const swatch = document.createElement('div')
  swatch.style.color = getComputedStyle(element).getPropertyValue('--focus-ring').trim()
  document.body.append(swatch)
  const ring = `${getComputedStyle(swatch).color} 0px 0px 0px 2px inset`
  swatch.remove()

  expect(element).not.toHaveFocus()
  expect(getComputedStyle(element).boxShadow).not.toContain(ring)

  await userEvent.tab()
  await waitFor(() => expect(element).toHaveFocus())
  const style = getComputedStyle(element)
  // Tailwind's outline-none is a transparent outline, kept for forced-colors mode.
  expect(style.outlineStyle === 'none' || style.outlineColor === 'rgba(0, 0, 0, 0)').toBe(true)
  expect(style.boxShadow).toContain(ring)
}
