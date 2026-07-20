import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { fn } from 'storybook/test'

import { EMBEDDER_CATALOG } from '@/lib/embedder'
import { hydrateAppSettings } from '@/lib/stores'

import { EmbedderDefaultCard } from './embedder-default-card'

const [LOCAL_ENTRY] = EMBEDDER_CATALOG.models

type RawConfig = {
  providers?: unknown[]
  embeddingModelId?: string | null
  embeddingProviderId?: string | null
  defaultStorySettings?: Record<string, unknown>
}

const seed = (config: RawConfig) => async () => {
  await hydrateAppSettings(async () => ({
    providers: [],
    profiles: [],
    assignments: {},
    defaultProviderId: null,
    embeddingModelId: null,
    embeddingProviderId: null,
    defaultStorySettings: {},
    diagnostics: { enabled: false, debug_level_enabled: false },
    ...config,
  }))
}

const PROVIDER_WITH_EMBEDDING_MODELS = {
  id: 'prov-openai-compat',
  type: 'openai-compatible',
  displayName: 'Local llama.cpp',
  apiKey: 'sk-test',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
  cachedModels: [
    { id: 'text-embedding-3-small', capabilities: { embedding: true } },
    { id: 'text-embedding-3-large', capabilities: { embedding: true } },
    { id: 'gpt-4o-mini', capabilities: { reasoning: true } },
  ],
}

const noneInstalled = () => Promise.resolve([])
const localInstalled = () =>
  Promise.resolve([{ id: LOCAL_ENTRY.id, sizeBytes: LOCAL_ENTRY.size_bytes }])

const meta: Meta<typeof EmbedderDefaultCard> = {
  title: 'Compounds/EmbedderDefaultCard',
  component: EmbedderDefaultCard,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View style={{ width: 480 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EmbedderDefaultCard>

export const LocalWithInstalled: Story = {
  args: { listInstalled: localInstalled, onManage: fn() },
  beforeEach: seed({
    embeddingModelId: LOCAL_ENTRY.id,
    defaultStorySettings: { embeddingBackend: 'local' },
  }),
}

export const LocalEmpty: Story = {
  args: { listInstalled: noneInstalled, onManage: fn() },
  beforeEach: seed({ defaultStorySettings: { embeddingBackend: 'local' } }),
}

export const ProviderCapabilityFiltered: Story = {
  args: { listInstalled: noneInstalled, onManage: fn() },
  beforeEach: seed({
    providers: [PROVIDER_WITH_EMBEDDING_MODELS],
    embeddingProviderId: PROVIDER_WITH_EMBEDDING_MODELS.id,
    embeddingModelId: 'text-embedding-3-small',
    defaultStorySettings: { embeddingBackend: 'provider' },
  }),
}

export const ProviderFreeTextFallback: Story = {
  args: { listInstalled: noneInstalled, onManage: fn() },
  beforeEach: seed({
    providers: [PROVIDER_WITH_EMBEDDING_MODELS],
    embeddingProviderId: PROVIDER_WITH_EMBEDDING_MODELS.id,
    embeddingModelId: 'text-embedding-3-custom-finetune',
    defaultStorySettings: { embeddingBackend: 'provider' },
  }),
}

export const ProviderEmpty: Story = {
  args: { listInstalled: noneInstalled, onManage: fn() },
  beforeEach: seed({ defaultStorySettings: { embeddingBackend: 'provider' } }),
}
