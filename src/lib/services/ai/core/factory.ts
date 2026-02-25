/**
 * Service Factory
 *
 * Factory for creating AI service instances.
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
    const presetId = settings.getServicePresetId('classifier')
    return new ClassifierService(
      presetId,
      settings.systemServicesSettings.classifier.chatHistoryTruncation ?? 100,
    )
  }

  /**
   * Create a memory service instance.
   */
  createMemoryService(): MemoryService {
    const presetId = settings.getServicePresetId('memory')
    return new MemoryService(presetId)
  }

  /**
   * Create a suggestions service instance.
   * Note: Uses SDK-based pattern - fully working.
   */
  createSuggestionsService(): SuggestionsService {
    const presetId = settings.getServicePresetId('suggestions')
    return new SuggestionsService(presetId)
  }

  /**
   * Create an action choices service instance.
   */
  createActionChoicesService(): ActionChoicesService {
    const presetId = settings.getServicePresetId('actionChoices')
    return new ActionChoicesService(presetId)
  }

  /**
   * Create a style reviewer service instance.
   */
  createStyleReviewerService(): StyleReviewerService {
    const presetId = settings.getServicePresetId('styleReviewer')
    return new StyleReviewerService(presetId)
  }

  /**
   * Create an entry injector instance.
   */
  createEntryInjector(config?: Partial<ContextConfig>): EntryInjector {
    return new EntryInjector(config)
  }

  /**
   * Create an entry retrieval service instance.
   */
  createEntryRetrievalService(): EntryRetrievalService {
    const config = getEntryRetrievalConfigFromSettings()
    const presetId = settings.getServicePresetId('entryRetrieval')
    return new EntryRetrievalService(config, presetId)
  }

  /**
   * Create a lore management service instance.
   */
  createLoreManagementService(): LoreManagementService {
    const presetId = settings.getServicePresetId('loreManagement')
    const loreManagementSettings = settings.systemServicesSettings.loreManagement
    return new LoreManagementService(presetId, loreManagementSettings.maxIterations)
  }

  /**
   * Create an agentic retrieval service instance.
   */
  createAgenticRetrievalService(): AgenticRetrievalService {
    const presetId = settings.getServicePresetId('agenticRetrieval')
    const agenticRetrievalSettings = settings.systemServicesSettings.agenticRetrieval
    return new AgenticRetrievalService(presetId, agenticRetrievalSettings.maxIterations)
  }

  /**
   * Create a timeline fill service instance.
   */
  createTimelineFillService(): TimelineFillService {
    const presetId = settings.getServicePresetId('timelineFill')
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    return new TimelineFillService(presetId, timelineFillSettings.maxQueries)
  }

  /**
   * Create a timeline fill service for chapter queries.
   */
  createChapterQueryService(): TimelineFillService {
    const presetId = settings.getServicePresetId('chapterQuery')
    const timelineFillSettings = settings.systemServicesSettings.timelineFill
    return new TimelineFillService(presetId, timelineFillSettings.maxQueries)
  }

  /**
   * Create a translation service instance for a specific translation type.
   */
  createTranslationService(
    type: 'narration' | 'input' | 'ui' | 'suggestions' | 'actionChoices' | 'wizard',
  ): TranslationService {
    const presetId = settings.getServicePresetId(`translation:${type}`)
    return new TranslationService(presetId)
  }

  /**
   * Create an image analysis service instance.
   * Used for "analyzed" mode where LLM identifies imageable scenes in narrative.
   */
  createImageAnalysisService(): ImageAnalysisService {
    const presetId = settings.getServicePresetId('imageGeneration')
    return new ImageAnalysisService(presetId)
  }

  /**
   * Create a background image service instance.
   */
  createBackgroundImageService(): BackgroundImageService {
    const presetId = settings.getServicePresetId('bgImageGeneration')
    const imageSettings = settings.systemServicesSettings.imageGeneration
    return new BackgroundImageService(presetId, imageSettings)
  }
}

// Export singleton instance
export const serviceFactory = new ServiceFactory()
