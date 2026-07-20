import { z } from 'zod'

import catalogData from './catalog.json'

const executionProviderSchema = z.string()

const catalogFilesSchema = z
  .object({
    'model.onnx': z.string(),
    'tokenizer.json': z.string(),
    'tokenizer_config.json': z.string(),
  })
  .catchall(z.string())

const catalogSha256Schema = z
  .object({
    'model.onnx': z.string(),
    'tokenizer.json': z.string(),
    'tokenizer_config.json': z.string(),
  })
  .catchall(z.string())

const catalogDefaultEpSchema = z
  .object({
    android: executionProviderSchema,
    ios: executionProviderSchema,
    linux: executionProviderSchema,
    macos: executionProviderSchema,
    windows: executionProviderSchema,
  })
  .strict()

export const catalogModelEntrySchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    shortDescription: z.string(),
    size_bytes: z.number().int().positive(),
    dim: z.number().int().positive(),
    huggingfaceRevision: z.string(),
    files: catalogFilesSchema,
    expectedSha256: catalogSha256Schema,
    default_ep: catalogDefaultEpSchema,
    tags: z.array(z.string()),
  })
  .strict()

export const embedderCatalogSchema = z
  .object({
    version: z.string(),
    models: z.array(catalogModelEntrySchema),
  })
  .strict()

export type CatalogModelEntry = z.infer<typeof catalogModelEntrySchema>
export type EmbedderCatalog = z.infer<typeof embedderCatalogSchema>

export const EMBEDDER_CATALOG: EmbedderCatalog = embedderCatalogSchema.parse(catalogData)

export function getCatalogEntry(id: string): CatalogModelEntry | undefined {
  return EMBEDDER_CATALOG.models.find((model) => model.id === id)
}

export function getDefaultCatalogEntry(): CatalogModelEntry {
  const defaultEntry = EMBEDDER_CATALOG.models.find((model) => model.tags.includes('default'))
  if (!defaultEntry) {
    throw new Error('EMBEDDER_CATALOG has no entry tagged "default"')
  }
  return defaultEntry
}

export function localModelDim(id: string): number | undefined {
  return getCatalogEntry(id)?.dim
}
