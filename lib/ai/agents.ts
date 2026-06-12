// AgentId registry — the single source of truth for which agents exist
// (data-model.md → App settings storage). Narrative is NOT an agent.
export const AGENT_IDS = [
  'classifier',
  'translation',
  'suggestion',
  'lore-mgmt',
  'retrieval',
  'wizard-assist',
] as const

export type AgentId = (typeof AGENT_IDS)[number]

export type ResolveTarget = AgentId | 'narrative'
