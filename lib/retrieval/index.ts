export { loadAwarenessForScene } from './awareness'
export type { AwarenessRow } from './awareness'
export { composePromptBuffer } from './buffer'
export type { BufferEntry, BufferSettings } from './buffer'
export { KNN_K, PROSE_EXTRACT_TOP_K, RANKER_DEFAULTS } from './constants'
export { matchTerms, nameKeywordIndexFrom, normalizeTerm } from './name-index'
export type { NameKeywordIndex } from './name-index'
export { buildStructuralFloor, filterEntityPool, filterLorePool, filterThreadPool } from './pools'
export type { EntityRow, LoreRow, StructuralFloor, ThreadRow } from './pools'
export { extractProse, splitSentences } from './prose-extract'
export { buildQueryStack, distributeQueryVectors } from './queries'
export type { QuerySpec, QueryStack, QueryStackInput } from './queries'
export { rankAll, rankPerType } from './ranker'
export { ENTITY_FRAMING, runRetrieval } from './run'
export type {
  InjectedAwareness,
  RetrievalDeps,
  RetrievalFailure,
  RetrievalOutcome,
  RetrievalParams,
  RetrievalSuccess,
  RetrievalTimings,
} from './run'
export { runSyncStage } from './sync'
export type { SyncStageDeps, SyncStageResult } from './sync'
export { countEntryTokens, countTokens } from './tokens'
export type {
  Candidate,
  CandidateKind,
  CandidateTrace,
  DropReason,
  PoolFunnel,
  QueryAll,
  QueryPresence,
  RankedType,
  RankerParams,
  RetrievalType,
} from './types'
export { cosine } from './vector'
