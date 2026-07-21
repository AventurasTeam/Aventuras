import { z } from 'zod'

import catalogData from './catalog-data.json'

const executionProviderSchema = z.string()

// One entry per file rather than parallel path/hash maps: a file can't exist
// without its digest, so the download plan is total and verification can't be
// skipped by a key that's present in one map and absent from the other.
const catalogFileSchema = z
  .object({
    repoPath: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase 64-char SHA-256 digest'),
  })
  .strict()

// config.json is required because the desktop transformers.js loader reads it.
const catalogFilesSchema = z
  .object({
    'model.onnx': catalogFileSchema,
    'config.json': catalogFileSchema,
    'tokenizer.json': catalogFileSchema,
    'tokenizer_config.json': catalogFileSchema,
  })
  .catchall(catalogFileSchema)

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
  .superRefine((catalog, ctx) => {
    // getDefaultCatalogEntry picks the first match, so two defaults would make
    // the app's starting model depend on array order.
    const defaults = catalog.models.filter((model) => model.tags.includes('default'))
    if (defaults.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `catalog must tag exactly one model "default" (found ${defaults.length})`,
      })
    }
  })

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
