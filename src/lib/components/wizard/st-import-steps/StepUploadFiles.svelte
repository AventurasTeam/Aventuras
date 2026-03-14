<script lang="ts">
  import { Upload, ImageIcon, Check, X, MessageSquare, User, AlertCircle } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { cn } from '$lib/utils/cn'
  import type { STChatParseResult } from '$lib/services/stChatImporter'
  import type { ParsedCard } from '$lib/services/characterCardImporter'

  interface Props {
    chatParseResult: STChatParseResult | null
    chatFileError: string | null
    cardParsedData: ParsedCard | null
    cardPortrait: string | null
    cardFileError: string | null
    onChatFileProcess: (text: string) => void
    onChatFileClear: () => void
    onCardFileProcess: (file: File) => void
    onCardFileClear: () => void
  }

  let {
    chatParseResult,
    chatFileError,
    cardParsedData,
    cardPortrait,
    cardFileError,
    onChatFileProcess,
    onChatFileClear,
    onCardFileProcess,
    onCardFileClear,
  }: Props = $props()

  let chatDragOver = $state(false)
  let cardDragOver = $state(false)
  let chatFileInput: HTMLInputElement
  let cardFileInput: HTMLInputElement

  const userCount = $derived(
    chatParseResult?.messages.filter((m) => m.type === 'user_action').length ?? 0,
  )
  const narrationCount = $derived(
    chatParseResult?.messages.filter((m) => m.type === 'narration').length ?? 0,
  )

  function handleChatDrop(e: DragEvent) {
    e.preventDefault()
    chatDragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) void processChatFile(file)
  }

  function handleCardDrop(e: DragEvent) {
    e.preventDefault()
    cardDragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) onCardFileProcess(file)
  }

  async function processChatFile(file: File) {
    const text = await file.text()
    onChatFileProcess(text)
  }

  function handleChatFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) void processChatFile(file)
    input.value = ''
  }

  function handleCardFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) onCardFileProcess(file)
    input.value = ''
  }
</script>

<div class="space-y-5">
  <p class="text-muted-foreground">
    Upload your SillyTavern character card and optionally a chat export.
  </p>

  <!-- Character Card Upload -->
  <div class="space-y-2">
    <h4 class="flex items-center gap-2 text-sm font-medium">
      <User class="h-4 w-4" />
      Character Card
      <Badge variant="secondary" class="text-xs">Required</Badge>
    </h4>

    {#if cardParsedData}
      <Card.Root class="border-green-500/30 bg-green-500/5">
        <Card.Content class="flex items-center justify-between p-4">
          <div class="flex items-center gap-3">
            {#if cardPortrait}
              <img
                src={cardPortrait}
                alt={cardParsedData.name}
                class="h-10 w-10 rounded-lg object-cover"
              />
            {:else}
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <Check class="h-4 w-4 text-green-400" />
              </div>
            {/if}
            <div>
              <p class="text-sm font-medium">{cardParsedData.name}</p>
              <div class="text-muted-foreground flex flex-wrap gap-1.5 text-xs">
                <span>{cardParsedData.version.toUpperCase()}</span>
                {#if cardParsedData.firstMessage}
                  <span>· Has greeting</span>
                {/if}
                {#if cardParsedData.alternateGreetings.length > 0}
                  <span>· {cardParsedData.alternateGreetings.length} alt greetings</span>
                {/if}
                {#if cardParsedData.characterBook}
                  <span>· Has lorebook</span>
                {/if}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onclick={onCardFileClear}>
            <X class="h-4 w-4" />
          </Button>
        </Card.Content>
      </Card.Root>
    {:else}
      <div
        class={cn(
          'border-border hover:border-primary/40 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          cardDragOver && 'border-primary bg-primary/5',
        )}
        ondragover={(e) => {
          e.preventDefault()
          cardDragOver = true
        }}
        ondragleave={() => (cardDragOver = false)}
        ondrop={handleCardDrop}
        onclick={() => cardFileInput?.click()}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && cardFileInput?.click()}
      >
        <ImageIcon class="text-muted-foreground mb-2 h-8 w-8" />
        <p class="text-sm font-medium">Drop character card here or click to browse</p>
        <p class="text-muted-foreground mt-1 text-xs">PNG or JSON character card file</p>
      </div>
      <input
        type="file"
        accept=".png,.json"
        class="hidden"
        bind:this={cardFileInput}
        onchange={handleCardFileSelect}
      />
    {/if}

    {#if cardFileError}
      <Alert.Root variant="destructive">
        <AlertCircle class="h-4 w-4" />
        <Alert.Description>{cardFileError}</Alert.Description>
      </Alert.Root>
    {/if}
  </div>

  <!-- Chat File Upload -->
  <div class="space-y-2">
    <h4 class="flex items-center gap-2 text-sm font-medium">
      <MessageSquare class="h-4 w-4" />
      Chat Import
      <Badge variant="outline" class="text-xs">Optional</Badge>
    </h4>

    {#if chatParseResult}
      <Card.Root class="border-green-500/30 bg-green-500/5">
        <Card.Content class="flex items-center justify-between p-4">
          <div class="flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20">
              <Check class="h-4 w-4 text-green-400" />
            </div>
            <div>
              <p class="text-sm font-medium">{chatParseResult.characterName}</p>
              <p class="text-muted-foreground text-xs">
                {userCount} user messages · {narrationCount} narrations
                {#if chatParseResult.totalSkipped > 0}
                  · {chatParseResult.totalSkipped} skipped
                {/if}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onclick={onChatFileClear}>
            <X class="h-4 w-4" />
          </Button>
        </Card.Content>
      </Card.Root>
    {:else}
      <div
        class={cn(
          'border-border hover:border-primary/40 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          chatDragOver && 'border-primary bg-primary/5',
        )}
        ondragover={(e) => {
          e.preventDefault()
          chatDragOver = true
        }}
        ondragleave={() => (chatDragOver = false)}
        ondrop={handleChatDrop}
        onclick={() => chatFileInput?.click()}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && chatFileInput?.click()}
      >
        <Upload class="text-muted-foreground mb-2 h-8 w-8" />
        <p class="text-sm font-medium">Drop .jsonl file here or click to browse</p>
        <p class="text-muted-foreground mt-1 text-xs">SillyTavern chat file (.jsonl)</p>
      </div>
      <input
        type="file"
        accept=".jsonl"
        class="hidden"
        bind:this={chatFileInput}
        onchange={handleChatFileSelect}
      />
    {/if}

    {#if chatFileError}
      <Alert.Root variant="destructive">
        <AlertCircle class="h-4 w-4" />
        <Alert.Description>{chatFileError}</Alert.Description>
      </Alert.Root>
    {/if}
  </div>
</div>
