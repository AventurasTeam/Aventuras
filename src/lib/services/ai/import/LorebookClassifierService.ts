import { settings } from '$lib/stores/settings.svelte'
/**
 * LorebookClassifierService
 *
 * Wraps the LLM-based entry classification in lorebookImporter.ts using the
 * standard serviceId + dynamic getter pattern, consistent with all other AI services.
 */

import type { StoryMode } from '$lib/types'
import type { EntryType } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { lorebookClassificationResultSchema } from '../sdk/schemas/lorebook'
import { createLogger } from '../core/config'
import type { ImportedEntry } from '$lib/services/lorebookImporter'

const log = createLogger('LorebookClassifierService')

export class LorebookClassifierService extends BaseAIService {
  constructor(serviceId: string = 'lorebookClassifier') {
    super(serviceId)
  }

  /**
   * LLM-based entry type classification.
   * Classifies entries in batches to avoid token limits.
   */
  async classifyEntries(
    entries: ImportedEntry[],
    onProgress?: (classified: number, total: number) => void,
    mode: StoryMode = 'adventure',
  ): Promise<ImportedEntry[]> {
    if (entries.length === 0) return entries

    const lorebookSettings = settings.serviceSpecificSettings?.lorebookClassifier
    const BATCH_SIZE = lorebookSettings?.batchSize ?? 50
    const MAX_CONCURRENT = lorebookSettings?.maxConcurrent ?? 5

    const result = [...entries]
    let classified = 0

    const batchStarts: number[] = []
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      batchStarts.push(i)
    }

    for (let ci = 0; ci < batchStarts.length; ci += MAX_CONCURRENT) {
      const concurrentStarts = batchStarts.slice(ci, ci + MAX_CONCURRENT)

      const batchPromises = concurrentStarts.map(async (startIndex) => {
        const batch = entries.slice(startIndex, startIndex + BATCH_SIZE)

        const entriesJson = JSON.stringify(
          batch.map((entry, batchIndex) => ({
            index: batchIndex,
            name: entry.name,
            content: entry.description.slice(0, 500),
            keywords: entry.keywords.slice(0, 10),
          })),
          null,
          2,
        )

        const ctx = new ContextBuilder()
        ctx.add({ mode, pov: 'second', tense: 'present', protagonistName: '', entriesJson })
        const { system, user: prompt } = await ctx.render('lorebook-classifier')

        let classifications: Array<{ index: number; type: string }> = []
        try {
          classifications = await this.generate(
            lorebookClassificationResultSchema,
            system,
            prompt,
            'lorebook-classifier',
          )
        } catch (err) {
          log('Failed to classify batch starting at ' + startIndex, err)
        }

        return { startIndex, batch, classifications }
      })

      const batchResults = await Promise.all(batchPromises)

      for (const { startIndex, batch, classifications } of batchResults) {
        for (const classification of classifications) {
          const globalIndex = startIndex + classification.index
          if (globalIndex < result.length) {
            result[globalIndex] = {
              ...result[globalIndex],
              type: classification.type as EntryType,
            }
          }
        }

        classified += batch.length
        if (onProgress) {
          onProgress(classified, entries.length)
        }

        log('Classified batch', {
          batchStart: startIndex,
          batchSize: BATCH_SIZE,
          maxConcurrent: MAX_CONCURRENT,
          classified,
          total: entries.length,
        })
      }
    }

    return result
  }
}
