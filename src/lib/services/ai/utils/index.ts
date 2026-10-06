/**
 * AI Utilities Module
 *
 * Utility services and helpers for AI operations:
 * - Translation: Multi-language translation service
 * - TTS: Text-to-speech service
 */

export {
  TranslationService,
  type Translated,
  type TranslationResult,
  type UITranslationItem,
} from './TranslationService'

export {
  AITTSService,
  aiTTSService,
  TTSProvider,
  GoogleTranslateTTSProvider,
  OpenAICompatibleTTSProvider,
  MicrosoftSpeechProvider,
  GOOGLE_TRANSLATE_LANGUAGES,
  DEFAULT_SPEECH_RATE,
  DEFAULT_PITCH,
  DEFAULT_VOLUME,
  type TTSSettings,
  type TTSVoice,
} from './TTSService'
