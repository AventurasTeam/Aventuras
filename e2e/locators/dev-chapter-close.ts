import type { Locator, Page } from '@playwright/test'

// The dev route app/dev/chapter-close.tsx. Dev routes keep raw English labels with no i18n key
// behind them, so these names are the route's literals; the result has no role (Tier 3 testID).
export const devChapterClose = {
  // Exact: `Close at #6` must not match `Close at #63`.
  closeAt: (page: Page, position: number): Locator =>
    page.getByRole('button', { name: `Close at #${position}`, exact: true }),
  result: (page: Page): Locator => page.getByTestId('dev-close-result'),
  // expo-router's Link hands its child `role: 'link'`, asChild or not.
  openPlot: (page: Page): Locator => page.getByRole('link', { name: 'Open Plot', exact: true }),
  openReader: (page: Page): Locator => page.getByRole('link', { name: 'Open reader', exact: true }),
}
