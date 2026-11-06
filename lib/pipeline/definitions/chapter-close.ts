import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'

import { closeAgentPhase } from './chapter-close-agent'
import { closeBoundaryPhase } from './chapter-close-boundary'
import { closeMetadataPhase } from './chapter-close-metadata'
import { closeReportPhase } from './chapter-close-report'
import { CLOSE_PHASE } from './intermediates'
import { PER_TURN_KIND } from './per-turn'
import { definePipeline } from '../authoring/define'
import { getPipeline } from '../authoring/registry'
import type { ResolverInput } from '../types'

// C2: an unassigned lore-mgmt fails at pre-flight, not inside a phase.
export const CHAPTER_CLOSE_RESOLVES: readonly ResolverInput[] = [{ target: 'lore-mgmt' }]

/** generation-pipeline.md → V1 declarations. Idempotent: boot and every start call it. */
export function ensureChapterClosePipelineRegistered(): void {
  try {
    getPipeline(CHAPTER_CLOSE_KIND)
  } catch {
    definePipeline({
      kind: CHAPTER_CLOSE_KIND,
      phases: [
        { name: CLOSE_PHASE.boundary, run: closeBoundaryPhase, resolves: CHAPTER_CLOSE_RESOLVES },
        { name: CLOSE_PHASE.metadata, run: closeMetadataPhase, resolves: CHAPTER_CLOSE_RESOLVES },
        { name: CLOSE_PHASE.agent, run: closeAgentPhase, resolves: CHAPTER_CLOSE_RESOLVES },
        { name: CLOSE_PHASE.report, run: closeReportPhase },
      ],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      interruptible: 'close',
      concurrencyPolicy: {
        blockedBy: [
          PER_TURN_KIND,
          PERIODIC_CLASSIFIER_KIND,
          CHAPTER_CLOSE_KIND,
          'translation-retry',
        ],
      },
    })
  }
}
