<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    AlertTriangle,
    ArrowUpDown,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Search,
  } from '@lucide/svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import FilterButton from '#lib/components/ui/filter-button.svelte'
  import { Input } from '#lib/components/ui/input/index.ts'
  import type { ExportTracking } from '#lib/services/export.ts'
  import type { PackBindingResolution } from '#lib/services/import/index.ts'
  import {
    DEFAULT_LIST_PREFS,
    NEEDS_ACTION,
    STATUS_ORDER,
    applyCopy,
    applyItem,
    applyStory,
    buildRows,
    confirmSends,
    countByStatus,
    fetchListing,
    formatAgo,
    listLocalItems,
    loadListPrefs,
    pullEnvelope,
    saveListPrefs,
    sendItem,
    settleVector,
    storiesUsingPack,
    storySyncRecord,
    viewRows,
  } from '#lib/services/sync/index.ts'
  import { SYNC_SECTIONS } from '#lib/types/sync.ts'
  import type {
    SyncConnectionData,
    SyncEnvelope,
    SyncListPrefs,
    SyncPeer,
    SyncRow,
    SyncSection,
    SyncVector,
    SyncSort,
    SyncStatus,
  } from '#lib/types/sync.ts'

  interface Props {
    connection: SyncConnectionData
    self: SyncPeer
    tracking: () => ExportTracking
    /** Settles a story's pack before anything is replaced. Null if the user backed out. */
    resolvePack: (storyJson: string) => Promise<PackBindingResolution | null | { error: string }>
    /** Reloads whatever in-memory list holds this section's items. */
    onApplied: (section: SyncSection) => Promise<void>
    /** Fatal for the connection, as opposed to one item's transfer. */
    onDisconnect: (message: string) => void
  }

  let { connection, self, tracking, resolvePack, onApplied, onDisconnect }: Props = $props()

  const SECTION_LABELS: Record<SyncSection, string> = {
    stories: 'Stories',
    characters: 'Characters',
    lorebooks: 'Lorebooks',
    scenarios: 'Scenarios',
    packs: 'Prompt packs',
  }

  const SORT_LABELS: Record<SyncSort, { label: string; hint: string }> = {
    status: { label: 'Status', hint: 'Changed on both first, in sync last' },
    name: { label: 'Name', hint: 'A to Z' },
    lastSynced: { label: 'Last synced', hint: 'With the remote device; never synced last' },
    lastChanged: { label: 'Last changed', hint: 'Newest change on either device' },
  }

  let peer = $state<SyncPeer | null>(null)
  let rowsBySection = $state<Partial<Record<SyncSection, SyncRow[]>>>({})
  let section = $state<SyncSection | null>(null)
  let search = $state('')
  let prefs = $state<Partial<Record<SyncSection, SyncListPrefs>>>({})
  let sheet = $state<'filter' | 'sort' | null>(null)
  let openRow = $state<SyncRow | null>(null)
  let packConfirm = $state<{ row: SyncRow; stories: number } | null>(null)
  let busy = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let error = $state<string | null>(null)
  /** Sends the other device has yet to accept, by sync id. */
  const sent = new SvelteMap<string, SyncVector>()

  const currentPrefs = $derived(
    section ? (prefs[section] ?? DEFAULT_LIST_PREFS) : DEFAULT_LIST_PREFS,
  )
  const currentRows = $derived(section ? (rowsBySection[section] ?? []) : [])
  const view = $derived(viewRows(currentRows, search, currentPrefs))
  const counts = $derived(countByStatus(currentRows))

  function statusLabel(status: SyncStatus): string {
    switch (status) {
      case 'changedOnBoth':
        return 'Changed on both'
      case 'sameName':
        return 'Same name'
      case 'newerThere':
        return 'Newer on remote device'
      case 'newerHere':
        return 'Newer on this device'
      case 'onlyThere':
        return 'Only on remote device'
      case 'onlyHere':
        return 'Only on this device'
      case 'inSync':
        return 'In sync'
    }
  }

  const STATUS_CLASSES: Record<SyncStatus, string> = {
    changedOnBoth: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    sameName: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    newerThere: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    onlyThere: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    newerHere: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    onlyHere: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    inSync: 'bg-muted text-muted-foreground',
  }

  const ACTION_LABELS = { send: 'Send', get: 'Get', resolve: 'Resolve', choose: 'Choose' }

  function syncedLabel(row: SyncRow): string {
    return row.lastSyncedAt ? `synced ${formatAgo(row.lastSyncedAt)}` : 'never synced'
  }

  /** Each listing is read as the rows are built, so a slow section cannot show stale local data. */
  async function loadSection(name: SyncSection): Promise<void> {
    const listing = await fetchListing(connection, self, name)
    await confirmSends(name, listing.items, listing.device, sent)
    const local = await listLocalItems(name)
    peer = listing.device
    rowsBySection[name] = buildRows(name, local, listing.items, listing.device.deviceId)
  }

  onMount(() => {
    void untrack(async () => {
      prefs = await loadListPrefs()
      try {
        await Promise.all(SYNC_SECTIONS.map(loadSection))
      } catch (e) {
        onDisconnect(e instanceof Error ? e.message : 'Connection failed')
      }
    })
  })

  function sectionCounts(name: SyncSection) {
    const rows = rowsBySection[name]
    if (!rows) return null
    const c = countByStatus(rows)
    return {
      total: rows.length,
      both: c.changedOnBoth,
      sameName: c.sameName,
      send: c.newerHere + c.onlyHere,
      get: c.newerThere + c.onlyThere,
    }
  }

  function openSection(name: SyncSection) {
    section = name
    search = ''
    void refresh(name)
  }

  async function refresh(name: SyncSection) {
    try {
      await loadSection(name)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not refresh'
    }
  }

  function updatePrefs(change: Partial<SyncListPrefs>) {
    if (!section) return
    prefs[section] = { ...currentPrefs, ...change }
    void saveListPrefs($state.snapshot(prefs))
  }

  function toggleStatus(status: SyncStatus, on: boolean) {
    updatePrefs({
      statuses: on
        ? [...currentPrefs.statuses, status]
        : currentPrefs.statuses.filter((s) => s !== status),
    })
  }

  const isNeedsAction = $derived(
    currentPrefs.statuses.length === NEEDS_ACTION.length &&
      NEEDS_ACTION.every((s) => currentPrefs.statuses.includes(s)),
  )

  /** Runs one transfer, then re-reads both devices so the row shows its real status. */
  async function transfer(row: SyncRow, work: (name: SyncSection) => Promise<string | void>) {
    if (!section || busy) return
    const name = section
    busy = row.key
    error = null
    notice = null
    openRow = null
    packConfirm = null
    try {
      const message = await work(name)
      await onApplied(name)
      await loadSection(name)
      if (message) notice = message
    } catch (e) {
      error = e instanceof Error ? e.message : 'Transfer failed'
    } finally {
      busy = null
    }
  }

  function send(row: SyncRow) {
    const local = row.local
    if (!local) return
    const theirs = row.remote?.syncId === local.syncId ? (row.remote?.vector ?? null) : null
    return transfer(row, async (name) => {
      const { syncId, vector, outcome } = await sendItem(
        connection,
        self,
        name,
        local.localId,
        tracking(),
        theirs,
      )
      if (outcome === 'declined') return 'The remote device declined it.'
      sent.set(syncId, vector)
      if (outcome === 'waiting') {
        return 'No answer yet. Once the remote device accepts it, reopen this section to see it.'
      }
    })
  }

  async function fetchFor(row: SyncRow, name: SyncSection) {
    if (!row.remote) throw new Error('That item is not on the other device')
    return pullEnvelope(connection, self, name, row.remote.localId)
  }

  /** A story's pack, or a reason to stop. A cancel is not an error: nothing has changed. */
  async function packFor(envelope: SyncEnvelope): Promise<PackBindingResolution | null> {
    const binding = await resolvePack(envelope.document)
    if (binding && 'error' in binding) throw new Error(binding.error)
    return binding
  }

  async function get(row: SyncRow) {
    if (section === 'packs' && row.local) {
      const stories = await storiesUsingPack(row.local.localId)
      if (stories > 0 && packConfirm?.row !== row) {
        openRow = null
        packConfirm = { row, stories }
        return
      }
    }
    return transfer(row, async (name) => {
      if (!peer) return
      const envelope = await fetchFor(row, name)
      const existingId = row.local?.localId ?? null

      if (name === 'stories') {
        const binding = await packFor(envelope)
        if (!binding) return
        const previous = existingId ? await storySyncRecord(existingId) : null
        const result = await applyStory(envelope, peer, existingId, binding, previous)
        if (!result.success) throw new Error(result.error ?? 'Import failed')
        if (result.vector) await settleVector(connection, self, envelope, result.vector)
        return
      }

      const result = await applyItem(envelope, peer, existingId)
      await settleVector(connection, self, envelope, result.vector)
      if (result.renamedTo) return `Received as "${result.renamedTo}": that name was taken.`
    })
  }

  function keepBoth(row: SyncRow) {
    return transfer(row, async (name) => {
      if (!peer) return
      const envelope = await fetchFor(row, name)
      const binding = name === 'stories' ? await packFor(envelope) : null
      if (name === 'stories' && !binding) return
      await applyCopy(envelope, peer, binding)
    })
  }

  function formatChanged(time: number | undefined): string {
    return time ? formatAgo(time) : '-'
  }
</script>

{#if error}
  <div
    class="bg-destructive/15 text-destructive mb-3 flex items-center gap-2 rounded-lg p-3 text-sm"
  >
    <AlertTriangle class="h-4 w-4 shrink-0" />
    {error}
  </div>
{/if}
{#if notice}
  <div class="bg-muted text-muted-foreground mb-3 rounded-lg p-3 text-sm">{notice}</div>
{/if}

{#if !section}
  <p class="text-muted-foreground mb-3 text-sm break-words">
    Connected to {peer?.name ?? 'remote device'}
  </p>
  <div class="flex flex-col gap-2">
    {#each SYNC_SECTIONS as name, i (i)}
      {@const summary = sectionCounts(name)}
      <button
        class="bg-card hover:bg-muted/50 flex min-h-16 w-full items-center gap-3 rounded-lg border p-3 text-left"
        onclick={() => openSection(name)}
      >
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="font-medium">{SECTION_LABELS[name]}</span>
          {#if !summary}
            <span class="text-muted-foreground text-xs">Loading...</span>
          {:else if summary.both + summary.sameName + summary.send + summary.get === 0}
            <span class="text-muted-foreground text-xs">
              {summary.total === 0 ? 'Nothing to sync' : `All ${summary.total} in sync`}
            </span>
          {:else}
            <span class="flex flex-wrap gap-1">
              {#if summary.both}
                <span class="rounded-full px-2 py-0.5 text-xs {STATUS_CLASSES.changedOnBoth}">
                  {summary.both} changed on both
                </span>
              {/if}
              {#if summary.sameName}
                <span class="rounded-full px-2 py-0.5 text-xs {STATUS_CLASSES.sameName}">
                  {summary.sameName} same name
                </span>
              {/if}
              {#if summary.send}
                <span class="rounded-full px-2 py-0.5 text-xs {STATUS_CLASSES.newerHere}">
                  {summary.send} to send
                </span>
              {/if}
              {#if summary.get}
                <span class="rounded-full px-2 py-0.5 text-xs {STATUS_CLASSES.newerThere}">
                  {summary.get} to get
                </span>
              {/if}
            </span>
          {/if}
        </span>
        <ChevronRight class="text-muted-foreground h-5 w-5 shrink-0" />
      </button>
    {/each}
  </div>
{:else}
  <div class="mb-3 flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon"
      aria-label="Back to sections"
      onclick={() => (section = null)}
    >
      <ChevronLeft class="h-5 w-5" />
    </Button>
    <h3 class="font-semibold">{SECTION_LABELS[section]}</h3>
  </div>

  <div class="mb-2 flex items-center gap-2">
    <div class="min-w-0 flex-1">
      <Input
        bind:value={search}
        leftIcon={Search}
        class="h-10"
        type="search"
        aria-label="Search {SECTION_LABELS[section]}"
        placeholder="Search {SECTION_LABELS[section].toLowerCase()}"
      />
    </div>
    <FilterButton
      class="size-10 shrink-0"
      active={currentPrefs.statuses.length !== STATUS_ORDER.length}
      label="Filter"
      onclick={() => (sheet = 'filter')}
    />
    <FilterButton
      class="size-10 shrink-0"
      icon={ArrowUpDown}
      active={currentPrefs.sort !== DEFAULT_LIST_PREFS.sort || currentPrefs.reversed}
      label="Sort"
      onclick={() => (sheet = 'sort')}
    />
  </div>

  <div class="divide-y">
    {#each view.rows as row (row.key)}
      <div class="flex min-h-16 items-center gap-2 py-2">
        <button class="min-w-0 flex-1 text-left" onclick={() => (openRow = row)}>
          <span class="block truncate font-medium">{row.name}</span>
          <span class="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
            <span class="rounded-full px-2 py-0.5 whitespace-nowrap {STATUS_CLASSES[row.status]}">
              {statusLabel(row.status)}
            </span>
            <span class="truncate">{syncedLabel(row)}</span>
          </span>
        </button>
        {#if busy === row.key}
          <Loader2 class="text-primary mx-6 h-5 w-5 shrink-0 animate-spin" />
        {:else if row.action}
          <Button
            class="min-w-20 shrink-0"
            size="sm"
            variant="outline"
            disabled={!!busy}
            onclick={() => {
              if (row.action === 'send') void send(row)
              else if (row.action === 'get') void get(row)
              else openRow = row
            }}
          >
            {ACTION_LABELS[row.action]}
          </Button>
        {/if}
      </div>
    {:else}
      <p class="text-muted-foreground py-6 text-center text-sm">Nothing here.</p>
    {/each}
  </div>
  {#if view.hidden > 0}
    <button
      class="text-muted-foreground hover:text-foreground mt-2 min-h-11 w-full text-left text-sm"
      onclick={() => updatePrefs({ statuses: [...STATUS_ORDER] })}
    >
      {view.hidden} hidden by filter. Show everything.
    </button>
  {/if}
{/if}

<ResponsiveModal.Root bind:open={() => sheet === 'filter', (open) => !open && (sheet = null)}>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-w-sm"
  >
    <ResponsiveModal.Header>
      <ResponsiveModal.Title>Show</ResponsiveModal.Title>
    </ResponsiveModal.Header>
    <div class="grid grid-cols-2 gap-2">
      <Button
        variant={isNeedsAction ? 'default' : 'outline'}
        onclick={() => updatePrefs({ statuses: [...NEEDS_ACTION] })}
      >
        Needs action
      </Button>
      <Button variant="outline" onclick={() => updatePrefs({ statuses: [...STATUS_ORDER] })}>
        Everything
      </Button>
    </div>
    <div class="divide-y">
      {#each STATUS_ORDER as status, i (i)}
        <label class="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            class="accent-primary h-5 w-5"
            checked={currentPrefs.statuses.includes(status)}
            onchange={(e) => toggleStatus(status, e.currentTarget.checked)}
          />
          <span class="flex-1">{statusLabel(status)}</span>
          <span class="text-muted-foreground text-sm">{counts[status]}</span>
        </label>
      {/each}
    </div>
    <ResponsiveModal.Footer>
      <Button class="w-full" onclick={() => (sheet = null)}>Show {view.rows.length}</Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<ResponsiveModal.Root bind:open={() => sheet === 'sort', (open) => !open && (sheet = null)}>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-w-sm"
  >
    <ResponsiveModal.Header>
      <ResponsiveModal.Title>Sort by</ResponsiveModal.Title>
    </ResponsiveModal.Header>
    <div class="divide-y">
      {#each Object.entries(SORT_LABELS) as [sort, { label, hint }] (sort)}
        <label class="flex min-h-14 items-center gap-3">
          <input
            type="radio"
            name="sync-sort"
            class="accent-primary h-5 w-5"
            checked={currentPrefs.sort === sort}
            onchange={() => updatePrefs({ sort: sort as SyncSort })}
          />
          <span class="flex flex-col">
            <span>{label}</span>
            <span class="text-muted-foreground text-xs">{hint}</span>
          </span>
        </label>
      {/each}
    </div>
    <label class="flex min-h-12 items-center gap-3">
      <input
        type="checkbox"
        class="accent-primary h-5 w-5"
        checked={currentPrefs.reversed}
        onchange={(e) => updatePrefs({ reversed: e.currentTarget.checked })}
      />
      Reversed
    </label>
    <ResponsiveModal.Footer>
      <Button class="w-full" onclick={() => (sheet = null)}>Close</Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<ResponsiveModal.Root bind:open={() => !!openRow, (open) => !open && (openRow = null)}>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-w-sm"
  >
    {#if openRow}
      {@const row = openRow}
      <ResponsiveModal.Header>
        <ResponsiveModal.Title class="break-words">{row.name}</ResponsiveModal.Title>
        <ResponsiveModal.Description>
          <span class="rounded-full px-2 py-0.5 text-xs {STATUS_CLASSES[row.status]}">
            {statusLabel(row.status)}
          </span>
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>

      {#if row.status === 'sameName'}
        <p class="text-muted-foreground text-sm">
          Both devices hold an item with this name, and they have never synced. Pick which to keep,
          or keep both.
        </p>
      {:else if row.status === 'changedOnBoth'}
        <p class="text-muted-foreground text-sm">
          Edited on this device and on the remote device since they last synced. Pick which version
          to keep.
        </p>
      {/if}

      <dl class="divide-y text-sm">
        <div class="flex min-h-10 items-center justify-between gap-3">
          <dt class="text-muted-foreground">Changed on this device</dt>
          <dd>{formatChanged(row.local?.updatedAt)}</dd>
        </div>
        <div class="flex min-h-10 items-center justify-between gap-3">
          <dt class="text-muted-foreground">Changed on remote device</dt>
          <dd>{formatChanged(row.remote?.updatedAt)}</dd>
        </div>
        <div class="flex min-h-10 items-center justify-between gap-3">
          <dt class="text-muted-foreground">Last synced</dt>
          <dd>{row.lastSyncedAt ? formatAgo(row.lastSyncedAt) : 'Never'}</dd>
        </div>
      </dl>

      <div class="flex flex-col gap-2">
        {#if row.action === 'resolve' || row.action === 'choose'}
          <Button variant="outline" class="h-auto flex-col py-2" onclick={() => send(row)}>
            Keep this device's version
            <span class="text-xs font-normal opacity-80">Send it; replaces the remote version</span>
          </Button>
          <Button variant="outline" class="h-auto flex-col py-2" onclick={() => get(row)}>
            Keep the remote device's version
            <span class="text-xs font-normal opacity-80">Get it; replaces this device's</span>
          </Button>
          <Button variant="outline" class="h-auto flex-col py-2" onclick={() => keepBoth(row)}>
            Keep both
            <span class="text-xs font-normal break-words whitespace-normal opacity-80">
              Get it as a separate copy
            </span>
          </Button>
        {:else}
          {#if row.action === 'send'}
            <Button onclick={() => send(row)}>Send</Button>
          {:else if row.action === 'get'}
            <Button onclick={() => get(row)}>Get</Button>
          {/if}
          {#if row.local && row.remote}
            {#if row.action !== 'get'}
              <Button variant="outline" onclick={() => get(row)}>Get anyway</Button>
            {/if}
            {#if row.action !== 'send'}
              <Button variant="outline" onclick={() => send(row)}>Send anyway</Button>
            {/if}
          {/if}
        {/if}
        <Button variant="ghost" onclick={() => (openRow = null)}>Cancel</Button>
      </div>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<ResponsiveModal.Root bind:open={() => !!packConfirm, (open) => !open && (packConfirm = null)}>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-4 pb-4 sm:max-w-sm"
  >
    {#if packConfirm}
      {@const confirm = packConfirm}
      <ResponsiveModal.Header>
        <ResponsiveModal.Title>Replace this pack?</ResponsiveModal.Title>
        <ResponsiveModal.Description>
          {confirm.stories}
          {confirm.stories === 1 ? 'story uses' : 'stories use'} "{confirm.row.name}" on this device
          and will narrate through the incoming version.
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>
      <ResponsiveModal.Footer>
        <div class="flex w-full justify-end gap-2">
          <Button variant="outline" onclick={() => (packConfirm = null)}>Cancel</Button>
          <Button onclick={() => get(confirm.row)}>Replace</Button>
        </div>
      </ResponsiveModal.Footer>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
