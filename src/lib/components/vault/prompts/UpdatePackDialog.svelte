<script lang="ts">
  import type { PackUpdateSummary } from '$lib/services/packs/update-summary'
  import type { PackExport } from '$lib/services/packs/validation'
  import type { PresetPack } from '$lib/services/packs/types'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import * as Alert from '$lib/components/ui/alert'
  import { AlertTriangle, Download } from '@lucide/svelte'

  interface Props {
    open: boolean
    pack: PresetPack | null
    packData: PackExport | null
    summary: PackUpdateSummary | null
    exporting: boolean
    updating: boolean
    onExportFirst: () => void
    onConfirm: () => void
    onCancel: () => void
  }

  let {
    open,
    pack,
    packData,
    summary,
    exporting,
    updating,
    onExportFirst,
    onConfirm,
    onCancel,
  }: Props = $props()

  let stories = $derived(summary?.storyCount ?? 0)
  let edited = $derived(summary?.editedTemplates ?? 0)
</script>

<ResponsiveModal.Root
  {open}
  onOpenChange={(v) => {
    if (!v) onCancel()
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-lg">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title>Update "{pack?.name}" from file?</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        The pack keeps its name and every story stays bound to it. Its templates and variables are
        replaced by the file's.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    {#if pack && packData && summary}
      <div class="flex flex-col gap-3 px-6 py-4">
        <div class="flex items-center gap-2">
          <Badge variant="secondary">{packData.templates.length} templates</Badge>
          <Badge variant="secondary">{packData.variables.length} variables</Badge>
          {#if packData.author}
            <span class="text-muted-foreground text-sm">By {packData.author}</span>
          {/if}
        </div>

        {#if edited > 0}
          <Alert.Root variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <Alert.Title>
              {edited}
              {edited === 1 ? 'template carries' : 'templates carry'} your edits
            </Alert.Title>
            <Alert.Description>
              {edited === 1 ? 'It' : 'They'} will be replaced by the file's version. Export the pack first
              if you want to keep {edited === 1 ? 'it' : 'them'}.
            </Alert.Description>
          </Alert.Root>
        {/if}

        <ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            {#if stories === 0}
              No story uses this pack.
            {:else}
              {stories}
              {stories === 1 ? 'story' : 'stories'} will use the new prompts from
              {stories === 1 ? 'its' : 'their'} next turn.
            {/if}
          </li>
          {#if summary.addedVariables.length > 0}
            <li>
              Variables added: <span class="font-mono text-xs"
                >{summary.addedVariables.join(', ')}</span
              >
            </li>
          {/if}
          {#if summary.removedVariables.length > 0}
            <li>
              Variables removed:
              <span class="font-mono text-xs">{summary.removedVariables.join(', ')}</span>
            </li>
          {/if}
          <li>Per-entity runtime variable values are not affected.</li>
        </ul>
      </div>

      <ResponsiveModal.Footer class="border-t px-6 py-4">
        <Button variant="ghost" onclick={onCancel} disabled={updating}>Cancel</Button>
        <Button variant="outline" onclick={onExportFirst} disabled={exporting || updating}>
          <Download class="mr-2 h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export current pack'}
        </Button>
        <Button variant="destructive" onclick={onConfirm} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </Button>
      </ResponsiveModal.Footer>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
