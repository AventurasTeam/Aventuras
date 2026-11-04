import { expect } from 'storybook/test'

/** Checks text selected in `element` takes the theme's --selection-bg under --fg-primary, not the browser's highlight. */
export function expectThemeSelection(element: Element): void {
  const style = getComputedStyle(element)
  const swatch = document.createElement('div')
  swatch.style.backgroundColor = style.getPropertyValue('--selection-bg').trim()
  swatch.style.color = style.getPropertyValue('--fg-primary').trim()
  document.body.append(swatch)
  const theme = {
    background: getComputedStyle(swatch).backgroundColor,
    text: getComputedStyle(swatch).color,
  }
  swatch.remove()
  expect(theme.background).not.toBe('rgba(0, 0, 0, 0)')
  const selection = getComputedStyle(element, '::selection')
  expect({ background: selection.backgroundColor, text: selection.color }).toEqual(theme)
}
