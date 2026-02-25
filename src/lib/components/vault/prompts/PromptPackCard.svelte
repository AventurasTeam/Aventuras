<script lang="ts">
  import type { PresetPack } from '$lib/services/packs/types'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import { Download, Trash2, Lock } from 'lucide-svelte'
  import { stripToPlainText } from '$lib/utils/markdown'

  interface Props {
    pack: PresetPack
    modifiedCount: number
    usageCount: number
    onclick: () => void
    onExport?: () => void
    onDelete?: () => void
  }

  let { pack, modifiedCount, usageCount, onclick, onExport, onDelete }: Props = $props()
</script>

<button type="button" class="w-full text-left" {onclick}>
  <Card
    class="group hover:border-primary/50 h-full cursor-pointer transition-colors {pack.isDefault
      ? 'border-dashed'
      : ''}"
  >
    <CardContent class="flex h-full flex-col p-4">
      <div class="flex items-start justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="truncate font-semibold">{pack.name}</h3>
            {#if usageCount > 0}
              <Badge variant="outline" class="border-green-500/50 text-green-500">Active</Badge>
            {/if}
          </div>
          <p class="text-muted-foreground mt-1 line-clamp-2 text-sm">
            {#if pack.description}{stripToPlainText(pack.description)}{:else}&nbsp;{/if}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          {#if onExport}
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
              onclick={(e: MouseEvent) => {
                e.stopPropagation()
                onExport?.()
              }}
              title="Export pack"
            >
              <Download class="h-4 w-4" />
            </Button>
          {/if}
          {#if !pack.isDefault && onDelete}
            <Button
              variant="ghost"
              size="icon"
              class="text-destructive h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
              onclick={(e: MouseEvent) => {
                e.stopPropagation()
                onDelete?.()
              }}
              title="Delete pack"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          {/if}
        </div>
      </div>
      <div class="text-muted-foreground mt-auto flex items-center gap-3 pt-3 text-xs">
        {#if pack.isDefault}
          <span class="flex items-center gap-1"><Lock class="h-3 w-3" />Built-in</span>
        {:else}
          <span>{modifiedCount} modified</span>
        {/if}
        <span class="text-muted-foreground/50">|</span>
        <span>{pack.author ?? 'Custom'}</span>
      </div>
    </CardContent>
  </Card>
</button>
