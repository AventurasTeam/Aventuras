import type { EmbedDescriptions } from '@/lib/classifier'

// Matching degrades to an unflagged or a flagged create, never a failed pass, when boot has not
// wired a real embedder.
const NO_EMBEDDER: EmbedDescriptions = async () => ({ vectors: [], dim: 0 })

// Injected so tests drive the similarity bands deterministically and so the embedder
// composition (config and provider resolution) stays in the action layer.
let embedDescriptions: EmbedDescriptions = NO_EMBEDDER

export function configureClassifierEmbedder(fn: EmbedDescriptions): void {
  embedDescriptions = fn
}

export function __resetClassifierEmbedder(): void {
  embedDescriptions = NO_EMBEDDER
}

/** The boot-injected embedder; a no-op one (empty vectors) until boot wires it. */
export function classifierEmbedder(): EmbedDescriptions {
  return embedDescriptions
}
