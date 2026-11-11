<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { database } from '#lib/services/database.ts'
  import { imageExportService } from '#lib/services/imageExport.ts'
  import { retryImageGeneration } from '#lib/services/ai/image/index.ts'
  import { eventBus, type ImageQueuedEvent, type ImageReadyEvent } from '#lib/services/events.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { normalizeImageDataUrl } from '#lib/utils/image.ts'
  import { diffGalleryImages, isImageInProgress } from '#lib/utils/galleryImages.ts'
  import type { EmbeddedImageMeta } from '#lib/types/index.ts'
  import {
    Download,
    ImageIcon,
    AlertCircle,
    X,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    ClockArrowDown,
    ClockArrowUp,
  } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts'
  import { Textarea } from '#lib/components/ui/textarea/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { SvelteSet, SvelteMap } from 'svelte/reactivity'
  import type { Attachment } from 'svelte/attachments'

  const SWIPE_THRESHOLD = 50

  const promptId = $props.id()

  // Always chronological, as loaded and cached in `ui`; `images` is the display order.
  let loadedImages = $state.raw<EmbeddedImageMeta[]>([])
  const images = $derived(ui.galleryNewestFirst ? loadedImages.toReversed() : loadedImages)
  const imageById = $derived(new Map(loadedImages.map((img) => [img.id, img])))
  // Lazy-loaded base64 payloads, keyed by image id. The grid/lightbox only loads the
  // pixels that are actually visible, so a story with many images never pulls all of
  // them through the SQL/IPC bridge at once (which caused Android OOM crashes).
  //
  // Lazy loading alone only bounds the peak at open, not the total: scrolling a large
  // gallery would still end up retaining every image. So the cache is an LRU with a byte
  // budget — base64 length is a good proxy for the heap it costs — and is dropped wholesale
  // when the story changes.
  const imageDataCache = new SvelteMap<string, string>()
  const loadingImageIds = new SvelteSet<string>()
  // Ids whose load failed; rendered as a retry affordance rather than an endless spinner.
  const failedImageIds = new SvelteSet<string>()
  // The fetch each id is waiting on. A fetch that finds its token gone was invalidated while it
  // ran, and must not put its payload back.
  const fetchTokens = new SvelteMap<string, symbol>()
  const MAX_CACHE_BYTES = 96 * 1024 * 1024
  let cacheBytes = 0
  // Only read when evicting, never from the template.
  const lastUse = new SvelteMap<string, number>()
  const visibleIds = new SvelteSet<string>()
  let useTick = 0

  // True only until a story's first list is on screen; every later reload happens in place.
  let isLoading = $state(false)
  let isSaving = $state(false)
  const regeneratingImageIds = new SvelteSet<string>()

  const selectedImageIds = new SvelteSet<string>()
  const selectAllChecked = $derived(images.length > 0 && selectedImageIds.size === images.length)

  let lightboxOpen = $state(false)
  // The lightbox follows an image, not a position: a reload or a change of order moves indices.
  let lightboxImageId = $state<string | null>(null)
  const lightboxIndex = $derived(
    lightboxImageId === null ? -1 : images.findIndex((img) => img.id === lightboxImageId),
  )
  // Not gated on `lightboxOpen`: the modal keeps rendering its image while it animates out.
  const lightboxImage = $derived(lightboxIndex >= 0 ? images[lightboxIndex] : null)
  const lightboxRegenerating = $derived(
    lightboxImage ? regeneratingImageIds.has(lightboxImage.id) : false,
  )
  let editingImagePrompt = $state('')
  let touchStartX = 0

  /** What the lightbox shows or is about to show: these load first and survive eviction. */
  const lightboxWindowIds = $derived(
    !lightboxOpen || lightboxIndex < 0
      ? []
      : [
          images[lightboxIndex - 1]?.id,
          images[lightboxIndex]?.id,
          images[lightboxIndex + 1]?.id,
        ].filter((id): id is string => !!id),
  )

  function uncache(id: string) {
    lastUse.delete(id)
    const data = imageDataCache.get(id)
    if (data === undefined) return
    imageDataCache.delete(id)
    cacheBytes -= data.length
  }

  /** Drop least-recently-used payloads until the cache fits its budget; protected ids stay. */
  function evictOverBudget(protectedIds: ReadonlySet<string>) {
    while (cacheBytes > MAX_CACHE_BYTES) {
      let oldest: string | undefined
      let oldestUse = Infinity
      for (const id of imageDataCache.keys()) {
        const use = lastUse.get(id) ?? 0
        if (!protectedIds.has(id) && use < oldestUse) {
          oldest = id
          oldestUse = use
        }
      }
      if (oldest === undefined) return
      uncache(oldest)
    }
  }

  /** Insert (or replace) a payload, then evict whatever no longer fits. */
  function cacheImageData(id: string, data: string) {
    uncache(id)
    imageDataCache.set(id, data)
    lastUse.set(id, ++useTick)
    cacheBytes += data.length
    evictOverBudget(new Set([...lightboxWindowIds, ...visibleIds]))
  }

  function clearImageCache() {
    imageDataCache.clear()
    lastUse.clear()
    loadingImageIds.clear()
    failedImageIds.clear()
    fetchTokens.clear()
    cacheBytes = 0
  }

  /** Forget one image's payload, failure and in-flight fetch, so the next view of it fetches again. */
  function dropImageData(id: string) {
    uncache(id)
    failedImageIds.delete(id)
    loadingImageIds.delete(id)
    fetchTokens.delete(id)
  }

  function resetSelection() {
    selectedImageIds.clear()
  }

  function closeGallery() {
    ui.activePanel = 'story'
  }

  function refreshImages() {
    clearImageCache()
    loadImages()
  }

  /** Lazily fetch (and cache) the base64 payload for a single image. */
  async function ensureImageData(id: string | undefined) {
    if (!id) return
    if (imageDataCache.has(id)) {
      lastUse.set(id, ++useTick)
      return
    }
    if (loadingImageIds.has(id)) return
    const meta = imageById.get(id)
    if (meta && isImageInProgress(meta)) return
    const token = Symbol()
    fetchTokens.set(id, token)
    loadingImageIds.add(id)
    failedImageIds.delete(id)
    try {
      const full = await database.getEmbeddedImage(id)
      if (fetchTokens.get(id) !== token) return
      if (full?.imageData) {
        cacheImageData(id, full.imageData)
      } else {
        failedImageIds.add(id)
      }
    } catch (error) {
      if (fetchTokens.get(id) !== token) return
      console.error('[Gallery] Failed to load image data:', error)
      failedImageIds.add(id)
    } finally {
      if (fetchTokens.get(id) === token) {
        fetchTokens.delete(id)
        loadingImageIds.delete(id)
      }
    }
  }

  async function regenerate(id: string, prompt: string) {
    if (regeneratingImageIds.has(id)) return
    regeneratingImageIds.add(id)
    try {
      await retryImageGeneration(id, prompt)
    } catch (error) {
      console.error('[Gallery] Regenerate failed:', error)
      ui.showToast(`Failed to regenerate image: ${errMessage(error)}`, 'error')
    } finally {
      regeneratingImageIds.delete(id)
    }
  }

  /** Svelte attachment: load an image's pixels once its grid cell scrolls near the viewport. */
  const lazyImage =
    (id: string): Attachment<HTMLElement> =>
    (node) => {
      // Keeps observing: an evicted payload refetches when its cell scrolls back.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) visibleIds.delete(id)
            else {
              visibleIds.add(id)
              ensureImageData(id)
            }
          }
        },
        { rootMargin: '300px' },
      )
      observer.observe(node)
      return () => {
        observer.disconnect()
        visibleIds.delete(id)
      }
    }

  /** Put a fresh list on screen, and let go of what it no longer covers. */
  function applyLoaded(storyId: string, loaded: EmbeddedImageMeta[]) {
    const { removed, statusChanged } = diffGalleryImages(loadedImages, loaded)
    for (const id of [...removed, ...statusChanged]) dropImageData(id)
    for (const id of removed) selectedImageIds.delete(id)
    if (lightboxOpen && lightboxImageId !== null && removed.includes(lightboxImageId)) {
      closeLightbox()
    }
    loadedImages = loaded
    ui.setGalleryImages(storyId, loaded)
    isLoading = false
  }

  let loadActive = false
  let loadAgain = false

  // One query at a time. A request that lands mid-flight reruns once afterwards, so the list
  // written last was read after the last change.
  async function loadImages() {
    if (loadActive) {
      loadAgain = true
      return
    }
    loadActive = true
    try {
      do {
        loadAgain = false
        const storyId = story.currentStory?.id
        if (!storyId) {
          isLoading = false
          break
        }
        try {
          const loaded = await database.getEmbeddedImageMetaForStory(storyId)
          if (story.currentStory?.id === storyId) applyLoaded(storyId, loaded)
          else loadAgain = true
        } catch (error) {
          if (story.currentStory?.id === storyId) {
            console.error('[Gallery] Failed to load images:', error)
            ui.showToast('Failed to load gallery images', 'error')
            isLoading = false
          } else {
            loadAgain = true
          }
        }
      } while (loadAgain)
    } finally {
      loadActive = false
    }
  }

  const currentStoryId = $derived(story.currentStory?.id)
  const listCached = $derived(currentStoryId ? ui.hasGalleryImages(currentStoryId) : false)

  // The story the pixel cache, selection and lightbox belong to. Plain `let`: changing it must
  // not re-run the effect.
  let shownStoryId: string | undefined

  $effect(() => {
    const storyId = currentStoryId
    const cached = listCached
    untrack(() => {
      if (storyId !== shownStoryId) {
        shownStoryId = storyId
        // The previous story's payloads would otherwise stay in the heap for the whole session.
        resetSelection()
        clearImageCache()
        closeLightbox()
        lightboxImageId = null
        const list = storyId ? ui.getGalleryImages(storyId) : undefined
        loadedImages = list ?? []
        isLoading = !!storyId && !list
        // A cached list is shown at once and revalidated.
        if (storyId) loadImages()
      } else if (storyId && !cached) {
        loadImages()
      }
    })
  })

  onMount(() => {
    const unsubQueued = eventBus.subscribe<ImageQueuedEvent>('ImageQueued', () => {
      loadImages()
    })
    const unsubReady = eventBus.subscribe<ImageReadyEvent>('ImageReady', (event) => {
      // A regenerated image keeps its id and its `complete` status, so the payload is dropped by id.
      dropImageData(event.imageId)
      loadImages()
    })
    return () => {
      unsubQueued()
      unsubReady()
    }
  })

  function toggleSelectAll() {
    if (selectAllChecked) {
      selectedImageIds.clear()
    } else {
      for (const img of images) selectedImageIds.add(img.id)
    }
  }

  function toggleImageSelection(imageId: string) {
    if (selectedImageIds.has(imageId)) {
      selectedImageIds.delete(imageId)
    } else {
      selectedImageIds.add(imageId)
    }
  }

  async function handleSaveImages() {
    if (!story.currentStory || images.length === 0) return

    const imagesToSave = selectedImageIds.size || images.length

    isSaving = true
    try {
      const success = await imageExportService.exportImages(
        story.currentStory.title,
        images,
        selectedImageIds.size > 0 ? selectedImageIds : undefined,
      )

      if (success) {
        const message = imagesToSave === 1 ? 'Saved 1 image' : `Saved ${imagesToSave} images as ZIP`
        ui.showToast(message, 'info')
        resetSelection()
      }
    } catch (error) {
      console.error('[Gallery] Save failed:', error)
      ui.showToast(`Failed to save images: ${errMessage(error)}`, 'error')
    } finally {
      isSaving = false
    }
  }

  // Show the full stored prompt - user can edit as needed
  function showLightboxImage(id: string) {
    lightboxImageId = id
    editingImagePrompt = imageById.get(id)?.prompt ?? ''
  }

  function openLightbox(id: string) {
    showLightboxImage(id)
    lightboxOpen = true
  }

  function closeLightbox() {
    lightboxOpen = false
  }

  function previousImage() {
    const previous = lightboxIndex > 0 ? images[lightboxIndex - 1] : undefined
    if (previous) showLightboxImage(previous.id)
  }

  function nextImage() {
    const next = lightboxIndex >= 0 ? images[lightboxIndex + 1] : undefined
    if (next) showLightboxImage(next.id)
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.changedTouches[0].screenX
  }

  function handleTouchEnd(e: TouchEvent) {
    const touchEndX = e.changedTouches[0].screenX
    const diff = touchStartX - touchEndX

    if (Math.abs(diff) > SWIPE_THRESHOLD) {
      if (diff > 0) {
        nextImage()
      } else {
        previousImage()
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (lightboxOpen) {
      if (e.key === 'Escape') closeLightbox()
      // Arrows move the caret in a field, and switching images would discard its unsaved edit.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft') previousImage()
      if (e.key === 'ArrowRight') nextImage()
    } else {
      if (e.key === 'Escape') closeGallery()
    }
  }

  const OrderIcon = $derived(ui.galleryNewestFirst ? ClockArrowDown : ClockArrowUp)

  // Lazily load pixels (current + neighbors) when navigating the lightbox
  $effect(() => {
    const ids = lightboxWindowIds
    untrack(() => {
      for (const id of ids) ensureImageData(id)
    })
  })

  // Submit edit modal - regenerate with new prompt
  async function handleEditImageSubmit(imageId: string) {
    // Use the prompt as-is - don't append style (user has full control)
    const fullPrompt = editingImagePrompt.trim()
    if (!fullPrompt || !imageById.has(imageId)) return

    closeLightbox()
    await regenerate(imageId, fullPrompt)
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="bg-surface-900 flex h-full flex-col">
  <!-- Header -->
  <div class="border-surface-700 border-b px-4 py-3 sm:px-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <ImageIcon class="text-accent-400 h-5 w-5" />
        <h2 class="text-surface-100 text-lg font-semibold">Gallery</h2>
        {#if images.length > 0}
          <span class="text-surface-500 text-sm">({images.length})</span>
        {/if}
      </div>

      {#if images.length > 0 && !isLoading}
        <div class="flex items-center gap-1.5">
          <!-- Order toggle -->
          <Button
            variant="ghost"
            size="icon"
            onclick={() => ui.toggleGalleryOrder()}
            title={ui.galleryNewestFirst ? 'Show oldest first' : 'Show newest first'}
            class="h-8 w-8"
          >
            <OrderIcon class="h-3.5 w-3.5" />
          </Button>

          <!-- Refresh button -->
          <Button
            variant="ghost"
            size="icon"
            onclick={refreshImages}
            disabled={!story.currentStory}
            title="Refresh gallery"
            class="h-8 w-8"
          >
            <RefreshCw class="size-3.5" />
          </Button>

          <!-- Save button -->
          <Button
            variant="default"
            size="sm"
            onclick={handleSaveImages}
            disabled={isSaving}
            title={isSaving
              ? 'Saving images...'
              : selectedImageIds.size > 0
                ? `Save ${selectedImageIds.size} selected`
                : 'Save all images'}
            class="h-8 gap-1.5 px-2.5 text-xs"
          >
            <Download class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">
              {isSaving
                ? 'Saving...'
                : selectedImageIds.size > 0
                  ? `Save ${selectedImageIds.size}`
                  : 'Save All'}
            </span>
            <span class="sm:hidden">
              {isSaving ? '...' : selectedImageIds.size > 0 ? selectedImageIds.size : 'All'}
            </span>
          </Button>

          <!-- Close/Back button -->
          <Button
            variant="outline"
            size="sm"
            onclick={closeGallery}
            title="Close gallery (Esc)"
            aria-label="Close gallery"
            class="h-8 gap-1 px-2.5 text-xs"
          >
            <X class="h-3.5 w-3.5" />
            <span class="hidden sm:inline">Close</span>
          </Button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Selection toolbar (shown when images exist) -->
  {#if images.length > 0 && !isLoading}
    <div
      class="border-surface-700 bg-surface-800 flex items-center gap-3 border-b px-4 py-2.5 sm:px-6"
    >
      <Checkbox
        checked={selectAllChecked}
        onCheckedChange={toggleSelectAll}
        aria-label="Select all images"
      />
      <span class="text-surface-400 text-xs sm:text-sm">
        {selectedImageIds.size === 0
          ? 'Select images to download'
          : selectedImageIds.size === images.length
            ? 'All selected'
            : `${selectedImageIds.size} selected`}
      </span>
    </div>
  {/if}

  <!-- Content -->
  <div class="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
    {#if isLoading}
      <!-- Loading state -->
      <div class="flex items-center justify-center py-12">
        <div class="flex flex-col items-center gap-3">
          <div
            class="border-surface-600 border-t-accent-400 h-8 w-8 animate-spin rounded-full border-2"
          ></div>
          <p class="text-surface-400 text-sm">Loading images...</p>
        </div>
      </div>
    {:else if images.length === 0}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <ImageIcon class="text-surface-700 mb-3 h-12 w-12" />
        <p class="text-surface-300 font-medium">No generated images yet</p>
        <p class="text-surface-500 mt-1 text-sm">
          Generate images using the image generation feature in your story
        </p>
      </div>
    {:else}
      <!-- Images grid -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each images as image, index (image.id)}
          {@const selected = selectedImageIds.has(image.id)}
          <div
            class={[
              'group bg-surface-800 relative overflow-hidden rounded-lg border-2 transition-colors',
              selected ? 'border-accent-500' : 'border-surface-700 hover:border-accent-400',
            ]}
          >
            <!-- Checkbox overlay (top-left) -->
            <div class="pointer-events-auto absolute top-2 left-2 z-20">
              <Checkbox
                checked={selected}
                onCheckedChange={() => toggleImageSelection(image.id)}
                aria-label="Select image"
                class="bg-surface-900/80 border-surface-500"
              />
            </div>

            <div class="bg-surface-700 relative aspect-video" {@attach lazyImage(image.id)}>
              {#if imageDataCache.has(image.id)}
                <img
                  src={normalizeImageDataUrl(imageDataCache.get(image.id)) ?? ''}
                  alt={`Generated image ${index + 1}`}
                  class="h-full w-full object-contain"
                />
              {:else if failedImageIds.has(image.id)}
                <button
                  class="text-surface-400 hover:text-surface-200 relative z-20 flex h-full w-full flex-col items-center justify-center gap-1 text-xs"
                  onclick={() => ensureImageData(image.id)}
                >
                  <RefreshCw class="h-4 w-4" />
                  Retry
                </button>
              {:else}
                <div class="flex h-full w-full items-center justify-center">
                  <div
                    class="border-surface-600 border-t-accent-400 h-6 w-6 animate-spin rounded-full border-2"
                  ></div>
                </div>
              {/if}
              <!-- Opens the lightbox; Retry sits above it -->
              <button
                type="button"
                class="focus-visible:ring-accent-400 absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                aria-label={`Open image ${index + 1}`}
                onclick={() => openLightbox(image.id)}
              ></button>
              <!-- Hover overlay: hover-capable devices only; clicks pass through to the open button -->
              <div
                class="can-hover:flex pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              >
                <Button variant="default" size="sm">View</Button>
              </div>
            </div>

            <!-- Image metadata (shown below) -->
            <div class="border-surface-700 border-t p-3 text-xs">
              <div class="text-surface-400 space-y-1">
                {#if image.model}
                  <p class="truncate">
                    <span class="text-surface-500 font-medium">Model:</span>
                    {image.model}
                  </p>
                {/if}
                {#if image.styleId}
                  <p class="truncate">
                    <span class="text-surface-500 font-medium">Style:</span>
                    {image.styleId}
                  </p>
                {/if}
                {#if image.width && image.height}
                  <p>
                    <span class="text-surface-500 font-medium">Size:</span>
                    {image.width}×{image.height}
                  </p>
                {/if}
                {#if image.generationMode}
                  <p class="capitalize">
                    <span class="text-surface-500 font-medium">Mode:</span>
                    {image.generationMode}
                  </p>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer info -->
  {#if images.length > 0 && !isLoading}
    <div class="border-surface-700 bg-surface-800 border-t px-4 py-2 sm:px-6">
      <div class="text-surface-400 flex items-start gap-2 text-xs">
        <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          {selectedImageIds.size > 0
            ? `${selectedImageIds.size} image${selectedImageIds.size > 1 ? 's' : ''} selected for download`
            : `${images.length} image${images.length > 1 ? 's' : ''} available. Select images to download.`}
        </p>
      </div>
    </div>
  {/if}
</div>

<!-- Lightbox Modal using ResponsiveModal -->
<ResponsiveModal.Root bind:open={lightboxOpen}>
  <ResponsiveModal.Content class="gap-0 overflow-hidden p-0 sm:max-w-3xl">
    <!-- Image area with navigation -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-surface-950 relative flex items-center justify-center p-4"
      ontouchstart={handleTouchStart}
      ontouchend={handleTouchEnd}
    >
      <!-- Navigation: Previous -->
      {#if images.length > 1}
        <button
          onclick={previousImage}
          disabled={lightboxIndex <= 0}
          class="bg-surface-800/80 hover:bg-surface-700 text-surface-300 absolute top-1/2 left-2 -translate-y-1/2 rounded-full p-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          title="Previous (←)"
          aria-label="Previous image"
        >
          <ChevronLeft class="h-5 w-5" />
        </button>
      {/if}

      <!-- Image with loading overlay -->
      {#if lightboxImage}
        <div class="relative">
          {#if imageDataCache.has(lightboxImage.id)}
            <img
              src={normalizeImageDataUrl(imageDataCache.get(lightboxImage.id)) ?? ''}
              alt={`Generated image ${lightboxIndex + 1}`}
              class={[
                'max-h-(--image-view-height) max-w-full rounded object-contain sm:max-h-(--image-view-height-sm)',
                lightboxRegenerating && 'opacity-50',
              ]}
            />
          {:else if failedImageIds.has(lightboxImage.id)}
            <div
              class="flex h-(--image-view-height) w-full items-center justify-center sm:h-(--image-view-height-sm)"
            >
              <Button variant="outline" size="sm" onclick={() => ensureImageData(lightboxImage.id)}>
                <RefreshCw class="h-4 w-4" />
                Retry
              </Button>
            </div>
          {:else}
            <div
              class="flex h-(--image-view-height) w-full items-center justify-center sm:h-(--image-view-height-sm)"
            >
              <div
                class="border-surface-600 border-t-accent-400 h-8 w-8 animate-spin rounded-full border-2"
              ></div>
            </div>
          {/if}
          {#if lightboxRegenerating}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="bg-surface-900/80 flex flex-col items-center gap-2 rounded-lg px-4 py-3">
                <div
                  class="border-surface-400 border-t-accent-400 h-6 w-6 animate-spin rounded-full border-2"
                ></div>
                <span class="text-surface-300 text-sm">Regenerating...</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Navigation: Next -->
      {#if images.length > 1}
        <button
          onclick={nextImage}
          disabled={lightboxIndex === images.length - 1}
          class="bg-surface-800/80 hover:bg-surface-700 text-surface-300 absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          title="Next (→)"
          aria-label="Next image"
        >
          <ChevronRight class="h-5 w-5" />
        </button>
      {/if}
    </div>

    <!-- Edit area -->
    <div class="bg-surface-900 border-surface-800 border-t px-4 py-3">
      <label for={promptId} class="text-surface-400 mb-1.5 block text-xs">Image Prompt</label>
      <Textarea
        id={promptId}
        bind:value={editingImagePrompt}
        placeholder="Describe the image you want to generate..."
        rows={3}
        class="resize-none text-sm"
      />
    </div>

    <!-- Footer toolbar -->
    <div
      class="bg-surface-900 border-surface-800 flex items-center justify-between gap-3 border-t px-4 py-3"
    >
      <!-- Counter -->
      <div class="text-surface-400 text-sm tabular-nums">
        {#if images.length > 1}
          {lightboxIndex + 1} of {images.length}
        {:else}
          1 image
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={closeLightbox} class="h-8 text-xs">
          Close
        </Button>
        {#if lightboxImage}
          <Button
            size="sm"
            onclick={() => lightboxImage && handleEditImageSubmit(lightboxImage.id)}
            disabled={!editingImagePrompt.trim() || lightboxRegenerating}
            class="h-8 gap-1.5 text-xs"
          >
            {#if lightboxRegenerating}
              <div
                class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              ></div>
            {:else}
              <RotateCcw class="size-3.5" />
            {/if}
            Regenerate
          </Button>
        {/if}
      </div>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
