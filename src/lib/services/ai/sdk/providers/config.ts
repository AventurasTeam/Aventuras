/**
 * Unified Provider Configuration
 *
 * Single source of truth for all provider metadata, defaults, and capabilities.
 */

import type { ProviderType, ReasoningEffort } from '$lib/types'
import { OPENROUTER_SUPPORTED_SIZES } from '../../image/providers/openrouter'

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
  binaryReasoning?: true
  /**
   * How reasoning is extracted from the response.
   * - 'think-tag': Provider embeds reasoning in <think> tags, use extractReasoningMiddleware
   * - undefined: Standard handling
   */
  reasoningExtraction?: 'think-tag'
  modelCapabilityFetching?: boolean
}

export interface ImageDefaults {
  defaultModel: string
  referenceModel: string
  supportedSizes: string[]
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
  imageDefaults?: ImageDefaults
  fallbackModels: string[]
  /** Service model defaults. Only some providers (openrouter, nanogpt) have preconfigured defaults. */
  services?: ProviderServices
}

// ============================================================================
// Provider Configurations
// ============================================================================

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
    imageDefaults: {
      defaultModel: 'google/gemini-2.5-flash-image',
      referenceModel: 'google/gemini-2.5-flash-image',
      supportedSizes: OPENROUTER_SUPPORTED_SIZES,
    },
    fallbackModels: [
      'z-ai/glm-5',
      'x-ai/grok-4.1-fast',
      'google/gemini-3-flash-preview',
      'deepseek/deepseek-v3.2',
      'stepfun/step-3.5-flash:free',
    ],
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
        reasoningEffort: 'off',
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
        reasoningEffort: 'off',
      },
      translation: {
        model: 'google/gemini-3-flash-preview',
        temperature: 1.0,
        maxTokens: 8192,
        reasoningEffort: 'off',
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
      structuredOutput: false,
      reasoning: true,
      modelCapabilityFetching: true,
    },
    imageDefaults: {
      defaultModel: 'z-image-turbo',
      referenceModel: 'qwen-image',
      supportedSizes: ['512x512', '1024x1024', '2048x2048'],
    },
    fallbackModels: [
      'deepseek/deepseek-v3.2',
      'zai-org/glm-5:thinking',
      'stepfun-ai/step-3.5-flash',
      'openai/gpt-oss-120b',
    ],
    services: {
      narrative: {
        model: 'zai-org/glm-5:thinking',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      classification: {
        model: 'stepfun-ai/step-3.5-flash',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      memory: {
        model: 'stepfun-ai/step-3.5-flash',
        temperature: 0.5,
        maxTokens: 8192,
        reasoningEffort: 'high',
      },
      suggestions: {
        model: 'deepseek/deepseek-v3.2',
        temperature: 0.8,
        maxTokens: 8192,
        reasoningEffort: 'off',
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
    imageDefaults: {
      defaultModel: 'z-image-turbo',
      referenceModel: 'qwen-image-edit-2511',
      supportedSizes: ['576x576', '1024x1024', '2048x2048'],
    },
    fallbackModels: [
      'deepseek-ai/DeepSeek-V3-0324',
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    ],
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
      structuredOutput: false,
      reasoning: true,
    },
    imageDefaults: {
      defaultModel: 'flux',
      referenceModel: 'kontext',
      supportedSizes: ['512x512', '1024x1024', '2048x2048'],
    },
    fallbackModels: ['openai', 'mistral', 'llama'],
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
      structuredOutput: false,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    fallbackModels: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'qwen2.5', 'phi3', 'gemma2'],
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
      structuredOutput: false,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    fallbackModels: ['loaded-model'],
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
      structuredOutput: false,
      reasoning: true,
      reasoningExtraction: 'think-tag',
    },
    fallbackModels: ['loaded-model'],
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
    fallbackModels: [
      'nvidia/llama-3.1-nemotron-nano-8b-v2',
      'meta/llama-3.1-70b-instruct',
      'meta/llama-3.1-8b-instruct',
      'nvidia/llama-3.1-nemotron-70b-instruct',
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
    fallbackModels: ['default'],
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
    imageDefaults: {
      defaultModel: 'dall-e-3',
      referenceModel: 'dall-e-2',
      supportedSizes: ['1024x1024', '1024x1792', '1792x1024'],
    },
    fallbackModels: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1',
      'o1-mini',
    ],
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
    fallbackModels: [
      'claude-opus-4-5-20251101',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-1-20250805',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ],
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
    },
    imageDefaults: {
      defaultModel: 'imagen-3.0-generate-002',
      referenceModel: 'imagen-3.0-generate-002',
      supportedSizes: ['512x512', '1024x1024'],
    },
    fallbackModels: [
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
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
    fallbackModels: ['grok-3', 'grok-3-fast', 'grok-2', 'grok-2-vision'],
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
      structuredOutput: false,
      reasoning: true,
    },
    fallbackModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
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
      binaryReasoning: true,
    },
    imageDefaults: {
      defaultModel: 'cogview-3-plus',
      referenceModel: 'cogview-3',
      supportedSizes: ['512x512', '1024x1024'],
    },
    fallbackModels: [
      'glm-4-plus',
      'glm-4-flash',
      'glm-4-air',
      'glm-4v',
      'glm-4v-plus',
      'cogview-3-plus',
    ],
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
      binaryReasoning: true,
    },
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
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
      structuredOutput: false,
      reasoning: false,
    },
    fallbackModels: [
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-latest',
      'pixtral-large-latest',
      'ministral-8b-latest',
      'ministral-3b-latest',
    ],
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

/** Check if a provider uses binary (on/off) reasoning instead of a level slider */
export function supportsBinaryReasoning(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.binaryReasoning
}

/** Check if a provider supports capability fetching */
export function supportsCapabilityFetch(providerType: ProviderType): boolean {
  return !!PROVIDERS[providerType].capabilities.modelCapabilityFetching
}

/** Get the reasoning extraction method for a provider */
export function getReasoningExtraction(
  providerType: ProviderType,
): ProviderCapabilities['reasoningExtraction'] {
  return PROVIDERS[providerType].capabilities.reasoningExtraction
}
