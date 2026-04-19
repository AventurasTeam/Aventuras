/**
 * Public wrapper for LLM-based entry classification
 */

import type { ImportedEntry } from '../types'
import { LorebookClassifierService } from './aiService'

export async function classifyEntries(
  entries: ImportedEntry[],
  onProgress?: (classified: number, total: number) => void,
): Promise<ImportedEntry[]> {
  const service = new LorebookClassifierService()
  return service.classifyEntries(entries, onProgress)
}
