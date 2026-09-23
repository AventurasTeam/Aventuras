import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { ProviderModelPicker, type ModelRef, type ProviderSource } from './provider-model-picker'
import { Text } from '../ui/text'

const ANTHROPIC: ProviderSource = {
  id: 'anthropic',
  name: 'Anthropic',
  models: [
    { id: 'claude-opus-4-7', capabilities: { reasoning: true, structured: true } },
    { id: 'claude-sonnet-4-7', capabilities: { reasoning: true, structured: true } },
    { id: 'claude-sonnet-4-6', capabilities: { reasoning: true, structured: true } },
    { id: 'claude-haiku-4-5', capabilities: { reasoning: true } },
  ],
}

const OPENAI: ProviderSource = {
  id: 'openai',
  name: 'OpenAI',
  models: [
    { id: 'gpt-5', capabilities: { reasoning: true, structured: true } },
    { id: 'gpt-5-mini', capabilities: { structured: true } },
    { id: 'gpt-4o-mini', capabilities: { structured: true } },
  ],
}

const OPENROUTER: ProviderSource = {
  id: 'openrouter',
  name: 'OpenRouter',
  models: [
    { id: 'anthropic/claude-sonnet-4-7' },
    { id: 'openai/gpt-5' },
    { id: 'meta/llama-3.1-70b' },
  ],
}

// Stress-tests trigger + popover row truncation behavior. The long namespaced
// ids match real OpenRouter / Vertex catalog entries; the substrate must keep
// them on one line and never spawn horizontal scroll inside the popover.
const LONG_NAMES_PROVIDER: ProviderSource = {
  id: 'longnames',
  name: 'Long-Name Provider',
  models: [
    {
      id: 'anthropic/claude-3-5-sonnet-20241022-with-very-long-name',
      capabilities: { reasoning: true, structured: true },
    },
    {
      id: 'meta-llama/llama-3.1-405b-instruct-turbo',
      capabilities: { structured: true },
    },
    { id: 'gpt-4-turbo-2024-04-09-preview-extended-context' },
  ],
}

const ALL_PROVIDERS = [ANTHROPIC, OPENAI, OPENROUTER]

const meta: Meta<typeof ProviderModelPicker> = {
  title: 'Compounds/ProviderModelPicker',
  component: ProviderModelPicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-80" style={{ minHeight: 480 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ProviderModelPicker>

type DemoProps = {
  providers?: ProviderSource[]
  initialValue?: ModelRef | null
  initialFavorites?: ModelRef[]
}

function DemoPicker({
  providers = ALL_PROVIDERS,
  initialValue = { providerId: 'anthropic', modelId: 'claude-sonnet-4-7' },
  initialFavorites = [
    { providerId: 'anthropic', modelId: 'claude-sonnet-4-7' },
    { providerId: 'openai', modelId: 'gpt-5' },
  ],
}: DemoProps) {
  const [value, setValue] = useState<ModelRef | null>(initialValue)
  const [favorites, setFavorites] = useState<ModelRef[]>(initialFavorites)
  const [extraModels, setExtraModels] = useState<Record<string, string[]>>({})

  const effectiveProviders: ProviderSource[] = providers.map((p) => {
    const extras = extraModels[p.id] ?? []
    if (extras.length === 0) return p
    return {
      ...p,
      models: [...p.models, ...extras.map((id) => ({ id }))],
    }
  })

  const toggleFavorite = (ref: ModelRef) => {
    setFavorites((prev) => {
      const has = prev.some((f) => f.providerId === ref.providerId && f.modelId === ref.modelId)
      return has
        ? prev.filter((f) => !(f.providerId === ref.providerId && f.modelId === ref.modelId))
        : [...prev, ref]
    })
  }

  const addCustom = (ref: ModelRef) => {
    setExtraModels((prev) => ({
      ...prev,
      [ref.providerId]: [...(prev[ref.providerId] ?? []), ref.modelId],
    }))
    setValue(ref)
  }

  return (
    <View className="flex-col gap-3">
      <ProviderModelPicker
        value={value}
        onChange={setValue}
        providers={effectiveProviders}
        favorites={favorites}
        onFavoriteToggle={toggleFavorite}
        onAddCustom={addCustom}
      />
      <Text size="xs" variant="muted">
        value: {value ? `${value.providerId} / ${value.modelId}` : 'null'}
      </Text>
      <Text size="xs" variant="muted">
        favorites: {favorites.length}
      </Text>
    </View>
  )
}

export const Default: Story = { render: () => <DemoPicker /> }

export const SingleProvider: Story = {
  render: () => <DemoPicker providers={[ANTHROPIC]} initialFavorites={[]} />,
}

export const NoProviders: Story = {
  render: () => <DemoPicker providers={[]} initialValue={null} initialFavorites={[]} />,
}

export const NoFavorites: Story = {
  render: () => <DemoPicker initialFavorites={[]} />,
}

export const BrokenTriggerProviderMissing: Story = {
  render: () => (
    <DemoPicker
      providers={[ANTHROPIC, OPENAI]}
      initialValue={{ providerId: 'deleted-provider', modelId: 'gpt-4' }}
      initialFavorites={[]}
    />
  ),
}

export const BrokenTriggerModelNotInCatalog: Story = {
  render: () => (
    <DemoPicker
      initialValue={{ providerId: 'anthropic', modelId: 'claude-removed-model' }}
      initialFavorites={[]}
    />
  ),
}

export const BrokenFavorite: Story = {
  render: () => (
    <DemoPicker
      initialFavorites={[
        { providerId: 'anthropic', modelId: 'claude-sonnet-4-7' },
        { providerId: 'anthropic', modelId: 'claude-deprecated-model' },
      ]}
    />
  ),
}

// Stresses the inline composer's `Under:` panel scroll cap. With 10+
// providers the panel hits its 180px max-height and the inner ScrollView
// becomes the scroll surface — verify by opening the picker, tapping
// `+ Add custom model…`, then tapping `Under:` and confirming the panel
// doesn't push Cancel/Add off-screen.
const MANY_PROVIDERS: ProviderSource[] = Array.from({ length: 12 }, (_, i) => ({
  id: `provider-${i + 1}`,
  name: `Provider ${i + 1} ${['Anthropic', 'OpenAI', 'OpenRouter', 'Mistral', 'Cohere', 'Google'][i % 6]}`,
  models: [{ id: `model-${i + 1}-default` }, { id: `model-${i + 1}-mini` }],
}))

export const ManyProvidersComposer: Story = {
  render: () => (
    <DemoPicker
      providers={MANY_PROVIDERS}
      initialValue={{ providerId: 'provider-1', modelId: 'model-1-default' }}
      initialFavorites={[]}
    />
  ),
}

export const LongModelNames: Story = {
  render: () => (
    <DemoPicker
      providers={[LONG_NAMES_PROVIDER, ANTHROPIC]}
      initialValue={{
        providerId: 'longnames',
        modelId: 'anthropic/claude-3-5-sonnet-20241022-with-very-long-name',
      }}
      initialFavorites={[
        {
          providerId: 'longnames',
          modelId: 'anthropic/claude-3-5-sonnet-20241022-with-very-long-name',
        },
      ]}
    />
  ),
}

// Zero-padded so the ids sort and match unambiguously.
const BULK_PROVIDER: ProviderSource = {
  id: 'bulk',
  name: 'Bulk Provider',
  models: Array.from({ length: 60 }, (_, i) => ({ id: `model-${String(i).padStart(2, '0')}` })),
}
const BULK_SELECTED: ModelRef = { providerId: 'bulk', modelId: 'model-50' }

// The selection is also a favorite, so it has a twin in the strip at the top; the
// picker must anchor the provider-section row, the one far down the list.
export const OpensScrolledToSelection: Story = {
  render: () => (
    <DemoPicker
      providers={[ANTHROPIC, BULK_PROVIDER]}
      initialValue={BULK_SELECTED}
      initialFavorites={[BULK_SELECTED]}
    />
  ),
  play: async () => {
    await userEvent.click(
      screen.getByRole('button', {
        name: t('modelPicker.selectedModel', { modelId: BULK_SELECTED.modelId }),
      }),
    )
    await waitFor(
      async () => {
        const listbox = screen.getByRole('listbox')
        const row = screen
          .getAllByRole('option', { name: /model-50/ })
          .find((el) => el.id.endsWith('-provider-bulk-model-50'))
        await expect(row).toBeDefined()
        const box = listbox.getBoundingClientRect()
        const rect = row!.getBoundingClientRect()
        const center = (rect.top + rect.bottom) / 2
        await expect(center).toBeGreaterThan(box.top + box.height / 3)
        await expect(center).toBeLessThan(box.top + (2 * box.height) / 3)
      },
      { timeout: 5000 },
    )
  },
}

export const Disabled: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <ProviderModelPicker
        value={{ providerId: 'anthropic', modelId: 'claude-sonnet-4-7' }}
        onChange={() => undefined}
        providers={ALL_PROVIDERS}
        favorites={[]}
        onFavoriteToggle={() => undefined}
        onAddCustom={() => undefined}
        disabled
        disabledReason="Generation in progress — fields lock until complete"
      />
    </View>
  ),
}

// No ThemeMatrix — picker portals through Popover / Sheet, escaping per-row theme scope.
