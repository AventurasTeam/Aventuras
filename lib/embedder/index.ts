export {
  EMBEDDER_CATALOG,
  catalogModelEntrySchema,
  embedderCatalogSchema,
  getCatalogEntry,
  getDefaultCatalogEntry,
  localModelDim,
} from './catalog'
export type { CatalogModelEntry, EmbedderCatalog } from './catalog'

export { EMBEDDER_INTEGRATIONS } from './integrations'
export type { EmbedderIntegration } from './integrations'

export { resolveEmbedderConfig } from './resolve-config'
export type { EmbedderAppDefaults, EmbedderConfigResolution } from './resolve-config'

export { resolveEmbedderGate } from './gate'
export type { EmbedderGateResult } from './gate'

export { providerTypeSupportsEmbedding } from './provider-support'

export { EmbedderCallError, EmbedderInitError } from './types'
export type { EmbedderBackend, EmbedderConfig } from './types'

export { embedLocal, listInstalledLocal, smokeTestLocal } from './local/runtime'
export type { LocalEmbedResult } from './local/runtime'

export { sanitizeModelDirName } from './local/sanitize'

export { embedAndBuildVecOps, embedTexts, testEmbedder } from './service'
export type { EmbedIntent } from './service'

export { createEmbedderDownloadDriver } from './download/driver'

export {
  buildDownloadPlan,
  findPlanRow,
  modelMetaFromCatalogEntry,
  toDialogCatalogEntry,
} from './download/catalog-files'
export type { DownloadPlanRow } from './download/catalog-files'

export { fetchModelCard, resolveHfModel } from './download/model-card'
