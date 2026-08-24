import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EMBEDDER_CATALOG } from '@/lib/embedder'

import { EmbeddingModelsPanel } from './embedding-models-panel'

const [LIGHTWEIGHT, MULTILINGUAL] = EMBEDDER_CATALOG.models

const noneInstalled = () => Promise.resolve([])
const oneInstalled = () =>
  Promise.resolve([{ id: LIGHTWEIGHT.id, sizeBytes: LIGHTWEIGHT.size_bytes }])
// createEmbedderDownloadDriver isn't exercised by these stories (no story
// drives the download dialog open) — a never-resolving stub keeps the type
// contract without pulling in the real desktop/native bridge.
const stubDriver = () => ({
  fetchModelCard: () => new Promise<never>(() => {}),
  resolveHfModel: () => new Promise<never>(() => {}),
  downloadFile: () => new Promise<never>(() => {}),
  computeSha256: () => new Promise<never>(() => {}),
  cancelDownload: () => Promise.resolve(),
  smokeTestEmbed: () => new Promise<never>(() => {}),
  persistInstall: () => new Promise<never>(() => {}),
  deletePartial: () => new Promise<never>(() => {}),
})

const meta: Meta<typeof EmbeddingModelsPanel> = {
  title: 'Compounds/EmbeddingModelsPanel',
  component: EmbeddingModelsPanel,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View style={{ width: 560 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EmbeddingModelsPanel>

export const AllUninstalled: Story = {
  args: {
    listInstalled: noneInstalled,
    createDriver: stubDriver,
  },
}

export const MixedInstalled: Story = {
  args: {
    listInstalled: oneInstalled,
    createDriver: stubDriver,
  },
}

export const TestSuccess: Story = {
  args: {
    listInstalled: oneInstalled,
    createDriver: stubDriver,
    runTest: () => Promise.resolve({ ok: true, dim: LIGHTWEIGHT.dim, ms: 42 }),
  },
  play: async () => {
    await userEvent.click(await screen.findByText(LIGHTWEIGHT.displayName))
    await userEvent.click(
      await screen.findByRole('button', { name: `Test ${LIGHTWEIGHT.displayName}` }),
    )
    await waitFor(() =>
      expect(screen.getByText(`OK · dim ${LIGHTWEIGHT.dim} · 42 ms`)).toBeTruthy(),
    )
  },
}

export const TestFailure: Story = {
  args: {
    listInstalled: oneInstalled,
    createDriver: stubDriver,
    runTest: () =>
      Promise.resolve({ ok: false, kind: 'init', message: 'ONNX runtime init failed' }),
  },
  play: async () => {
    await userEvent.click(await screen.findByText(LIGHTWEIGHT.displayName))
    await userEvent.click(
      await screen.findByRole('button', { name: `Test ${LIGHTWEIGHT.displayName}` }),
    )
    await waitFor(() => expect(screen.getByText('ONNX runtime init failed')).toBeTruthy())
  },
}

// Sanity check the second catalog entry (multilingual, larger, uninstalled)
// renders its tags/size correctly alongside the first.
export const BothEntries: Story = {
  args: {
    listInstalled: noneInstalled,
    createDriver: stubDriver,
  },
  play: async () => {
    await expect(screen.findByText(LIGHTWEIGHT.displayName)).resolves.toBeTruthy()
    await expect(screen.findByText(MULTILINGUAL.displayName)).resolves.toBeTruthy()
  },
}
