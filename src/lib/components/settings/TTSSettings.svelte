<script lang="ts">
  import { onDestroy } from 'svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { createDebouncedSave } from '$lib/utils/debounce'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import * as Select from '$lib/components/ui/select'
  import { Slider } from '$lib/components/ui/slider'
  import { Play, Square, RefreshCw, Loader2 } from '@lucide/svelte'
  import { GOOGLE_TRANSLATE_LANGUAGES, aiTTSService } from '$lib/services/ai/utils/TTSService'
  import {
    prepareTTSSegments,
    resolveDialogueVoice,
    supportsDialogueVoice,
  } from '$lib/services/ai/utils/ttsText'
  import TTSVoiceSelector from './TTSVoiceSelector.svelte'

  const PREVIEW_TEXT =
    'This is a preview of the selected voice. The story narration will sound like this.'

  /** Holds a quote, so the preview demonstrates the hand-off between the two voices. */
  const DIALOGUE_PREVIEW_TEXT =
    'The captain leaned closer. "We sail before dawn," she said, and turned away.'

  let isPlayingPreview = $state(false)
  let isLoadingPreview = $state(false)
  let previewError = $state<string | null>(null)
  interface SystemVoice {
    name: string
    lang: string
  }

  let systemVoices = $state<SystemVoice[]>([])
  let isLoadingVoices = $state(false)

  /**
   * Load system voices when Microsoft provider is selected
   * Uses the TTS service to ensure consistent voice handling
   */
  async function loadSystemVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return
    }

    isLoadingVoices = true

    try {
      // Initialize the service to get properly formatted voices
      await aiTTSService.initialize({
        ...settings.systemServicesSettings.tts,
        provider: 'microsoft',
      })

      const voices = await aiTTSService.getAvailableVoices()
      systemVoices = voices.map((v) => ({ name: v.name, lang: v.lang }))
    } catch (error) {
      console.error('[TTSSettings] Failed to load system voices:', error)
      systemVoices = []
    } finally {
      isLoadingVoices = false
    }
  }

  // Load voices when provider changes to microsoft
  $effect(() => {
    if (settings.systemServicesSettings.tts.provider === 'microsoft') {
      loadSystemVoices()
    }
  })

  const dialogueVoiceSupported = $derived(
    supportsDialogueVoice(settings.systemServicesSettings.tts.provider),
  )

  /**
   * The voice fields accept free text on OpenAI-compatible endpoints, so a keystroke
   * would otherwise rewrite the whole settings blob to SQLite. The store update stays
   * immediate — only the write waits.
   */
  const { trigger: triggerVoiceSave, flush: flushVoiceSave } = createDebouncedSave(() =>
    settings.saveSystemServicesSettings(),
  )

  onDestroy(() => flushVoiceSave())

  /** Store a voice both in the active slot and in its provider-specific memory,
   * so switching provider and back restores what was chosen there. */
  function setVoice(voice: string) {
    const tts = settings.systemServicesSettings.tts
    tts.voice = voice
    if (tts.providerVoices) tts.providerVoices[tts.provider] = voice
    triggerVoiceSave()
  }

  function setDialogueVoice(voice: string) {
    const tts = settings.systemServicesSettings.tts
    tts.dialogueVoice = voice
    if (tts.providerDialogueVoices) tts.providerDialogueVoices[tts.provider] = voice
    triggerVoiceSave()
  }

  const providers = [
    { value: 'openai', label: 'OpenAI Compatible (OpenRouter, OpenAI, Local)' },
    { value: 'google', label: 'Google Translate' },
    { value: 'microsoft', label: 'Windows System TTS (Microsoft SAPI)' },
  ] as const

  /**
   * Validate TTS settings before preview
   */
  function validateTTSSettings(): string | null {
    const tts = settings.systemServicesSettings.tts

    if (tts.provider === 'openai') {
      if (!tts.endpoint || !tts.apiKey) {
        return 'Endpoint and API key are required'
      }
    } else if (tts.provider === 'microsoft') {
      if (!tts.voice) {
        return 'Please select a system voice'
      }
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        return 'Speech Synthesis API is not available in your browser'
      }
      if (systemVoices.length > 0 && !systemVoices.some((v) => v.name === tts.voice)) {
        return `Voice "${tts.voice}" not found. Please select a different voice.`
      }

      // The dialogue voice is resolved before any audio plays, so a stale one must be
      // caught here rather than halfway through an entry.
      const dialogueVoice = resolveDialogueVoice(tts)
      if (
        dialogueVoice &&
        systemVoices.length > 0 &&
        !systemVoices.some((v) => v.name === dialogueVoice)
      ) {
        return `Dialogue voice "${dialogueVoice}" not found. Please select a different voice.`
      }
    }
    return null
  }

  /**
   * Preview both voices on one line of prose.
   *
   * Goes through the same `prepareTTSSegments` the story path uses — a preview built
   * from its own segmentation could sound right while playback misbehaves.
   */
  async function playDialoguePreview() {
    const tts = settings.systemServicesSettings.tts
    const dialogueVoice = resolveDialogueVoice(tts)
    if (!tts.enabled || !dialogueVoice || isPlayingPreview || isLoadingPreview) return

    const validationError = validateTTSSettings()
    if (validationError) {
      previewError = validationError
      return
    }

    isLoadingPreview = true
    previewError = null

    try {
      await aiTTSService.initialize(tts)

      isPlayingPreview = true
      isLoadingPreview = false

      await aiTTSService.generateAndPlay(
        prepareTTSSegments(DIALOGUE_PREVIEW_TEXT, {
          narratorVoice: tts.voice,
          dialogueVoice,
          excludedCharacters: tts.excludedCharacters,
        }),
      )

      isPlayingPreview = false
    } catch (error) {
      console.error('[TTSSettings] Dialogue preview failed:', error)
      previewError = error instanceof Error ? error.message : 'Preview failed'
      isPlayingPreview = false
      isLoadingPreview = false
    }
  }

  async function playVoicePreview() {
    if (!settings.systemServicesSettings.tts.enabled || isPlayingPreview || isLoadingPreview) {
      return
    }

    const validationError = validateTTSSettings()
    if (validationError) {
      previewError = validationError
      return
    }

    const tts = settings.systemServicesSettings.tts

    isLoadingPreview = true
    previewError = null

    try {
      await aiTTSService.initialize(tts)

      isPlayingPreview = true
      isLoadingPreview = false

      await aiTTSService.generateAndPlay(PREVIEW_TEXT, tts.voice)

      isPlayingPreview = false
    } catch (error) {
      console.error('[TTSSettings] Preview failed:', error)
      previewError = error instanceof Error ? error.message : 'Preview failed'
      isPlayingPreview = false
      isLoadingPreview = false
    }
  }

  function stopPreview() {
    aiTTSService.stopPlayback()
    isPlayingPreview = false
    isLoadingPreview = false
  }

  function resetSettings() {
    settings.resetTTSSettings()
    previewError = null
  }
</script>

<div class="space-y-4">
  <!-- Enable TTS Toggle -->
  <div class="flex items-center justify-between">
    <div>
      <Label>Enable Text-to-Speech</Label>
      <p class="text-muted-foreground text-xs">Configure text-to-speech settings for narration.</p>
    </div>
    <Switch
      checked={settings.systemServicesSettings.tts.enabled}
      onCheckedChange={(v) => {
        settings.systemServicesSettings.tts.enabled = v
        settings.saveSystemServicesSettings()
      }}
    />
  </div>

  {#if settings.systemServicesSettings.tts.enabled}
    <!-- Provider Selection -->
    <div>
      <Label class="mb-2 block">TTS Provider</Label>
      <Select.Root
        type="single"
        value={settings.systemServicesSettings.tts.provider}
        onValueChange={(v) => {
          const provider = v as 'openai' | 'google' | 'microsoft'
          const tts = settings.systemServicesSettings.tts
          const previousProvider = tts.provider

          // Save current voice to provider-specific slot
          if (tts.providerVoices) {
            tts.providerVoices[tts.provider] = tts.voice
          }

          tts.provider = provider

          // Restore provider-specific voice
          if (tts.providerVoices?.[provider]) {
            tts.voice = tts.providerVoices[provider]
          } else {
            // Fallbacks if not initialized
            if (provider === 'openai') tts.voice = 'alloy'
            else if (provider === 'google') tts.voice = 'en'
            else if (provider === 'microsoft') tts.voice = '' // Will be set when user selects from dropdown
          }

          // Ensure google voice is valid
          if (
            provider === 'google' &&
            !GOOGLE_TRANSLATE_LANGUAGES.some((lang) => lang.id === tts.voice)
          ) {
            tts.voice = 'en'
            if (tts.providerVoices) tts.providerVoices['google'] = 'en'
          }

          // Same round-trip for the dialogue voice. Without its own memory a voice id
          // from one provider would be left sitting in another provider's slot.
          if (tts.providerDialogueVoices) {
            tts.providerDialogueVoices[previousProvider] = tts.dialogueVoice
            tts.dialogueVoice = tts.providerDialogueVoices[provider] ?? ''
          }

          settings.saveSystemServicesSettings()
        }}
      >
        <Select.Trigger class="h-10 w-full">
          {providers.find((p) => p.value === settings.systemServicesSettings.tts.provider)?.label ??
            'Select provider'}
        </Select.Trigger>
        <Select.Content>
          {#each providers as provider (provider.value)}
            <Select.Item value={provider.value} label={provider.label}>
              {provider.label}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    {#if settings.systemServicesSettings.tts.provider === 'openai'}
      <!-- API Endpoint -->
      <div>
        <Label class="mb-2 block">API Endpoint</Label>
        <Input
          type="text"
          class="w-full"
          value={settings.systemServicesSettings.tts.endpoint}
          oninput={(e) => {
            settings.systemServicesSettings.tts.endpoint = e.currentTarget.value
            settings.saveSystemServicesSettings()
          }}
          placeholder="https://api.openai.com/v1/audio/speech"
        />
      </div>

      <!-- API Key -->
      <div>
        <Label class="mb-2 block">API Key</Label>
        <Input
          type="password"
          class="w-full"
          value={settings.systemServicesSettings.tts.apiKey}
          oninput={(e) => {
            settings.systemServicesSettings.tts.apiKey = e.currentTarget.value
            settings.saveSystemServicesSettings()
          }}
          placeholder="Enter your API key"
        />
      </div>

      <!-- TTS Model -->
      <div>
        <Label class="mb-2 block">TTS Model</Label>
        <Input
          type="text"
          class="w-full"
          value={settings.systemServicesSettings.tts.model}
          oninput={(e) => {
            settings.systemServicesSettings.tts.model = e.currentTarget.value
            settings.saveSystemServicesSettings()
          }}
          placeholder="tts-1"
        />
      </div>
    {/if}

    <!-- Narrator voice -->
    <TTSVoiceSelector
      id="tts-narrator-voice"
      provider={settings.systemServicesSettings.tts.provider}
      value={settings.systemServicesSettings.tts.voice}
      label={settings.systemServicesSettings.tts.provider === 'google' ? 'Language' : 'Voice'}
      description={dialogueVoiceSupported &&
      settings.systemServicesSettings.tts.dialogueVoiceEnabled
        ? 'Used for narration outside quotation marks'
        : undefined}
      {systemVoices}
      {isLoadingVoices}
      onChange={(v) => setVoice(v)}
    />

    {#if dialogueVoiceSupported}
      <!-- Dialogue voice -->
      <div class="space-y-3 rounded-lg border p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <Label for="tts-dialogue-voice-enabled">Separate Dialogue Voice</Label>
            <p class="text-muted-foreground text-xs">
              Speak text inside quotation marks in a second voice
            </p>
          </div>
          <Switch
            id="tts-dialogue-voice-enabled"
            checked={settings.systemServicesSettings.tts.dialogueVoiceEnabled}
            onCheckedChange={(v) => {
              settings.systemServicesSettings.tts.dialogueVoiceEnabled = v
              settings.saveSystemServicesSettings()
            }}
          />
        </div>

        {#if settings.systemServicesSettings.tts.dialogueVoiceEnabled}
          <TTSVoiceSelector
            id="tts-dialogue-voice"
            provider={settings.systemServicesSettings.tts.provider}
            value={settings.systemServicesSettings.tts.dialogueVoice}
            label="Dialogue Voice"
            description="Recognises &quot;…&quot;, &ldquo;…&rdquo; and «…». Leave empty to keep one voice."
            {systemVoices}
            {isLoadingVoices}
            placeholder="nova"
            onChange={(v) => setDialogueVoice(v)}
          />

          <p class="text-muted-foreground text-xs">
            To keep the quotation marks themselves from being read aloud, add them to
            <em>Excluded Characters</em> below.
          </p>
        {/if}
      </div>
    {/if}

    <!-- Voice Preview -->
    <div>
      <Button
        variant="outline"
        class="w-full"
        onclick={isPlayingPreview ? stopPreview : playVoicePreview}
        disabled={isLoadingPreview}
      >
        {#if isLoadingPreview}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          Loading...
        {:else if isPlayingPreview}
          <Square class="mr-2 h-4 w-4" />
          Stop
        {:else}
          <Play class="mr-2 h-4 w-4" />
          Preview Voice
        {/if}
      </Button>

      {#if dialogueVoiceSupported && resolveDialogueVoice(settings.systemServicesSettings.tts)}
        <Button
          variant="outline"
          class="mt-2 w-full"
          onclick={isPlayingPreview ? stopPreview : playDialoguePreview}
          disabled={isLoadingPreview}
        >
          {#if isLoadingPreview}
            <Loader2 class="mr-2 h-4 w-4 animate-spin" />
            Loading...
          {:else if isPlayingPreview}
            <Square class="mr-2 h-4 w-4" />
            Stop
          {:else}
            <Play class="mr-2 h-4 w-4" />
            Preview Both Voices
          {/if}
        </Button>
      {/if}
      {#if previewError}
        <p class="text-destructive mt-2 text-xs">{previewError}</p>
      {/if}
    </div>

    <!-- Volume Control -->
    <div class="border-border bg-muted/20 space-y-4 rounded-lg border p-4">
      <div class="flex items-center justify-between">
        <div>
          <Label>Volume Override</Label>
          <p class="text-muted-foreground text-xs">Manually control TTS narration volume.</p>
        </div>
        <Switch
          checked={settings.systemServicesSettings.tts.volumeOverride}
          onCheckedChange={(v) => {
            settings.systemServicesSettings.tts.volumeOverride = v
            settings.saveSystemServicesSettings()
          }}
        />
      </div>

      {#if settings.systemServicesSettings.tts.volumeOverride}
        <div>
          <Label class="mb-2 block">
            Narration Volume: {Math.round(settings.systemServicesSettings.tts.volume * 100)}%
          </Label>
          <Slider
            value={settings.systemServicesSettings.tts.volume}
            onValueChange={(v) => {
              settings.systemServicesSettings.tts.volume = v
              settings.saveSystemServicesSettings()
            }}
            type="single"
            min={0}
            max={1}
            step={0.01}
            class="w-full"
          />
        </div>
      {/if}
    </div>

    <!-- Speech Speed -->
    <div>
      <Label class="mb-2 block">
        Speech Speed: {settings.systemServicesSettings.tts.speed.toFixed(2)}x
      </Label>
      <Slider
        value={settings.systemServicesSettings.tts.speed}
        onValueChange={(v) => {
          settings.systemServicesSettings.tts.speed = v
          settings.saveSystemServicesSettings()
        }}
        type="single"
        min={0.25}
        max={4}
        step={0.05}
        class="w-full"
      />
      <p class="text-muted-foreground mt-1 text-xs">
        Adjust the speed of speech generation (0.25-4.0).
      </p>
    </div>

    <!-- Auto-Play Toggle -->
    <div class="flex items-center justify-between">
      <div>
        <Label>Auto-Play Narration</Label>
        <p class="text-muted-foreground text-xs">
          Automatically play TTS audio when story is narrated.
        </p>
      </div>
      <Switch
        checked={settings.systemServicesSettings.tts.autoPlay}
        onCheckedChange={(v) => {
          settings.systemServicesSettings.tts.autoPlay = v
          settings.saveSystemServicesSettings()
        }}
      />
    </div>

    <!-- Excluded Characters -->
    <div>
      <Label class="mb-2 block">Excluded Characters</Label>
      <Input
        type="text"
        class="w-full"
        value={settings.systemServicesSettings.tts.excludedCharacters}
        oninput={(e) => {
          settings.systemServicesSettings.tts.excludedCharacters = e.currentTarget.value
          settings.saveSystemServicesSettings()
        }}
        placeholder="Comma-separated characters (e.g., *, #, _, ~)"
      />
      <p class="text-muted-foreground mt-1 text-xs">Characters excluded from TTS narration.</p>
    </div>
    <div class="border-border bg-muted/20 space-y-4 rounded-lg border p-4">
      <!-- Remove HTML tags Toggle -->
      <div class="flex items-center justify-between">
        <div>
          <Label>Remove HTML tags</Label>
          <p class="text-muted-foreground text-xs">
            Remove HTML tags from narrated text before sending to TTS.
          </p>
        </div>
        <Switch
          checked={settings.systemServicesSettings.tts.removeHtmlTags}
          onCheckedChange={(v) => {
            settings.systemServicesSettings.tts.removeHtmlTags = v
            settings.saveSystemServicesSettings()
          }}
        />
      </div>

      {#if settings.systemServicesSettings.tts.removeHtmlTags}
        <!-- HTML tags to remove content from -->
        <div>
          <Label class="mb-2 block">HTML tags to remove content from</Label>
          <Input
            type="text"
            class="w-full"
            value={settings.systemServicesSettings.tts.htmlTagsToRemoveContent}
            oninput={(e) => {
              settings.systemServicesSettings.tts.htmlTagsToRemoveContent = e.currentTarget.value
              settings.saveSystemServicesSettings()
            }}
            placeholder="Comma-separated HTML tags (e.g., div, span, font)"
            disabled={settings.systemServicesSettings.tts.removeAllHtmlContent}
          />
          <p class="text-muted-foreground mt-1 text-xs">
            Comma-separated list of HTML tags whose content should be removed before narration.
          </p>
        </div>

        <!-- Remove all tag content Toggle -->
        <div class="flex items-center justify-between">
          <div>
            <Label>Remove all tag content</Label>
            <p class="text-muted-foreground text-xs">
              Removes content inside any HTML tag before narration.
            </p>
          </div>
          <Switch
            checked={settings.systemServicesSettings.tts.removeAllHtmlContent}
            onCheckedChange={(v) => {
              settings.systemServicesSettings.tts.removeAllHtmlContent = v
              settings.saveSystemServicesSettings()
            }}
          />
        </div>
      {/if}
    </div>
    <!-- Reset Button -->
    <Button variant="outline" size="sm" onclick={resetSettings}>
      <RefreshCw class="mr-1 h-3 w-3" />
      Reset to Defaults
    </Button>
  {/if}
</div>
