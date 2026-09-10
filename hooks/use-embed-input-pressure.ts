import { useEffect, useMemo, useRef, useState } from 'react'

import { resolveModelCapabilities } from '@/lib/ai'
import {
  countEmbedderTokens,
  embedderInputWindow,
  inputPressure,
  resolveEmbedderConfig,
  type InputPressure,
  type InputWindow,
} from '@/lib/embedder'
import { countTokens } from '@/lib/retrieval'
import { appSettingsStore, currentStoryStore } from '@/lib/stores'

// 300ms is about not re-entering the tokenizer, not about it being slow — the count is
// sub-millisecond. A fast typist re-counts once rather than per keystroke.
const DEBOUNCE_MS = 300

export type EmbedInputPressure = {
  /** null until the first count settles, so a surface can stay quiet rather than flash 0. */
  tokens: number | null
  /** False when the number came from an estimator; a provider has no tokenizer to load. */
  exact: boolean
  window: InputWindow
  pressure: InputPressure
}

/**
 * How close `text` is to the embedder's input window, counted by that embedder's
 * own tokenizer wherever one exists.
 *
 * Falls back to app defaults when no story is open — the wizard authors lore
 * before a story exists, and its embedder is whatever the app would give it.
 */
export function useEmbedInputPressure(text: string): EmbedInputPressure {
  // Scalar selectors: an object built inside a selector breaks useSyncExternalStore's
  // snapshot-stability contract. `providers` is the stored array itself, so it reads whole.
  const appModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const appProviderId = appSettingsStore.useAppSettings((s) => s.embeddingProviderId)
  const appBackend = appSettingsStore.useAppSettings((s) => s.defaultStorySettings.embeddingBackend)
  const providers = appSettingsStore.useAppSettings((s) => s.providers)

  const storyBackend = currentStoryStore.useCurrentStory(
    (o) => o?.settings.embeddingBackend ?? null,
  )
  const storyModelId = currentStoryStore.useCurrentStory(
    (o) => o?.settings.embedding_model_id ?? null,
  )
  const storyProviderId = currentStoryStore.useCurrentStory(
    (o) => o?.settings.embedding_provider_id ?? null,
  )
  const storyEffectiveDim = currentStoryStore.useCurrentStory((o) => o?.settings.effectiveDim)

  const resolution = useMemo(
    () =>
      resolveEmbedderConfig(
        storyBackend === null
          ? null
          : {
              embeddingBackend: storyBackend,
              embedding_model_id: storyModelId ?? '',
              embedding_provider_id: storyProviderId ?? undefined,
              ...(storyEffectiveDim === undefined ? {} : { effectiveDim: storyEffectiveDim }),
            },
        {
          embeddingModelId: appModelId,
          embeddingProviderId: appProviderId,
          defaultStorySettings: { embeddingBackend: appBackend },
        },
      ),
    [
      storyBackend,
      storyModelId,
      storyProviderId,
      storyEffectiveDim,
      appModelId,
      appProviderId,
      appBackend,
    ],
  )

  const config = resolution.ok ? resolution.config : null
  const window = useMemo(() => {
    if (config === null) return { tokens: null, source: 'unknown' } as const
    const capabilities =
      config.backend === 'provider'
        ? resolveModelCapabilities(config.providerId, config.modelId, providers)
        : undefined
    return embedderInputWindow(config, capabilities)
  }, [config, providers])

  const [count, setCount] = useState<{ tokens: number; exact: boolean } | null>(null)
  // Generation, not an AbortController: the counters are synchronous work behind a
  // promise, so there is nothing to abort — only a late answer to discard.
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    if (config === null) {
      setCount(null)
      return
    }
    if (text === '') {
      setCount({ tokens: 0, exact: true })
      return
    }
    const timer = setTimeout(() => {
      void countEmbedderTokens(config, [text], countTokens).then((result) => {
        if (generation.current !== current) return
        setCount({ tokens: result.counts[0] ?? 0, exact: result.exact })
      })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [text, config])

  return {
    tokens: count?.tokens ?? null,
    exact: count?.exact ?? false,
    window,
    pressure: count === null ? 'ok' : inputPressure(count.tokens, window),
  }
}
