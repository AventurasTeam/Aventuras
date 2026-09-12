import type { Locator, Page } from '@playwright/test'

// Toasts (components/ui/toast.tsx) render as role="status" live regions, one per message.
export const toast = {
  withText: (page: Page, message: string): Locator =>
    page.getByRole('status').filter({ hasText: message }),
}
