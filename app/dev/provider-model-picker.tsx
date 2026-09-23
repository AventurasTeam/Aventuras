import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import {
  ProviderModelPicker,
  type ModelRef,
  type ProviderSource,
} from '@/components/compounds/provider-model-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

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

export default function ProviderModelPickerDevRoute() {
  const [value, setValue] = useState<ModelRef | null>({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-7',
  })
  const [favorites, setFavorites] = useState<ModelRef[]>([
    { providerId: 'anthropic', modelId: 'claude-sonnet-4-7' },
    { providerId: 'openai', modelId: 'gpt-5' },
  ])
  const [extraModels, setExtraModels] = useState<Record<string, string[]>>({})

  const providers: ProviderSource[] = [ANTHROPIC, OPENAI, OPENROUTER].map((p) => {
    const extras = extraModels[p.id] ?? []
    if (extras.length === 0) return p
    return { ...p, models: [...p.models, ...extras.map((id) => ({ id }))] }
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
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Three providers, two favorites pinned, Anthropic sonnet selected. Type to filter (e.g.
            `sonnet`, `anth`, or capability keywords `reasoning` / `structured`). Tap + custom to
            add an entry under any provider.
          </Text>
          <View className="mt-3">
            <ProviderModelPicker
              value={value}
              onChange={setValue}
              providers={providers}
              favorites={favorites}
              onFavoriteToggle={toggleFavorite}
              onAddCustom={addCustom}
            />
          </View>
          <Text size="xs" variant="muted" className="mt-2">
            value: {value ? `${value.providerId} / ${value.modelId}` : 'null'}
          </Text>
          <Text size="xs" variant="muted">
            favorites: {favorites.map((f) => `${f.providerId}/${f.modelId}`).join(', ') || 'none'}
          </Text>
        </View>

        <View>
          <Heading level={3}>Broken — provider missing</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Value references a provider that no longer exists. Trigger renders the warning Tag.
          </Text>
          <View className="mt-3">
            <ProviderModelPicker
              value={{ providerId: 'deleted-provider', modelId: 'some-model' }}
              onChange={() => undefined}
              providers={[ANTHROPIC, OPENAI]}
              favorites={[]}
              onFavoriteToggle={() => undefined}
              onAddCustom={() => undefined}
            />
          </View>
        </View>

        <View>
          <Heading level={3}>Broken — model not in catalog</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Provider exists but the model id doesn&apos;t appear in its fetched list.
          </Text>
          <View className="mt-3">
            <ProviderModelPicker
              value={{ providerId: 'anthropic', modelId: 'claude-removed-model' }}
              onChange={() => undefined}
              providers={[ANTHROPIC]}
              favorites={[]}
              onFavoriteToggle={() => undefined}
              onAddCustom={() => undefined}
            />
          </View>
        </View>

        <View>
          <Heading level={3}>Disabled (with reason)</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Uniform edit-restriction treatment; web title-tooltip surfaces the reason on hover.
          </Text>
          <View className="mt-3">
            <ProviderModelPicker
              value={{ providerId: 'anthropic', modelId: 'claude-sonnet-4-7' }}
              onChange={() => undefined}
              providers={[ANTHROPIC]}
              favorites={[]}
              onFavoriteToggle={() => undefined}
              onAddCustom={() => undefined}
              disabled
              disabledReason="Generation in progress — fields lock until complete"
            />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
