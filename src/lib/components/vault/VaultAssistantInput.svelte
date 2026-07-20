<script lang="ts">
  import { isTouchDevice } from '$lib/utils/swipe'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Button } from '$lib/components/ui/button'
  import { Send, Square } from 'lucide-svelte'

  let {
    onSend,
    onAbort,
    disabled = false,
    isGenerating = false,
  }: {
    onSend: (message: string) => void
    onAbort?: () => void
    disabled?: boolean
    isGenerating?: boolean
  } = $props()

  let inputValue = $state('')
  let textareaRef = $state<HTMLTextAreaElement | null>(null)

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
    if (textareaRef) textareaRef.scrollTop = 0
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
      bind:ref={textareaRef}
      onkeydown={handleKeyDown}
      placeholder="Ask me to create characters, organize lorebooks, set up scenarios..."
      rows={2}
      class="border-surface-700 bg-surface-800 placeholder:text-surface-500 min-h-[2.5rem] resize-none rounded-xl text-sm"
      disabled={disabled || isGenerating}
    />
    <Button
      size="icon"
      class="bg-accent-600 hover:bg-accent-500 h-10 w-10 shrink-0 rounded-xl"
      onclick={() => (isGenerating ? onAbort?.() : handleSend())}
      disabled={disabled || (!isGenerating && !inputValue.trim())}
      title={isGenerating ? 'Stop generating' : 'Send message'}
    >
      {#if isGenerating}
        <Square class="h-4 w-4 fill-current" />
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
