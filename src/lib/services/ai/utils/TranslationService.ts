/**
 * Translation Service
 *
 * Handles translation of narrative content, user input, and UI elements
 * using the Vercel AI SDK.
 */

import type { TranslationSettings } from '$lib/types'
import { createLogger } from '../core/config'
import { generatePlainText, generateStructured } from '../sdk/generate'
import { ContextBuilder } from '$lib/services/context'
import {
  translatedUIResultSchema,
  translatedSuggestionsResultSchema,
  translatedActionChoicesResultSchema,
  translatedWizardBatchResultSchema,
} from '../sdk/schemas/translation'

const log = createLogger('Translation')

// Use Intl.DisplayNames for proper language name resolution
const languageDisplayNames = new Intl.DisplayNames(['en'], { type: 'language' })

// Common language codes for the UI dropdown
const SUPPORTED_LANGUAGE_CODES = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ja',
  'ko',
  'zh',
  'ru',
  'ar',
  'hi',
  'nl',
  'pl',
  'tr',
  'vi',
  'th',
  'id',
  'sv',
  'da',
  'no',
  'fi',
  'cs',
  'el',
  'he',
  'uk',
  'ro',
  'hu',
  'bg',
  'hr',
  'sk',
  'sl',
  'et',
  'lv',
  'lt',
  'ms',
  'fil',
  'bn',
  'ta',
  'te',
]

export interface TranslationResult {
  translatedContent: string
  detectedLanguage?: string
}

export interface UITranslationItem {
  id: string
  text: string
  type: 'name' | 'description' | 'title'
}

/**
 * Service that handles translation of narrative and UI content.
 */
export class TranslationService {
  private presetId: string

  constructor(presetId: string = 'translation') {
    this.presetId = presetId
  }

  /**
   * Get the human-readable name for a language code using Intl API
   */
  private getLanguageName(code: string): string {
    if (code === 'auto') return 'auto-detect'
    try {
      return languageDisplayNames.of(code) || code
    } catch {
      return code
    }
  }

  /**
   * Translate narration (post-generation).
   * Preserves HTML tags and <pic> tags in the content.
   */
  async translateNarration(
    content: string,
    targetLanguage: string,
    _isVisualProse: boolean = false,
  ): Promise<TranslationResult> {
    // Skip if target is English or content is empty
    if (targetLanguage === 'en' || !content.trim()) {
      return { translatedContent: content }
    }

    try {
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), content })
      const { system, user: prompt } = await ctx.render('translate-narration')

      const translatedContent = await generatePlainText(
        {
          presetId: this.presetId,
          system,
          prompt,
        },
        'translate-narration',
      )

      log('Translated narration to', targetLanguage)
      return { translatedContent: translatedContent.trim() }
    } catch (error) {
      log('Translation failed:', error)
      return { translatedContent: content } // Return original on failure
    }
  }

  /**
   * Translate user input to English.
   */
  async translateInput(content: string, sourceLanguage: string): Promise<TranslationResult> {
    // Skip if source is English or content is empty
    if (sourceLanguage === 'en' || !content.trim()) {
      return { translatedContent: content }
    }

    try {
      const ctx = new ContextBuilder()
      ctx.add({ sourceLanguage: this.getLanguageName(sourceLanguage), content })
      const { system, user: prompt } = await ctx.render('translate-input')

      const translatedContent = await generatePlainText(
        {
          presetId: this.presetId,
          system,
          prompt,
        },
        'translate-input',
      )

      log('Translated input from', sourceLanguage, 'to English')
      return { translatedContent: translatedContent.trim(), detectedLanguage: sourceLanguage }
    } catch (error) {
      log('Input translation failed:', error)
      return { translatedContent: content }
    }
  }

  /**
   * Batch translate UI elements.
   */
  async translateUIElements(
    items: UITranslationItem[],
    targetLanguage: string,
  ): Promise<UITranslationItem[]> {
    if (items.length === 0) return []
    if (targetLanguage === 'en') return items

    try {
      const elementsJson = JSON.stringify(
        items.map((item) => ({
          id: item.id,
          text: item.text,
          type: item.type,
        })),
      )
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), elementsJson })
      const { system, user: prompt } = await ctx.render('translate-ui')

      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: translatedUIResultSchema,
          system,
          prompt,
        },
        'translate-ui',
      )

      // Merge translated text back into original items
      log('Translated', result.items.length, 'UI elements to', targetLanguage)
      return items.map((original, index) => ({
        ...original,
        text: result.items[index]?.text ?? original.text,
      }))
    } catch (error) {
      log('UI translation failed:', error)
      return items // Return original on failure
    }
  }

  /**
   * Translate suggestions.
   * Preserves the original object structure, only replacing the text field.
   */
  async translateSuggestions<T extends { text: string; type?: string }>(
    suggestions: T[],
    targetLanguage: string,
  ): Promise<T[]> {
    if (suggestions.length === 0) return []
    if (targetLanguage === 'en') return suggestions

    try {
      const suggestionsJson = JSON.stringify(
        suggestions.map((s) => ({
          text: s.text,
          type: s.type,
        })),
      )
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), suggestionsJson })
      const { system, user: prompt } = await ctx.render('translate-suggestions')

      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: translatedSuggestionsResultSchema,
          system,
          prompt,
        },
        'translate-suggestions',
      )

      // Merge translated text back into original objects (preserves extra fields)
      log('Translated', result.suggestions.length, 'suggestions to', targetLanguage)
      return suggestions.map((original, index) => ({
        ...original,
        text: result.suggestions[index]?.text ?? original.text,
      }))
    } catch (error) {
      log('Suggestions translation failed:', error)
      return suggestions
    }
  }

  /**
   * Translate action choices.
   * Preserves the original object structure, only replacing the text field.
   */
  async translateActionChoices<T extends { text: string; type?: string }>(
    choices: T[],
    targetLanguage: string,
  ): Promise<T[]> {
    if (choices.length === 0) return []
    if (targetLanguage === 'en') return choices

    try {
      const choicesJson = JSON.stringify(
        choices.map((c) => ({
          text: c.text,
          type: c.type,
        })),
      )
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), choicesJson })
      const { system, user: prompt } = await ctx.render('translate-action-choices')

      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: translatedActionChoicesResultSchema,
          system,
          prompt,
        },
        'translate-action-choices',
      )

      // Merge translated text back into original objects (preserves extra fields)
      log('Translated', result.choices.length, 'action choices to', targetLanguage)
      return choices.map((original, index) => ({
        ...original,
        text: result.choices[index]?.text ?? original.text,
      }))
    } catch (error) {
      log('Action choices translation failed:', error)
      return choices
    }
  }

  /**
   * Translate wizard content.
   */
  async translateWizardContent(
    content: string,
    targetLanguage: string,
  ): Promise<TranslationResult> {
    if (targetLanguage === 'en' || !content.trim()) {
      return { translatedContent: content }
    }

    try {
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), content })
      const { system, user: prompt } = await ctx.render('translate-wizard-content')

      const translatedContent = await generatePlainText(
        {
          presetId: this.presetId,
          system,
          prompt,
        },
        'translate-wizard-content',
      )

      log('Translated wizard content to', targetLanguage)
      return { translatedContent: translatedContent.trim() }
    } catch (error) {
      log('Wizard content translation failed:', error)
      return { translatedContent: content }
    }
  }

  /**
   * Batch translate wizard content fields.
   */
  async translateWizardBatch(
    fields: Record<string, string>,
    targetLanguage: string,
  ): Promise<Record<string, string>> {
    if (targetLanguage === 'en') {
      return fields
    }

    const entries = Object.entries(fields)
    if (entries.length === 0) {
      return fields
    }

    try {
      // Format as JSON object with field keys
      const fieldsJson = JSON.stringify(fields)
      const ctx = new ContextBuilder()
      ctx.add({ targetLanguage: this.getLanguageName(targetLanguage), content: fieldsJson })
      const { system } = await ctx.render('translate-wizard-content')

      const prompt = `Translate each value in this JSON object to ${this.getLanguageName(targetLanguage)}. Keep the keys unchanged. Return a JSON object with the same keys and translated values.

${fieldsJson}`

      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: translatedWizardBatchResultSchema,
          system,
          prompt,
        },
        'translate-wizard-content',
      )

      // Merge results with fallback to original values
      log('Translated', Object.keys(result.translations).length, 'wizard fields to', targetLanguage)
      const translated: Record<string, string> = {}
      for (const [key, value] of entries) {
        translated[key] = result.translations[key] ?? value
      }
      return translated
    } catch (error) {
      log('Wizard batch translation failed:', error)
      return fields
    }
  }

  /**
   * Check if translation should be performed based on settings
   */
  static shouldTranslate(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.targetLanguage !== 'en'
  }

  /**
   * Check if user input translation should be performed
   */
  static shouldTranslateInput(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.translateUserInput
  }

  /**
   * Check if narration translation should be performed
   */
  static shouldTranslateNarration(translationSettings: TranslationSettings): boolean {
    return (
      translationSettings.enabled &&
      translationSettings.translateNarration &&
      translationSettings.targetLanguage !== 'en'
    )
  }

  /**
   * Check if world state UI translation should be performed
   */
  static shouldTranslateWorldState(translationSettings: TranslationSettings): boolean {
    return (
      translationSettings.enabled &&
      translationSettings.translateWorldState &&
      translationSettings.targetLanguage !== 'en'
    )
  }
}

/**
 * Get all supported language codes with their display names
 */
export function getSupportedLanguages(): { code: string; name: string }[] {
  return SUPPORTED_LANGUAGE_CODES.map((code) => {
    try {
      return { code, name: languageDisplayNames.of(code) || code }
    } catch {
      return { code, name: code }
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get language name for display using Intl API
 */
export function getLanguageDisplayName(code: string): string {
  if (code === 'auto') return 'Auto-detect'
  try {
    return languageDisplayNames.of(code) || code
  } catch {
    return code
  }
}
