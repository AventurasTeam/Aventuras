<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { TriangleAlert } from '@lucide/svelte'

  interface Props {
    open: boolean
    title?: string
    onCancel: () => void
    onDiscard: () => void
  }

  let { open, title = 'Discard this story?', onCancel, onDiscard }: Props = $props()

  const uid = $props.id()

  let cancelButton = $state<HTMLElement | null>(null)

  $effect(() => {
    if (open) cancelButton?.focus()
  })
</script>

<!--
  Belongs inside the wizard's own dialog, not in a nested one: a second modal layer would
  take over the dismissible and escape layers this prompt exists to intercept.
-->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-background/80 absolute inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    onclick={(e) => e.target === e.currentTarget && onCancel()}
  >
    <div
      class="bg-card w-full max-w-sm rounded-lg border p-5 shadow-lg"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-description"
    >
      <div class="flex items-start gap-3">
        <TriangleAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div class="min-w-0">
          <h2 id="{uid}-title" class="font-semibold">{title}</h2>
          <p id="{uid}-description" class="text-muted-foreground mt-1 text-sm">
            Everything you have filled in so far will be lost.
          </p>
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <Button bind:ref={cancelButton} variant="outline" onclick={onCancel}>Keep Editing</Button>
        <Button variant="destructive" onclick={onDiscard}>Discard</Button>
      </div>
    </div>
  </div>
{/if}
