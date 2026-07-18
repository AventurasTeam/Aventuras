<script lang="ts">
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import IconRow from '$lib/components/ui/icon-row.svelte'
  import { Star, Pencil, Loader2, Download, Copy } from 'lucide-svelte'
  import { cn } from '$lib/utils/cn'
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    isImporting?: boolean
    isFavorite?: boolean
    selectable?: boolean
    selected?: boolean

    // Actions
    onEdit?: () => void
    onDelete?: () => void
    onToggleFavorite?: () => void
    onExport?: () => void
    onDuplicate?: () => void
    onSelect?: () => void

    // Styling
    class?: string

    // Slots
    icon?: Snippet
    badges?: Snippet
    description?: Snippet
    footer?: Snippet
  }

  let {
    title,
    isImporting = false,
    isFavorite = false,
    selectable = false,
    selected = false,
    onEdit,
    onDelete,
    onToggleFavorite,
    onExport,
    onDuplicate,
    onSelect,
    class: className,
    icon,
    badges,
    description,
    footer,
  }: Props = $props()

  function handleCardClick() {
    if (isImporting) return
    if (selectable && onSelect) {
      onSelect()
    }
  }
</script>

<Card
  class={cn(
    'group relative flex h-full flex-col overflow-hidden transition-all',
    selectable && !isImporting && 'hover:border-primary/50 cursor-pointer hover:shadow-sm',
    selectable &&
      !isImporting &&
      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    selected && 'border-primary ring-primary bg-primary/5 ring-1',
    className,
  )}
  onclick={handleCardClick}
  role={selectable && !isImporting ? 'button' : undefined}
  tabindex={selectable && !isImporting ? 0 : undefined}
  onkeydown={selectable && !isImporting
    ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') handleCardClick()
      }
    : undefined}
>
  {#if isImporting}
    <div
      class="bg-background/80 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 backdrop-blur-sm"
    >
      <Loader2 class="text-primary h-8 w-8 animate-spin" />
      <span class="text-muted-foreground text-sm font-medium">Processing...</span>
    </div>
  {/if}

  <CardContent class="flex flex-1 flex-col p-3">
    <div class="flex flex-1 gap-3">
      <!-- Icon/Image Slot -->
      {#if icon}
        <div class="shrink-0">
          {@render icon()}
        </div>
      {/if}

      <!-- Main Content -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex justify-between gap-2">
          <!-- Header info -->
          <div class="min-w-0 flex-1">
            <h3 class="truncate pr-1 text-base leading-normal font-bold" {title}>
              {title}
            </h3>

            <div class="mt-1 flex flex-wrap items-center gap-2">
              {#if badges}
                {@render badges()}
              {/if}

              {#if selectable && isFavorite}
                <Star class="h-3 w-3 shrink-0 fill-yellow-500 text-yellow-500" />
              {/if}
            </div>
          </div>

          <!-- Actions -->
          {#if !selectable && (onEdit || onDelete || onToggleFavorite || onExport || onDuplicate)}
            <IconRow class="-mt-2" size="icon" {onDelete}>
              {#if onToggleFavorite}
                <Button
                  icon={Star}
                  variant="ghost"
                  size="icon"
                  class="hover:text-foreground text-muted-foreground h-3.5 w-5 transition-all hover:bg-transparent"
                  iconClass={cn(
                    'h-3.5 w-3.5 transition-colors',
                    isFavorite
                      ? 'text-yellow-500 fill-yellow-500'
                      : 'text-muted-foreground hover:text-yellow-500',
                  )}
                  onclick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite?.()
                  }}
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                />
              {/if}
              {#if onEdit}
                <Button
                  icon={Pencil}
                  variant="ghost"
                  size="icon"
                  class="hover:text-foreground text-muted-foreground h-3.5 w-5 transition-all hover:bg-transparent"
                  iconClass="h-3.5 w-3.5"
                  onclick={(e) => {
                    e.stopPropagation()
                    onEdit?.()
                  }}
                  title="Edit"
                />
              {/if}
              {#if onExport}
                <Button
                  icon={Download}
                  variant="ghost"
                  size="icon"
                  class="hover:text-foreground text-muted-foreground h-3.5 w-5 transition-all hover:bg-transparent"
                  iconClass="h-3.5 w-3.5"
                  onclick={(e) => {
                    e.stopPropagation()
                    onExport?.()
                  }}
                  title="Export"
                />
              {/if}
              {#if onDuplicate}
                <Button
                  icon={Copy}
                  variant="ghost"
                  size="icon"
                  class="hover:text-foreground text-muted-foreground h-3.5 w-5 transition-all hover:bg-transparent"
                  iconClass="h-3.5 w-3.5"
                  onclick={(e) => {
                    e.stopPropagation()
                    onDuplicate?.()
                  }}
                  title="Duplicate"
                />
              {/if}
            </IconRow>
          {/if}
        </div>

        {#if description}
          <div class="mt-1">
            {@render description()}
          </div>
        {/if}

        {#if footer}
          <div class="mt-auto pt-2">
            {@render footer()}
          </div>
        {/if}
      </div>
    </div>
  </CardContent>
</Card>
