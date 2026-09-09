export {
  EMBEDDER_CATALOG,
  catalogModelEntrySchema,
  embedderCatalogSchema,
  getCatalogEntry,
  getDefaultCatalogEntry,
  localModelDim,
  localModelMaxInputTokens,
} from './catalog'
export type { CatalogModelEntry, EmbedderCatalog } from './catalog'

export { EMBEDDER_INTEGRATIONS } from './integrations'
export type { EmbedderIntegration } from './integrations'

export { embedderReadDim, resolveEmbedderConfig } from './resolve-config'
export type { EmbedderAppDefaults, EmbedderConfigResolution } from './resolve-config'

export { createDrainController } from './drain'
export type { DrainDeps } from './drain'

export { countEmbedderTokens } from './count-input'
export type { EmbedderTokenCount } from './count-input'

export {
  ASSUMED_PROVIDER_MAX_INPUT_TOKENS,
  NEAR_WINDOW_FRACTION,
  embedderInputWindow,
  inputPressure,
} from './input-window'
export type { InputPressure, InputWindow, InputWindowSource } from './input-window'

export { resolveEmbedderGate } from './gate'
export type { EmbedderGateResult } from './gate'

export { providerHasEmbeddingEndpoint, providerTypeSupportsEmbedding } from './provider-support'

export { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from './types'
export type {
  EmbedderBackend,
  EmbedderConfig,
  EmbedderErrorKind,
  EmbedderOutcomeKind,
} from './types'

export { countTokensLocal, embedLocal, listInstalledLocal, smokeTestLocal } from './local/runtime'
export type { LocalEmbedResult } from './local/runtime'

export { sanitizeModelDirName } from './local/sanitize'

export { embedAndBuildVecOps, embedRowsToVecOps, embedTexts, testEmbedder } from './service'
export type { EmbedIntent } from './service'

export { createEmbedderDownloadDriver } from './download/driver'

export { EmbedderDownloadError, downloadFailureCode } from './download/failure'

export {
  buildDownloadPlan,
  findPlanRow,
  modelMetaFromCatalogEntry,
  toDialogCatalogEntry,
} from './download/catalog-files'
export type { DownloadPlanRow } from './download/catalog-files'

export { fetchModelCard, resolveHfModel } from './download/model-card'
