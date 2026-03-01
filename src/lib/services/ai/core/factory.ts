/**
 * Service Factory
 *
 * Factory for creating AI service instances.
 * Services receive a service ID and resolve presets dynamically via settings.getServicePresetId().
 */

import { settings } from '$lib/stores/settings.svelte'
import { NarrativeService } from '../generation/NarrativeService'
import { ClassifierService } from '../generation/ClassifierService'
import { MemoryService } from '../generation/MemoryService'
import { SuggestionsService } from '../generation/SuggestionsService'
import { ActionChoicesService } from '../generation/ActionChoicesService'
import { StyleReviewerService } from '../generation/StyleReviewerService'
import { EntryInjector, type ContextConfig } from '../generation/EntryInjector'
import { LoreManagementService } from '../lorebook/LoreManagementService'
import { AgenticRetrievalService } from '../retrieval/AgenticRetrievalService'
import { TimelineFillService } from '../retrieval/TimelineFillService'
import {
  EntryRetrievalService,
  getEntryRetrievalConfigFromSettings,
} from '../retrieval/EntryRetrievalService'
import { TranslationService } from '../utils/TranslationService'
import { ImageAnalysisService } from '../image/ImageAnalysisService'
import { BackgroundImageService } from '../image/BackgroundImageService'

/**
 * Factory class for creating AI services.
 */
export class ServiceFactory {
  // ===== Service Instance Creators =====

  /**
   * Create a narrative service instance.
   * This is the core service for story generation.
   * Uses main narrative profile directly (no preset needed).
   */
  createNarrativeService(): NarrativeService {
    return new NarrativeService()
  }

  /**
   * Create a classifier service instance.
   */
  createClassifierService(): ClassifierService {
    return new ClassifierService(
      'classifier',
      settings.systemServicesSettings.classifier.chatHistoryTruncation ?? 100,
    )
  }

  /**
   * Create a memory service instance.
   */
  createMemoryService(): MemoryService {
    return new MemoryService('memory')
  }

  /**
   * Create a suggestions service instance.
   */
  createSuggestionsService(): SuggestionsService {
    return new SuggestionsService('suggestions')
  }

  /**
   * Create an action choices service instance.
   */
  createActionChoicesService(): ActionChoicesService {
    return new ActionChoicesService('actionChoices')
  }

  /**
   * Create a style reviewer service instance.
   */
  createStyleReviewerService(): StyleReviewerService {
    return new StyleReviewerService('styleReviewer')
  }

  /**
   * Create an entry injector instance.
   */
  createEntryInjector(config?: Partial<ContextConfig>): EntryInjector {
    return new EntryInjector(config, 'entryRetrieval')
  }

  /**
   * Create an entry retrieval service instance.
   */
  createEntryRetrievalService(): EntryRetrievalService {
    const config = getEntryRetrievalConfigFromSettings()
    return new EntryRetrievalService(config, 'entryRetrieval')
  }

  /**
   * Create a lore management service instance.
   */
  createLoreManagementService(): LoreManagementService {
    const loreManagementSettings = settings.systemServicesSettings.loreManagement
    return new LoreManagementService('loreManagement', loreManagementSettings.maxIterations)
  }

  /**
   * Create an agentic retrieval service instance.
   */
  createAgenticRetrievalService(): AgenticRetrievalService {
    const agenticRetrievalSettings = settings.systemServicesSettings.agenticRetrieval
    return new AgenticRetrievalService('agenticRetrieval', agenticRetrievalSettings.maxIterations)
  }

  /**
   * Create a timeline fill service instance.
   */
  createTimelineFillService(): TimelineFillService {
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    return new TimelineFillService('timelineFill', timelineFillSettings.maxQueries)
  }

  /**
   * Create a timeline fill service for chapter queries.
   */
  createChapterQueryService(): TimelineFillService {
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    return new TimelineFillService('chapterQuery', timelineFillSettings.maxQueries)
  }

  /**
   * Create a translation service instance for a specific translation type.
   */
  createTranslationService(
    type: 'narration' | 'input' | 'ui' | 'suggestions' | 'actionChoices' | 'wizard',
  ): TranslationService {
    return new TranslationService(`translation:${type}`)
  }

  /**
   * Create an image analysis service instance.
   * Used for "analyzed" mode where LLM identifies imageable scenes in narrative.
   */
  createImageAnalysisService(): ImageAnalysisService {
    return new ImageAnalysisService('imageGeneration')
  }

  /**
   * Create a background image service instance.
   */
  createBackgroundImageService(): BackgroundImageService {
    const imageSettings = settings.systemServicesSettings.imageGeneration
    if (!imageSettings.backgroundProfileId) {
      throw new Error('Background profile ID is missing')
    }
    return new BackgroundImageService('bgImageGeneration', imageSettings)
  }
}

// Export singleton instance
export const serviceFactory = new ServiceFactory()
