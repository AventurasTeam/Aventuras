import type { Locator, Page } from '@playwright/test'

// Toasts (components/ui/toast.tsx) render as role="status" live regions, one per message.
export const toast = {
  withText: (page: Page, message: string | RegExp): Locator =>
    page.getByRole('status').filter({ hasText: message }),
  // A toast's single action, beside its Dismiss.
  action: (page: Page, message: string | RegExp, label: string): Locator =>
    toast.withText(page, message).getByRole('button', { name: label, exact: true }),
}
