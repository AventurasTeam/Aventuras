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

export { EmbedderCallError, EmbedderInitError } from './types'
export type { EmbedderBackend, EmbedderConfig } from './types'
