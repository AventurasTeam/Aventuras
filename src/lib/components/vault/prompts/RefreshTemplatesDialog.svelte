<script lang="ts">
  import type { ClassifiedTemplates, RefreshScope } from '$lib/services/packs/staleness'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { describeTemplate } from './templateGroups'

  interface Props {
    open: boolean
    packName: string
    classified: ClassifiedTemplates | null
    refreshing: boolean
    onConfirm: (scope: RefreshScope) => void
    onCancel: () => void
  }

  let { open, packName, classified, refreshing, onConfirm, onCancel }: Props = $props()

  function listed(templateIds: string[]) {
    return templateIds
      .map((templateId) => ({ templateId, described: describeTemplate(templateId) }))
      .filter((entry) => entry.described !== null)
      .map((entry) => ({
        templateId: entry.templateId,
        label: entry.described!.isUserHalf
          ? `${entry.described!.name} (user half)`
          : entry.described!.name,
        group: entry.described!.group,
      }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  }

  let behind = $derived(listed(classified?.behind ?? []))
  let customised = $derived(listed(classified?.customised ?? []))
  let total = $derived(behind.length + customised.length)
</script>

<ResponsiveModal.Root
  {open}
  onOpenChange={(v) => {
    if (!v) onCancel()
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-lg">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title>Refresh "{packName}" from the shipped prompts</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Your version of each template you choose is replaced by the one this version of the app
        ships. Templates you have not edited are untouched either way.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <ScrollArea class="max-h-72">
      <div class="flex flex-col gap-4 px-6 py-4">
        {#if behind.length > 0}
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium">Behind newer shipped text</h4>
              <Badge variant="secondary">{behind.length}</Badge>
            </div>
            <p class="text-muted-foreground text-xs">
              You edited these, and the app has changed them since.
            </p>
            <ul class="flex flex-col gap-1 text-sm">
              {#each behind as entry (entry.templateId)}
                <li class="flex items-baseline gap-2">
                  <span class="text-muted-foreground shrink-0 text-xs">{entry.group}</span>
                  <span>{entry.label}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if customised.length > 0}
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h4 class="text-sm font-medium">Customised</h4>
              <Badge variant="secondary">{customised.length}</Badge>
            </div>
            <p class="text-muted-foreground text-xs">
              You edited these and the app ships nothing newer for them. Replacing these discards
              your version for no change.
            </p>
            <ul class="flex flex-col gap-1 text-sm">
              {#each customised as entry (entry.templateId)}
                <li class="flex items-baseline gap-2">
                  <span class="text-muted-foreground shrink-0 text-xs">{entry.group}</span>
                  <span>{entry.label}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </ScrollArea>

    <ResponsiveModal.Footer class="border-t px-6 py-4">
      <Button variant="ghost" onclick={onCancel} disabled={refreshing}>Cancel</Button>
      {#if behind.length > 0}
        <Button variant="outline" onclick={() => onConfirm('behind')} disabled={refreshing}>
          Replace the {behind.length} behind
        </Button>
      {/if}
      <Button variant="destructive" onclick={() => onConfirm('edited')} disabled={refreshing}>
        {refreshing ? 'Replacing…' : `Replace all ${total} edited`}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
