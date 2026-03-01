<script lang="ts">
  import type { StoryEntry, EmbeddedImage } from '$lib/types'
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    User,
    BookOpen,
    Info,
    Pencil,
    Trash2,
    Check,
    X,
    RefreshCw,
    RotateCcw,
    Loader2,
    GitBranch,
    Bookmark,
    Volume2,
    Image as ImageIcon,
  } from 'lucide-svelte'
  import { aiService } from '$lib/services/ai'
  import { aiTTSService } from '$lib/services/ai/utils/TTSService'
  import { parseMarkdown } from '$lib/utils/markdown'
  import { sanitizeTextForTTS } from '$lib/utils/htmlSanitize'
  import {
    processStoryContent,
    processVisualProseStoryContent,
    getPlacedImageIds,
  } from '$lib/services/image'
  import {
    eventBus,
    type ImageReadyEvent,
    type ImageQueuedEvent,
    type ImageAnalysisFailedEvent,
    type TTSQueuedEvent,
  } from '$lib/services/events'
  import { inlineImageService, retryImageGeneration } from '$lib/services/ai/image'
  import { database } from '$lib/services/database'
  import { onMount } from 'svelte'
  import ReasoningBlock from './ReasoningBlock.svelte'
  import { countTokens } from '$lib/services/tokenizer'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Input } from '$lib/components/ui/input'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import {
    IMAGE_STUCK_THRESHOLD_MS,
    DEFAULT_FALLBACK_STYLE_PROMPT,
  } from '$lib/services/ai/image/constants'
  import { SvelteSet } from 'svelte/reactivity'
  import { escapeRegex, extractSentenceAt, expandRangeBidirectional } from '$lib/utils/text'

  let { entry }: { entry: StoryEntry } = $props()

  // Separate token counts for content and reasoning
  const contentTokens = $derived(entry.metadata?.tokenCount ?? 0)
  const reasoningTokens = $derived(entry.reasoning ? countTokens(entry.reasoning) : 0)

  // Check if reasoning is enabled in API settings
  const isReasoningEnabled = $derived(settings.apiSettings.reasoningEffort !== 'off')

  // TTS generation state
  let isGeneratingTTS = $state(false)
  let isPlayingTTS = $state(false)

  // Check if this entry is an error entry (either tracked or detected by content)
  const isErrorEntry = $derived(
    entry.type === 'system' &&
      (ui.lastGenerationError?.errorEntryId === entry.id ||
        entry.content.toLowerCase().includes('generation failed') ||
        entry.content.toLowerCase().includes('failed to generate') ||
        entry.content.toLowerCase().includes('empty response')),
  )

  // Check if Visual Prose mode is enabled for this story
  const visualProseMode = $derived(story.currentStory?.settings?.visualProseMode ?? false)

  // Check if this is the latest narration entry (for retry button)
  const isLatestNarration = $derived.by(() => {
    if (entry.type !== 'narration') return false
    const narrations = story.entries.filter((e) => e.type === 'narration')
    if (narrations.length === 0) return false
    return narrations[narrations.length - 1].id === entry.id
  })

  // Check if retry is available for this entry
  const canRetry = $derived(
    isLatestNarration &&
      ui.retryBackup &&
      story.currentStory &&
      ui.retryBackup.storyId === story.currentStory.id &&
      !ui.isGenerating &&
      !ui.lastGenerationError,
  )

  /**
   * Dismiss/delete this error entry from the story.
   */
  async function handleDismissError() {
    if (ui.lastGenerationError?.errorEntryId === entry.id) {
      ui.clearGenerationError()
    }
    await story.deleteEntry(entry.id)
  }

  /**
   * Retry generation for this error entry.
   * For tracked errors, uses the UI callback. For legacy errors, finds the previous user action.
   */
  async function handleRetryFromEntry() {
    console.log('[StoryEntry] handleRetryFromEntry called', {
      entryId: entry.id,
      isGenerating: ui.isGenerating,
    })

    if (ui.isGenerating) {
      console.log('[StoryEntry] Already generating, returning')
      return
    }

    // If this is the currently tracked error, use the standard retry
    if (ui.lastGenerationError?.errorEntryId === entry.id) {
      console.log('[StoryEntry] Using tracked error retry')
      await ui.triggerRetry()
      return
    }

    // For legacy/untracked errors, find the previous user action and set up retry
    console.log('[StoryEntry] Legacy error, finding previous user action')
    const entryIndex = story.entries.findIndex((e) => e.id === entry.id)
    if (entryIndex <= 0) {
      console.log('[StoryEntry] Entry not found or is first entry')
      return
    }

    // Find the most recent user action before this error
    let userActionEntry = null
    for (let i = entryIndex - 1; i >= 0; i--) {
      if (story.entries[i].type === 'user_action') {
        userActionEntry = story.entries[i]
        break
      }
    }

    if (!userActionEntry) {
      console.log('[StoryEntry] No user action found before error')
      return
    }

    console.log('[StoryEntry] Found user action', {
      userActionId: userActionEntry.id,
    })

    // Set up the error state so the retry callback can handle it
    ui.setGenerationError({
      message: entry.content,
      errorEntryId: entry.id,
      userActionEntryId: userActionEntry.id,
      timestamp: Date.now(),
    })

    console.log('[StoryEntry] Error state set, triggering retry')
    // Trigger the retry
    await ui.triggerRetry()
    console.log('[StoryEntry] Retry complete')
  }

  let isEditing = $state(false)
  let editContent = $state('')
  let isDeleting = $state(false)

  // Embedded images state
  let embeddedImages = $state<EmbeddedImage[]>([])
  let expandedImageId = $state<string | null>(null)
  let clickedElement = $state<HTMLElement | null>(null)

  // Branching state
  let isBranching = $state(false)
  let branchName = $state('')

  // Inline image edit state
  let _isEditingImage = $state(false)
  let editingImageId = $state<string | null>(null)
  let editingImagePrompt = $state('')

  // Timer for checking stuck images
  let now = $state(Date.now())

  onMount(() => {
    const interval = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => {
      clearInterval(interval)
    }
  })

  // Helper to get which branch a checkpoint belongs to (by checking its last entry's branchId)
  function getCheckpointBranchId(checkpoint: {
    entriesSnapshot: { id: string; branchId?: string | null }[]
    lastEntryId: string
  }): string | null {
    const lastEntry = checkpoint.entriesSnapshot.find((e) => e.id === checkpoint.lastEntryId)
    return lastEntry?.branchId ?? null
  }

  // Check if this entry has an associated checkpoint (can be branched from)
  // Only show checkpoints that belong to the current branch to prevent incorrect branch lineage
  const currentBranchId = $derived(story.currentStory?.currentBranchId ?? null)
  const entryCheckpoint = $derived(
    story.checkpoints.find(
      (cp) => cp.lastEntryId === entry.id && getCheckpointBranchId(cp) === currentBranchId,
    ),
  )
  const canBranch = $derived(!!entryCheckpoint)

  // Handle creating a branch from this entry
  async function handleCreateBranch() {
    if (!branchName.trim()) return
    if (!entryCheckpoint) {
      alert('Cannot branch from this entry - no checkpoint available')
      return
    }
    try {
      await story.createBranchFromCheckpoint(branchName.trim(), entry.id, entryCheckpoint.id)
      isBranching = false
      branchName = ''
    } catch (error) {
      console.error('[StoryEntry] Failed to create branch:', error)
      alert(error instanceof Error ? error.message : 'Failed to create branch')
    }
  }

  function cancelBranch() {
    isBranching = false
    branchName = ''
  }

  // Checkpoint creation state
  let isCreatingCheckpoint = $state(false)
  let checkpointName = $state('')

  // Check if this is the latest entry (checkpoints can only be created at the latest entry)
  const isLatestEntry = $derived(
    story.entries.length > 0 && story.entries[story.entries.length - 1].id === entry.id,
  )

  // Can create checkpoint: latest entry, not a system entry, and no checkpoint exists yet
  const canCreateCheckpoint = $derived(isLatestEntry && entry.type !== 'system' && !entryCheckpoint)

  async function handleCreateCheckpoint() {
    if (!checkpointName.trim()) return
    try {
      await story.createCheckpoint(checkpointName.trim())
      isCreatingCheckpoint = false
      checkpointName = ''
    } catch (error) {
      console.error('[StoryEntry] Failed to create checkpoint:', error)
      alert(error instanceof Error ? error.message : 'Failed to create checkpoint')
    }
  }

  function cancelCheckpoint() {
    isCreatingCheckpoint = false
    checkpointName = ''
  }

  // Load embedded images for narration entries
  async function loadEmbeddedImages() {
    if (entry.type !== 'narration') return
    try {
      embeddedImages = await database.getEmbeddedImagesForEntry(entry.id)
    } catch (err) {
      console.error('[StoryEntry] Failed to load embedded images:', err)
    }
  }

  // Handle creating missing inline images (stuck/lost records)
  async function handleCreateMissingImage() {
    if (!story.currentStory) return

    // Trigger scanning of this entry
    // We pass the full content, the service will find tags and create missing records
    const context = {
      storyId: story.currentStory.id,
      entryId: entry.id,
      narrativeContent: entry.translatedContent ?? entry.content,
      presentCharacters: story.characters, // Use all story characters for lookup
      referenceMode: story.currentStory.settings?.referenceMode ?? false,
    }

    await inlineImageService.processNarrativeForInlineImages(context)
    await loadEmbeddedImages()
  }

  // State for inline image view modal
  let isViewingImage = $state(false)
  let viewingImage = $state<(typeof embeddedImages)[0] | null>(null)
  let viewingImagePrompt = $state('')

  // Track images currently being regenerated (for loading overlay)
  let regeneratingImageIds = $state<Set<string>>(new Set())

  // Derive orphaned images (agentic images whose sourceText is not found or placed in content)
  const orphanedImages = $derived.by(() => {
    const content = entry.translatedContent ?? entry.content
    if (!content) return []

    // Get the set of IDs that the rendering engine will actually place as links
    const placedImageIds = getPlacedImageIds(content, embeddedImages)

    return embeddedImages.filter((img) => {
      // Inline images are handled differently via tags
      if (img.generationMode === 'inline') return false
      // If status is not complete/generating/pending, don't show it
      if (img.status === 'failed') return false

      // An image is orphaned if the rendering engine didn't find a place for it
      return !placedImageIds.has(img.id)
    })
  })

  // State for drag and drop
  let draggingImageId = $state<string | null>(null)
  let lastDropTarget = $state<HTMLElement | null>(null)

  // Mobile linking state
  let selectedOrphanId = $state<string | null>(null)

  function clearDropTarget() {
    if (lastDropTarget) {
      lastDropTarget.classList.remove('drop-target')
      lastDropTarget = null
    }
  }

  /**
   * Link an orphaned image to a specific piece of text or paragraph.
   */
  async function linkImageToText(
    imageId: string,
    targetElement: HTMLElement,
    clientX?: number,
    clientY?: number,
  ) {
    // Try sentence-level extraction if we have coordinates
    let newSourceText =
      clientX !== undefined && clientY !== undefined
        ? (getSentenceAtPoint(targetElement, clientX, clientY)?.text ?? '')
        : ''

    // Fallback to full element text
    if (!newSourceText) {
      newSourceText = targetElement.innerText.trim()
    }
    if (!newSourceText) return

    try {
      await database.updateEmbeddedImage(imageId, { sourceText: newSourceText })
      await loadEmbeddedImages()
      selectedOrphanId = null
      draggingImageId = null
      clearDropTarget()
    } catch (err) {
      console.error('[StoryEntry] Failed to link image:', err)
      ui.showToast('Failed to link image', 'error')
    }
  }

  /**
   * Find the character boundaries around an offset that don't contain existing links.
   */
  function getParagraphBoundaries(
    container: HTMLElement,
    offset: number,
  ): { boundaryStart: number; boundaryEnd: number } {
    const fullText = container.innerText
    let boundaryStart = 0
    let boundaryEnd = fullText.length

    // Find all existing links in this paragraph
    const links = Array.from(container.querySelectorAll('.embedded-image-link'))

    for (const link of links) {
      const linkText = (link as HTMLElement).innerText
      // Find the position of this link's text in the full text
      const linkPos = fullText.indexOf(linkText)
      if (linkPos === -1) continue

      const linkEnd = linkPos + linkText.length

      if (linkEnd <= offset && linkEnd > boundaryStart) {
        boundaryStart = linkEnd
      } else if (linkPos >= offset && linkPos < boundaryEnd) {
        boundaryEnd = linkPos
      }
    }

    return { boundaryStart, boundaryEnd }
  }

  /**
   * Helper to get the character offset of a point within an HTMLElement's text content.
   */
  function getCharOffsetInElement(
    container: HTMLElement,
    targetNode: Node,
    offsetInNode: number,
  ): number {
    let offset = 0
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)

    let currentNode = walker.nextNode()
    while (currentNode && currentNode !== targetNode) {
      offset += currentNode.textContent?.length ?? 0
      currentNode = walker.nextNode()
    }

    return offset + (targetNode.nodeType === Node.TEXT_NODE ? offsetInNode : 0)
  }

  /**
   * Helper to create a DOM Range from character offsets within an element.
   */
  function getRangeFromOffsets(container: HTMLElement, start: number, end: number): Range {
    const range = document.createRange()
    let currentOffset = 0
    let startNode: Node | null = null
    let startOffsetInNode = 0
    let endNode: Node | null = null
    let endOffsetInNode = 0

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()

    while (node) {
      const length = node.textContent?.length ?? 0
      if (!startNode && currentOffset + length >= start) {
        startNode = node
        startOffsetInNode = start - currentOffset
      }
      if (!endNode && currentOffset + length >= end) {
        endNode = node
        endOffsetInNode = end - currentOffset
      }
      currentOffset += length
      node = walker.nextNode()
    }

    if (startNode) range.setStart(startNode, startOffsetInNode)
    if (endNode) range.setEnd(endNode, endOffsetInNode)
    else if (startNode) range.setEndAfter(container.lastChild!)

    return range
  }

  /**
   * Extract the expanded sentence range at a screen coordinate within a container element.
   */
  function getSentenceAtPoint(
    container: HTMLElement,
    clientX: number,
    clientY: number,
  ): { text: string; start: number; end: number } | null {
    const range = document.caretRangeFromPoint(clientX, clientY)
    if (!range || !container.contains(range.startContainer)) return null
    const fullText = container.innerText
    const offset = getCharOffsetInElement(container, range.startContainer, range.startOffset)
    const { start, end } = extractSentenceAt(fullText, offset)
    const { boundaryStart, boundaryEnd } = getParagraphBoundaries(container, offset)
    return expandRangeBidirectional(fullText, start, end, 20, boundaryStart, boundaryEnd)
  }

  // State for visual sentence highlight
  let sentenceHighlightRects = $state<DOMRect[]>([])
  let containerRect = $state<DOMRect | null>(null)
  let storyTextContainer = $state<HTMLElement | null>(null)
  let dragOverRafId: number | null = null
  let lastX = 0
  let lastY = 0

  function updateSentenceHighlight(p: HTMLElement, clientX: number, clientY: number) {
    dragOverRafId = null
    if (!storyTextContainer) return
    const sentence = getSentenceAtPoint(p, clientX, clientY)
    if (sentence) {
      const sentenceRange = getRangeFromOffsets(p, sentence.start, sentence.end)
      sentenceHighlightRects = Array.from(sentenceRange.getClientRects())
      containerRect = storyTextContainer.getBoundingClientRect()
    }
  }

  function handleDragOver(e: DragEvent) {
    if (!draggingImageId || !storyTextContainer) return
    e.preventDefault()

    // Skip calculations if movement is minimal to save CPU
    if (Math.abs(e.clientX - lastX) < 4 && Math.abs(e.clientY - lastY) < 4) return
    lastX = e.clientX
    lastY = e.clientY

    const target = e.target as HTMLElement
    const p = target.closest('p, li, blockquote') as HTMLElement

    if (!p) {
      clearDropTarget()
      cancelDragHighlight()
      return
    }

    // Paragraph changed: update drop target immediately
    if (p !== lastDropTarget) {
      clearDropTarget()
      p.classList.add('drop-target')
      lastDropTarget = p
    }

    // Sentence highlight: throttle to one rAF and capture coordinates
    if (!dragOverRafId) {
      const cx = e.clientX
      const cy = e.clientY
      dragOverRafId = requestAnimationFrame(() => updateSentenceHighlight(p, cx, cy))
    }
  }

  function cancelDragHighlight() {
    if (dragOverRafId) {
      cancelAnimationFrame(dragOverRafId)
      dragOverRafId = null
    }
    sentenceHighlightRects = []
  }

  function handleDragLeave(e: DragEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      clearDropTarget()
      cancelDragHighlight()
    }
  }

  async function handleDrop(e: DragEvent) {
    cancelDragHighlight()
    if (draggingImageId) {
      e.preventDefault()
      if (lastDropTarget) {
        const target = lastDropTarget
        clearDropTarget()
        await linkImageToText(draggingImageId, target, e.clientX, e.clientY)
      }
    }
  }

  // Open the image view/edit modal
  function openImageViewModal(image: (typeof embeddedImages)[0]) {
    viewingImage = image
    // Extract original prompt (remove style suffix)
    viewingImagePrompt = image.prompt.split('. ').slice(0, -1).join('. ') || image.prompt
    isViewingImage = true
  }

  // Handle click on embedded image link
  function handleContentClick(event: MouseEvent | KeyboardEvent) {
    const target = event.target as HTMLElement

    // Handle linking an orphaned image via tap (Mobile fallback)
    if (selectedOrphanId) {
      const p = target.closest('p, li, blockquote') as HTMLElement
      if (p) {
        event.preventDefault()
        event.stopPropagation()
        linkImageToText(selectedOrphanId, p)
        return
      }
    }

    // Check for clicking on inline generated image (opens view modal)
    const inlineImage = target.closest('.inline-generated-image') as HTMLElement | null
    if (inlineImage) {
      event.preventDefault()
      event.stopPropagation()
      const imageId = inlineImage.getAttribute('data-image-id')
      if (imageId) {
        const image = embeddedImages.find((img) => img.id === imageId)
        if (image) {
          openImageViewModal(image)
        }
      }
      return
    }

    // Check for inline image action buttons
    const actionBtn = target.closest('.inline-image-btn') as HTMLElement | null
    if (actionBtn) {
      event.preventDefault()
      event.stopPropagation()
      const action = actionBtn.getAttribute('data-action')
      const imageId = actionBtn.getAttribute('data-image-id')
      const prompt = actionBtn.getAttribute('data-prompt')

      if (action === 'create-missing' && prompt) {
        handleCreateMissingImage()
        return
      }

      if (action && imageId) {
        handleInlineImageAction(action, imageId)
      }
      return
    }

    // Check for embedded image link (analyzed/agent mode) - toggle inline expansion
    const imageLink = target.closest('.embedded-image-link') as HTMLElement | null
    if (imageLink) {
      const imageId = imageLink.getAttribute('data-image-id')
      if (imageId) {
        // Toggle expanded view for all statuses
        if (expandedImageId === imageId) {
          expandedImageId = null
          clickedElement = null
        } else {
          expandedImageId = imageId
          clickedElement = imageLink
        }
      }
    }
  }

  // Handle inline image actions (edit, regenerate)
  async function handleInlineImageAction(action: string, imageId: string) {
    const image = embeddedImages.find((img) => img.id === imageId)
    if (!image) return

    if (action === 'edit') {
      // Open edit modal with current prompt
      editingImageId = imageId
      // Extract the original prompt from the stored prompt (remove style suffix)
      editingImagePrompt = image.prompt.split('. ').slice(0, -1).join('. ') || image.prompt
      _isEditingImage = true
    } else if (action === 'regenerate') {
      // Regenerate with same prompt
      await regenerateInlineImage(imageId, image.prompt)
    }
  }

  // Regenerate an inline image with a new or existing prompt
  async function regenerateInlineImage(imageId: string, prompt: string) {
    const image = embeddedImages.find((img) => img.id === imageId)
    if (!image) return

    // Mark as regenerating (shows loading overlay)
    regeneratingImageIds = new Set([...regeneratingImageIds, imageId])

    let finalPrompt = prompt

    // If it's an inline image, try to reconstruct prompt with CURRENT style
    // This allows style changes in settings to apply when retrying/regenerating
    if (
      image.generationMode === 'inline' &&
      image.sourceText &&
      image.sourceText.startsWith('<pic')
    ) {
      // Extract raw prompt from sourceText
      const match = image.sourceText.match(/prompt=["']([^"']+)["']/i)
      if (match && match[1]) {
        const rawPrompt = match[1]

        // Get CURRENT style
        const imageSettings = settings.systemServicesSettings.imageGeneration
        const styleId = imageSettings.styleId
        let stylePrompt = ''
        try {
          const template = await database.getPackTemplate('default-pack', styleId)
          stylePrompt = template?.content || ''
        } catch {
          stylePrompt = DEFAULT_FALLBACK_STYLE_PROMPT
        }

        // Reconstruct full prompt
        finalPrompt = `${rawPrompt}. ${stylePrompt}`
        console.log('[StoryEntry] Reconstructed prompt with new style:', finalPrompt)
      }
    }

    try {
      // Use centralized retry logic from ImageGenerationService
      await retryImageGeneration(imageId, finalPrompt)

      // Reload images to show updated state
      await loadEmbeddedImages()
    } finally {
      // Remove from regenerating set
      const newSet = new SvelteSet(regeneratingImageIds)
      newSet.delete(imageId)
      regeneratingImageIds = newSet
    }
  }

  // Handle edit modal submission
  async function handleEditImageSubmit() {
    if (!editingImageId || !editingImagePrompt.trim()) return

    const image = embeddedImages.find((img) => img.id === editingImageId)
    if (!image) return

    // Get style prompt and append it
    const imageSettings = settings.systemServicesSettings.imageGeneration
    const styleId = imageSettings.styleId
    let stylePrompt = ''
    try {
      const template = await database.getPackTemplate('default-pack', styleId)
      stylePrompt = template?.content || ''
    } catch {
      stylePrompt = DEFAULT_FALLBACK_STYLE_PROMPT
    }

    const fullPrompt = `${editingImagePrompt.trim()}. ${stylePrompt}`

    // Close modal and regenerate
    _isEditingImage = false
    await regenerateInlineImage(editingImageId, fullPrompt)
    editingImageId = null
    editingImagePrompt = ''
  }

  // Manage inline image display
  $effect(() => {
    // Clean up any existing inline image displays
    const existingDisplays = document.querySelectorAll('.inline-image-display')
    existingDisplays.forEach((el) => el.remove())

    if (!expandedImageId || !clickedElement || !expandedImage) return

    // Create the inline image container
    const container = document.createElement('div')
    container.className = 'inline-image-display'
    container.setAttribute('data-image-id', expandedImageId)

    // Build the HTML content based on image status
    let innerHtml = ``

    if (expandedImage.status === 'complete' && expandedImage.imageData) {
      // Check if regenerating
      const isRegenerating = regeneratingImageIds.has(expandedImage.id)
      if (isRegenerating) {
        innerHtml += `
          <div class="inline-image-content-wrapper">
            <img src="data:image/png;base64,${expandedImage.imageData}" alt="${expandedImage.sourceText}" class="inline-image-content regenerating-image" />
            <div class="regenerating-overlay">
              <div class="regenerating-content">
                <svg class="regenerating-spinner" viewBox="0 0 50 50">
                  <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="80, 200" stroke-dashoffset="0"></circle>
                </svg>
                <span class="regenerating-text">Regenerating...</span>
              </div>
            </div>
          </div>`
      } else {
        // Clickable image - opens modal
        innerHtml += `
          <div class="inline-image-content-wrapper clickable-image" data-image-id="${expandedImage.id}">
            <img src="data:image/png;base64,${expandedImage.imageData}" alt="${expandedImage.sourceText}" class="inline-image-content" />
          </div>`
      }
    } else if (expandedImage.status === 'generating') {
      const isStuck = now - expandedImage.createdAt > IMAGE_STUCK_THRESHOLD_MS
      innerHtml += `<div class="inline-image-placeholder generating">
        <div class="placeholder-spinner"></div>
        <span class="placeholder-status">Generating...</span>
        ${isStuck ? `<button class="inline-image-retry" data-image-id="${expandedImage.id}">Force Retry</button>` : ''}
      </div>`
    } else if (expandedImage.status === 'pending') {
      const isStuck = now - expandedImage.createdAt > IMAGE_STUCK_THRESHOLD_MS
      innerHtml += `<div class="inline-image-placeholder pending">
        <div class="placeholder-icon">⏳</div>
        <span class="placeholder-status">Queued...</span>
        ${isStuck ? `<button class="inline-image-retry" data-image-id="${expandedImage.id}">Force Retry</button>` : ''}
      </div>`
    } else if (expandedImage.status === 'failed') {
      innerHtml += `<div class="inline-image-placeholder failed">
        <div class="placeholder-icon">⚠️</div>
        <span class="placeholder-status">Generation Failed</span>
        ${expandedImage.errorMessage ? `<span class="placeholder-text">${expandedImage.errorMessage}</span>` : ''}
        <button class="inline-image-retry" data-image-id="${expandedImage.id}">Retry Generation</button>
      </div>`
    }

    container.innerHTML = innerHtml

    // Add retry button handler (for pending/generating/failed)
    const retryBtn = container.querySelector('.inline-image-retry')
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        const imageId = retryBtn.getAttribute('data-image-id')
        if (imageId && expandedImage) {
          await regenerateInlineImage(imageId, expandedImage.prompt)
          expandedImageId = null
          clickedElement = null
        }
      })
    }

    // Add click handler for complete image - opens modal
    const clickableImage = container.querySelector('.clickable-image')
    if (clickableImage) {
      clickableImage.addEventListener('click', () => {
        if (expandedImage) {
          openImageViewModal(expandedImage)
          expandedImageId = null
          clickedElement = null
        }
      })
    }

    // Insert after the clicked element's parent paragraph or directly after
    const paragraph = clickedElement.closest('p')
    if (paragraph) {
      paragraph.insertAdjacentElement('afterend', container)
    } else {
      clickedElement.insertAdjacentElement('afterend', container)
    }

    // Cleanup function
    return () => {
      container.remove()
    }
  })

  // Get the currently expanded image
  const expandedImage = $derived(
    expandedImageId ? embeddedImages.find((img) => img.id === expandedImageId) : null,
  )

  // Subscribe to ImageReady, ImageQueued, and TTS events
  onMount(() => {
    // Subscribe to ImageQueued events to reload images when new records are created during streaming
    const unsubImageQueued = eventBus.subscribe<ImageQueuedEvent>('ImageQueued', (event) => {
      if (event.entryId === entry.id) {
        loadEmbeddedImages()
      }
    })

    // Subscribe to ImageReady events to reload images when one completes
    const unsubImageReady = eventBus.subscribe<ImageReadyEvent>('ImageReady', (event) => {
      if (event.entryId === entry.id) {
        loadEmbeddedImages()
      }
    })

    // Subscribe to ImageAnalysisFailed events to show error toast
    const unsubImageAnalysisFailed = eventBus.subscribe<ImageAnalysisFailedEvent>(
      'ImageAnalysisFailed',
      (event) => {
        if (event.entryId === entry.id) {
          ui.showToast(`Image generation failed: ${event.error}`, 'error', 10000)
        }
      },
    )

    // Subscribe to TTSQueued events to auto-play TTS when triggered from ActionInput
    const unsubTTSQueued = eventBus.subscribe<TTSQueuedEvent>('TTSQueued', (event) => {
      if (event.entryId === entry.id && entry.type === 'narration') {
        console.log('[StoryEntry] Received TTSQueued event, triggering auto-play', {
          entryId: entry.id,
        })
        handleTTSToggle()
        loadEmbeddedImages()
      }
    })

    // Load images on mount if this is a narration entry
    if (entry.type === 'narration') {
      loadEmbeddedImages()
    }

    return () => {
      unsubImageQueued()
      unsubImageReady()
      unsubImageAnalysisFailed()
      unsubTTSQueued()
    }
  })

  const icons = {
    user_action: User,
    narration: BookOpen,
    system: Info,
    retry: BookOpen,
  }

  const styles = $derived({
    user_action: story.currentBgImage
      ? 'border-l-primary bg-primary/10 backdrop-blur-md'
      : 'border-l-primary bg-primary/5',
    narration: story.currentBgImage
      ? 'border-l-muted-foreground/40 bg-card/60 backdrop-blur-md'
      : 'border-l-muted-foreground/40 bg-card',
    system: story.currentBgImage
      ? 'border-l-muted bg-muted/20 backdrop-blur-md italic text-muted-foreground'
      : 'border-l-muted bg-muted/30 italic text-muted-foreground',
    retry: story.currentBgImage
      ? 'border-l-amber-500 bg-amber-500/20 backdrop-blur-md'
      : 'border-l-amber-500 bg-amber-500/10',
  })

  const Icon = $derived(icons[entry.type])

  function startEdit() {
    editContent = entry.content
    isEditing = true
  }

  async function saveEdit() {
    const newContent = editContent.trim()
    if (!newContent || newContent === entry.content) {
      isEditing = false
      return
    }

    try {
      // Check if this is the last user_action entry
      const isLastUserAction = entry.type === 'user_action' && isLastUserActionEntry()

      if (
        isLastUserAction &&
        ui.retryBackup &&
        story.currentStory &&
        ui.retryBackup.storyId === story.currentStory.id
      ) {
        // Update the backup with the new content and trigger retry
        console.log('[StoryEntry] Editing last user action, triggering retry with new content')
        ui.updateRetryBackupContent(newContent)
        isEditing = false
        await ui.triggerRetryLastMessage()
      } else {
        // Normal edit - just update the entry
        await story.updateEntry(entry.id, newContent)
        isEditing = false
      }
    } catch (error) {
      console.error('[StoryEntry] Failed to save edit:', error)
      alert(error instanceof Error ? error.message : 'Failed to save edit')
    }
  }

  /**
   * Check if this entry is the last user_action in the story.
   */
  function isLastUserActionEntry(): boolean {
    // Find all user_action entries
    const userActions = story.entries.filter((e) => e.type === 'user_action')
    if (userActions.length === 0) return false

    // Check if this entry is the last one
    const lastUserAction = userActions[userActions.length - 1]
    return lastUserAction.id === entry.id
  }

  /**
   * Play TTS audio or stop if already playing.
   */
  async function handleTTSToggle() {
    // If audio is playing, stop it
    if (isPlayingTTS) {
      aiTTSService.stopPlayback()
      isPlayingTTS = false
      return
    }

    const ttsSettings = settings.systemServicesSettings.tts

    if (!ttsSettings.enabled) {
      alert('TTS is not enabled. Please enable it in settings.')
      return
    }

    isGeneratingTTS = true

    try {
      // Initialize/Update service with current settings
      await aiTTSService.initialize(ttsSettings)

      // Use translated content if available, otherwise use original content
      const ttsContent = entry.translatedContent ?? entry.content
      const textToNarrate = sanitizeTextForTTS(ttsContent, {
        removeTags: ttsSettings.removeHtmlTags,
        removeAllTagContent: ttsSettings.removeAllHtmlContent,
        htmlTagsToRemoveContent: ttsSettings.htmlTagsToRemoveContent.replace(/\s+/g, '').split(','),
      })

      // Remove excluded characters after HTML cleanup
      const excludedCharArray = ttsSettings.excludedCharacters.replace(/\s+/g, '').split(',')
      const hasExcludedChars = excludedCharArray.some(Boolean)
      const finalNarrationText = hasExcludedChars
        ? textToNarrate.replace(
            new RegExp(`[${excludedCharArray.filter(Boolean).map(escapeRegex).join('')}]`, 'g'),
            '',
          )
        : textToNarrate

      isPlayingTTS = true
      isGeneratingTTS = false

      await aiTTSService.generateAndPlay(finalNarrationText)

      isPlayingTTS = false
    } catch (error) {
      console.error('[StoryEntry] TTS failed:', error)
      alert(error instanceof Error ? error.message : 'Failed to play TTS')
      isPlayingTTS = false
      isGeneratingTTS = false
    } finally {
      isGeneratingTTS = false
    }
  }

  let isGeneratingStoryImages = $state(false)

  async function handleGenerateStoryImages() {
    if (!story.currentStory || isGeneratingStoryImages) return
    isGeneratingStoryImages = true
    try {
      const context = {
        storyId: story.currentStory.id,
        entryId: entry.id,
        narrativeResponse: entry.content,
        userAction: '',
        presentCharacters: story.characters,
        referenceMode: story.currentStory.settings?.referenceMode ?? false,
        translatedNarrative: entry.translatedContent ?? undefined,
      }
      await aiService.generateImagesForNarrative(context)
    } catch (error) {
      console.error('[StoryEntry] Image generation failed:', error)
      ui.showToast('Image generation failed', 'error')
    } finally {
      isGeneratingStoryImages = false
    }
  }

  function cancelEdit() {
    isEditing = false
    editContent = ''
  }

  async function confirmDelete() {
    try {
      await story.deleteEntry(entry.id)
      isDeleting = false
    } catch (error) {
      console.error('[StoryEntry] Failed to delete entry:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete entry')
      isDeleting = false
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancelEdit()
    } else if (event.key === 'Enter' && event.ctrlKey) {
      saveEdit()
    }
  }

  $effect(() => {
    if (entry.type === 'narration' && isLatestEntry && ui.streamingReasoningExpanded) {
      ui.transferStreamingReasoningState(entry.id)
    }
  })
</script>

<div
  class="group border-border rounded-lg border border-l-4 px-4 pt-3 pb-4 shadow-sm {styles[
    entry.type
  ]}"
>
  <!-- Header row: Label + metadata on left, action buttons on right -->
  <div class="mb-2 flex items-center gap-2">
    <!-- Left side: Entry type indicator + reasoning toggle -->
    {#if entry.type === 'user_action'}
      <span class="user-action text-primary text-sm font-semibold tracking-wide">You</span>
    {:else if entry.type === 'system'}
      <div class="text-muted-foreground flex items-center gap-1.5">
        <Icon class="h-4 w-4 shrink-0 translate-y-px" />
        <span class="text-xs font-medium tracking-wider uppercase">System</span>
      </div>
    {:else}
      <Icon class="text-muted-foreground h-4 w-4 shrink-0 translate-y-px" />
    {/if}

    <!-- Reasoning toggle (inline icon in header) - only show if reasoning is enabled -->
    {#if isReasoningEnabled && entry.reasoning}
      <ReasoningBlock
        content={entry.reasoning}
        isStreaming={false}
        entryId={entry.id}
        showToggleOnly={true}
      />
    {/if}

    <!-- Token count badge (shows 0 if no tokens) -->
    <span class="bg-muted rounded px-1.5 py-0.5 text-[11px] tabular-nums">
      {#if isReasoningEnabled && reasoningTokens > 0}
        <span class="text-muted-foreground">{reasoningTokens}r</span>
        <span class="text-muted-foreground/50 mx-0.5">+</span>
      {/if}
      <span class="text-muted-foreground">{contentTokens}</span>
      <span class="text-muted-foreground ml-0.5">tokens</span>
    </span>

    <!-- Spacer to push buttons to the right -->
    <div class="flex-1"></div>

    <!-- Right side: Action buttons toolbar (always visible on mobile, hover-only on desktop) -->
    {#if !isEditing && !isDeleting && !isBranching && !isCreatingCheckpoint && entry.type !== 'system'}
      <div class="flex items-center gap-0.5">
        {#if canRetry}
          <Button
            variant="text"
            size="icon"
            onclick={() => ui.triggerRetryLastMessage()}
            class="h-7 w-7 text-amber-500 hover:text-amber-600"
            title="Generate a different response"
          >
            <RotateCcw class="h-4 w-4" />
          </Button>
        {/if}
        {#if canBranch}
          <Button
            variant="text"
            size="icon"
            onclick={() => (isBranching = true)}
            class="h-7 w-7 text-amber-500 hover:text-amber-600"
            title="Branch from here"
          >
            <GitBranch class="h-4 w-4" />
          </Button>
        {/if}
        {#if canCreateCheckpoint}
          <Button
            variant="text"
            size="icon"
            onclick={() => (isCreatingCheckpoint = true)}
            class="h-7 w-7 text-blue-500 hover:text-blue-600"
            title="Create checkpoint"
          >
            <Bookmark class="h-4 w-4" />
          </Button>
        {/if}
        <Button
          variant="text"
          size="icon"
          onclick={handleTTSToggle}
          disabled={isGeneratingTTS}
          class="text-muted-foreground hover:text-foreground h-7 w-7"
          title={isPlayingTTS ? 'Stop narration' : 'Narrate'}
        >
          {#if isGeneratingTTS}
            <Loader2 class="h-4 w-4 animate-spin" />
          {:else if isPlayingTTS}
            <X class="h-4 w-4 text-red-500" />
          {:else}
            <Volume2 class="h-4 w-4" />
          {/if}
        </Button>
        {#if isLatestNarration && story.currentStory?.settings?.imageGenerationMode === 'agentic'}
          <Button
            variant="text"
            size="icon"
            onclick={handleGenerateStoryImages}
            disabled={ui.isGenerating || isGeneratingStoryImages || embeddedImages.length > 0}
            class="text-muted-foreground hover:text-foreground h-7 w-7"
            title={embeddedImages.length > 0 ? 'Images already generated' : 'Generate story images'}
          >
            {#if isGeneratingStoryImages}
              <Loader2 class="h-4 w-4 animate-spin" />
            {:else}
              <ImageIcon class="h-4 w-4" />
            {/if}
          </Button>
        {/if}
        <Button
          variant="text"
          size="icon"
          onclick={startEdit}
          disabled={ui.isGenerating}
          class="text-muted-foreground hover:text-foreground h-7 w-7"
          title={ui.isGenerating ? 'Cannot edit during generation' : 'Edit'}
        >
          <Pencil class="h-4 w-4" />
        </Button>
        <Button
          variant="text"
          size="icon"
          onclick={() => (isDeleting = true)}
          disabled={ui.isGenerating}
          class="text-muted-foreground h-7 w-7 hover:text-red-500"
          title={ui.isGenerating ? 'Cannot delete during generation' : 'Delete'}
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      </div>
    {/if}
  </div>

  <!-- Content area -->
  <div class="min-w-0">
    {#if isEditing}
      <div class="space-y-2">
        <Textarea
          bind:value={editContent}
          onkeydown={handleKeydown}
          class="min-h-25 w-full resize-y text-base"
          rows={4}
        />
        <div class="flex gap-2">
          <Button size="sm" onclick={saveEdit} class="h-9 px-3">
            <Check class="mr-1.5 h-4 w-4" />
            Save
          </Button>
          <Button variant="secondary" size="sm" onclick={cancelEdit} class="h-9 px-3">
            <X class="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </div>
        <p class="text-muted-foreground hidden text-xs sm:block">
          Ctrl+Enter to save, Esc to cancel
        </p>
      </div>
    {:else if isDeleting}
      <div class="space-y-2">
        <p class="text-muted-foreground text-sm">Delete this entry?</p>
        <div class="flex gap-2">
          <Button variant="destructive" size="sm" onclick={confirmDelete} class="h-9 px-3">
            <Trash2 class="mr-1.5 h-4 w-4" />
            Delete
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onclick={() => (isDeleting = false)}
            class="h-9 px-3"
          >
            <X class="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    {:else if isBranching}
      <div class="space-y-2">
        <p class="text-muted-foreground text-sm">Create a branch from this point:</p>
        <Input
          type="text"
          class="h-9 text-sm"
          placeholder="Branch name..."
          bind:value={branchName}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleCreateBranch()
            if (e.key === 'Escape') cancelBranch()
          }}
        />
        <div class="flex gap-2">
          <Button
            size="sm"
            onclick={handleCreateBranch}
            disabled={!branchName.trim()}
            class="h-9 bg-amber-500 px-3 text-white hover:bg-amber-600"
          >
            <GitBranch class="mr-1.5 h-4 w-4" />
            Create Branch
          </Button>
          <Button variant="secondary" size="sm" onclick={cancelBranch} class="h-9 px-3">
            <X class="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </div>
        <p class="text-muted-foreground text-xs">
          This will create a new timeline from this checkpoint.
        </p>
      </div>
    {:else if isCreatingCheckpoint}
      <div class="space-y-2">
        <p class="text-muted-foreground text-sm">Create a checkpoint at this point:</p>
        <Input
          type="text"
          class="h-9 text-sm"
          placeholder="Checkpoint name..."
          bind:value={checkpointName}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleCreateCheckpoint()
            if (e.key === 'Escape') cancelCheckpoint()
          }}
        />
        <div class="flex gap-2">
          <Button
            size="sm"
            onclick={handleCreateCheckpoint}
            disabled={!checkpointName.trim()}
            class="h-9 bg-blue-500 px-3 text-white hover:bg-blue-600"
          >
            <Bookmark class="mr-1.5 h-4 w-4" />
            Create Checkpoint
          </Button>
          <Button variant="secondary" size="sm" onclick={cancelCheckpoint} class="h-9 px-3">
            <X class="mr-1.5 h-4 w-4" />
            Cancel
          </Button>
        </div>
        <p class="text-muted-foreground text-xs">
          Checkpoints save the current story state and allow branching from this point.
        </p>
      </div>
    {:else}
      <!-- Reasoning content panel (between header and story text) -->
      {#if entry.reasoning}
        <ReasoningBlock
          content={entry.reasoning}
          isStreaming={false}
          entryId={entry.id}
          showToggleOnly={false}
        />
      {/if}

      <div
        bind:this={storyTextContainer}
        class="story-text prose-content relative"
        class:visual-prose-container={visualProseMode && entry.type === 'narration'}
        class:linking-mode={!!selectedOrphanId || !!draggingImageId}
        onclick={handleContentClick}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={handleDrop}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleContentClick(e)
        }}
        tabindex="0"
        role="button"
        aria-label="Expand embedded image or interact with story content"
      >
        {#if sentenceHighlightRects.length > 0 && containerRect}
          {#each sentenceHighlightRects as rect, i (i)}
            <div
              class="sentence-drop-highlight bg-primary/30 ring-primary/50 pointer-events-none absolute z-50 rounded ring-1 transition-all duration-75"
              style="
                left: {rect.left - containerRect.left}px;
                top: {rect.top - containerRect.top}px;
                width: {rect.width}px;
                height: {rect.height}px;
              "
            ></div>
          {/each}
        {/if}

        {#if entry.type === 'narration'}
          {@const displayContent = entry.translatedContent ?? entry.content}
          {#if visualProseMode}
            <!-- Visual Prose mode (handles both agentic and inline images) -->
            {@html processVisualProseStoryContent(
              displayContent,
              embeddedImages,
              entry.id,
              regeneratingImageIds,
            )}
          {:else}
            <!-- Standard mode (handles both agentic and inline images) -->
            {@html processStoryContent(displayContent, embeddedImages, regeneratingImageIds)}
          {/if}
        {:else if entry.type === 'user_action'}
          <!-- User action: show original input (before translation) -->
          {@html parseMarkdown(entry.originalInput ?? entry.content)}
        {:else}
          {@html parseMarkdown(entry.content)}
        {/if}

        {#if selectedOrphanId}
          <div
            class="bg-primary/5 pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          >
            <div
              class="bg-primary/90 animate-bounce rounded-full px-3 py-1.5 text-xs font-medium text-white"
            >
              Tap a paragraph to link image
            </div>
          </div>
        {/if}
      </div>

      <!-- Orphaned Images Gallery (Unplaced Illustrations) -->
      {#if orphanedImages.length > 0}
        <div class="border-border/50 mt-4 border-t pt-3">
          <div class="mb-2 flex items-center gap-2">
            <ImageIcon class="text-muted-foreground h-3.5 w-3.5" />
            <span class="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              Unplaced Illustrations
            </span>
            <span class="text-muted-foreground/60 text-[10px] italic">
              (Drag to a paragraph to link)
            </span>
          </div>
          <div
            class="scrollbar-hide flex gap-3 overflow-x-auto pb-2"
            role="list"
            aria-label="Unplaced illustrations gallery"
          >
            {#each orphanedImages as img (img.id)}
              <div
                class="group relative"
                draggable="true"
                role="listitem"
                ondragstart={(e) => {
                  draggingImageId = img.id
                  if (e.dataTransfer) {
                    e.dataTransfer.setData('text/plain', img.id)
                    e.dataTransfer.dropEffect = 'link'
                  }
                }}
                ondragend={() => {
                  draggingImageId = null
                  clearDropTarget()
                }}
              >
                <button
                  onclick={() => {
                    if (selectedOrphanId === img.id) {
                      selectedOrphanId = null
                    } else {
                      selectedOrphanId = img.id
                    }
                  }}
                  class="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200
                                {selectedOrphanId === img.id
                    ? 'border-primary ring-primary/20 scale-105 ring-2'
                    : 'border-border/50 hover:border-primary/50'}"
                >
                  <img
                    src="data:image/png;base64,{img.imageData}"
                    alt="Unplaced illustration"
                    class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div
                    class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                  ></div>
                </button>

                {#if selectedOrphanId === img.id}
                  <div
                    class="bg-primary absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full shadow-sm"
                  >
                    <Check class="h-2.5 w-2.5 text-white" />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if isErrorEntry}
        <div class="mt-2 flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onclick={handleRetryFromEntry}
            disabled={ui.isGenerating}
            class="h-8 border-red-500/30 px-3 text-red-500 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-400"
          >
            <RefreshCw class="h-3.5 w-3.5" />
            Retry
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={handleDismissError}
            disabled={ui.isGenerating}
            class="text-muted-foreground border-border h-8 px-3 hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Dismiss
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- View/Edit Image Modal -->
<ResponsiveModal.Root bind:open={isViewingImage}>
  <ResponsiveModal.Content class="gap-0 overflow-hidden p-0 sm:max-w-3xl">
    <!-- Image area -->
    <div class="bg-surface-950 relative flex items-center justify-center p-4">
      {#if viewingImage}
        <img
          src="data:image/png;base64,{viewingImage.imageData}"
          alt={viewingImage.prompt}
          class="max-h-[40vh] max-w-full rounded object-contain sm:max-h-[50vh]"
        />
      {/if}
    </div>

    <!-- Edit area -->
    <div class="bg-surface-900 border-surface-800 border-t px-4 py-3">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class="text-surface-400 mb-1.5 block text-xs">Image Prompt</label>
      <Textarea
        bind:value={viewingImagePrompt}
        placeholder="Describe the image you want to generate..."
        rows={3}
        class="resize-none text-sm"
      />
    </div>

    <!-- Footer toolbar -->
    <div
      class="bg-surface-900 border-surface-800 flex items-center justify-end gap-2 border-t px-4 py-3"
    >
      <Button
        variant="outline"
        size="sm"
        onclick={() => (isViewingImage = false)}
        class="h-8 text-xs"
      >
        Close
      </Button>
      <Button
        size="sm"
        onclick={async () => {
          if (viewingImage && viewingImagePrompt.trim()) {
            const imageId = viewingImage.id
            // Close modal immediately - loading will show on inline image
            isViewingImage = false
            // Regenerate with the prompt from the textarea
            editingImageId = imageId
            editingImagePrompt = viewingImagePrompt
            await handleEditImageSubmit()
          }
        }}
        disabled={!viewingImagePrompt.trim()}
        class="h-8 gap-1.5 text-xs"
      >
        <RefreshCw class="h-3.5 w-3.5" />
        Regenerate
      </Button>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<style>
  /* Entry action button base style */
  .entry-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    border-radius: 0.375rem;
    transition: all 0.15s ease;
    min-height: 28px;
    min-width: 28px;
  }

  .entry-action-btn:hover {
    transform: translateY(-1px);
  }

  .entry-action-btn:active {
    transform: translateY(0);
  }

  .entry-action-btn:disabled {
    cursor: not-allowed;
    transform: none;
  }

  /* Embedded image link styles */
  :global(.embedded-image-link) {
    color: var(--accent-400);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    transition: all 0.15s ease;
  }

  :global(.embedded-image-link:hover) {
    text-decoration-style: solid;
    filter: brightness(1.1);
  }

  :global(.embedded-image-link.generating) {
    color: var(--color-amber-400, #fbbf24);
    animation: pulse-glow 2s ease-in-out infinite;
  }

  :global(.embedded-image-link.pending) {
    color: var(--surface-400);
    text-decoration-style: dashed;
  }

  :global(.embedded-image-link.regenerating) {
    color: var(--accent-400);
    animation: pulse-glow 1s ease-in-out infinite;
    cursor: wait;
  }

  :global(.embedded-image-link.regenerating)::after {
    content: ' ⟳';
    display: inline;
    animation: spin 1s linear infinite;
  }

  @keyframes pulse-glow {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  /* Inline image display styles */
  :global(.inline-image-display) {
    margin: 0.75rem 0;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--surface-600);
    background-color: var(--surface-800);
  }

  :global(.inline-image-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background-color: var(--surface-700);
  }

  :global(.inline-image-title) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--surface-300);
  }

  :global(.inline-image-source) {
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.inline-image-close) {
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    background: transparent;
    border: none;
    color: var(--surface-400);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  :global(.inline-image-close:hover) {
    background-color: var(--surface-600);
    color: var(--surface-200);
  }

  :global(.inline-image-content) {
    display: block;
    width: 100%;
    max-width: 28rem;
    margin: 0 auto;
  }

  /* Clickable image wrapper (agent mode) */
  :global(.inline-image-content-wrapper) {
    position: relative;
    cursor: pointer;
    overflow: hidden;
  }

  :global(.inline-image-content-wrapper.clickable-image .inline-image-content) {
    transition:
      filter 0.2s ease,
      transform 0.2s ease;
  }

  :global(.inline-image-content-wrapper.clickable-image:hover .inline-image-content) {
    filter: brightness(0.85);
    transform: scale(1.01);
  }

  /* Inline Image Placeholders (Loading/Pending/Failed) */
  :global(.inline-image-placeholder) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 1rem 0;
    border-radius: 0.75rem;
    background: linear-gradient(135deg, var(--surface-800) 0%, var(--surface-850) 100%);
    border: 1px solid var(--surface-700);
    overflow: hidden;
    min-height: 200px;
    aspect-ratio: 16 / 9;
    max-width: 100%;
  }

  :global(.inline-image-placeholder.generating),
  :global(.inline-image-placeholder.pending) {
    border-color: var(--accent-600);
  }

  :global(.inline-image-placeholder.failed) {
    border-color: var(--color-red-500, #ef4444);
    background: linear-gradient(135deg, var(--surface-800) 0%, rgba(239, 68, 68, 0.1) 100%);
  }

  /* Shimmer effect */
  :global(.placeholder-shimmer) {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.03) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: shimmer 2s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* Content container */
  :global(.placeholder-content) {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem;
    text-align: center;
  }

  /* Loader with spinner and image icon */
  :global(.placeholder-loader) {
    position: relative;
    width: 4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.placeholder-spinner-svg) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: var(--accent-500);
    animation: spinner-rotate 1.5s linear infinite;
  }

  :global(.placeholder-spinner-svg.pending) {
    animation-duration: 3s;
    color: var(--surface-500);
  }

  :global(.placeholder-spinner-svg circle) {
    animation: spinner-dash 1.5s ease-in-out infinite;
  }

  @keyframes spinner-rotate {
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spinner-dash {
    0% {
      stroke-dasharray: 1, 200;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 100, 200;
      stroke-dashoffset: -35;
    }
    100% {
      stroke-dasharray: 100, 200;
      stroke-dashoffset: -124;
    }
  }

  :global(.placeholder-image-icon) {
    width: 1.75rem;
    height: 1.75rem;
    color: var(--surface-400);
  }

  :global(.placeholder-error-icon) {
    width: 3rem;
    height: 3rem;
    color: var(--color-red-400, #f87171);
  }

  :global(.placeholder-error-icon svg) {
    width: 100%;
    height: 100%;
  }

  /* Info text */
  :global(.placeholder-info) {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-width: 280px;
  }

  :global(.placeholder-status) {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--accent-400);
    letter-spacing: 0.01em;
  }

  :global(.pending .placeholder-status) {
    color: var(--surface-400);
  }

  :global(.placeholder-status.error) {
    color: var(--color-red-400, #f87171);
  }

  :global(.placeholder-prompt) {
    font-size: 0.75rem;
    color: var(--surface-500);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  :global(.inline-image-stuck-notice) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background-color: var(--surface-700);
    border-top: 1px solid var(--surface-600);
    font-size: 0.875rem;
    color: var(--surface-300);
  }

  /* Inline Generated Image - Clickable */
  :global(.inline-generated-image) {
    position: relative;
    display: block;
    margin: 1rem 0;
    border-radius: 0.75rem;
    overflow: hidden;
    cursor: pointer;
  }

  :global(.inline-generated-image img) {
    display: block;
    width: 100%;
    height: auto;
    transition:
      filter 0.2s ease,
      transform 0.2s ease;
  }

  :global(.inline-generated-image:hover img) {
    filter: brightness(0.85);
    transform: scale(1.01);
  }

  /* Regenerating overlay */
  :global(.inline-generated-image.regenerating) {
    cursor: default;
  }

  :global(.inline-generated-image.regenerating:hover) {
    opacity: 1;
  }

  :global(.inline-generated-image .regenerating-image) {
    filter: brightness(0.5);
    transition: filter 0.3s ease;
  }

  :global(.regenerating-overlay) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);
  }

  :global(.regenerating-content) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 1.5rem 2rem;
    background: var(--surface-900);
    border-radius: 0.75rem;
    border: 1px solid var(--surface-700);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  :global(.regenerating-spinner) {
    width: 2.5rem;
    height: 2.5rem;
    color: var(--accent-500);
    animation: spinner-rotate 1.5s linear infinite;
  }

  :global(.regenerating-spinner circle) {
    animation: spinner-dash 1.5s ease-in-out infinite;
  }

  :global(.regenerating-text) {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--surface-300);
  }

  /* Shared Inline Image Button Styles */
  :global(.inline-image-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
    color: white; /* Always white for visibility on images */
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    transition: all 0.15s ease;
    cursor: pointer;
  }

  :global(.inline-image-btn:hover) {
    background-color: rgba(0, 0, 0, 0.8);
    transform: translateY(-1px);
    border-color: rgba(255, 255, 255, 0.4);
  }

  :global(.inline-image-btn:active) {
    transform: translateY(0);
  }

  :global(.inline-image-btn svg) {
    width: 14px;
    height: 14px;
  }

  /* Placeholder (Failed/Loading) styles for the button */
  :global(.inline-image-placeholder .inline-image-btn) {
    margin-top: 0.5rem;
    color: var(--foreground);
    background-color: var(--surface-600);
    border-color: var(--surface-500);
  }

  :global(.inline-image-placeholder .inline-image-btn:hover) {
    background-color: var(--surface-500);
    border-color: var(--surface-400);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Expanded image display action buttons (agent/auto mode) */
  :global(.inline-image-display-actions) {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    padding: 0.75rem;
    background-color: var(--surface-700);
    border-top: 1px solid var(--surface-600);
  }

  :global(.inline-image-edit-btn),
  :global(.inline-image-regenerate-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--surface-200);
    background-color: var(--surface-600);
    border: 1px solid var(--surface-500);
    transition: all 0.15s ease;
    cursor: pointer;
  }

  :global(.inline-image-edit-btn:hover),
  :global(.inline-image-regenerate-btn:hover) {
    background-color: var(--surface-500);
    border-color: var(--surface-400);
    transform: translateY(-1px);
  }

  :global(.inline-image-edit-btn:active),
  :global(.inline-image-regenerate-btn:active) {
    transform: translateY(0);
  }

  :global(.inline-image-edit-btn svg),
  :global(.inline-image-regenerate-btn svg) {
    width: 14px;
    height: 14px;
  }

  /* Linking & Drag-and-Drop Styles */
  .story-text.linking-mode :global(p),
  .story-text.linking-mode :global(li),
  .story-text.linking-mode :global(blockquote) {
    cursor: copy;
    transition: all 0.2s ease;
    border-radius: 0.25rem;
    padding: 2px 4px;
    margin-left: -4px;
    margin-right: -4px;
  }

  .story-text.linking-mode :global(p:hover),
  .story-text.linking-mode :global(li:hover),
  .story-text.linking-mode :global(blockquote:hover) {
    background-color: var(--primary-500/10);
    box-shadow: 0 0 0 1px var(--primary-500/30);
  }

  :global(.drop-target) {
    background-color: color-mix(in srgb, var(--color-primary), transparent 85%) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary), transparent 60%) !important;
    transform: scale(1.005);
    transition: all 0.2s ease;
    z-index: 1;
    position: relative;
  }

  /* Hide scrollbar for gallery */
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
