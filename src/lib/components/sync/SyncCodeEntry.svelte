<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import { decodeConnectionCode, isValidPort } from '#lib/services/sync/index.ts'
  import type { SyncConnectionData } from '#lib/types/sync.ts'

  interface Props {
    /** Shown when this screen stands in for a camera that could not start. */
    note: string | null
    onConnect: (connection: SyncConnectionData) => void
    onScan: () => void
  }

  let { note, onConnect, onScan }: Props = $props()

  let code = $state('')
  let parsed = $state<SyncConnectionData | null>(null)
  let address = $state('')
  let port = $state('')

  const invalid = $derived(code.trim() !== '' && !parsed)
  const portNumber = $derived(Number(port))
  const ready = $derived(!!parsed && address.trim() !== '' && isValidPort(portNumber))

  function codeChanged() {
    parsed = decodeConnectionCode(code)
    address = parsed?.ip ?? ''
    port = parsed ? String(parsed.port) : ''
  }

  function connect() {
    if (parsed && ready) onConnect({ ...parsed, ip: address.trim(), port: portNumber })
  }
</script>

<div class="flex flex-col gap-4">
  {#if note}
    <p class="text-muted-foreground text-sm">{note}</p>
  {/if}

  <div class="flex flex-col gap-1">
    <Label for="sync-connection-code">Connection code</Label>
    <Input
      id="sync-connection-code"
      class="h-10 font-mono"
      bind:value={code}
      oninput={codeChanged}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      placeholder="Paste the code here"
      aria-invalid={invalid}
    />
    {#if invalid}
      <p class="text-destructive text-sm">That isn't a valid connection code.</p>
    {/if}
  </div>

  {#if parsed}
    <div class="text-sm">
      <p class="text-muted-foreground break-all">Connecting to {address}:{port}</p>
      <details class="mt-1">
        <summary class="min-h-11 cursor-pointer content-center">Change address</summary>
        <div class="grid grid-cols-[1fr_6rem] gap-2">
          <div class="flex flex-col gap-1">
            <Label for="sync-connection-address">Address</Label>
            <Input
              id="sync-connection-address"
              class="h-10"
              bind:value={address}
              autocapitalize="off"
              spellcheck={false}
            />
          </div>
          <div class="flex flex-col gap-1">
            <Label for="sync-connection-port">Port</Label>
            <Input id="sync-connection-port" class="h-10" inputmode="numeric" bind:value={port} />
          </div>
        </div>
      </details>
    </div>
  {/if}

  <div class="flex justify-between gap-2">
    <Button variant="outline" onclick={onScan}>Scan instead</Button>
    <Button disabled={!ready} onclick={connect}>Connect</Button>
  </div>
</div>
