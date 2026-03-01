<script lang="ts">
  import type { ImportValidationResult, ConflictStrategy } from '$lib/services/packs/import-export'
  import type { PresetPack } from '$lib/services/packs/types'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import * as Alert from '$lib/components/ui/alert'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { AlertTriangle } from 'lucide-svelte'
  import { renderDescription } from '$lib/utils/markdown'

  interface Props {
    open: boolean
    validationResult: ImportValidationResult | null
    conflictPack: PresetPack | null
    onConfirm: (strategy: ConflictStrategy) => void
    onCancel: () => void
  }

  let { open, validationResult, conflictPack, onConfirm, onCancel }: Props = $props()

  let isValid = $derived(validationResult?.valid ?? false)
  let pack = $derived(validationResult?.pack)
</script>

<ResponsiveModal.Root
  {open}
  onOpenChange={(v) => {
    if (!v) onCancel()
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-lg">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title class="flex items-center gap-2">
        Import Prompt Pack
        {#if validationResult}
          {#if isValid}
            <Badge variant="default" class="bg-green-600">Valid</Badge>
          {:else}
            <Badge variant="destructive">Invalid</Badge>
          {/if}
        {/if}
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        {#if isValid}
          Review the pack details before importing.
        {:else}
          The selected file contains errors and cannot be imported.
        {/if}
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    {#if validationResult && !isValid}
      <!-- Error state -->
      <div class="flex flex-col gap-3 px-6 py-4">
        {#if validationResult.structuralErrors.length > 0}
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">Structural errors:</p>
            <ul class="text-destructive list-disc pl-5 text-sm">
              {#each validationResult.structuralErrors as error (error)}
                <li>{error}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if validationResult.templateErrors.length > 0}
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">Template syntax errors:</p>
            <ScrollArea class="max-h-48">
              <ul class="text-destructive list-disc pl-5 text-sm">
                {#each validationResult.templateErrors as templateError (templateError.templateId)}
                  <li>
                    <span class="font-mono text-xs">{templateError.templateId}</span>:
                    {templateError.error}
                  </li>
                {/each}
              </ul>
            </ScrollArea>
          </div>
        {/if}
      </div>

      <ResponsiveModal.Footer class="border-t px-6 py-4">
        <Button variant="outline" onclick={onCancel}>Close</Button>
      </ResponsiveModal.Footer>
    {:else if validationResult && isValid && pack}
      <!-- Valid state: pack preview -->
      <div class="flex flex-col gap-3 px-6 py-4">
        <div class="flex flex-col gap-1">
          <h3 class="text-base font-semibold">{pack.name}</h3>
          {#if pack.description}
            <div class="prose-content text-muted-foreground text-sm">
              {@html renderDescription(pack.description)}
            </div>
          {/if}
          {#if pack.author}
            <p class="text-muted-foreground text-sm">By {pack.author}</p>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <Badge variant="secondary">{pack.templates.length} templates</Badge>
          <Badge variant="secondary">{pack.variables.length} variables</Badge>
        </div>

        {#if conflictPack}
          <Alert.Root variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <Alert.Title>Name conflict</Alert.Title>
            <Alert.Description>
              A pack named "{conflictPack.name}" already exists. Choose how to proceed.
            </Alert.Description>
          </Alert.Root>
        {/if}
      </div>

      <ResponsiveModal.Footer class="border-t px-6 py-4">
        {#if conflictPack}
          <Button variant="ghost" onclick={onCancel}>Cancel</Button>
          <Button variant="outline" onclick={() => onConfirm('rename')}>Import as Copy</Button>
          <Button variant="destructive" onclick={() => onConfirm('replace')}
            >Replace Existing</Button
          >
        {:else}
          <Button variant="outline" onclick={onCancel}>Cancel</Button>
          <Button onclick={() => onConfirm('rename')}>Import</Button>
        {/if}
      </ResponsiveModal.Footer>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
