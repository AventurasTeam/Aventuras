import { settings } from '$lib/stores/settings.svelte'
import {
  hasRequiredCredentials,
  getProviderDisplayName,
  generatePortrait as sdkGeneratePortrait,
} from '$lib/services/ai/image'
import { database } from '$lib/services/database'
import { ContextBuilder } from '$lib/services/context'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from '$lib/services/ai/image/constants'
import { createLogger } from '$lib/services/ai/core/config'
import type { GeneratedCharacter, GeneratedProtagonist } from '$lib/services/ai/sdk'

const log = createLogger('WizardPortrait')

/**
 * Get the style prompt for the selected style ID.
 * Image style templates are external (raw text) -- fetched directly from the database.
 */
async function getStylePrompt(styleId: string): Promise<string> {
  try {
    const template = await database.getPackTemplate('default-pack', styleId)
    if (template?.content) {
      return template.content
    }
  } catch {
    // Template not found, use fallback
  }
  return DEFAULT_FALLBACK_STYLE_PROMPT
}

/**
 * Build a portrait generation prompt using ContextBuilder pipeline.
 */
async function buildPortraitPrompt(
  stylePrompt: string,
  visualDescriptors: string,
  characterName: string,
): Promise<string> {
  const ctx = new ContextBuilder()
  ctx.add({
    mode: 'adventure',
    pov: 'second',
    tense: 'present',
    protagonistName: '',
    imageStylePrompt: stylePrompt,
    visualDescriptors,
    characterName,
  })
  const { system } = await ctx.render('image-portrait-generation')
  return system
}

export class ImageStore {
  protagonistVisualDescriptors = $state('')
  protagonistPortrait = $state<string | null>(null)
  isGeneratingProtagonistPortrait = $state(false)
  isUploadingProtagonistPortrait = $state(false)
  portraitError = $state<string | null>(null)

  supportingCharacterVisualDescriptors = $state<Record<string, string>>({})
  supportingCharacterPortraits = $state<Record<string, string | null>>({})
  generatingPortraitName = $state<string | null>(null)
  uploadingCharacterName = $state<string | null>(null)

  // Actions
  async generateProtagonistPortrait(protagonist: GeneratedProtagonist | null) {
    if (!protagonist || this.isGeneratingProtagonistPortrait) return

    const imageSettings = settings.systemServicesSettings.imageGeneration

    log('Starting protagonist portrait generation', {
      protagonistName: protagonist.name,
      model: settings.getImageProfile(imageSettings.portraitProfileId ?? '')?.model ?? '',
      styleId: imageSettings.portraitStyleId,
    })

    if (!hasRequiredCredentials()) {
      const providerName = getProviderDisplayName()
      log('Missing credentials for provider', { provider: providerName })
      this.portraitError = `${providerName} API key required for portrait generation`
      return
    }

    const descriptors = this.protagonistVisualDescriptors.trim()
    if (!descriptors) {
      log('No visual descriptors provided')
      this.portraitError = 'Add appearance descriptors first'
      return
    }

    this.isGeneratingProtagonistPortrait = true
    this.portraitError = null

    try {
      const stylePrompt = await getStylePrompt(imageSettings.styleId)
      const portraitPrompt = await buildPortraitPrompt(stylePrompt, descriptors, protagonist.name)

      log('Sending protagonist portrait request', {
        promptLength: portraitPrompt.length,
      })

      const base64 = await sdkGeneratePortrait(portraitPrompt)

      log('Protagonist portrait generated successfully', {
        protagonistName: protagonist.name,
      })

      this.protagonistPortrait = `data:image/png;base64,${base64}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate portrait'
      log('Protagonist portrait generation failed', {
        protagonistName: protagonist.name,
        error: errorMessage,
      })
      this.portraitError = errorMessage
    } finally {
      this.isGeneratingProtagonistPortrait = false
    }
  }

  async generateSupportingCharacterPortrait(
    charName: string,
    supportingCharacters: GeneratedCharacter[],
  ) {
    const char = supportingCharacters.find((c) => c.name === charName)
    if (!char || this.generatingPortraitName !== null) return

    const imageSettings = settings.systemServicesSettings.imageGeneration

    log('Starting supporting character portrait generation', {
      characterName: charName,
      model: settings.getImageProfile(imageSettings.portraitProfileId ?? '')?.model ?? '',
      styleId: imageSettings.portraitStyleId,
    })

    if (!hasRequiredCredentials()) {
      const providerName = getProviderDisplayName()
      log('Missing credentials for provider', { provider: providerName })
      this.portraitError = `${providerName} API key required for portrait generation`
      return
    }

    const descriptors = (this.supportingCharacterVisualDescriptors[charName] || '').trim()
    if (!descriptors) {
      log('No visual descriptors provided for character', { characterName: charName })
      this.portraitError = `Add appearance descriptors for ${char.name} first`
      return
    }

    this.generatingPortraitName = charName
    this.portraitError = null

    try {
      const stylePrompt = await getStylePrompt(imageSettings.portraitStyleId)
      const portraitPrompt = await buildPortraitPrompt(stylePrompt, descriptors, char.name)

      log('Sending supporting character portrait request', {
        characterName: charName,
        promptLength: portraitPrompt.length,
      })

      const base64 = await sdkGeneratePortrait(portraitPrompt)

      log('Supporting character portrait generated successfully', {
        characterName: charName,
      })

      this.supportingCharacterPortraits[charName] = `data:image/png;base64,${base64}`
      // Force update for reactive map
      this.supportingCharacterPortraits = { ...this.supportingCharacterPortraits }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate portrait'
      log('Supporting character portrait generation failed', {
        characterName: charName,
        error: errorMessage,
      })
      this.portraitError = errorMessage
    } finally {
      this.generatingPortraitName = null
    }
  }

  removeProtagonistPortrait() {
    this.protagonistPortrait = null
    this.portraitError = null
  }

  removeSupportingCharacterPortrait(charName: string) {
    this.supportingCharacterPortraits[charName] = null
    this.supportingCharacterPortraits = { ...this.supportingCharacterPortraits }
    this.portraitError = null
  }

  async handleProtagonistPortraitUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    this.isUploadingProtagonistPortrait = true
    this.portraitError = null

    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select an image file')
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be smaller than 5MB')
      }

      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result
          if (typeof result !== 'string' || !result.startsWith('data:image/')) {
            reject(new Error('Failed to read image data'))
            return
          }
          resolve(result)
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })

      this.protagonistPortrait = dataUrl
    } catch (error) {
      this.portraitError = error instanceof Error ? error.message : 'Failed to upload portrait'
    } finally {
      this.isUploadingProtagonistPortrait = false
      input.value = ''
    }
  }

  async handleSupportingCharacterPortraitUpload(event: Event, charName: string) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    this.uploadingCharacterName = charName
    this.portraitError = null

    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please select an image file')
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Image must be smaller than 5MB')
      }

      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result
          if (typeof result !== 'string' || !result.startsWith('data:image/')) {
            reject(new Error('Failed to read image data'))
            return
          }
          resolve(result)
        }
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })

      this.supportingCharacterPortraits[charName] = dataUrl
      this.supportingCharacterPortraits = { ...this.supportingCharacterPortraits }
    } catch (error) {
      this.portraitError = error instanceof Error ? error.message : 'Failed to upload portrait'
    } finally {
      this.uploadingCharacterName = null
      input.value = ''
    }
  }
}
