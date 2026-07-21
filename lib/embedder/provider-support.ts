// v1 routes provider embedding through an openai-compatible /embeddings
// endpoint; every other provider type throws EmbedderInitError at transport.
// Kept here rather than in lib/ai so the gate can consult it without lib/embedder
// gaining a dependency on lib/ai (which already depends on this module).
const EMBEDDING_PROVIDER_TYPES = new Set(['openai-compatible'])

export function providerTypeSupportsEmbedding(type: string): boolean {
  return EMBEDDING_PROVIDER_TYPES.has(type)
}
