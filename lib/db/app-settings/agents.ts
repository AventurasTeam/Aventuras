// AgentId registry — the single source of truth for which agents exist

export const STORY_AGENT_IDS = [
  'classifier',
  'translation',
  'suggestion',
  'lore-mgmt',
  'retrieval',
] as const

export const GLOBAL_AGENT_IDS = ['wizard-assist'] as const

export const AGENT_IDS = [...STORY_AGENT_IDS, ...GLOBAL_AGENT_IDS] as const

export type AgentId = (typeof AGENT_IDS)[number]
export type StoryAgentId = (typeof STORY_AGENT_IDS)[number]
export type GlobalAgentId = (typeof GLOBAL_AGENT_IDS)[number]
