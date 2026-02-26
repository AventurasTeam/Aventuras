<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    Users,
    MapPin,
    Backpack,
    Scroll,
    Clock,
    GitBranch,
    BookOpen,
    BookMarked,
    Brain,
  } from 'lucide-svelte'
  import CharacterPanel from '$lib/components/world/CharacterPanel.svelte'

  import LocationPanel from '$lib/components/world/LocationPanel.svelte'
  import InventoryPanel from '$lib/components/world/InventoryPanel.svelte'
  import QuestPanel from '$lib/components/world/QuestPanel.svelte'
  import TimePanel from '$lib/components/world/TimePanel.svelte'
  import BranchPanel from '$lib/components/branch/BranchPanel.svelte'
  import { swipe } from '$lib/utils/swipe'
  import { DESKTOP_BREAKPOINT, MAX_SIDEBAR_WIDTH, MAX_SIDEBAR_RATIO } from '$lib/constants/layout'

  import * as Tabs from '$lib/components/ui/tabs'
  import { Button } from '$lib/components/ui/button'

  const tabs = [
    { id: 'characters' as const, icon: Users, label: 'Characters' },
    { id: 'locations' as const, icon: MapPin, label: 'Locations' },
    { id: 'inventory' as const, icon: Backpack, label: 'Inventory' },
    { id: 'quests' as const, icon: Scroll, label: 'Quests' },
    { id: 'time' as const, icon: Clock, label: 'Time' },
    { id: 'branches' as const, icon: GitBranch, label: 'Branches' },
  ]

  function handleSwipeLeft() {
    // Navigate to next tab
    const currentIndex = tabs.findIndex((t) => t.id === ui.sidebarTab)
    if (currentIndex < tabs.length - 1) {
      ui.setSidebarTab(tabs[currentIndex + 1].id)
    }
  }

  function handleSwipeRight() {
    // Navigate to previous tab, or close sidebar if on first tab
    const currentIndex = tabs.findIndex((t) => t.id === ui.sidebarTab)
    if (currentIndex > 0) {
      ui.setSidebarTab(tabs[currentIndex - 1].id)
    } else {
      // On first tab, swipe right closes sidebar (swiping towards the right edge)
      ui.toggleSidebar()
    }
  }

  let innerWidth = $state(0)
</script>

<svelte:window bind:innerWidth />
<aside
  class="border-border bg-card/80 flex h-full w-[calc(100vw-3rem)] flex-col border-l backdrop-blur-[2px]"
  style:width={innerWidth > DESKTOP_BREAKPOINT ? settings.uiSettings.sidebarWidth + 'px' : ''}
  style:max-width={innerWidth > DESKTOP_BREAKPOINT
    ? Math.min(MAX_SIDEBAR_WIDTH, innerWidth * MAX_SIDEBAR_RATIO) + 'px'
    : '288px'}
  use:swipe={{ onSwipeLeft: handleSwipeLeft, onSwipeRight: handleSwipeRight, threshold: 50 }}
>
  <!-- Tab navigation -->
  <Tabs.Root
    value={ui.sidebarTab}
    onValueChange={(v) => ui.setSidebarTab(v as any)}
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="border-border bg-muted/60 flex-shrink-0 border-b px-0">
      <Tabs.List class="flex h-auto w-full justify-start rounded-none bg-transparent p-0">
        {#each tabs as tab (tab.id)}
          <Tabs.Trigger
            value={tab.id}
            class="data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-muted/30 hover:bg-muted/20 text-muted-foreground flex-1 rounded-none border-b-2 border-transparent bg-transparent py-3 transition-colors"
            title={tab.label}
          >
            <tab.icon class="h-4 w-4" />
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </div>

    <!-- Panel content -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <Tabs.Content value="characters" class="mt-0 h-full space-y-4">
        <CharacterPanel />
      </Tabs.Content>
      <Tabs.Content value="locations" class="mt-0 h-full space-y-4">
        <LocationPanel />
      </Tabs.Content>
      <Tabs.Content value="inventory" class="mt-0 h-full space-y-4">
        <InventoryPanel />
      </Tabs.Content>
      <Tabs.Content value="quests" class="mt-0 h-full space-y-4">
        <QuestPanel />
      </Tabs.Content>
      <Tabs.Content value="time" class="mt-0 h-full space-y-4">
        <TimePanel />
      </Tabs.Content>
      <Tabs.Content value="branches" class="mt-0 h-full space-y-4">
        <BranchPanel />
      </Tabs.Content>
    </div>
  </Tabs.Root>

  <!-- Bottom Context Navigation -->
  <div
    class="bottom-context-nav border-border bg-muted flex flex-shrink-0 items-center gap-1 border-t p-2"
  >
    <Button
      variant="ghost"
      class="text-muted-foreground hover:bg-muted/40 hover:text-foreground h-auto min-h-12 flex-1 flex-col gap-1 py-2 text-xs {ui.activePanel ===
      'story'
        ? '!bg-primary/10 !text-primary'
        : ''}"
      onclick={() => ui.setActivePanel('story')}
      title="Story"
    >
      <BookOpen class="h-4 w-4" />
      <span>Story</span>
    </Button>
    <Button
      variant="ghost"
      class="text-muted-foreground hover:bg-muted/40 hover:text-foreground h-auto min-h-12 flex-1 flex-col gap-1 py-2 text-xs {ui.activePanel ===
      'lorebook'
        ? '!bg-primary/10 !text-primary'
        : ''}"
      onclick={() => ui.setActivePanel('lorebook')}
      title="Lorebook"
    >
      <BookMarked class="h-4 w-4" />
      <span>Lorebook</span>
    </Button>
    <Button
      variant="ghost"
      class="text-muted-foreground hover:bg-muted/40 hover:text-foreground h-auto min-h-12 flex-1 flex-col gap-1 py-2 text-xs {ui.activePanel ===
      'memory'
        ? '!bg-primary/10 !text-primary'
        : ''}"
      onclick={() => ui.setActivePanel('memory')}
      title="Memory"
    >
      <Brain class="h-4 w-4" />
      <span>Memory</span>
    </Button>
  </div>
</aside>

<style>
  .bottom-context-nav {
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
  }

  @media (min-width: 769px) {
    .bottom-context-nav {
      padding-bottom: 0.5rem;
    }
  }
</style>
