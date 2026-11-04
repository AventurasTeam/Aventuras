import { expect, userEvent, waitFor } from 'storybook/test'

/** Tabs to `element` and checks keyboard focus draws the inset 2 px --focus-ring, not the browser's outline. */
export async function expectInsetFocusRing(element: HTMLElement): Promise<void> {
  await userEvent.tab()
  await waitFor(() => expect(element).toHaveFocus())
  const style = getComputedStyle(element)
  // Tailwind's outline-none is a transparent outline, kept for forced-colors mode.
  expect(style.outlineStyle === 'none' || style.outlineColor === 'rgba(0, 0, 0, 0)').toBe(true)
  const swatch = document.createElement('div')
  swatch.style.color = style.getPropertyValue('--focus-ring').trim()
  document.body.append(swatch)
  const ring = getComputedStyle(swatch).color
  swatch.remove()
  expect(style.boxShadow).toContain(`${ring} 0px 0px 0px 2px inset`)
}
