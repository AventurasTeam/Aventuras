/**
 * Unified Provider Configuration
 *
 * Single source of truth for all provider metadata, defaults, and capabilities.
 */

import type { ProviderType, ReasoningEffort } from '$lib/types'

// ============================================================================
// Types
// ============================================================================

export interface ServiceModelDefaults {
  model: string
  temperature: number
  maxTokens: number
  reasoningEffort: ReasoningEffort
}

export interface ProviderCapabilities {
  textGeneration: boolean
  imageGeneration: boolean
  structuredOutput: boolean
  /**
   * Whether the provider supports reasoning/thinking.
   */
  reasoning: boolean
  /**
   * How reasoning is extracted from the response.
   * - 'think-tag': Provider embeds reasoning in <think> tags, use extractReasoningMiddleware
   * - undefined: Standard handling
   */
  reasoningExtraction?: 'think-tag'
  modelCapabilityFetching?: boolean
}

export interface ProviderServices {
  narrative: ServiceModelDefaults
  classification: ServiceModelDefaults
  memory: ServiceModelDefaults
  suggestions: ServiceModelDefaults
  agentic: ServiceModelDefaults
  wizard: ServiceModelDefaults
  translation: ServiceModelDefaults
}

export interface ProviderConfig {
  name: string
  description: string
  baseUrl: string // Empty string = SDK default
  requiresApiKey: boolean
  capabilities: ProviderCapabilities
  /** Models to hide by default when a new profile of this type is created. */
  defaultHiddenModels?: string[]
  /** Service model defaults. Only some providers (openrouter, nanogpt) have preconfigured defaults. */
  services?: ProviderServices
}

// ============================================================================
// Provider Configurations
// ============================================================================

import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'

export const GOOGLE_SAFETY_SETTINGS: NonNullable<
  GoogleGenerativeAIProviderOptions['safetySettings']
> = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
] as const

export const PROVIDERS: Record<ProviderType, ProviderConfig> = {
  openrouter: {
    name: 'OpenRouter',
    description: 'Access 100+ models from one API',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
      modelCapabilityFetching: true,
    },
    services: {
      narrative: {
        model: 'z-ai/glm-5',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      classification: {
        model: 'x-ai/grok-4.1-fast',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      memory: {
        model: 'x-ai/grok-4.1-fast',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      suggestions: {
        model: 'deepseek/deepseek-v3.2',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'none',
      },
      agentic: {
        model: 'z-ai/glm-5',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      wizard: {
        model: 'deepseek/deepseek-v3.2',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'none',
      },
      translation: {
        model: 'google/gemini-3-flash-preview',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'none',
      },
    },
  },

  nanogpt: {
    name: 'NanoGPT',
    description: 'Subscription-Based LLMs and image generation',
    baseUrl: 'https://nano-gpt.com/api/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
      modelCapabilityFetching: true,
    },
    services: {
      narrative: {
        model: 'zai-org/glm-5:thinking',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      classification: {
        model: 'stepfun-ai/step-3.5-flash-2603',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      memory: {
        model: 'stepfun-ai/step-3.5-flash-2603',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      suggestions: {
        model: 'deepseek/deepseek-v3.2',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'none',
      },
      agentic: {
        model: 'zai-org/glm-5:thinking',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      wizard: {
        model: 'deepseek/deepseek-v3.2',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      translation: {
        model: 'openai/gpt-oss-120b',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
    },
  },

  chutes: {
    name: 'Chutes',
    description: 'Text and image generation',
    baseUrl: 'https://llm.chutes.ai/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: false,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  pollinations: {
    name: 'Pollinations',
    description: 'Free text and image generation',
    baseUrl: 'https://gen.pollinations.ai/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
      modelCapabilityFetching: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  ollama: {
    name: 'Ollama',
    description: 'Run local LLMs (requires Ollama installed)',
    baseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    // No service defaults - user must configure models in Generation Settings
  },

  lmstudio: {
    name: 'LM Studio',
    description: 'Run local LLMs (requires LM Studio installed)',
    baseUrl: 'http://localhost:1234/v1',
    requiresApiKey: false,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    // No service defaults - user must configure models in Generation Settings
  },

  llamacpp: {
    name: 'llama.cpp',
    description: 'Run local LLMs (requires llama.cpp server)',
    baseUrl: 'http://localhost:8080/v1',
    requiresApiKey: false,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    // No service defaults - user must configure models in Generation Settings
  },

  'nvidia-nim': {
    name: 'NVIDIA NIM',
    description: 'NVIDIA hosted inference microservices',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: false,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    // Models excluded here cannot be identified by the keyword or size patterns in
    // modelFetcher.ts (NIM_EXCLUDE_PATTERNS / nimLargestSizeB) but are not useful
    // for interactive fiction: legacy, deprecated, or narrow-domain models ≥ 24B.
    defaultHiddenModels: [
      '01-ai/yi-large',
      'ai21labs/jamba-1.5-large-instruct',
      'databricks/dbrx-instruct',
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.3-70b-instruct',
      'meta/llama2-70b',
      'microsoft/phi-3.5-moe-instruct',
      'mistralai/mistral-large',
      'nvidia/llama-3.1-nemotron-51b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'nvidia/nemotron-4-340b-instruct',
      'writer/palmyra-creative-122b',
    ],
    // No service defaults - user must configure models in Generation Settings
  },

  'openai-compatible': {
    name: 'OpenAI Compatible',
    description: 'Any OpenAI-compatible API (requires custom URL)',
    baseUrl: '', // Requires custom baseUrl
    requiresApiKey: false,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: false,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  openai: {
    name: 'OpenAI',
    description: 'GPT models from OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  anthropic: {
    name: 'Anthropic',
    description: 'Claude models',
    baseUrl: '', // SDK default
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  google: {
    name: 'Google AI',
    description: 'Gemini models',
    baseUrl: '', // SDK default
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
      modelCapabilityFetching: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  xai: {
    name: 'xAI (Grok)',
    description: 'Grok models from xAI',
    baseUrl: 'https://api.x.ai/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  groq: {
    name: 'Groq',
    description: 'Ultra-fast inference for open models',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  zhipu: {
    name: 'Zhipu AI',
    description: 'GLM models (Chinese AI provider)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: true,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  deepseek: {
    name: 'DeepSeek',
    description: 'Cost-effective reasoning models',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: true,
    },
    // No service defaults - user must configure models in Generation Settings
  },

  mistral: {
    name: 'Mistral',
    description: 'European AI provider with strong coding models',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresApiKey: true,
    capabilities: {
      textGeneration: true,
      imageGeneration: false,
      structuredOutput: true,
      reasoning: false,
    },
    // No service defaults - user must configure models in Generation Settings
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Get the base URL for a provider, or undefined if SDK default should be used */
export function getBaseUrl(providerType: ProviderType): string | undefined {
  const url = PROVIDERS[providerType].baseUrl
  return url || undefined
}

/** Check if a provider has a default endpoint (doesn't require custom URL) */
export function hasDefaultEndpoint(providerType: ProviderType): boolean {
  return providerType !== 'openai-compatible'
}

/** Get all providers as a list for UI dropdowns */
export function getProviderList(): Array<{
  value: ProviderType
  label: string
  description: string
}> {
  return (Object.keys(PROVIDERS) as ProviderType[]).map((key) => ({
    value: key,
    label: PROVIDERS[key].name,
    description: PROVIDERS[key].description,
  }))
}

/** Check if a provider supports reasoning/thinking */
export function supportsReasoning(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.reasoning
}

/** Check if a provider supports capability fetching */
export function supportsCapabilityFetch(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.modelCapabilityFetching
}

/**
 * Whether this provider emits reasoning inline in `<think>` tags rather than in a field of
 * its own, so the response needs `extractReasoningMiddleware` to pull it back out.
 *
 * `openai-compatible` is included regardless of its declared capability: it is the generic
 * "any gateway" provider, so the model behind it is unknown and the tags may show up.
 *
 * One expression, because it used to be three -- twice in `generate.ts` and once inline in an
 * IIFE inside an `{#if}` in AgentProfiles, which is exactly how these drift apart.
 */
export function usesThinkTag(providerType: ProviderType): boolean {
  return (
    providerType === 'openai-compatible' ||
    PROVIDERS[providerType].capabilities.reasoningExtraction === 'think-tag'
  )
}
