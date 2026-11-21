import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { t } from '@/lib/i18n'

import { ChapterProgressLine } from './chapter-progress-line'

const COUNTS = '9,100 / 10,000 tok'

const meta: Meta<typeof ChapterProgressLine> = {
  title: 'Compounds/ChapterProgressLine',
  component: ChapterProgressLine,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View style={{ width: 200 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ChapterProgressLine>

/** `Ready to close` sits inside the counts' paragraph, so Android wraps the two as one. */
export const Ready: Story = {
  args: { counts: COUNTS, ready: true },
  play: async () => {
    const label = await screen.findByText(t('chapters:readyToClose'))
    // RN-Web renders a Text nested in another as a span; a sibling paragraph would be a div.
    expect(label.tagName).toBe('SPAN')
    expect(label.parentElement?.textContent).toBe(`${COUNTS} · ${t('chapters:readyToClose')}`)
  },
}

export const NotReady: Story = {
  args: { counts: COUNTS, ready: false },
  play: async () => {
    await screen.findByText(COUNTS)
    expect(screen.queryByText(t('chapters:readyToClose'))).toBeNull()
  },
}
