<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import * as Select from '$lib/components/ui/select'
  import { Slider } from '$lib/components/ui/slider'
  import { Play, Square, RefreshCw, Loader2 } from '@lucide/svelte'
  import { GOOGLE_TRANSLATE_LANGUAGES, aiTTSService } from '$lib/services/ai/utils/TTSService'

  const PREVIEW_TEXT =
    'This is a preview of the selected voice. The story narration will sound like this.'

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
    }
    return null
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

      <!-- Voice -->
      <div>
        <Label class="mb-2 block">Voice</Label>
        <Input
          type="text"
          class="w-full"
          value={settings.systemServicesSettings.tts.voice}
          oninput={(e) => {
            const voice = e.currentTarget.value
            settings.systemServicesSettings.tts.voice = voice
            if (settings.systemServicesSettings.tts.providerVoices) {
              settings.systemServicesSettings.tts.providerVoices['openai'] = voice
            }
            settings.saveSystemServicesSettings()
          }}
          placeholder="alloy"
        />
      </div>
    {:else if settings.systemServicesSettings.tts.provider === 'microsoft'}
      <!-- Windows System Voice Selection -->
      <div>
        <Label class="mb-2 block">System Voice</Label>
        {#if isLoadingVoices}
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading system voices...
          </div>
        {:else if systemVoices.length === 0}
          <div class="text-muted-foreground text-sm">
            No system voices found. Make sure you're running on Windows with TTS voices installed.
          </div>
        {:else}
          <Select.Root
            type="single"
            value={settings.systemServicesSettings.tts.voice}
            onValueChange={(v) => {
              settings.systemServicesSettings.tts.voice = v
              if (settings.systemServicesSettings.tts.providerVoices) {
                settings.systemServicesSettings.tts.providerVoices['microsoft'] = v
              }
              settings.saveSystemServicesSettings()
            }}
          >
            <Select.Trigger class="h-10 w-full">
              {systemVoices.find((v) => v.name === settings.systemServicesSettings.tts.voice)
                ?.name ?? 'Select system voice'}
            </Select.Trigger>
            <Select.Content>
              {#each systemVoices as voice (voice.name)}
                <Select.Item value={voice.name} label={voice.name}>
                  {voice.name}
                  <span class="text-muted-foreground ml-2 text-xs">({voice.lang})</span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    {:else if settings.systemServicesSettings.tts.provider === 'google'}
      <!-- Language Selection -->
      <div>
        <Label class="mb-2 block">Language</Label>
        <Select.Root
          type="single"
          value={settings.systemServicesSettings.tts.voice}
          onValueChange={(v) => {
            settings.systemServicesSettings.tts.voice = v
            if (settings.systemServicesSettings.tts.providerVoices) {
              settings.systemServicesSettings.tts.providerVoices['google'] = v
            }
            settings.saveSystemServicesSettings()
          }}
        >
          <Select.Trigger class="h-10 w-full">
            {GOOGLE_TRANSLATE_LANGUAGES.find(
              (l) => l.id === settings.systemServicesSettings.tts.voice,
            )?.name ?? 'Select language'}
          </Select.Trigger>
          <Select.Content>
            {#each GOOGLE_TRANSLATE_LANGUAGES as lang (lang.id)}
              <Select.Item value={lang.id} label={lang.name}>
                {lang.name}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
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
