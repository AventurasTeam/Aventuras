<script lang="ts">
  import type { DirectoryExportPlan } from '$lib/services/packs/import-export'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Button } from '$lib/components/ui/button'

  interface Props {
    /** The planned export awaiting an answer, or null when nothing is pending. */
    plan: DirectoryExportPlan | null
    onConfirm: () => void
    onCancel: () => void
  }

  let { plan, onConfirm, onCancel }: Props = $props()

  let removals = $derived(plan?.prunePaths ?? [])
</script>

<ResponsiveModal.Root
  open={!!plan}
  onOpenChange={(v) => {
    if (!v) onCancel()
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-md">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title>
        {removals.length > 0 ? 'Delete files no longer in this pack?' : 'Export into this folder?'}
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        {#if plan && !plan.isKnownExport}
          This folder already holds files and was not written by a previous export. Nothing in it
          will be deleted, but any file sharing a name with one of the exported files — including
          ABOUT.md, .gitattributes and any prompt of the same name — will be overwritten.
        {:else}
          Exporting keeps the folder matching the pack, so files it no longer contains are removed.
          A Markdown file you kept beside the prompts looks the same as a prompt this pack has
          dropped, so check the list before continuing.
        {/if}
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    {#if removals.length > 0}
      <div class="flex flex-col gap-1 px-6 py-4">
        <p class="text-sm font-medium">
          {removals.length === 1
            ? '1 file will be deleted:'
            : `${removals.length} files will be deleted:`}
        </p>
        <ScrollArea class="max-h-48">
          <ul class="text-destructive list-disc pl-5 text-sm">
            {#each removals as path (path)}
              <li class="font-mono text-xs">{path}</li>
            {/each}
          </ul>
        </ScrollArea>
      </div>
    {/if}

    <ResponsiveModal.Footer class="border-t px-6 py-4">
      <Button variant="outline" onclick={onCancel}>Cancel</Button>
      <Button variant={removals.length > 0 ? 'destructive' : 'default'} onclick={onConfirm}>
        {removals.length > 0 ? 'Delete and export' : 'Export here'}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
