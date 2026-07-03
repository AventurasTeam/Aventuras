import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { ConcurrentStatePrompt } from './wizard-session-seam'

const handlers = {
  open: true,
  onContinueSession: fn(),
  onDiscard: fn(),
  onDismiss: fn(),
}

const meta: Meta<typeof ConcurrentStatePrompt> = {
  title: 'Story/ConcurrentStatePrompt',
  component: ConcurrentStatePrompt,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof ConcurrentStatePrompt>

export const NewStory: StoryT = {
  args: { trigger: 'new-story', ...handlers },
}

export const Draft: StoryT = {
  args: { trigger: 'draft', draftName: "Aria's Descent", ...handlers },
}

export const DraftUntitled: StoryT = {
  args: { trigger: 'draft', ...handlers },
}

export const ContinueCallsHandler: StoryT = {
  args: { trigger: 'new-story', ...handlers },
  play: async ({ args }) => {
    const button = screen.getByRole('button', {
      name: t('landing:concurrentSession.newStory.continue'),
    })
    await userEvent.click(button)
    await waitFor(() => expect(args.onContinueSession).toHaveBeenCalledTimes(1))
  },
}

export const DiscardCallsHandler: StoryT = {
  args: { trigger: 'draft', draftName: 'Tea House Diaries', ...handlers },
  play: async ({ args }) => {
    const button = screen.getByRole('button', {
      name: t('landing:concurrentSession.draft.discard', { draftName: 'Tea House Diaries' }),
    })
    await userEvent.click(button)
    await waitFor(() => expect(args.onDiscard).toHaveBeenCalledTimes(1))
  },
}
