<script lang="ts">
  import type { DirectoryExportPlan } from '#lib/services/packs/import-export.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import { FEATURE_COLORS, type ActionTone } from '#lib/components/shared/featureColors.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props {
    /** The planned export awaiting an answer, or null when nothing is pending. */
    plan: DirectoryExportPlan | null
    onConfirm: () => void
    onCancel: () => void
  }

  let { plan, onConfirm, onCancel }: Props = $props()

  let movedPrompts = $derived(plan?.movedPromptCount ?? 0)
  let deletions = $derived(plan?.deletedPaths ?? [])
  let renames = $derived(plan?.renames ?? [])
  let replaced = $derived(plan?.replacedPaths ?? [])
  let foreign = $derived(plan?.origin === 'foreign')
  let deletesPrompt = $derived(plan?.deletesPrompt ?? false)

  let tone = $derived<ActionTone>(
    deletions.length > 0 ? 'delete' : replaced.length > 0 ? 'overwrite' : 'default',
  )
</script>

{#snippet description()}
  {#if plan?.origin === 'earlier'}
    <span class="block">
      It was exported by an older version of Aventuras and is brought up to the current layout.
    </span>
  {:else if plan?.origin === 'current' && movedPrompts > 0}
    <span class="block">This version of Aventuras groups some prompts differently.</span>
  {/if}
  {#if deletesPrompt}
    <span class="block">Prompts this pack no longer has are deleted.</span>
    <span class="block">
      A note of your own in a prompt folder counts as a prompt, so check the list.
    </span>
  {/if}
  {#if foreign}
    <span class="block">
      This folder already holds files, but it wasn't made by an export, so nothing in it is deleted.
    </span>
  {/if}
{/snippet}

{#snippet fileList(heading: string, paths: string[], danger: boolean)}
  <div class="flex flex-col gap-1">
    <p class="text-sm font-medium">{heading}</p>
    <ul class={cn('list-disc pl-5 text-sm', danger && FEATURE_COLORS.delete.text)}>
      {#each paths as path, i (i)}
        <li class="font-mono text-xs">{path}</li>
      {/each}
    </ul>
  </div>
{/snippet}

<ActionModal
  open={!!plan}
  {onCancel}
  title={foreign ? 'Export into this folder?' : 'Update this folder?'}
  {description}
  action={{ label: 'Export', tone, onConfirm }}
>
  <div class="flex flex-col gap-4">
    {#if movedPrompts > 0}
      <p class="text-sm">
        <span class="font-medium">Moved into new folders:</span>
        {movedPrompts === 1 ? '1 prompt' : `${movedPrompts} prompts`}
      </p>
    {/if}
    {#if renames.length > 0}
      {@render fileList(
        'Kept under a new name:',
        renames.map(({ from, to }) => `${from} → ${to}`),
        false,
      )}
    {/if}
    {#if replaced.length > 0}
      {@render fileList('Replaced:', replaced, true)}
    {/if}
    {#if deletions.length > 0}
      {@render fileList('Deleted:', deletions, true)}
    {/if}
  </div>
</ActionModal>
