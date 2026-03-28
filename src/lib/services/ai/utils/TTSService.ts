/**
 * Text-To-Speech (TTS) Service
 * Provides audio generation via OpenAI-compatible APIs (and others) with streaming support.
 * Designed for extensibility to support multiple TTS providers.
 */

import { PROVIDERS } from '$lib/constants/providerConfig'
import { corsFetch } from '$lib/services/discovery/utils'

// Constants
export const DEFAULT_SPEECH_RATE = 1.0
export const DEFAULT_PITCH = 1.0
export const DEFAULT_VOLUME = 1.0

// TTS Configuration - matches TTSServiceSettings in settings.svelte.ts
export interface TTSSettings {
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
  voice: string
  speed: number
  autoPlay: boolean
  excludedCharacters: string
  removeHtmlTags: boolean
  removeAllHtmlContent: boolean
  htmlTagsToRemoveContent: string
  provider: 'openai' | 'google' | 'microsoft'
  volume: number
  volumeOverride: boolean
  providerVoices: Record<string, string>
}

export interface TTSVoice {
  name: string
  id: string
  lang: string
}

/**
 * Sort voices with Microsoft voices prioritized first
 */
function sortVoicesByPriority(voices: TTSVoice[]): TTSVoice[] {
  return voices.sort((a, b) => {
    const aMicrosoft = a.name.toLowerCase().includes('microsoft')
    const bMicrosoft = b.name.toLowerCase().includes('microsoft')
    if (aMicrosoft && !bMicrosoft) return -1
    if (!aMicrosoft && bMicrosoft) return 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Map SpeechSynthesisError to user-friendly error message
 */
function mapSpeechErrorToMessage(error: string): string {
  const errorMap: Record<string, string> = {
    canceled: 'Speech was canceled',
    interrupted: 'Speech was interrupted',
    'audio-busy': 'Audio device is busy',
    'audio-hardware': 'Audio hardware error',
    network: 'Network error during speech synthesis',
    'synthesis-unavailable': 'Speech synthesis is unavailable',
    'synthesis-failed': 'Speech synthesis failed',
    'language-unavailable': 'Selected language is not available',
    'voice-unavailable': 'Selected voice is not available',
    'text-too-long': 'Text is too long for speech synthesis',
    'invalid-argument': 'Invalid speech synthesis argument',
    'not-allowed': 'Speech synthesis not allowed (may require user interaction)',
  }
  return errorMap[error] || 'Speech synthesis failed'
}

/**
 * Base TTS Provider - extend this for custom implementations
 */
export abstract class TTSProvider {
  private currentAudio: HTMLAudioElement | null = null

  abstract get name(): string
  abstract get maxChunkLength(): number

  /**
   * Get available voices for this provider
   */
  abstract getAvailableVoices(): Promise<TTSVoice[]>

  /**
   * Generate TTS audio for a single text chunk.
   */
  protected abstract generateChunk(text: string, voice: string): Promise<Blob>

  /**
   * Generate TTS audio, splitting long text into chunks.
   */
  async generateSpeech(text: string, voice: string): Promise<Blob[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('TTS: Cannot generate speech for empty text')
    }

    const chunks = splitTextForTTS(text, this.maxChunkLength)
    const blobs: Blob[] = []
    for (const chunk of chunks) {
      blobs.push(await this.generateChunk(chunk, voice))
    }
    return blobs
  }

  protected stopped = false

  /**
   * Play a single audio blob using HTML Audio element.
   * Creates a fresh element each time to avoid GStreamer crashes on Linux.
   */
  private playSingleBlob(
    blob: Blob,
    onProgress?: (progress: number, duration: number) => void,
    playbackRate = 1.0,
    volume = 1.0,
    volumeOverride = false,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio()
      this.currentAudio = audio
      if (volumeOverride) {
        audio.volume = volume
      }

      const cleanup = () => {
        audio.oncanplaythrough = null
        audio.onended = null
        audio.onerror = null
        audio.ontimeupdate = null
        // Release the PulseAudio/PipeWire stream by fully detaching the source
        audio.pause()
        URL.revokeObjectURL(url)
        audio.removeAttribute('src')
        audio.load()
      }

      audio.onerror = (e) => {
        if (this.currentAudio !== audio) return
        console.error('[TTS] Audio playback error:', e)
        cleanup()
        this.currentAudio = null
        reject(new Error('Failed to play audio'))
      }

      audio.onended = () => {
        if (this.currentAudio !== audio) return
        cleanup()
        this.currentAudio = null
        resolve()
      }

      if (onProgress) {
        audio.ontimeupdate = () => {
          if (audio.duration) {
            onProgress(audio.currentTime, audio.duration)
          }
        }
      }

      audio.oncanplaythrough = () => {
        if (this.currentAudio !== audio) return
        try {
          if (playbackRate !== 1.0) {
            audio.playbackRate = playbackRate
          }
          audio.play().catch((err) => {
            if (this.currentAudio !== audio) return
            console.error('[TTS] Play failed:', err)
            cleanup()
            this.currentAudio = null
            reject(err)
          })
        } catch (err) {
          if (this.currentAudio !== audio) return
          console.error('[TTS] Error during playback setup:', err)
          cleanup()
          this.currentAudio = null
          reject(err)
        }
      }

      audio.src = url
      audio.load()
    })
  }

  /**
   * Generate and play TTS audio in a streaming pipeline.
   * Playback starts as soon as the first chunk is ready while remaining chunks
   * are generated in the background.
   */
  async streamAndPlay(
    text: string,
    voice: string,
    onProgress?: (progress: number) => void,
    playbackRate = 1.0,
    volume = 1.0,
    volumeOverride = false,
  ): Promise<void> {
    if (!text || text.trim().length === 0) {
      throw new Error('TTS: Cannot generate speech for empty text')
    }

    this.stopAudio()
    this.stopped = false

    const textChunks = splitTextForTTS(text, this.maxChunkLength)
    const totalChunks = textChunks.length

    // Queue: generated blobs ready for playback
    const ready: Blob[] = []
    let generationDone = false
    let generationError: Error | null = null

    // Signal mechanism for producer -> consumer notification
    let notifyChunk: () => void
    let chunkAvailable = new Promise<void>((resolve) => {
      notifyChunk = resolve
    })
    const signalChunk = () => {
      notifyChunk()
      chunkAvailable = new Promise<void>((resolve) => {
        notifyChunk = resolve
      })
    }

    // Producer: generate chunks in background with retry
    const MAX_RETRIES = 2
    const produceAll = async () => {
      try {
        for (const chunk of textChunks) {
          if (this.stopped) return
          let lastErr: Error | null = null
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              const blob = await this.generateChunk(chunk, voice)
              ready.push(blob)
              signalChunk()
              lastErr = null
              break
            } catch (err) {
              lastErr = err instanceof Error ? err : new Error(String(err))
              if (attempt < MAX_RETRIES) {
                console.warn(
                  `[TTS] Chunk generation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`,
                  lastErr,
                )
              }
            }
          }
          if (lastErr) throw lastErr
        }
      } catch (err) {
        generationError = err instanceof Error ? err : new Error(String(err))
      } finally {
        generationDone = true
        signalChunk()
      }
    }

    const generationPromise = produceAll()

    // Consumer: play chunks as they become available
    let playedIndex = 0
    while (true) {
      if (this.stopped) return

      if (playedIndex < ready.length) {
        const chunkProgress = onProgress
          ? (currentTime: number, duration: number) => {
              const base = (playedIndex / totalChunks) * 100
              const within = (currentTime / duration) * (1 / totalChunks) * 100
              onProgress(base + within)
            }
          : undefined

        await this.playSingleBlob(
          ready[playedIndex],
          chunkProgress,
          playbackRate,
          volume,
          volumeOverride,
        )
        playedIndex++
      } else if (generationDone) {
        if (generationError) throw generationError
        break
      } else {
        await chunkAvailable
      }
    }

    await generationPromise
  }

  /**
   * Stop current playback
   */
  stopAudio(): void {
    this.stopped = true
    if (this.currentAudio) {
      const audio = this.currentAudio
      // Clear reference FIRST to prevent callbacks from firing
      this.currentAudio = null

      try {
        // Clear all handlers to prevent any callbacks
        audio.oncanplaythrough = null
        audio.onended = null
        audio.onerror = null
        audio.ontimeupdate = null

        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  /**
   * Get current playback state
   */
  getPlaybackState(): { playing: boolean; progress: number; duration: number } {
    if (!this.currentAudio) {
      return { playing: false, progress: 0, duration: 0 }
    }
    return {
      playing: !this.currentAudio.paused,
      progress: this.currentAudio.currentTime,
      duration: this.currentAudio.duration || 0,
    }
  }
}

/**
 * Split text into chunks for TTS (Google Translate has ~200 char limit)
 * Similar to SillyTavern's splitRecursive approach
 */
function splitTextForTTS(text: string, maxLength = 200): string[] {
  if (!text || text.length === 0) return []
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  // Priority: paragraph breaks, sentence ends, commas, spaces
  const delimiters = ['\n\n', '\n', '. ', '! ', '? ', ', ', ' ']

  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitIndex = -1
    // Try each delimiter in priority order
    for (const delimiter of delimiters) {
      const searchRange = remaining.substring(0, maxLength)
      const lastIndex = searchRange.lastIndexOf(delimiter)
      if (lastIndex > 0) {
        splitIndex = lastIndex + delimiter.length
        break
      }
    }

    // If no delimiter found, force split at maxLength
    if (splitIndex === -1) {
      splitIndex = maxLength
    }

    const chunk = remaining.substring(0, splitIndex).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    remaining = remaining.substring(splitIndex).trim()
  }

  return chunks
}

export const GOOGLE_TRANSLATE_LANGUAGES: TTSVoice[] = [
  { name: 'English (US)', id: 'en', lang: 'en' },
  { name: 'English (UK)', id: 'en-GB', lang: 'en-GB' },
  { name: 'Italian', id: 'it', lang: 'it' },
  { name: 'Spanish', id: 'es', lang: 'es' },
  { name: 'French', id: 'fr', lang: 'fr' },
  { name: 'German', id: 'de', lang: 'de' },
  { name: 'Japanese', id: 'ja', lang: 'ja' },
  { name: 'Korean', id: 'ko', lang: 'ko' },
  { name: 'Chinese (Simplified)', id: 'zh-CN', lang: 'zh-CN' },
  { name: 'Chinese (Traditional)', id: 'zh-TW', lang: 'zh-TW' },
  { name: 'Russian', id: 'ru', lang: 'ru' },
  { name: 'Portuguese', id: 'pt', lang: 'pt' },
  { name: 'Dutch', id: 'nl', lang: 'nl' },
  { name: 'Polish', id: 'pl', lang: 'pl' },
  { name: 'Turkish', id: 'tr', lang: 'tr' },
]

/**
 * Google Translate TTS Provider
 * Unofficial API usage (similar to SillyTavern implementation)
 */
export class GoogleTranslateTTSProvider extends TTSProvider {
  private settings: TTSSettings

  constructor(settings: TTSSettings) {
    super()
    this.settings = settings
  }

  override get name(): string {
    return 'Google Translate'
  }

  override get maxChunkLength(): number {
    return 200
  }

  override async getAvailableVoices(): Promise<TTSVoice[]> {
    return GOOGLE_TRANSLATE_LANGUAGES
  }

  protected override async generateChunk(text: string, voice: string): Promise<Blob> {
    const encodedText = encodeURIComponent(text)
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=${voice}&client=tw-ob`

    const response = await corsFetch(url)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Google TTS generation failed: ${response.status} - ${error}`)
    }

    return response.blob()
  }
}

/**
 * Windows Built-in TTS Provider (SAPI)
 * Uses Web Speech Synthesis API to access Windows system voices
 * Supports voices like Microsoft Hazel Desktop, David, Zira, etc.
 */
export class MicrosoftSpeechProvider extends TTSProvider {
  private settings: TTSSettings
  private systemVoices: SpeechSynthesisVoice[] = []
  private voicesLoaded: boolean = false

  constructor(settings: TTSSettings) {
    super()
    this.settings = settings
    this.initializeVoices()
  }

  override get name(): string {
    return 'Windows System TTS'
  }

  override get maxChunkLength(): number {
    // Windows SAPI handles longer text well
    return 500
  }

  /**
   * Initialize system voices
   */
  private async initializeVoices(): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[TTS] Speech Synthesis API not available')
      return
    }

    // Load voices
    const loadVoices = () => {
      this.systemVoices = window.speechSynthesis.getVoices()
      this.voicesLoaded = true
    }

    // Voices may load asynchronously
    if (window.speechSynthesis.getVoices().length > 0) {
      loadVoices()
    } else {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }
  }

  /**
   * Wait for voices to be loaded
   */
  private async waitForVoices(): Promise<void> {
    if (this.voicesLoaded && this.systemVoices.length > 0) {
      return
    }

    const MAX_WAIT_TIME = 5000 // 5 seconds
    const POLL_INTERVAL = 100

    return new Promise((resolve, reject) => {
      let elapsedTime = 0
      const checkVoices = () => {
        const voices = window.speechSynthesis.getVoices()
        if (voices.length > 0) {
          this.systemVoices = voices
          this.voicesLoaded = true
          resolve()
        } else if (elapsedTime < MAX_WAIT_TIME) {
          elapsedTime += POLL_INTERVAL
          setTimeout(checkVoices, POLL_INTERVAL)
        } else {
          reject(new Error('System voices failed to load within the time limit.'))
        }
      }
      checkVoices()
    })
  }

  /**
   * Get available system voices
   */
  override async getAvailableVoices(): Promise<TTSVoice[]> {
    await this.waitForVoices()

    if (this.systemVoices.length === 0) {
      console.warn('[TTS] No system voices available')
      return []
    }

    // Convert SpeechSynthesisVoice to TTSVoice format
    const voices = this.systemVoices
      .filter((v) => v.localService) // Only local/system voices
      .map((v) => ({
        name: v.name,
        id: v.name, // Use voice name as ID for Web Speech API
        lang: v.lang,
      }))

    return sortVoicesByPriority(voices)
  }

  /**
   * Generate TTS audio using Web Speech Synthesis API
   * This method is not supported for MicrosoftSpeechProvider because the Web Speech API
   * does not allow direct access to the generated audio data as a Blob.
   * Playback must be handled via the overridden streamAndPlay method.
   */
  protected override async generateChunk(_text: string, _voice: string): Promise<Blob> {
    throw new Error('Generating audio blobs is not supported by the Windows System TTS provider.')
  }

  /**
   * Override streamAndPlay to use Web Speech API directly
   * Since we can't capture audio, we play directly instead of streaming blobs
   */
  override async streamAndPlay(
    text: string,
    voice: string,
    onProgress?: (progress: number) => void,
    playbackRate = 1.0,
    volume = 1.0,
    volumeOverride = false,
  ): Promise<void> {
    await this.waitForVoices()

    if (!window.speechSynthesis) {
      throw new Error('Speech Synthesis API not available')
    }

    // Find the voice
    const selectedVoice = this.systemVoices.find((v) => v.name === voice)
    if (!selectedVoice) {
      throw new Error(`Voice not found: ${voice}`)
    }

    // Reset stopped flag
    this.stopped = false

    // Split text into chunks
    const chunks = splitTextForTTS(text, this.maxChunkLength)

    // Speak each chunk sequentially
    for (let i = 0; i < chunks.length; i++) {
      if (this.stopped) break

      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(chunks[i])
        utterance.voice = selectedVoice
        utterance.rate = playbackRate
        utterance.pitch = DEFAULT_PITCH
        utterance.volume = volumeOverride ? volume : DEFAULT_VOLUME

        let hasEnded = false
        let hasErrored = false

        utterance.onerror = (event) => {
          if (hasEnded || hasErrored) return // Prevent duplicate error handling
          hasErrored = true
          console.error('[TTS] Speech synthesis error:', event.error)
          reject(new Error(mapSpeechErrorToMessage(event.error)))
        }

        utterance.onend = () => {
          if (hasErrored) return // Don't resolve if we already errored
          hasEnded = true
          if (onProgress) {
            const progress = ((i + 1) / chunks.length) * 100
            onProgress(progress)
          }
          resolve()
        }

        // Boundary event for progress tracking
        utterance.onboundary = (event) => {
          if (hasErrored) return
          if (onProgress && event.charIndex !== undefined) {
            const chunkProgress = (event.charIndex / chunks[i].length) * (1 / chunks.length) * 100
            const overallProgress = (i / chunks.length) * 100 + chunkProgress
            onProgress(overallProgress)
          }
        }

        // Wrap in try-catch to prevent any unhandled exceptions from showing dialogs
        try {
          window.speechSynthesis.speak(utterance)
        } catch (err) {
          hasErrored = true
          reject(
            new Error(
              `Failed to start speech synthesis: ${err instanceof Error ? err.message : 'Unknown error'}`,
            ),
          )
        }
      })
    }
  }

  /**
   * Override stopAudio to cancel speech synthesis
   */
  override stopAudio(): void {
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    } catch (err) {
      console.error('[TTS] Error canceling speech synthesis:', err)
    }
    this.stopped = true
  }
}

/**
 * OpenAI-compatible TTS Provider
 * Supports OpenAI, OpenRouter, and any OpenAI-compatible endpoint
 */
export class OpenAICompatibleTTSProvider extends TTSProvider {
  private settings: TTSSettings
  private voiceCache: Map<string, TTSVoice[]> = new Map()

  constructor(settings: TTSSettings) {
    super()
    this.settings = settings
  }

  override get name(): string {
    return 'OpenAI Compatible'
  }

  override get maxChunkLength(): number {
    return 300
  }

  /**
   * Get endpoint URL
   */
  private getEndpoint(): string {
    // If no custom endpoint, use OpenRouter default
    if (!this.settings.endpoint) {
      return `${PROVIDERS.openrouter.baseUrl}/audio/speech`
    }
    // Ensure endpoint ends with /audio/speech
    const url = this.settings.endpoint.replace(/\/$/, '')
    return url.endsWith('/audio/speech') ? url : `${url}/audio/speech`
  }

  /**
   * Verify settings are valid
   */
  private validateSettings(): void {
    if (!this.settings.apiKey) {
      throw new Error('TTS: No API key configured')
    }
    if (!this.settings.model) {
      throw new Error('TTS: No model selected')
    }
    if (!this.settings.voice) {
      throw new Error('TTS: No voice selected')
    }
  }

  /**
   * Get request headers
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.settings.apiKey}`,
    }
  }

  /**
   * Get available voices - cached per endpoint
   */
  override async getAvailableVoices(): Promise<TTSVoice[]> {
    const endpoint = this.getEndpoint()

    // Return cached voices if available
    if (this.voiceCache.has(endpoint)) {
      return this.voiceCache.get(endpoint)!
    }

    // Default voices matching OpenAI's standard set
    const defaultVoices: TTSVoice[] = [
      { name: 'Alloy', id: 'alloy', lang: 'en-US' },
      { name: 'Echo', id: 'echo', lang: 'en-US' },
      { name: 'Fable', id: 'fable', lang: 'en-US' },
      { name: 'Onyx', id: 'onyx', lang: 'en-US' },
      { name: 'Nova', id: 'nova', lang: 'en-US' },
      { name: 'Shimmer', id: 'shimmer', lang: 'en-US' },
    ]

    // Try to fetch custom voices from provider (optional)
    try {
      const response = await fetch(`${endpoint.replace('/audio/speech', '')}/models`, {
        headers: this.getHeaders(),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.data && Array.isArray(data.data)) {
          const voices = data.data
            .filter((m: any) => m.id?.includes('tts'))
            .map((m: any) => ({
              name: m.id,
              id: m.id,
              lang: 'en-US',
            }))
          if (voices.length > 0) {
            this.voiceCache.set(endpoint, voices)
            return voices
          }
        }
      }
    } catch (err) {
      console.warn('[TTS] Failed to fetch custom voices, using defaults', err)
    }

    this.voiceCache.set(endpoint, defaultVoices)
    return defaultVoices
  }

  /**
   * Generate TTS audio blob
   */
  protected override async generateChunk(text: string, voice: string): Promise<Blob> {
    this.validateSettings()

    const response = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.settings.model,
        input: text,
        voice: voice,
        response_format: 'mp3',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`TTS generation failed: ${response.status} - ${error}`)
    }

    return response.blob()
  }
}

/**
 * TTS Service - Main API for the application
 * Manages TTS operations and provider lifecycle
 */
export class AITTSService {
  private provider: TTSProvider | null = null
  private settings: TTSSettings | null = null
  private isPlaying = false

  /**
   * Initialize service with settings
   */
  async initialize(settings: TTSSettings): Promise<void> {
    this.settings = settings

    if (!settings.enabled) {
      this.provider = null
      return
    }

    try {
      if (settings.provider === 'google') {
        this.provider = new GoogleTranslateTTSProvider(settings)
      } else if (settings.provider === 'microsoft') {
        this.provider = new MicrosoftSpeechProvider(settings)
      } else {
        this.provider = new OpenAICompatibleTTSProvider(settings)
      }

      // Validate by fetching voices
      await this.provider.getAvailableVoices()
    } catch (error) {
      console.error('[TTSService] Failed to initialize provider:', error)
      this.provider = null
      throw error
    }
  }

  /**
   * Update settings and reinitialize if needed
   */
  async updateSettings(settings: Partial<TTSSettings>): Promise<void> {
    if (!this.settings) {
      throw new Error('TTS service not initialized')
    }

    this.settings = { ...this.settings, ...settings }
    await this.initialize(this.settings)
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return (this.settings?.enabled ?? false) && !!this.provider
  }

  /**
   * Get available voices
   */
  async getAvailableVoices(): Promise<TTSVoice[]> {
    if (!this.provider) {
      throw new Error('TTS provider not initialized')
    }
    return this.provider.getAvailableVoices()
  }

  /**
   * Generate and play TTS audio
   */
  async generateAndPlay(
    text: string,
    voice?: string,
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    if (!this.provider || !this.settings) {
      throw new Error('TTS service not ready')
    }

    const voiceToUse = voice || this.settings.voice
    // Speed is always applied client-side via playbackRate since not all
    // OpenAI-compatible servers (e.g. Kokoro) honor the speed parameter
    const playbackRate = this.settings.speed
    const volume = this.settings.volume
    const volumeOverride = this.settings.volumeOverride

    try {
      this.isPlaying = true
      await this.provider.streamAndPlay(
        text,
        voiceToUse,
        onProgress,
        playbackRate,
        volume,
        volumeOverride,
      )
    } finally {
      this.isPlaying = false
    }
  }

  /**
   * Generate TTS audio without playing
   */
  async generateSpeech(text: string, voice?: string): Promise<Blob[]> {
    if (!this.provider || !this.settings) {
      throw new Error('TTS service not ready')
    }

    const voiceToUse = voice || this.settings.voice
    return this.provider.generateSpeech(text, voiceToUse)
  }

  /**
   * Stop playback
   */
  stopPlayback(): void {
    if (!this.provider) return
    this.provider.stopAudio()
    this.isPlaying = false
  }

  /**
   * Check if currently playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying
  }

  /**
   * Get current playback progress
   */
  getPlaybackProgress(): {
    playing: boolean
    progress: number
    duration: number
  } {
    if (!this.provider) {
      return { playing: false, progress: 0, duration: 0 }
    }
    return this.provider.getPlaybackState()
  }
}

// Export singleton instance
export const aiTTSService = new AITTSService()
