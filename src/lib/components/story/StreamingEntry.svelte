<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { storyContext } from '$lib/stores/storyContext.svelte'
  import { BookOpen, Volume2, Pencil, Trash2 } from 'lucide-svelte'
  import { parseMarkdown } from '$lib/utils/markdown'
  import ReasoningBlock from './ReasoningBlock.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { replacePicTagsWithPlaceholders } from '$lib/utils/inlineImageParser'

  // Reactive binding to streaming content
  let content = $derived(ui.streamingContent)

  // Check if streaming in Visual Prose mode
  let isVisualProse = $derived(ui.isVisualProseStreaming())

  // Check if inline image mode is enabled
  let inlineImageMode = $derived(
    storyContext.currentStory?.settings?.imageGenerationMode === 'inline',
  )

  // For Visual Prose, content is already wrapped HTML; for regular, parse as markdown
  // Also process <pic> tags to show generating placeholders when inline mode is enabled
  let renderedContent = $derived.by(() => {
    let processed = isVisualProse ? content : parseMarkdown(content)
    // Replace <pic> tags with generating placeholders during streaming
    if (inlineImageMode && content.includes('<pic')) {
      processed = replacePicTagsWithPlaceholders(processed)
    }
    return processed
  })

  // Show thinking state when streaming but no content yet (and no reasoning)
  let reasoning = $derived(ui.streamingReasoning)
  let isThinking = $derived(ui.isStreaming && content.length === 0 && reasoning.length === 0)

  // Check if reasoning is enabled in API settings
  let isReasoningEnabled = $derived(settings.apiSettings.reasoningEffort !== 'off')

  // Live token counts (separate)
  let reasoningTokens = $derived(ui.streamingReasoningTokens)
  let contentTokens = $derived(ui.streamingContentTokens)

  // Streaming phase detection for highlighting
  // Phase 1: reasoning is actively streaming (has reasoning, no content yet)
  // Phase 2: content is actively streaming (has content)
  let isReasoningPhase = $derived(ui.isStreaming && reasoning.length > 0 && content.length === 0)
  let isContentPhase = $derived(ui.isStreaming && content.length > 0)
</script>

<!-- Streaming content container -->
<div
  class="border-border border-l-muted-foreground/40 animate-fade-in rounded-lg border border-l-4 px-4 pt-3 pb-4 shadow-sm {story.currentBgImage
    ? 'bg-card/60 backdrop-blur-md'
    : 'bg-card'}"
>
  <!-- Header row -->
  <div class="mb-2 flex items-center gap-2">
    <BookOpen
      class="text-muted-foreground h-4 w-4 shrink-0 translate-y-px {isContentPhase ||
      !isReasoningEnabled
        ? 'animate-pulse'
        : ''}"
    />

    <!-- Reasoning toggle (inline icon) - only show if reasoning is enabled -->
    {#if isReasoningEnabled && (reasoning || isThinking)}
      <ReasoningBlock
        content={reasoning}
        isStreaming={true}
        {isReasoningPhase}
        showToggleOnly={true}
      />
    {/if}

    <!-- Live token counts with phase-based highlighting -->
    <span class="bg-muted rounded px-1.5 py-0.5 text-[11px] tabular-nums">
      {#if isReasoningEnabled && reasoningTokens > 0}
        <span
          class="transition-colors duration-200"
          class:text-primary={isReasoningPhase}
          class:text-muted-foreground={!isReasoningPhase}>{reasoningTokens}r</span
        >
        <span class="text-muted-foreground/50 mx-0.5">+</span>
      {/if}
      <span
        class="transition-colors duration-200"
        class:text-primary={isContentPhase}
        class:text-muted-foreground={!isContentPhase}>{contentTokens}</span
      >
      <span class="text-muted-foreground ml-0.5">tokens</span>
    </span>

    <!-- Spacer to push buttons to the right -->
    <div class="flex-1"></div>

    <!-- Placeholder for action buttons (invisible, reserves space to match StoryEntry) -->
    <div class="invisible flex items-center gap-0.5">
      <span class="inline-flex h-7 w-7 items-center justify-center"
        ><Volume2 class="h-4 w-4" /></span
      >
      <span class="inline-flex h-7 w-7 items-center justify-center"><Pencil class="h-4 w-4" /></span
      >
      <span class="inline-flex h-7 w-7 items-center justify-center"><Trash2 class="h-4 w-4" /></span
      >
    </div>
  </div>

  <!-- Main Content -->
  <div class="min-w-0">
    <!-- Reasoning content panel -->
    {#if reasoning || isThinking}
      <ReasoningBlock
        content={reasoning}
        isStreaming={true}
        {isReasoningPhase}
        showToggleOnly={false}
      />
    {/if}

    <!-- Story Content -->
    {#if content.length > 0}
      <div class="story-text prose-content streaming-content animate-fade-in">
        {@html renderedContent}<span class="streaming-cursor"></span>
      </div>
    {:else if isReasoningPhase || isThinking}
      <!-- Pending Content Indicator (while reasoning or thinking) -->
      <div class="story-text prose-content animate-fade-in text-muted-foreground mt-1">
        <span class="typing-indicator">
          <span>.</span><span>.</span><span>.</span>
        </span>
      </div>
    {/if}
  </div>
</div>

<style>
  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes typing {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    50% {
      transform: translateY(-2px);
      opacity: 1;
    }
  }

  .typing-indicator span {
    animation: typing 1.2s infinite ease-in-out both;
    font-size: 1.5rem;
    line-height: 1rem;
    display: inline-block;
    margin-right: 1px;
    color: var(--color-surface-400, #94a3b8);
  }

  .typing-indicator span:nth-child(1) {
    animation-delay: 0s;
  }
  .typing-indicator span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing-indicator span:nth-child(3) {
    animation-delay: 0.4s;
  }

  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }

  /* Streaming cursor that appears inline after the last content */
  .streaming-cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1rem;
    margin-left: 0.125rem;
    background-color: var(--color-accent-400, #60a5fa);
    animation: blink 1s infinite;
    vertical-align: text-bottom;
  }

  /* Ensure the cursor appears after the last element in streaming content */
  :global(.streaming-content > *:last-child) {
    display: inline;
  }
</style>
