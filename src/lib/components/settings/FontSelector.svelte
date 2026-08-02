<script lang="ts">
  import type { FontSource } from '$lib/types'
  import { settings } from '$lib/stores/settings.svelte'
  import { Loader2 } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { getAvailableSystemFonts } from '$lib/utils/fontDetection'

  // Popular Google Fonts for stories/reading
  // Verified against fonts.google.com
  const popularGoogleFonts = [
    'Merriweather',
    'Lora',
    'Crimson Text',
    'Libre Baskerville',
    'Source Serif 4',
    'Playfair Display',
    'EB Garamond',
    'Cormorant Garamond',
    'Spectral',
    'Bitter',
    'Literata',
    'Newsreader',
    'IBM Plex Serif',
    'Noto Serif',
    'PT Serif',
    'Alegreya',
    'Vollkorn',
    'Cardo',
    'Sorts Mill Goudy',
    'Old Standard TT',
  ]

  // Detected system fonts (populated on mount)
  let availableFonts = $state<{
    serif: string[]
    sansSerif: string[]
    monospace: string[]
  }>({ serif: [], sansSerif: [], monospace: [] })
  let fontsDetected = $state(false)

  let fontSource = $state<FontSource>(settings.uiSettings.fontSource)
  let selectedFont = $state(settings.uiSettings.fontFamily)
  let customGoogleFont = $state('')
  let customSystemFont = $state('')
  let isLoading = $state(false)
  let errorMessage = $state('')

  onMount(() => {
    // Detect available system fonts
    availableFonts = getAvailableSystemFonts()
    fontsDetected = true
  })

  // Get flat list of all available system fonts
  function getAllSystemFonts(): string[] {
    return [...availableFonts.serif, ...availableFonts.sansSerif, ...availableFonts.monospace]
  }

  // Initialize custom font fields if the saved font isn't in the detected/popular lists
  $effect(() => {
    if (
      settings.uiSettings.fontSource === 'google' &&
      !popularGoogleFonts.includes(settings.uiSettings.fontFamily)
    ) {
      customGoogleFont = settings.uiSettings.fontFamily
    }
    if (
      settings.uiSettings.fontSource === 'system' &&
      !getAllSystemFonts().includes(settings.uiSettings.fontFamily) &&
      settings.uiSettings.fontFamily !== 'default'
    ) {
      customSystemFont = settings.uiSettings.fontFamily
    }
  })

  async function handleSourceChange(source: FontSource) {
    fontSource = source
    errorMessage = ''

    if (source === 'default') {
      selectedFont = 'default'
      await settings.setFontFamily('default', 'default')
    } else if (source === 'system') {
      // Default to first available serif font, or first available font
      const firstFont =
        availableFonts.serif[0] || availableFonts.sansSerif[0] || availableFonts.monospace[0]
      if (firstFont) {
        selectedFont = firstFont
        await settings.setFontFamily(firstFont, 'system')
      }
    } else if (source === 'google') {
      // Default to first popular Google font
      selectedFont = popularGoogleFonts[0]
      isLoading = true
      try {
        await settings.setFontFamily(popularGoogleFonts[0], 'google')
      } catch {
        errorMessage = 'Failed to load font'
      }
      isLoading = false
    }
  }

  async function handleFontChange(font: string) {
    selectedFont = font
    errorMessage = ''

    if (fontSource === 'google') {
      isLoading = true
      try {
        await settings.setFontFamily(font, 'google')
      } catch {
        errorMessage = 'Failed to load font'
      }
      isLoading = false
    } else {
      await settings.setFontFamily(font, fontSource)
    }
  }

  async function handleCustomGoogleFont() {
    if (!customGoogleFont.trim()) return

    errorMessage = ''
    isLoading = true
    selectedFont = customGoogleFont.trim()

    try {
      await settings.setFontFamily(customGoogleFont.trim(), 'google')
    } catch {
      errorMessage = 'Failed to load font. Check the font name.'
    }
    isLoading = false
  }

  async function handleCustomSystemFont() {
    if (!customSystemFont.trim()) return

    errorMessage = ''
    selectedFont = customSystemFont.trim()
    await settings.setFontFamily(customSystemFont.trim(), 'system')
  }
</script>

<div class="space-y-3">
  <div>
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label class="text-surface-300 mb-2 block text-sm font-medium"> Font Source </label>
    <select
      class="input"
      value={fontSource}
      onchange={(e) => handleSourceChange(e.currentTarget.value as FontSource)}
    >
      <option value="default">Theme Default</option>
      <option value="system">System Font</option>
      <option value="google">Google Font</option>
    </select>
    <p class="text-surface-400 mt-1 text-xs">
      {#if fontSource === 'default'}
        Uses the default font for your selected theme
      {:else if fontSource === 'system'}
        Choose from fonts installed on your system
      {:else}
        Load fonts from Google Fonts library
      {/if}
    </p>
  </div>

  {#if fontSource === 'system'}
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-surface-300 mb-2 block text-sm font-medium"> System Font </label>
      {#if !fontsDetected}
        <div class="text-surface-400 flex items-center gap-2 py-2 text-sm">
          <Loader2 class="h-4 w-4 animate-spin" />
          Detecting fonts...
        </div>
      {:else if getAllSystemFonts().length === 0}
        <p class="text-surface-400 py-2 text-sm">No system fonts detected</p>
      {:else}
        <select
          class="input"
          value={selectedFont}
          onchange={(e) => handleFontChange(e.currentTarget.value)}
        >
          {#if availableFonts.serif.length > 0}
            <optgroup label="Serif">
              {#each availableFonts.serif as font (font)}
                <option value={font}>{font}</option>
              {/each}
            </optgroup>
          {/if}
          {#if availableFonts.sansSerif.length > 0}
            <optgroup label="Sans-Serif">
              {#each availableFonts.sansSerif as font (font)}
                <option value={font}>{font}</option>
              {/each}
            </optgroup>
          {/if}
          {#if availableFonts.monospace.length > 0}
            <optgroup label="Monospace">
              {#each availableFonts.monospace as font (font)}
                <option value={font}>{font}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
        <p class="text-surface-400 mt-1 text-xs">
          {getAllSystemFonts().length} fonts detected on your system
        </p>
      {/if}

      <div class="mt-3">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="text-surface-300 mb-2 block text-sm font-medium">
          Or enter font name manually
        </label>
        <div class="flex gap-2">
          <input
            type="text"
            class="input flex-1"
            placeholder="e.g., Comic Sans MS"
            bind:value={customSystemFont}
            onkeydown={(e) => e.key === 'Enter' && handleCustomSystemFont()}
          />
          <button
            class="btn btn-secondary"
            onclick={handleCustomSystemFont}
            disabled={!customSystemFont.trim()}
          >
            Apply
          </button>
        </div>
        <p class="text-surface-400 mt-1 text-xs">
          Enter the exact name of a font installed on your system
        </p>
      </div>
    </div>
  {:else if fontSource === 'google'}
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-surface-300 mb-2 block text-sm font-medium"> Popular Google Fonts </label>
      <select
        class="input"
        value={popularGoogleFonts.includes(selectedFont) ? selectedFont : ''}
        onchange={(e) => handleFontChange(e.currentTarget.value)}
        disabled={isLoading}
      >
        <option value="" disabled>Select a font...</option>
        {#each popularGoogleFonts as font (font)}
          <option value={font}>{font}</option>
        {/each}
      </select>
    </div>

    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-surface-300 mb-2 block text-sm font-medium">
        Or enter custom Google Font
      </label>
      <div class="flex gap-2">
        <input
          type="text"
          class="input flex-1"
          placeholder="e.g., Roboto Slab"
          bind:value={customGoogleFont}
          onkeydown={(e) => e.key === 'Enter' && handleCustomGoogleFont()}
          disabled={isLoading}
        />
        <button
          class="btn btn-secondary flex items-center gap-2"
          onclick={handleCustomGoogleFont}
          disabled={isLoading || !customGoogleFont.trim()}
        >
          {#if isLoading}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else}
            Load
          {/if}
        </button>
      </div>
      <p class="text-surface-400 mt-1 text-xs">
        Enter the exact font name from <a
          href="https://fonts.google.com"
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent-400 hover:text-accent-300 underline">fonts.google.com</a
        >
      </p>
    </div>
  {/if}

  {#if errorMessage}
    <p class="text-sm text-red-400">{errorMessage}</p>
  {/if}

  <!-- Font Preview -->
  {#if fontSource !== 'default'}
    <div class="border-surface-600 bg-surface-800 mt-4 rounded-lg border p-4">
      <p class="text-surface-400 mb-2 text-xs font-medium tracking-wider uppercase">Preview</p>
      <p
        class="text-lg leading-relaxed"
        style="font-family: '{selectedFont}', Georgia, serif; color: var(--text-secondary);"
      >
        The quick brown fox jumps over the lazy dog. In a world of magic and mystery, every story
        begins with a single word.
      </p>
    </div>
  {/if}
</div>
