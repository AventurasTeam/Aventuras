<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import { FEATURE_COLORS } from './featureColors'
  import { PAIR_BUTTON, PAIR_ROW } from './buttonPair'
  import type { PendingQuestion } from './pendingQuestion.svelte'

  let { question }: { question: PendingQuestion } = $props()

  const shown = $derived(question.current)
  const open = $derived(shown !== null)

  const uid = $props.id()

  let box = $state<HTMLElement | null>(null)

  // The question takes the focus off the inert modal behind it, but no answer is preselected.
  $effect(() => {
    if (open) box?.focus()
  })
</script>

<!--
  Belongs inside its modal's own content, not in a nested modal: a second modal layer would
  take over the dismissible and escape layers this prompt exists to intercept.
-->
<!-- Past the modal's border by a few pixels, with a wider radius, so its edge is covered too. -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-background/80 absolute -inset-1 z-50 flex items-center justify-center rounded-xl p-3 backdrop-blur-sm"
    onclick={(e) => e.target === e.currentTarget && question.answer(false)}
  >
    <div
      bind:this={box}
      tabindex="-1"
      class="bg-background w-full max-w-sm overflow-hidden rounded-lg border shadow-lg outline-none sm:w-fit sm:max-w-full"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-description"
    >
      <!-- An action modal's frame, as wide as its footer's pair: the text wraps to that width. -->
      <div class="bg-muted/40 w-0 min-w-full border-b p-4">
        <h2 id="{uid}-title" class="text-center text-lg leading-none font-semibold tracking-tight">
          {shown?.title}
        </h2>
      </div>
      <p id="{uid}-description" class="text-muted-foreground w-0 min-w-full p-4 text-sm">
        {shown?.description}
      </p>
      <div class="bg-muted/40 border-t p-4">
        <div class={PAIR_ROW}>
          <Button variant="outline" class={PAIR_BUTTON} onclick={() => question.answer(false)}>
            {shown?.keepLabel ?? 'Keep editing'}
          </Button>
          <Button
            variant="feature"
            class={cn(PAIR_BUTTON, FEATURE_COLORS.delete.vars)}
            onclick={() => question.answer(true)}
          >
            {shown?.confirmLabel ?? 'Discard'}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}
