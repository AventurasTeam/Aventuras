import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { embeddingTargetKey } from '@/lib/db'
import { t } from '@/lib/i18n'

import { SwapDialog, type SwapCandidate, type SwapDialogProps } from './swap-dialog'

const LOCAL_SOURCE = t('storySettings:swap.sourceLocal')
const PROVIDER_SOURCE = 'OpenAI-compatible'

const candidates: SwapCandidate[] = [
  {
    target: { modelId: 'minilm-l6', backend: 'local' },
    label: 'MiniLM-L6 (lightweight)',
    sourceLabel: LOCAL_SOURCE,
    isCurrent: true,
  },
  {
    target: { modelId: 'bge-small', backend: 'local' },
    label: 'BGE-small-en-v1.5',
    sourceLabel: LOCAL_SOURCE,
    isCurrent: false,
  },
  {
    target: {
      modelId: 'text-embedding-3-small',
      backend: 'provider',
      providerId: 'prov-openai-compat',
    },
    label: 'text-embedding-3-small',
    sourceLabel: PROVIDER_SOURCE,
    isCurrent: false,
  },
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
    const current = screen.getByTestId('swap-candidate-local:minilm-l6')
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
    await userEvent.click(screen.getByTestId('swap-candidate-local:bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())
    expect(screen.getByText('Switch to BGE-small-en-v1.5')).toBeInTheDocument()
  },
}

export const ReindexFires: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('swap-candidate-local:bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await userEvent.click(await screen.findByTestId('swap-reindex'))
    await waitFor(() =>
      expect(args.onReindex).toHaveBeenCalledWith({ modelId: 'bge-small', backend: 'local' }),
    )
  },
}

export const KeepFires: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('swap-candidate-local:bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await userEvent.click(await screen.findByTestId('swap-keep'))
    await waitFor(() => expect(args.onKeep).toHaveBeenCalledTimes(1))
  },
}

export const RelabelShowsDisclaimer: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(
      screen.getByTestId('swap-candidate-provider:prov-openai-compat:text-embedding-3-small'),
    )
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    expect(screen.getByText(t('storySettings:swap.relabelDisclaimer'))).toBeInTheDocument()
    await userEvent.click(await screen.findByTestId('swap-relabel'))
    await waitFor(() =>
      expect(args.onRelabel).toHaveBeenCalledWith({
        modelId: 'text-embedding-3-small',
        backend: 'provider',
        providerId: 'prov-openai-compat',
      }),
    )
  },
}

export const BackReturnsToPickPane: Story = {
  args: { open: true, candidates, ...handlers },
  play: async () => {
    await userEvent.click(screen.getByTestId('swap-candidate-local:bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.back') }))
    await waitFor(() =>
      expect(screen.getByTestId('swap-candidate-local:bge-small')).toBeInTheDocument(),
    )
  },
}

export const CancelFromPickPane: Story = {
  args: { open: true, candidates, ...handlers },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.cancel') }))
    await waitFor(() => expect(args.onDismiss).toHaveBeenCalledTimes(1))
  },
}

// Owns `open` itself so the play function can close and reopen the real
// dialog instance — the reset-on-reopen effect only fires on a genuine
// closed→open transition, which a fixed `open: true` arg can't exercise.
function ReopenHarness(props: Omit<SwapDialogProps, 'open' | 'onDismiss'>) {
  const [open, setOpen] = useState(true)
  return (
    <View className="gap-3">
      <Button testID="reopen-trigger" onPress={() => setOpen(true)}>
        <Text>Reopen</Text>
      </Button>
      <SwapDialog {...props} open={open} onDismiss={() => setOpen(false)} />
    </View>
  )
}

export const ReopenResetsPickPane: Story = {
  render: () => (
    <ReopenHarness candidates={candidates} onReindex={fn()} onKeep={fn()} onRelabel={fn()} />
  ),
  play: async () => {
    await userEvent.click(screen.getByTestId('swap-candidate-local:bge-small'))
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.next') }))
    await waitFor(() => expect(screen.getByTestId('swap-reindex')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.cancel') }))
    await waitFor(() => expect(screen.queryByTestId('swap-reindex')).not.toBeInTheDocument())

    await userEvent.click(screen.getByTestId('reopen-trigger'))
    await waitFor(() =>
      expect(screen.getByTestId('swap-candidate-local:bge-small')).toBeInTheDocument(),
    )

    for (const candidate of candidates) {
      expect(
        screen.getByTestId(`swap-candidate-${embeddingTargetKey(candidate.target)}`),
      ).toHaveAttribute('aria-checked', 'false')
    }
    expect(screen.getByRole('button', { name: t('storySettings:swap.next') })).toBeDisabled()
  },
}
