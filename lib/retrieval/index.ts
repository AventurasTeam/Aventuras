export { loadAwarenessForScene } from './awareness'
export type { AwarenessRow } from './awareness'
export { promptBufferTake, readPromptBuffer } from './buffer'
export type { BufferSettings } from './buffer'
export { KNN_K, PROSE_EXTRACT_TOP_K, RANKER_DEFAULTS } from './constants'
export { matchTerms, nameKeywordIndexFrom, normalizeTerm } from './name-index'
export type { NameKeywordIndex } from './name-index'
export { buildStructuralFloor, filterEntityPool, filterLorePool, filterThreadPool } from './pools'
export type { EntityRow, LoreRow, StructuralFloor, ThreadRow } from './pools'
export { extractProse, splitSentences } from './prose-extract'
export { buildQueryStack, distributeQueryVectors } from './queries'
export type { QuerySpec, QueryStack, QueryStackInput } from './queries'
export { rankAll, rankPerType, tokenCost } from './ranker'
export type { RankTypeInput } from './ranker'
export { ENTITY_FRAMING, entityRenderedText, lines, loreRenderedText } from './rendered-text'
export { runRetrieval } from './run'
export type {
  InjectedAwareness,
  RetrievalDeps,
  RetrievalFailure,
  RetrievalOutcome,
  RetrievalParams,
  RetrievalPartial,
  RetrievalSuccess,
  RetrievalTimings,
} from './run'
export { buildScanText, readScanEntries } from './scan-surface'
export type { ScanSurfaceInput } from './scan-surface'
export { runSyncStage } from './sync'
export type { SyncStageDeps, SyncStageResult } from './sync'
export { countEntryTokens, countTokens, TOKENIZER_IDENTITY } from './tokens'
export { RETRIEVAL_TYPES } from './types'
export type {
  Candidate,
  CandidateKind,
  CandidateTrace,
  DropReason,
  InjectedRow,
  KeywordInjection,
  PoolFunnel,
  QueryAll,
  QueryTextPresence,
  QueryWeights,
  RankAllInput,
  RankedType,
  RankerParams,
  RetrievalType,
  SeatedRow,
} from './types'
export { cosine } from './vector'
