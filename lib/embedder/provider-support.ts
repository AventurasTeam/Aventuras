// v1 routes provider embedding through an openai-compatible /embeddings
// endpoint; every other provider type throws EmbedderInitError at transport.
// Kept here rather than in lib/ai so the gate can consult it without lib/embedder
// gaining a dependency on lib/ai (which already depends on this module).
const EMBEDDING_PROVIDER_TYPES = new Set(['openai-compatible'])

export function providerTypeSupportsEmbedding(type: string): boolean {
  return EMBEDDING_PROVIDER_TYPES.has(type)
}

// openai-compatible has no implicit base URL, so a blank endpoint is a provider
// that cannot be constructed at all. The gate consults this so buildEmbeddingModel's
// "anything that passed the gate is constructible" contract holds instance-wide,
// not just at the type level.
export function providerHasEmbeddingEndpoint<T extends { endpoint?: string }>(
  provider: T,
): provider is T & { endpoint: string } {
  return (provider.endpoint?.trim().length ?? 0) > 0
}
