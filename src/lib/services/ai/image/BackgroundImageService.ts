import { emitBackgroundImageAnalysisFailed } from '$lib/services/events'
import { ContextBuilder } from '$lib/services/context'
import { settings } from '$lib/stores/settings.svelte'
import { createLogger } from '$lib/log'
import { backgroundImageAnalysisResultSchema, type BackgroundImageAnalysisResult } from '../sdk'
import { BaseAIService } from '../BaseAIService'
import { generateImage } from './providers/registry'
import { story } from '$lib/stores/story/index.svelte'

const log = createLogger('BackgroundImageService')

export class BackgroundImageService extends BaseAIService {
  private imageSettings: typeof settings.systemServicesSettings.imageGeneration

  constructor(
    serviceId: string,
    imageSettings: typeof settings.systemServicesSettings.imageGeneration,
  ) {
    super(serviceId)
    this.imageSettings = imageSettings
  }

  async analyzeResponsesForBackgroundImage(): Promise<BackgroundImageAnalysisResult> {
    log('analyzeResponsesForBackgroundImage called')
    const storyEntries = story.entry.visibleEntries
    const narrationEntries = storyEntries.filter((e) => e.type === 'narration')

    if (narrationEntries.length === 0) {
      log('No entries, skipping')
      return {
        changeNecessary: false,
        prompt: '',
      }
    }

    const ctx = new ContextBuilder()
    ctx.add(story.generationContext.promptContext)
    const { system, user: prompt } = await ctx.render('background-image-prompt-analysis')

    try {
      const result = await this.generate(
        backgroundImageAnalysisResultSchema,
        system,
        prompt,
        'background-image-prompt-analysis',
      )

      return result
    } catch (error) {
      emitBackgroundImageAnalysisFailed()
      log('Query generation failed:', error)
      return {
        changeNecessary: false,
        prompt: '',
      }
    }
  }

  async generateBackgroundImage(prompt: string): Promise<string> {
    log('generateBackgroundImage called', { prompt })
    const profileId = this.imageSettings.backgroundProfileId

    if (!profileId) {
      throw new Error('No background image generation profile selected')
    }

    try {
      const profile = settings.getImageProfile(profileId)
      const result = await generateImage({
        profileId,
        model: profile?.model ?? '',
        prompt,
        size: this.imageSettings.backgroundSize,
      })

      if (!result.base64) {
        throw new Error('No image data returned')
      }

      log('Background image generated successfully')

      return result.base64
    } catch (error) {
      log('Background image generation failed:', error)
      return ''
    }
  }
}
