<script lang="ts">
  import type { VaultCharacter, VaultLorebook, VaultScenario } from '$lib/types'
  import { normalizeImageDataUrl } from '$lib/utils/image'
  import { Badge } from '$lib/components/ui/badge'
  import {
    User,
    Users,
    Book,
    MapPin,
    MessageSquare,
    Box,
    Flag,
    Brain,
    Calendar,
    Link,
  } from 'lucide-svelte'
  import TagBadge from '$lib/components/tags/TagBadge.svelte'
  import { tagStore } from '$lib/stores/tags.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import VaultCard from './shared/VaultCard.svelte'

  type VaultItem = VaultCharacter | VaultLorebook | VaultScenario
  type VaultType = 'character' | 'lorebook' | 'scenario'

  interface Props {
    item: VaultItem
    type: VaultType
    onEdit?: () => void
    onDelete?: () => void
    onToggleFavorite?: () => void
    selectable?: boolean
    onSelect?: () => void
  }

  let {
    item,
    type,
    onEdit,
    onDelete,
    onToggleFavorite,
    selectable = false,
    onSelect,
  }: Props = $props()

  // Type Guards & Casters
  const asCharacter = $derived(type === 'character' ? (item as VaultCharacter) : null)
  const asLorebook = $derived(type === 'lorebook' ? (item as VaultLorebook) : null)
  const asScenario = $derived(type === 'scenario' ? (item as VaultScenario) : null)

  let isImporting = $derived(item.metadata?.importing === true)

  // Linked lorebook detection
  const hasLinkedLorebook = $derived(
    (type === 'character' || type === 'scenario') && !!item.metadata?.linkedLorebookId,
  )
  const linkedLorebookName = $derived.by(() => {
    if (!hasLinkedLorebook) return null
    const id = item.metadata?.linkedLorebookId as string
    return lorebookVault.getById(id)?.name ?? null
  })
  const isLinkedFromCard = $derived(
    type === 'lorebook' && !!(item.metadata as Record<string, unknown>)?.linkedFromName,
  )
  const linkedFromName = $derived(
    isLinkedFromCard ? ((item.metadata as Record<string, unknown>).linkedFromName as string) : null,
  )

  // Helper for Lorebook Entry Icons

  const entryTypeIcons: Record<string, any> = {
    character: Users,
    location: MapPin,
    item: Box,
    faction: Flag,
    concept: Brain,
    event: Calendar,
  }

  // Scenario tags with "imported" filtered out (source badge handles that)
  const scenarioTags = $derived(
    asScenario ? asScenario.tags.filter((t) => t.toLowerCase() !== 'imported') : [],
  )

  // Helper for Lorebook Entry Counts
  const lorebookEntryCounts = $derived.by(() => {
    if (!asLorebook?.metadata?.entryBreakdown) return []
    return Object.entries(asLorebook.metadata.entryBreakdown)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => ({ type, count }))
  })
</script>

<VaultCard
  title={item.name}
  {isImporting}
  isFavorite={item.favorite}
  {selectable}
  {onEdit}
  {onDelete}
  {onToggleFavorite}
  {onSelect}
>
  {#snippet icon()}
    {#if asCharacter}
      {#if asCharacter.portrait}
        <img
          src={normalizeImageDataUrl(asCharacter.portrait) ?? ''}
          alt={asCharacter.name}
          class="ring-border h-32 w-24 rounded-md object-cover ring-1"
        />
      {:else}
        <div class="bg-muted flex h-32 w-24 items-center justify-center rounded-md">
          <User class="text-muted-foreground h-10 w-10" />
        </div>
      {/if}
    {:else if asLorebook}
      <div
        class="bg-muted ring-border/50 flex h-24 w-24 items-center justify-center rounded-md ring-1"
      >
        <Book class="text-muted-foreground/50 h-10 w-10" />
      </div>
    {:else if asScenario}
      <div
        class="bg-muted ring-border/50 flex h-24 w-24 items-center justify-center rounded-md ring-1"
      >
        <MapPin class="text-muted-foreground/50 h-10 w-10" />
      </div>
    {/if}
  {/snippet}

  {#snippet badges()}
    {#if asCharacter}
      {#if hasLinkedLorebook}
        <Badge variant="secondary" class="h-4 max-w-32 gap-1 px-1.5 text-[10px] font-normal">
          <Link class="h-2.5 w-2.5 shrink-0" />
          <span class="truncate">{linkedLorebookName ?? 'Lorebook'}</span>
        </Badge>
      {/if}
    {:else if asLorebook}
      <span class="text-muted-foreground text-[10px] font-medium">
        {asLorebook.entries.length} entries
      </span>
      {#if isLinkedFromCard}
        <Badge variant="secondary" class="h-4 gap-1 px-1.5 text-[10px] font-normal">
          <Link class="h-2.5 w-2.5" />
          {linkedFromName}
        </Badge>
      {:else if asLorebook.source === 'story' || asLorebook.source === 'import'}
        <Badge variant="secondary" class="h-4 px-1.5 text-[10px] font-normal">
          {asLorebook.source === 'story' ? 'Story' : 'Imported'}
        </Badge>
      {/if}
    {:else if asScenario}
      {#if hasLinkedLorebook}
        <Badge variant="secondary" class="h-4 max-w-32 gap-1 px-1.5 text-[10px] font-normal">
          <Link class="h-2.5 w-2.5 shrink-0" />
          <span class="truncate">{linkedLorebookName ?? 'Lorebook'}</span>
        </Badge>
      {/if}
    {/if}
  {/snippet}

  {#snippet description()}
    {#if item.description}
      <p class="text-muted-foreground line-clamp-4 text-xs leading-snug">
        {item.description}
      </p>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if asCharacter}
      {#if asCharacter.traits.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each asCharacter.traits.slice(0, 3) as trait, i (i)}
            <Badge
              variant="outline"
              class="text-muted-foreground/80 border-muted-foreground/20 min-h-4 px-1.5 py-0 text-[10px] leading-4 font-normal"
            >
              {trait}
            </Badge>
          {/each}
          {#if asCharacter.traits.length > 3}
            <span class="text-muted-foreground self-center text-[10px]">
              +{asCharacter.traits.length - 3}
            </span>
          {/if}
        </div>
      {/if}
    {:else if asLorebook}
      {#if lorebookEntryCounts.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each lorebookEntryCounts.slice(0, 4) as { type, count } (type)}
            {@const Icon = entryTypeIcons[type]}
            <div
              class="text-muted-foreground/80 bg-muted/50 border-border/50 flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]"
              title={type}
            >
              {#if Icon}
                <Icon class="h-3 w-3 opacity-70" />
              {/if}
              <span>{count}</span>
            </div>
          {/each}
          {#if lorebookEntryCounts.length > 4}
            <span class="text-muted-foreground self-center text-[10px]">
              +{lorebookEntryCounts.length - 4}
            </span>
          {/if}
        </div>
      {/if}
    {:else if asScenario}
      <div class="flex flex-wrap gap-1">
        {#if asScenario.npcs.length > 0}
          <Badge
            variant="outline"
            class="text-muted-foreground/80 border-muted-foreground/20 h-4 gap-1 px-1.5 text-[10px] font-normal"
          >
            <Users class="h-2.5 w-2.5" />
            {asScenario.npcs.length} NPCs
          </Badge>
        {/if}
        {#if asScenario.firstMessage}
          <Badge
            variant="outline"
            class="text-muted-foreground/80 border-muted-foreground/20 h-4 gap-1 px-1.5 text-[10px] font-normal"
          >
            <MessageSquare class="h-2.5 w-2.5" />
            Opening
          </Badge>
        {/if}
        {#if asScenario.source === 'wizard' || asScenario.source === 'import'}
          <Badge
            variant="outline"
            class="text-muted-foreground/80 border-muted-foreground/20 h-4 px-1.5 text-[10px] font-normal"
          >
            {asScenario.source === 'wizard' ? 'Created' : 'Imported'}
          </Badge>
        {/if}
        {#each scenarioTags.slice(0, 3) as tag, i (i)}
          <TagBadge name={tag} color={tagStore.getColor(tag, 'scenario')} />
        {/each}
        {#if scenarioTags.length > 3}
          <span class="text-muted-foreground self-center text-[10px]">
            +{scenarioTags.length - 3}
          </span>
        {/if}
      </div>
    {/if}
  {/snippet}
</VaultCard>
