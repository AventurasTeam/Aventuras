import { AGENT_IDS, GLOBAL_AGENT_IDS, type AgentId, type StoryAgentId } from '@/lib/db'

export type ResolveTarget = AgentId | 'narrative'

// Targets that carry a per-story model override: narrative + the story-scoped
// agents. Mirrors stories.settings.models; both derive from the registry split.
export type StoryOverrideTarget = StoryAgentId | 'narrative'

const GLOBAL_TARGET_IDS: ReadonlySet<string> = new Set(GLOBAL_AGENT_IDS)

// A target has a story scope unless it's a global agent (runs outside any story).
export function isStoryOverrideTarget(target: ResolveTarget): target is StoryOverrideTarget {
  return !GLOBAL_TARGET_IDS.has(target)
}

export { AGENT_IDS, type AgentId }
