import type { Locator, Page } from '@playwright/test'

import { copyPattern, t } from '../harness/i18n'

// Every card repeats the same controls, so its testID scopes them (testing.md → Tier 3); specs
// read chapter ids from the DB by title.
const CARD_HEADING = copyPattern('chapters:card.heading', { texts: ['number', 'title'] })

export const chapterTimeline = {
  header: (page: Page, closed: number): Locator =>
    page.getByText(t('chapters:timeline.header', { closed }), { exact: true }),
  card: (page: Page, chapterId: string): Locator => page.getByTestId(`chapter-card-${chapterId}`),
  // The disclosure head, named by its heading (`Chapter <N> — <title>`).
  cardHead: (page: Page, chapterId: string): Locator =>
    chapterTimeline.card(page, chapterId).getByRole('button', { name: CARD_HEADING }),
  field: (page: Page, chapterId: string, labelKey: 'title' | 'theme' | 'summary'): Locator =>
    chapterTimeline
      .card(page, chapterId)
      .getByRole('textbox', { name: t(`chapters:fields.${labelKey}`), exact: true }),
  // TagInput's inner text input carries the field label as its accessible name.
  keywordInput: (page: Page, chapterId: string): Locator =>
    chapterTimeline
      .card(page, chapterId)
      .getByRole('textbox', { name: t('chapters:fields.keywords'), exact: true }),
  jump: (page: Page, chapterId: string): Locator =>
    chapterTimeline
      .card(page, chapterId)
      .getByRole('button', { name: t('chapters:actions.jump'), exact: true }),
  // Inline at tablet and desktop, on a chapter whose close wrote a report.
  reviewChanges: (page: Page, chapterId: string): Locator =>
    chapterTimeline
      .card(page, chapterId)
      .getByRole('button', { name: t('chapters:actions.review'), exact: true }),
  inProgressCard: (page: Page): Locator => page.getByTestId('chapter-in-progress-card'),
}
