// AgentId registry — the single source of truth for which agents exist
// (data-model.md → App settings storage). Indexes app_settings.assignments;
// lives in lib/db (not lib/ai) so the config/action layer can reach it without
// pulling the AI-SDK barrel. Narrative is NOT an agent.
export const AGENT_IDS = [
  'classifier',
  'translation',
  'suggestion',
  'lore-mgmt',
  'retrieval',
  'wizard-assist',
] as const

export type AgentId = (typeof AGENT_IDS)[number]
