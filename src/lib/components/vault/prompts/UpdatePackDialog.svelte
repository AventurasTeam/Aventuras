<script lang="ts">
  import type { PackUpdateSummary } from '#lib/services/packs/update-summary.ts'
  import type { PackExport } from '#lib/services/packs/validation.ts'
  import type { PresetPack } from '#lib/services/packs/types.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Badge } from '#lib/components/ui/badge/index.ts'
  import * as Alert from '#lib/components/ui/alert/index.ts'
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

<ActionModal
  {open}
  {onCancel}
  title={`Replace the pack “${pack?.name ?? ''}”`}
  description={packData?.author ? `By ${packData.author}` : undefined}
  action={{
    label: 'Replace',
    tone: 'overwrite',
    disabled: !pack || !packData || !summary,
    onConfirm,
  }}
  busy={updating}
>
  {#if pack && packData && summary}
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{packData.templates.length} templates</Badge>
      <Badge variant="secondary">{packData.variables.length} variables</Badge>
    </div>
    <ExplanationFold id="pack_update_help" summary="What it changes">
      <p>
        The pack keeps its name and every story stays bound to it. Its templates and variables are
        replaced by the file's.
      </p>
    </ExplanationFold>

    {#if edited > 0}
      <Alert.Root variant="destructive">
        <AlertTriangle class="size-4" />
        <Alert.Title>
          {edited}
          {edited === 1 ? 'template carries' : 'templates carry'} your edits
        </Alert.Title>
        <Alert.Description class="flex flex-col items-start gap-2">
          <span>
            {edited === 1 ? 'It' : 'They'} will be replaced by the file's version. Export the pack first
            if you want to keep {edited === 1 ? 'it' : 'them'}.
          </span>
          <!-- The safe way out of the warning, so it wears Cancel's look, not the alert's red. -->
          <Button
            variant="outline"
            size="sm"
            class="text-foreground gap-1.5"
            onclick={onExportFirst}
            disabled={exporting || updating}
          >
            <Download class="size-4" />
            {exporting ? 'Exporting…' : 'Export current pack'}
          </Button>
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
          Variables added: <span class="font-mono text-xs">{summary.addedVariables.join(', ')}</span
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
  {/if}
</ActionModal>
