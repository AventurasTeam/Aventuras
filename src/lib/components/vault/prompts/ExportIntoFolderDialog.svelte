<script lang="ts">
  import type { DirectoryExportPlan } from '#lib/services/packs/import-export.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { ScrollArea } from '#lib/components/ui/scroll-area/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'

  interface Props {
    /** The planned export awaiting an answer, or null when nothing is pending. */
    plan: DirectoryExportPlan | null
    onConfirm: () => void
    onCancel: () => void
  }

  let { plan, onConfirm, onCancel }: Props = $props()

  let moves = $derived(plan?.movedPaths ?? [])
  let removals = $derived((plan?.prunePaths ?? []).filter((path) => !moves.includes(path)))
  let renames = $derived(plan?.renames ?? [])

  let title = $derived.by(() => {
    const kinds = [moves, removals, renames].filter((list) => list.length > 0).length
    if (kinds > 1) return 'Update this folder?'
    if (removals.length > 0) return 'Delete files no longer in this pack?'
    if (renames.length > 0) return 'Rename a file in this folder?'
    if (moves.length > 0) return 'Move prompts into their new folders?'
    return 'Export into this folder?'
  })
</script>

<ResponsiveModal.Root
  open={!!plan}
  onOpenChange={(v) => {
    if (!v) onCancel()
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-md">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title>{title}</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        {#if plan && !plan.isKnownExport}
          This folder already holds files and was not written by a previous export. Nothing in it
          will be deleted, but any file sharing a name with one of the exported files — including
          {renames.length > 0 ? '' : 'README.md, '}.gitattributes and any prompt of the same name —
          will be overwritten.
        {:else}
          Exporting keeps the folder matching the pack, so files it no longer contains are removed.
          A Markdown file you kept beside the prompts looks the same as a prompt this pack has
          dropped, so check the list before continuing.
        {/if}
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    {#if moves.length > 0 || renames.length > 0 || removals.length > 0}
      <div class="flex flex-col gap-4 px-6 py-4">
        {#if moves.length > 0}
          <p class="text-sm">
            {moves.length === 1
              ? '1 prompt moves into its new folder.'
              : `${moves.length} prompts move into their new folders.`}
          </p>
        {/if}

        {#if renames.length > 0}
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">
              {renames.length === 1
                ? '1 file of yours will be renamed, since the export writes its own:'
                : `${renames.length} files of yours will be renamed, since the export writes its own:`}
            </p>
            <ul class="list-disc pl-5 text-sm">
              {#each renames as { from, to }, i (i)}
                <li class="font-mono text-xs">{from} → {to}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if removals.length > 0}
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">
              {removals.length === 1
                ? '1 file will be deleted:'
                : `${removals.length} files will be deleted:`}
            </p>
            <ScrollArea class="max-h-48">
              <ul class="text-destructive list-disc pl-5 text-sm">
                {#each removals as path, i (i)}
                  <li class="font-mono text-xs">{path}</li>
                {/each}
              </ul>
            </ScrollArea>
          </div>
        {/if}
      </div>
    {/if}

    <ResponsiveModal.Footer class="border-t px-6 py-4">
      <Button variant="outline" onclick={onCancel}>Cancel</Button>
      <Button variant={removals.length > 0 ? 'destructive' : 'default'} onclick={onConfirm}>
        {removals.length > 0
          ? 'Delete and export'
          : renames.length > 0
            ? 'Rename and export'
            : 'Export here'}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
