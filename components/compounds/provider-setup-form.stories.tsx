import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { hydrateAppSettings } from '@/lib/stores'

import { ProviderSetupForm } from './provider-setup-form'

type RawConfig = {
  providers?: unknown[]
  profiles?: unknown[]
  assignments?: Record<string, string>
  defaultProviderId?: string | null
}

const seed = (config: RawConfig) => async () => {
  await hydrateAppSettings(async () => ({
    providers: [],
    profiles: [],
    assignments: {},
    defaultProviderId: null,
    diagnostics: { enabled: false, debug_level_enabled: false },
    ...config,
  }))
}

const SAVED_PROVIDER = {
  id: 'interim-oai-compat',
  type: 'openai-compatible',
  displayName: 'Local llama.cpp',
  apiKey: 'sk-test',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

const CACHED_MODELS = [
  { id: 'llama-3.1-8b-instruct' },
  { id: 'qwen2.5-7b-instruct' },
  { id: 'mistral-7b-instruct' },
]

const meta: Meta<typeof ProviderSetupForm> = {
  title: 'Compounds/ProviderSetupForm',
  component: ProviderSetupForm,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-96" style={{ minHeight: 560 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ProviderSetupForm>

export const Empty: Story = {
  beforeEach: seed({}),
}

export const Populated: Story = {
  beforeEach: seed({ providers: [SAVED_PROVIDER] }),
}

export const CatalogFetched: Story = {
  beforeEach: seed({
    providers: [{ ...SAVED_PROVIDER, cachedModels: CACHED_MODELS, cachedAt: Date.now() }],
  }),
}

export const CustomModelId: Story = {
  beforeEach: seed({
    providers: [{ ...SAVED_PROVIDER, customModelIds: ['my-finetune-v3'] }],
  }),
}

export const QuickWired: Story = {
  beforeEach: seed({
    providers: [{ ...SAVED_PROVIDER, cachedModels: CACHED_MODELS }],
    profiles: [
      {
        id: 'narrative-profile',
        kind: 'narrative',
        name: 'Narrative',
        modelRef: { providerId: 'interim-oai-compat', modelId: 'llama-3.1-8b-instruct' },
      },
    ],
    defaultProviderId: 'interim-oai-compat',
  }),
}
