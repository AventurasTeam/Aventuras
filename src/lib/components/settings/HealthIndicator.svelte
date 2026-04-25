<script lang="ts">
  import SignalHigh from '@lucide/svelte/icons/signal-high'
  import SignalLow from '@lucide/svelte/icons/signal-low'
  import Clock from '@lucide/svelte/icons/clock'
  import X from '@lucide/svelte/icons/x'
  import { cn } from '$lib/utils/cn'
  import { isFresh } from '$lib/services/modelHealthCache'
  import {
    PING_TTL_AUTO_MS,
    PING_TTL_DEFAULT_MS,
    type CachedHealth,
    type HealthStatus,
  } from '$lib/constants/modelHealth'
  import type { ProviderType } from '$lib/types'

  interface Props {
    health: CachedHealth | undefined
    providerType: ProviderType
  }
  let { health, providerType }: Props = $props()

  let staleTtl = $derived(PING_TTL_AUTO_MS[providerType] ?? PING_TTL_DEFAULT_MS)
  let stale = $derived(!!health && !isFresh(health.checkedAt, staleTtl))

  function formatLatency(ms: number | null): string {
    if (ms === null) return ''
    if (ms < 1000) return `${ms}ms`
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.round(ms / 1000)}s`
  }

  function tooltipFor(status: HealthStatus, code: number | null): string {
    switch (status) {
      case 'ok':
      case 'slow':
        return 'Connection latency (initial ping). Does not reflect the model writing/generation speed.'
      case 'down':
        return code
          ? `Model unreachable (HTTP ${code}). Sending is blocked.`
          : 'Model unreachable. Sending is blocked.'
      case 'auth':
        return 'Invalid API key or insufficient permissions'
      case 'rate_limited':
        return 'Provider rate limit reached (429) — quota exhausted, try again later'
    }
  }
</script>

{#if health}
  {@const status = health.status}
  {@const showLatency = (status === 'ok' || status === 'slow') && health.latencyMs !== null}
  <span
    class={cn('flex shrink-0 items-center gap-0.5', stale && 'opacity-50')}
    title={tooltipFor(status, health.httpCode)}
  >
    {#if status === 'ok'}
      <SignalHigh class="h-3 w-3 text-emerald-500" />
    {:else if status === 'slow'}
      <SignalLow class="h-3 w-3 text-yellow-500" />
    {:else if status === 'rate_limited'}
      <Clock class="h-3 w-3 text-yellow-500" />
    {:else if status === 'auth'}
      <X class="h-3 w-3 text-yellow-500" />
    {:else}
      <X class="h-3 w-3 text-red-500" />
    {/if}
    {#if showLatency}
      <span class="text-muted-foreground text-[0.65rem] tabular-nums"
        >{formatLatency(health.latencyMs)}</span
      >
    {/if}
  </span>
{/if}
