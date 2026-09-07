<script lang="ts">
  import type { PresetPack } from '$lib/services/packs/types'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { Upload, RefreshCw, Trash2, Lock, FileJson, FolderOpen } from '@lucide/svelte'
  import { stripToPlainText } from '$lib/utils/markdown'
  import { supportsDirectoryTransfer } from '$lib/services/packs/directory/support'

  interface Props {
    pack: PresetPack
    modifiedCount: number
    usageCount: number
    onclick: () => void
    onExport?: () => void
    onExportDirectory?: () => void
    onUpdateFromFile?: () => void
    onUpdateFromDirectory?: () => void
    onDelete?: () => void
  }

  let {
    pack,
    modifiedCount,
    usageCount,
    onclick,
    onExport,
    onExportDirectory,
    onUpdateFromFile,
    onUpdateFromDirectory,
    onDelete,
  }: Props = $props()

  const canUseDirectories = supportsDirectoryTransfer()

  let exportMenuOpen = $state(false)
  let replaceMenuOpen = $state(false)

  // The card reveals its actions on hover, so an open menu has to hold its trigger visible.
  const triggerClass = (open: boolean) =>
    `h-8 w-8 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 ${open ? 'sm:opacity-100' : ''}`

  // The built-in pack is rewritten from the app's own templates on every launch, so it is
  // never a replacement target.
  const canReplace = $derived(!pack.isDefault && !!onUpdateFromFile)
</script>

<div class="relative">
  <Card
    class="group hover:border-primary/50 h-full cursor-pointer transition-colors {pack.isDefault
      ? 'border-dashed'
      : ''}"
  >
    <CardContent class="flex h-full flex-col p-4">
      <!-- Covers the card so the whole surface opens the pack, while the action menu stays a
           sibling: a menu trigger nested in a <button> breaks focus and activation. -->
      <button
        type="button"
        class="absolute inset-0 z-0 h-full w-full cursor-pointer rounded-xl text-left"
        aria-label="Open {pack.name}"
        {onclick}
      ></button>

      <div class="flex items-start justify-between">
        <div class="pointer-events-none relative z-10 min-w-0 flex-1">
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
        <div class="relative z-10 flex shrink-0 items-center gap-0.5">
          <!--
            One button per direction, as before. Where a folder is possible the button opens a
            menu to choose the format; on Android there is only the file, so it is the action
            itself rather than a menu of one.

            No onclick on a trigger: its handlers arrive through the spread props, and a second
            toggle on click opens then immediately closes the menu on touch.
          -->
          {#if canUseDirectories}
            <DropdownMenu.Root bind:open={exportMenuOpen}>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    class={triggerClass(exportMenuOpen)}
                    title="Export pack"
                  >
                    <Upload class="h-4 w-4" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>Export as</DropdownMenu.Label>
                <DropdownMenu.Item onclick={() => onExport?.()}>
                  <FileJson class="text-accent-400 h-4 w-4" />
                  Pack file (.prompt.json)
                </DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => onExportDirectory?.()}>
                  <FolderOpen class="h-4 w-4 text-blue-400" />
                  Folder of Markdown
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {:else if onExport}
            <Button
              variant="ghost"
              size="icon"
              class={triggerClass(false)}
              onclick={() => onExport?.()}
              title="Export pack"
            >
              <Upload class="h-4 w-4" />
            </Button>
          {/if}

          {#if canReplace && canUseDirectories}
            <DropdownMenu.Root bind:open={replaceMenuOpen}>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    class={triggerClass(replaceMenuOpen)}
                    title="Replace this pack"
                  >
                    <RefreshCw class="h-4 w-4" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>Replace this pack from</DropdownMenu.Label>
                <DropdownMenu.Item onclick={() => onUpdateFromFile?.()}>
                  <FileJson class="text-accent-400 h-4 w-4" />
                  Pack file (.prompt.json)
                </DropdownMenu.Item>
                {#if onUpdateFromDirectory}
                  <DropdownMenu.Item onclick={() => onUpdateFromDirectory?.()}>
                    <FolderOpen class="h-4 w-4 text-blue-400" />
                    Folder of Markdown
                  </DropdownMenu.Item>
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {:else if canReplace}
            <Button
              variant="ghost"
              size="icon"
              class={triggerClass(false)}
              onclick={() => onUpdateFromFile?.()}
              title="Update from file"
            >
              <RefreshCw class="h-4 w-4" />
            </Button>
          {/if}

          {#if !pack.isDefault && onDelete}
            <Button
              variant="ghost"
              size="icon"
              class="text-destructive h-8 w-8 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
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
</div>
