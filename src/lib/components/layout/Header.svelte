<script lang="ts">
  import { onMount } from 'svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { exportService, gatherStoryData } from '$lib/services/export'
  import { Button } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import {
    eventBus,
    type ImageAnalysisStartedEvent,
    type ImageAnalysisCompleteEvent,
    type ImageQueuedEvent,
    type ImageReadyEvent,
    type BackgroundImageAnalysisStartedEvent,
    type BackgroundImageAnalysisCompleteEvent,
    type BackgroundImageQueuedEvent,
    type BackgroundImageReadyEvent,
  } from '$lib/services/events'
  import {
    PanelRight,
    Settings,
    Library,
    ArrowUpDown,
    FileJson,
    FileText,
    ChevronDown,
    Bug,
    ImageIcon,
    MessageSquare,
  } from 'lucide-svelte'

  let showExportMenu = $state(false)

  // Subscribe to image generation events
  onMount(() => {
    const unsubAnalysisStarted = eventBus.subscribe<ImageAnalysisStartedEvent>(
      'ImageAnalysisStarted',
      () => ui.setImageAnalysisInProgress(true),
    )

    const unsubAnalysisComplete = eventBus.subscribe<ImageAnalysisCompleteEvent>(
      'ImageAnalysisComplete',
      () => ui.setImageAnalysisInProgress(false),
    )

    const unsubImageQueued = eventBus.subscribe<ImageQueuedEvent>('ImageQueued', () =>
      ui.incrementImagesGenerating(),
    )

    const unsubImageReady = eventBus.subscribe<ImageReadyEvent>('ImageReady', () =>
      ui.decrementImagesGenerating(),
    )

    const unsubBackgroundImageAnalysisStarted =
      eventBus.subscribe<BackgroundImageAnalysisStartedEvent>(
        'BackgroundImageAnalysisStarted',
        () => ui.setImageAnalysisInProgress(true),
      )

    const unsubBackgroundImageAnalysisComplete =
      eventBus.subscribe<BackgroundImageAnalysisCompleteEvent>(
        'BackgroundImageAnalysisComplete',
        () => ui.setImageAnalysisInProgress(false),
      )

    const unsubBackgroundImageQueued = eventBus.subscribe<BackgroundImageQueuedEvent>(
      'BackgroundImageQueued',
      () => ui.incrementImagesGenerating(),
    )

    const unsubBackgroundImageReady = eventBus.subscribe<BackgroundImageReadyEvent>(
      'BackgroundImageReady',
      () => ui.decrementImagesGenerating(),
    )

    return () => {
      unsubAnalysisStarted()
      unsubAnalysisComplete()
      unsubImageQueued()
      unsubImageReady()
      unsubBackgroundImageAnalysisStarted()
      unsubBackgroundImageAnalysisComplete()
      unsubBackgroundImageQueued()
      unsubBackgroundImageReady()
    }
  })

  async function handleExport(exportFn: () => Promise<boolean>, formatName: string) {
    if (!story.currentStory) return
    showExportMenu = false
    try {
      const success = await exportFn()
      if (success) {
        ui.showToast(`Exported story as ${formatName}`, 'info')
      } else {
        ui.showToast('Export cancelled', 'info')
      }
    } catch (error) {
      console.error('[Header] Export failed:', error)
      ui.showToast(
        `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      )
    }
  }

  async function exportAventuras() {
    const currentStory = story.currentStory
    if (!currentStory) return
    const data = await gatherStoryData(currentStory.id)
    await handleExport(
      () =>
        exportService.exportToAventura(
          currentStory,
          data.entries,
          data.characters,
          data.locations,
          data.items,
          data.storyBeats,
          data.lorebookEntries,
          data.embeddedImages,
          data.checkpoints,
          data.branches,
          data.chapters,
        ),
      'Aventuras (.avt)',
    )
  }

  async function exportMarkdown() {
    const currentStory = story.currentStory
    if (!currentStory) return
    await handleExport(
      () =>
        exportService.exportToMarkdown(
          currentStory,
          story.entries,
          story.characters,
          story.locations,
          true,
        ),
      'Markdown (.md)',
    )
  }

  async function exportText() {
    const currentStory = story.currentStory
    if (!currentStory) return
    await handleExport(
      () => exportService.exportToText(currentStory, story.entries),
      'Plain Text (.txt)',
    )
  }
</script>

<header
  class="bg-card relative z-10 flex h-12 items-center justify-between border-b px-1 sm:h-14 sm:px-4"
>
  <!-- Left side: Story title -->
  <div class="flex min-w-0 items-center">
    <div class="flex items-center gap-3 px-2.5 sm:px-1">
      <div
        class="bg-primary h-7 w-7 flex-shrink-0"
        style="mask-image: url('/logo.png'); mask-size: contain; mask-repeat: no-repeat; mask-position: center; -webkit-mask-image: url('/logo.png'); -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;"
        role="img"
        aria-label="Aventuras"
      ></div>
      {#if story.currentStory}
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="text-foreground max-w-40 truncate text-sm font-semibold sm:max-w-none sm:translate-y-[-1.5px] sm:text-base"
          >
            {story.currentStory.title}
          </span>
          {#if ui.isGenerating}
            <div
              class="bg-accent-500 h-2 w-2 flex-shrink-0 animate-pulse rounded-full sm:hidden"
            ></div>
          {/if}
        </div>
        {#if settings.uiSettings.showWordCount}
          <span class="text-muted-foreground hidden text-sm sm:-translate-y-px lg:inline"
            >({story.wordCount} words)</span
          >
        {/if}
      {:else}
        <!-- App Branding (Library Mode) -->
        <span class="text-foreground text-lg font-semibold sm:translate-y-[-1.5px]">Aventuras</span>
      {/if}
    </div>
  </div>

  <!-- Center spacer -->
  <div class="flex-1"></div>

  <!-- Right side: Export and Settings -->
  <div class="flex items-center">
    <div class="flex items-center gap-2">
      {#if ui.isGenerating}
        <div class="text-accent-400 hidden items-center gap-1.5 text-sm sm:flex">
          <div class="bg-accent-500 h-2 w-2 animate-pulse rounded-full"></div>
          <span>Generating...</span>
        </div>
      {/if}

      <!-- Image generation status indicators -->
      {#if ui.imageAnalysisInProgress}
        <div
          class="flex items-center gap-1.5 text-sm text-blue-400"
          title="Analyzing scene for images"
        >
          <ImageIcon class="h-3.5 w-3.5 animate-pulse" />
          <span class="hidden sm:inline">Analyzing...</span>
        </div>
      {:else if ui.imagesGenerating > 0}
        <div class="flex items-center gap-1.5 text-sm text-emerald-400" title="Generating images">
          <ImageIcon class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">
            {ui.imagesGenerating} image{ui.imagesGenerating > 1 ? 's' : ''}
          </span>
          <div class="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></div>
        </div>
      {/if}
    </div>

    <!-- Back to Library Button (right side) -->
    {#if story.currentStory}
      <Button
        icon={Library}
        label="Library"
        variant="text"
        class="text-muted-foreground hover:text-primary min-h-11 min-w-11"
        onclick={() => {
          story.closeStory()
          ui.setActivePanel('library')
        }}
        title="Return to Library"
      />
    {/if}

    {#if story.currentStory}
      <!-- Gallery Button -->
      <Button
        icon={ImageIcon}
        label="Gallery"
        variant="text"
        class="text-muted-foreground hover:text-primary min-h-11 min-w-11"
        onclick={() => ui.setActivePanel(ui.activePanel === 'gallery' ? 'story' : 'gallery')}
        title="View generated images"
      />

      <!-- Import / Export Menu -->
      <DropdownMenu.Root bind:open={showExportMenu}>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              icon={ArrowUpDown}
              label="Import/Export"
              endIcon={ChevronDown}
              variant="text"
              class="text-muted-foreground hover:text-primary min-h-[44px] min-w-[44px]"
              title="Import / Export story"
            />
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>Import</DropdownMenu.Label>
          <DropdownMenu.Item
            onclick={() => {
              showExportMenu = false
              ui.openSTChatImport()
            }}
          >
            <MessageSquare class="text-muted-foreground h-4 w-4" />
            SillyTavern Chat (.jsonl)
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Label>Export</DropdownMenu.Label>
          <DropdownMenu.Item onclick={() => exportAventuras()}>
            <FileJson class="text-accent-400 h-4 w-4" />
            Aventuras (.avt)
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => exportMarkdown()}>
            <FileText class="h-4 w-4 text-blue-400" />
            Markdown (.md)
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => exportText()}>
            <FileText class="text-muted-foreground h-4 w-4" />
            Plain Text (.txt)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}

    {#if story.currentStory && story.lorebookEntries.length > 0}
      <Button
        variant="text"
        class="text-muted-foreground hover:text-primary relative hidden min-h-11 min-w-11 sm:flex"
        onclick={() => ui.toggleLorebookDebug()}
        title="View active lorebook entries"
      >
        <Bug class="h-5 w-5" />
        {#if ui.lastLorebookRetrieval && ui.lastLorebookRetrieval.all.length > 0}
          <span
            class="bg-accent-500 absolute top-1 right-1 flex h-3 w-3 items-center justify-center rounded-full text-[9px] font-medium text-white"
          >
            {ui.lastLorebookRetrieval.all.length}
          </span>
        {/if}
      </Button>
    {/if}

    {#if !story.currentStory}
      <Button
        href="https://discord.gg/DqVzhSPC46"
        target="_blank"
        rel="noopener noreferrer"
        variant="text"
        class="text-muted-foreground hover:text-primary min-h-[44px] min-w-[44px] sm:hidden"
        title="Join our Discord community"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
          />
        </svg>
      </Button>
    {/if}

    <Button
      icon={Settings}
      label="Settings"
      variant="text"
      class="text-muted-foreground hover:text-primary min-h-11 min-w-11"
      onclick={() => ui.openSettings()}
    />

    {#if story.currentStory}
      <Button
        icon={PanelRight}
        variant="text"
        class="text-muted-foreground hover:text-primary min-h-11 min-w-11"
        onclick={() => ui.toggleSidebar()}
        title={ui.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      />
    {/if}
  </div>
</header>
