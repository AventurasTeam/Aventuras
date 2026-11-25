<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'

  interface Props {
    code: string
  }

  let { code }: Props = $props()

  let copied = $state(false)
  let copyFailed = $state(false)

  $effect(() => {
    if (!copied) return
    const timer = setTimeout(() => (copied = false), 2000)
    return () => clearTimeout(timer)
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      copied = true
      copyFailed = false
    } catch {
      copyFailed = true
    }
  }
</script>

<div class="flex w-full flex-col gap-1 text-left">
  <Label>Connection code</Label>
  <div class="flex items-center gap-1 rounded-md border pl-3">
    <span class="min-w-0 flex-1 truncate font-mono text-sm">{code}</span>
    <Button
      variant="ghost"
      size="icon"
      class="size-11 shrink-0"
      aria-label="Copy code"
      onclick={copy}
    >
      {#if copied}
        <Check class="size-4 text-green-500" />
      {:else}
        <Copy class="size-4" />
      {/if}
    </Button>
  </div>
  {#if copyFailed}
    <p class="text-destructive text-sm">Couldn't copy the code. Select it here instead:</p>
    <p class="font-mono text-sm break-all select-all">{code}</p>
  {/if}
</div>
