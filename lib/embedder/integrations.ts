export type EmbedderIntegration = {
  pooling: 'mean' | 'cls'
  normalize: true
  documentPrefix: string
  queryPrefix: string
}

// Partial: an id absent from this map is a real possibility (a catalog entry
// added without its integration row), so consumers must handle the miss.
export const EMBEDDER_INTEGRATIONS: Partial<Record<string, EmbedderIntegration>> = {
  'Xenova/all-MiniLM-L6-v2': {
    pooling: 'mean',
    normalize: true,
    documentPrefix: '',
    queryPrefix: '',
  },
  'onnx-community/embeddinggemma-300m-ONNX': {
    pooling: 'mean',
    normalize: true,
    documentPrefix: 'title: none | text: ',
    queryPrefix: 'task: search result | query: ',
  },
}
