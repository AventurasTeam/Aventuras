import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { SwapDialog, type SwapCandidate } from './swap-dialog'

const candidates: SwapCandidate[] = [
  { id: 'minilm-l6', label: 'MiniLM-L6 (lightweight)', isCurrent: true },
  { id: 'bge-small', label: 'BGE-small-en-v1.5', isCurrent: false },
  { id: 'embedding-gemma', label: 'EmbeddingGemma', isCurrent: false },
]

const handlers = {
  onReindex: fn(),
  onKeep: fn(),
  onRelabel: fn(),
  onDismiss: fn(),
}

// No `tags: ['autodocs']` — every story sets `open: true` to show the
// modal state directly, so autodocs would render overlapping modals on
// the docs page. Same rationale as embedder-download-dialog.stories.tsx.
const meta: Meta<typeof SwapDialog> = {
  title: 'Compounds/Embedder/SwapDialog',
  component: SwapDialog,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof meta>

export const PickPane: Story = {
  args: { open: true, candidates, ...handlers },
}

export const CurrentCandidateUnselectable: Story = {
  args: { open: true, candidates, ...handlers },
  play: async () => {
    const current = screen.getByTestId('swap-candidate-minilm-l6')
    expect(current).toHaveAttribute('aria-disabled', 'true')

    // The row is `pointer-events: none`, so userEvent's actionability
    // check refuses the click outright — that's the disabled gate working.
    await expect(userEvent.click(current)).rejects.toThrow(/pointer-events/)
    expect(screen.getByRole('button', { name: t('storySettings:swap.next') })).toBeDisabled()
  },
}

export const OptionsPane: Story = {
  args: { open: true, candidates, ...handlers },
  play: async () => {
    await userEvent.click(screen.getByTestId('swap-candidate-bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())
    expect(screen.getByText('Switch to BGE-small-en-v1.5')).toBeInTheDocument()
  },
}

export const ReindexFires: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('swap-candidate-bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await userEvent.click(await screen.findByTestId('swap-reindex'))
    await waitFor(() => expect(args.onReindex).toHaveBeenCalledWith('bge-small'))
  },
}

export const KeepFires: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('swap-candidate-bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await userEvent.click(await screen.findByTestId('swap-keep'))
    await waitFor(() => expect(args.onKeep).toHaveBeenCalledTimes(1))
  },
}

export const RelabelShowsDisclaimer: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('swap-candidate-embedding-gemma'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    expect(screen.getByText(t('storySettings:swap.relabelDisclaimer'))).toBeInTheDocument()
    await userEvent.click(await screen.findByTestId('swap-relabel'))
    await waitFor(() => expect(args.onRelabel).toHaveBeenCalledWith('embedding-gemma'))
  },
}

export const BackReturnsToPickPane: Story = {
  args: { open: true, candidates, ...handlers },
  play: async () => {
    await userEvent.click(screen.getByTestId('swap-candidate-bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.back') }))
    await waitFor(() => expect(screen.getByTestId('swap-candidate-bge-small')).toBeInTheDocument())
  },
}

export const CancelFromPickPane: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.cancel') }))
    await waitFor(() => expect(args.onDismiss).toHaveBeenCalledTimes(1))
  },
}
