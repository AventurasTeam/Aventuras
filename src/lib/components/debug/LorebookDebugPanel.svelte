<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { BookOpen, Users, MapPin, Package, Shield, Lightbulb, Calendar } from 'lucide-svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { cn } from '$lib/utils/cn'

  const tierLabels: Record<number, string> = {
    1: 'Always Active',
    2: 'Keyword Matched',
    3: 'LLM Selected',
  }

  const tierDescriptions: Record<number, string> = {
    1: 'State-based or always-inject entries',
    2: 'Matched by name, alias, or keyword',
    3: 'Contextually relevant (AI selected)',
  }

  // Modern colors compatible with light/dark modes
  const tierColors: Record<number, string> = {
    1: 'text-green-600 dark:text-green-400 border-green-500/20 bg-green-500/5',
    2: 'text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/5',
    3: 'text-purple-600 dark:text-purple-400 border-purple-500/20 bg-purple-500/5',
  }

  const tierIndicatorColors: Record<number, string> = {
    1: 'bg-green-500',
    2: 'bg-amber-500',
    3: 'bg-purple-500',
  }

  const typeIcons: Record<string, typeof Users> = {
    character: Users,
    location: MapPin,
    item: Package,
    faction: Shield,
    concept: Lightbulb,
    event: Calendar,
  }

  function getIcon(type: string) {
    return typeIcons[type] || BookOpen
  }
</script>

<ResponsiveModal.Root bind:open={ui.lorebookDebugOpen}>
  <ResponsiveModal.Content class="flex h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
    <ResponsiveModal.Header class="shrink-0 border-b px-6 py-4" title="Active Lorebook Entries" />

    <ScrollArea class="min-h-0 flex-1">
      <div class="space-y-6 p-6">
        {#if ui.lastLorebookRetrieval}
          {@const result = ui.lastLorebookRetrieval}
          {@const totalCount = result.tier1.length + result.tier2.length + result.tier3.length}

          <!-- Summary Card -->
          <Card class="bg-muted/40 shadow-sm">
            <CardContent class="p-4">
              <div class="mb-4 flex items-center justify-between text-sm">
                <span class="text-muted-foreground font-medium">Total Active Entries</span>
                <span
                  class="text-foreground bg-background rounded border px-2.5 py-0.5 font-mono font-bold"
                  >{totalCount}</span
                >
              </div>
              <div class="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  class="border-green-500/40 bg-green-500/5 text-green-700 transition-colors hover:bg-green-500/10 dark:text-green-400"
                  >Tier 1: {result.tier1.length}</Badge
                >
                <Badge
                  variant="outline"
                  class="border-amber-500/40 bg-amber-500/5 text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                  >Tier 2: {result.tier2.length}</Badge
                >
                <Badge
                  variant="outline"
                  class="border-purple-500/40 bg-purple-500/5 text-purple-700 transition-colors hover:bg-purple-500/10 dark:text-purple-400"
                  >Tier 3: {result.tier3.length}</Badge
                >
              </div>
            </CardContent>
          </Card>

          {#if totalCount === 0}
            <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
              <BookOpen class="mb-4 h-12 w-12 opacity-10" />
              <p class="font-medium">No active entries</p>
              <p class="mt-1 text-sm opacity-70">Generate a response to populate the lorebook.</p>
            </div>
          {:else}
            <!-- Tier Sections -->
            {#each [1, 2, 3] as tier (tier)}
              {@const tierEntries =
                tier === 1 ? result.tier1 : tier === 2 ? result.tier2 : result.tier3}
              {#if tierEntries.length > 0}
                <div class="space-y-3">
                  <div class="flex items-center gap-2">
                    <div
                      class={cn(
                        'h-2.5 w-2.5 rounded-full shadow-sm',
                        tierIndicatorColors[tier as 1 | 2 | 3],
                      )}
                    ></div>
                    <h3 class="text-sm font-semibold">
                      Tier {tier}: {tierLabels[tier as 1 | 2 | 3]}
                      <span class="text-muted-foreground ml-1 font-normal"
                        >({tierEntries.length})</span
                      >
                    </h3>
                  </div>
                  <p class="text-muted-foreground pl-5 text-xs">
                    {tierDescriptions[tier as 1 | 2 | 3]}
                  </p>

                  <div class="grid gap-3">
                    {#each tierEntries as retrieved (retrieved.entry.id)}
                      {@const Icon = getIcon(retrieved.entry.type)}
                      <Card
                        class={cn(
                          'overflow-hidden transition-all hover:shadow-md',
                          tierColors[tier as 1 | 2 | 3],
                        )}
                      >
                        <CardContent class="flex items-start gap-3.5 p-3.5">
                          <div
                            class="bg-background/60 mt-0.5 shrink-0 rounded-md border border-transparent p-1.5 shadow-sm backdrop-blur-sm"
                          >
                            <Icon class="h-4 w-4" />
                          </div>
                          <div class="min-w-0 flex-1 space-y-1.5">
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate text-sm font-semibold"
                                >{retrieved.entry.name}</span
                              >
                              <Badge
                                variant="secondary"
                                class="bg-background/60 hover:bg-background/90 h-5 px-1.5 text-[10px] font-medium tracking-wide uppercase"
                                >{retrieved.entry.type}</Badge
                              >
                            </div>
                            {#if retrieved.matchReason}
                              <div
                                class="bg-background/40 inline-block rounded border border-black/5 px-2 py-1 text-xs dark:border-white/5"
                              >
                                <span class="font-medium opacity-70">Match:</span>
                                {retrieved.matchReason.replace(/^matched:\s*/i, '')}
                              </div>
                            {/if}
                            <p class="line-clamp-2 text-xs leading-relaxed opacity-80">
                              {retrieved.entry.description}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
          {/if}

          <!-- Context Block Preview removed — lorebook now uses structured ContextLorebookEntry[] injected via template -->
        {:else}
          <div class="text-muted-foreground flex flex-col items-center justify-center py-20">
            <div class="bg-muted/30 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
              <BookOpen class="h-10 w-10 opacity-20" />
            </div>
            <p class="text-lg font-semibold">No Data Available</p>
            <p class="mt-2 max-w-xs text-center text-sm opacity-70">
              Generate a story response to see active lorebook entries populated here.
            </p>
          </div>
        {/if}
      </div>
    </ScrollArea>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
