// Reasoning detail types per OpenRouter API spec
// https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
export type ReasoningDetailFormat =
  | 'unknown'
  | 'openai-responses-v1'
  | 'xai-responses-v1'
  | 'anthropic-claude-v1'

export interface ReasoningDetailBase {
  id?: string | null
  format?: ReasoningDetailFormat
  index?: number
}

export interface ReasoningSummaryDetail extends ReasoningDetailBase {
  type: 'reasoning.summary'
  summary: string
}

export interface ReasoningEncryptedDetail extends ReasoningDetailBase {
  type: 'reasoning.encrypted'
  data: string
}

export interface ReasoningTextDetail extends ReasoningDetailBase {
  type: 'reasoning.text'
  text: string
  signature?: string | null
}

export type ReasoningDetail =
  | ReasoningSummaryDetail
  | ReasoningEncryptedDetail
  | ReasoningTextDetail

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  // Legacy reasoning string (for backwards compatibility)
  reasoning?: string | null
  // Structured reasoning details for preserving reasoning across tool calls
  // Required for models like MiniMax M2.1, Claude 3.7+, OpenAI o-series
  reasoning_details?: ReasoningDetail[]
}

// Extended message type for tool calling
export interface ToolCallMessage {
  role: 'assistant'
  content: string | null
  tool_calls: ToolCall[]
  // Legacy reasoning string (for backwards compatibility)
  reasoning?: string | null
  // Structured reasoning details for preserving reasoning across tool calls
  reasoning_details?: ReasoningDetail[]
}

export interface ToolResultMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

export type AgenticMessage = Message | ToolCallMessage | ToolResultMessage

// Tool definitions (OpenAI function calling format)
export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: { type: string }
  properties?: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

export interface Tool {
  type: 'function'
  function: ToolFunction
}

// Tool calls from the model
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

export interface GenerationRequest {
  messages: Message[]
  model: string
  temperature?: number
  topP?: number
  maxTokens?: number
  stopSequences?: string[]
  extraBody?: Record<string, unknown> // For provider-specific options like reasoning
  signal?: AbortSignal
}

// Extended request for agentic tool-calling flows
export interface AgenticRequest {
  messages: AgenticMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  tools: Tool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  extraBody?: Record<string, unknown>
  signal?: AbortSignal
}

export interface GenerationResponse {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// Extended response for agentic flows
export interface AgenticResponse {
  content: string | null
  model: string
  tool_calls?: ToolCall[]
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    reasoningTokens?: number
  }
  // Legacy reasoning string (for backwards compatibility)
  reasoning?: string
  // Structured reasoning details for preserving across tool calls
  // This is what should be passed back to the API for context continuity
  reasoning_details?: ReasoningDetail[]
}

export interface StreamChunk {
  content: string
  reasoning?: string
  done: boolean
}

/**
 * Streaming chunk types for tool-enabled streaming responses.
 * Used by streamWithTools to yield events as they arrive from the API.
 */
export type AgenticStreamChunk =
  | { type: 'reasoning'; content: string }
  | { type: 'reasoning_detail'; detail: ReasoningDetail }
  | { type: 'content'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args'; id: string; args: string }
  | { type: 'done'; response: AgenticResponse }

export interface ModelInfo {
  id: string
  name: string
  description?: string
  pricing?: {
    prompt: number
    completion: number
  }
}

export interface ProviderInfo {
  name: string
  slug: string
  privacyPolicyUrl?: string | null
  termsOfServiceUrl?: string | null
  statusPageUrl?: string | null
}

export interface AIProvider {
  id: string
  name: string

  generateResponse(request: GenerationRequest): Promise<GenerationResponse>
  streamResponse(request: GenerationRequest): AsyncIterable<StreamChunk>
  listModels(): Promise<ModelInfo[]>
  listProviders?(): Promise<ProviderInfo[]>
  validateApiKey(): Promise<boolean>
}
