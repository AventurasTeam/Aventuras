import type {
  appSettings,
  assets,
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  probeCaptures,
  stories,
  storyEntries,
  threads,
  translations,
  vaultCalendars,
} from './schema'

export type SqlOp = { sql: string; params: unknown[] }

export type Story = typeof stories.$inferSelect
export type NewStory = typeof stories.$inferInsert

export type Branch = typeof branches.$inferSelect
export type NewBranch = typeof branches.$inferInsert

export type StoryEntry = typeof storyEntries.$inferSelect
export type NewStoryEntry = typeof storyEntries.$inferInsert

export type Entity = typeof entities.$inferSelect
export type NewEntity = typeof entities.$inferInsert

export type Lore = typeof lore.$inferSelect
export type NewLore = typeof lore.$inferInsert

export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert

export type Happening = typeof happenings.$inferSelect
export type NewHappening = typeof happenings.$inferInsert

export type HappeningInvolvement = typeof happeningInvolvements.$inferSelect
export type NewHappeningInvolvement = typeof happeningInvolvements.$inferInsert

export type HappeningAwareness = typeof happeningAwareness.$inferSelect
export type NewHappeningAwareness = typeof happeningAwareness.$inferInsert

export type CharacterRelationship = typeof characterRelationships.$inferSelect
export type NewCharacterRelationship = typeof characterRelationships.$inferInsert

export type Chapter = typeof chapters.$inferSelect
export type NewChapter = typeof chapters.$inferInsert

export type BranchEraFlip = typeof branchEraFlips.$inferSelect
export type NewBranchEraFlip = typeof branchEraFlips.$inferInsert

export type Translation = typeof translations.$inferSelect
export type NewTranslation = typeof translations.$inferInsert

export type ProbeCapture = typeof probeCaptures.$inferSelect
export type NewProbeCapture = typeof probeCaptures.$inferInsert

export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert

export type EntryAsset = typeof entryAssets.$inferSelect
export type NewEntryAsset = typeof entryAssets.$inferInsert

export type VaultCalendar = typeof vaultCalendars.$inferSelect
export type NewVaultCalendar = typeof vaultCalendars.$inferInsert

export type AppSettings = typeof appSettings.$inferSelect
export type NewAppSettings = typeof appSettings.$inferInsert

export type PipelineRun = typeof pipelineRuns.$inferSelect
export type NewPipelineRun = typeof pipelineRuns.$inferInsert

export type Delta = typeof deltas.$inferSelect
export type NewDelta = typeof deltas.$inferInsert
