<script lang="ts">
  import { isTouchDevice } from '$lib/utils/swipe'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'
  import { Loader2, Send } from 'lucide-svelte'

  let {
    onSend,
    disabled = false,
    isGenerating = false,
  }: {
    onSend: (message: string) => void
    disabled?: boolean
    isGenerating?: boolean
  } = $props()

  let inputValue = $state('')

  function handleKeyDown(e: KeyboardEvent) {
    const isTouch = isTouchDevice()
    const shouldSubmit = isTouch
      ? e.key === 'Enter' && e.shiftKey
      : e.key === 'Enter' && !e.shiftKey
    if (shouldSubmit) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    const msg = inputValue.trim()
    if (!msg) return
    inputValue = ''
    onSend(msg)
  }

  export function appendText(text: string) {
    inputValue = inputValue.trim() ? `${inputValue.trim()}\n${text}` : text
  }
</script>

<div
  class="border-surface-700 bg-surface-900 border-t p-3"
  style="padding-bottom: calc(0.75rem + var(--safe-bottom));"
>
  <div class="flex items-end gap-2">
    <Textarea
      bind:value={inputValue}
      onkeydown={handleKeyDown}
      placeholder="Ask me to create characters, organize lorebooks, set up scenarios..."
      rows={2}
      class="border-surface-700 bg-surface-800 placeholder:text-surface-500 min-h-[2.5rem] resize-none rounded-xl text-sm"
      disabled={disabled || isGenerating}
    />
    <Button
      size="icon"
      class={cn(
        'h-10 w-10 shrink-0 rounded-xl',
        isGenerating ? 'opacity-70' : 'bg-accent-600 hover:bg-accent-500',
      )}
      onclick={handleSend}
      disabled={!inputValue.trim() || disabled || isGenerating}
      title="Send message"
    >
      {#if isGenerating}
        <Loader2 class="h-5 w-5 animate-spin" />
      {:else}
        <Send class="h-5 w-5" />
      {/if}
    </Button>
  </div>
  <div class="text-surface-500 mt-1.5 hidden text-center text-[10px] md:block">
    {isTouchDevice()
      ? 'Shift+Enter to send, Enter for new line'
      : 'Enter to send, Shift+Enter for new line'}
  </div>
</div>
