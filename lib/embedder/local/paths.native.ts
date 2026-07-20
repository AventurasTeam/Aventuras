import { Directory, Paths } from 'expo-file-system'

import { sanitizeModelDirName } from './sanitize'

// Android canon roots embedders at <internal>/files/embedders/, iOS at
// <documents>/embedders/ (docs/memory/model-management.md → Storage layout).
// Paths.document maps to both platforms' document directory.
export function embeddersRoot(): Directory {
  return new Directory(Paths.document, 'embedders')
}

export function modelDir(modelId: string): Directory {
  return new Directory(embeddersRoot(), sanitizeModelDirName(modelId))
}
