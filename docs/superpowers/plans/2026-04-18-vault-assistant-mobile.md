# Vault Assistant Mobile & Narrow-Width Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `InteractiveVaultAssistant` component mobile feature parity with desktop (via a tabbed layout) and make it stretch edge-to-edge on Fold-inner-class screens and narrow desktop windows.

**Architecture:** Introduce a 1024px `isCompact` breakpoint used only by this component. At that width and below, render a full-screen overlay (not a drawer) with a Chat / Entity tab bar that surfaces all the auto-open behaviors desktop users already get — without hijacking the chat stream. Above 1024px, keep the two-panel desktop layout but let both panels shrink gracefully via flex minimums so the editor doesn't get cramped on narrow desktops.

**Tech Stack:** Svelte 5 (`$state`, `$derived`, `$effect`), Tailwind, `vaul-svelte` (drawer primitive, left in place for other call-sites), `bits-ui` (Dialog primitive).

**Spec:** `docs/superpowers/specs/2026-04-18-vault-assistant-mobile-design.md`

---

## File Structure

**New:**
- `src/lib/hooks/is-compact.svelte.ts` — `createIsCompact()` hook mirroring `createIsMobile` at a 1024px breakpoint.

**Modified:**
- `src/lib/components/vault/InteractiveVaultAssistant.svelte` — all UI changes happen here. No store, service, or shared-primitive changes.

The plan splits the component changes into small, independently-committable tasks. Between tasks the app stays functional; the compact layout may look rougher than final until Task 4 lands.

## Verification conventions

- After every code change, run `npm run check` (svelte-check / TypeScript) and `npm run lint` (eslint). Both must pass before committing.
- Manual smoke test happens in Task 10 only. Between tasks, type-check + lint are the gates.
- Commit messages follow existing repo convention (imperative mood, lowercase type prefix).

---

## Task 1: Create the `createIsCompact` hook

**Files:**
- Create: `src/lib/hooks/is-compact.svelte.ts`

- [ ] **Step 1: Create the hook file**

File path: `src/lib/hooks/is-compact.svelte.ts`

```ts
import { onMount } from 'svelte'

/**
 * Layout breakpoint hook for components that need a tighter "compact" threshold
 * than the 768px `createIsMobile` gives. Fires true below 1024px (Tailwind lg).
 */
export function createIsCompact() {
  let isCompact = $state(false)

  onMount(() => {
    const mql = window.matchMedia('(max-width: 1023px)')

    const onChange = () => {
      isCompact = mql.matches
    }

    mql.addEventListener('change', onChange)
    isCompact = mql.matches

    return () => mql.removeEventListener('change', onChange)
  })

  return {
    get current() {
      return isCompact
    },
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: no new errors relating to `is-compact.svelte.ts`.

- [ ] **Step 3: Verify it lints**

Run: `npm run lint`
Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hooks/is-compact.svelte.ts
git commit -m "feat: add createIsCompact hook at 1024px breakpoint"
```

---

## Task 2: Swap `isMobile` → `isCompact` for layout decisions

**Goal:** Widen the existing "mobile" layout path from 768px to 1024px without behavior guards changing yet. This is a mechanical rename touching only layout sites. The onMount / tool_end / show_entity guards stay as `!isMobile.current` until Task 5.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Import the new hook alongside the existing one**

Replace the import on line 54:

```ts
import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
```

with:

```ts
import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
import { createIsCompact } from '$lib/hooks/is-compact.svelte'
```

- [ ] **Step 2: Instantiate `isCompact` next to `isMobile`**

Replace the block at lines 64–65:

```ts
  // Mobile detection
  const isMobile = createIsMobile()
```

with:

```ts
  // Mobile detection (touch/native-device flavour + 768px breakpoint — kept for non-layout guards)
  const isMobile = createIsMobile()
  // Layout breakpoint: below 1024px we use the compact (tabs, full-screen) layout
  const isCompact = createIsCompact()
```

- [ ] **Step 3: Replace layout-related `isMobile.current` usages with `isCompact.current`**

These are the ONLY layout sites to change in this task. Guards in auto-open handlers stay on `isMobile` for now.

Line 549 — modal container width:

```svelte
vaultEditor.editorOpen && !isMobile.current ? 'max-w-[90vw]' : 'max-w-2xl',
```

→

```svelte
vaultEditor.editorOpen && !isCompact.current ? 'max-w-[90vw]' : 'max-w-2xl',
```

Line 598 — desktop edit panel render:

```svelte
{#if vaultEditor.editorOpen && vaultEditor.activeChange && !isMobile.current}
```

→

```svelte
{#if vaultEditor.editorOpen && vaultEditor.activeChange && !isCompact.current}
```

Line 616 — chat panel sizing class expression:

```svelte
<div
  class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isMobile.current
    ? 'w-full max-w-2xl shrink-0'
    : 'mx-auto w-full max-w-2xl'}"
>
```

→

```svelte
<div
  class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isCompact.current
    ? 'w-full max-w-2xl shrink-0'
    : 'mx-auto w-full max-w-2xl'}"
>
```

Line 1093 — mobile Sheet guard:

```svelte
{#if isMobile.current && vaultEditor.activeChange}
```

→

```svelte
{#if isCompact.current && vaultEditor.activeChange}
```

Leave lines 145, 389, 396, and 421 alone (they stay on `!isMobile.current` for this task).

- [ ] **Step 4: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "refactor: use isCompact for vault assistant layout decisions"
```

---

## Task 3: Replace compact shell with full-screen Dialog

**Goal:** On compact widths, render a full-viewport `Dialog` instead of the `ResponsiveModal` drawer. Eliminates the `max-w-2xl` clip on Fold-inner screens and the `h-[90vh]`/`max-h-[85vh]` height conflict. Wide path untouched.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Add a shell wrapper around the existing content**

Find the current top-level render (starts at line 545):

```svelte
<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content
    class={cn(
      'flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0',
      vaultEditor.editorOpen && !isCompact.current ? 'max-w-[90vw]' : 'max-w-2xl',
    )}
  >
    <div class="flex flex-col overflow-hidden" style="height: 100%">
```

Replace with:

```svelte
{#if isCompact.current}
  <Dialog.Root open={true} onOpenChange={(open) => !open && onClose()}>
    <Dialog.Content
      class="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-none p-0"
    >
      <Dialog.Title class="sr-only">Vault Assistant</Dialog.Title>
      <div class="flex flex-col overflow-hidden" style="height: 100%">
{:else}
  <ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
    <ResponsiveModal.Content
      class={cn(
        'flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0',
        vaultEditor.editorOpen ? 'max-w-[90vw]' : 'max-w-2xl',
      )}
    >
      <div class="flex flex-col overflow-hidden" style="height: 100%">
{/if}
```

Notes:
- The `!isCompact.current` check in the `max-w-[90vw]` class is now redundant because we're only inside the ResponsiveModal branch when `!isCompact.current`; I've simplified it to `vaultEditor.editorOpen`.
- `Dialog.Title class="sr-only"` is required by bits-ui's Dialog for accessibility; it hides a title from visual users.

- [ ] **Step 2: Add matching closing tags**

Find the current closing (line 1089–1090):

```svelte
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
```

Replace with:

```svelte
      </div>
  {#if isCompact.current}
    </Dialog.Content>
  </Dialog.Root>
  {:else}
    </ResponsiveModal.Content>
  </ResponsiveModal.Root>
  {/if}
```

Note: Svelte's indentation inside `{#if}` doesn't affect rendering; the intent is that the `</div>` closes the inner flex container and the if/else closes the correct shell.

*Tip:* if the `{#if}` / `{:else}` pair placement is awkward to read, it is acceptable to split into two full copies of the shell (each wrapping `{@render ...}` or the same markup). Either form is fine — pick the one you find clearer. Keep whichever you pick consistent with the opening tag placement from Step 1.

- [ ] **Step 3: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "feat: render vault assistant as full-screen dialog on compact"
```

---

## Task 4: Tab architecture and unified edit panel mounting

**Goal:** Add the Chat/Entity tab bar, move the compact-width edit panel out of the bottom `Sheet.Root` and into the Entity tab body, collapse the two edit-panel refs into one, and add an effect that auto-switches the tab back to Chat when the Entity tab disappears.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Add tab state and the auto-switch-to-chat effect**

After the existing `let viewedEntity = $state<FocusedEntity | null>(null)` line (currently around line 100) add:

```ts
  // Compact-width tab state
  let activeTab = $state<'chat' | 'entity'>('chat')

  // Auto-fall-back to chat tab when the Entity tab loses its content
  // (e.g. user closed the editor, approved/rejected the last pending change,
  // or conversation switched away from an active change).
  $effect(() => {
    const entityTabAvailable =
      vaultEditor.editorOpen && vaultEditor.activeChange !== null
    if (!entityTabAvailable && activeTab === 'entity') {
      activeTab = 'chat'
    }
  })
```

- [ ] **Step 2: Reset tab to chat on new / switched conversation**

In `handleNewConversation` (currently around line 222):

```ts
  async function handleNewConversation() {
    if (!service) return
    // Auto-save current conversation before starting new one
    if (messages.some((m) => !m.isGreeting)) {
      await service.saveConversation(messages, vaultEditor.pendingChanges).catch(() => {})
    }
    service.reset()
    vaultEditor.reset()
    initializeService()
    await loadConversationsList()
  }
```

Insert `activeTab = 'chat'` right after `vaultEditor.reset()`:

```ts
    service.reset()
    vaultEditor.reset()
    activeTab = 'chat'
    initializeService()
    await loadConversationsList()
```

In `handleSwitchConversation` (currently around line 234), similarly add `activeTab = 'chat'` after the existing `vaultEditor.reset()` call:

```ts
    const loaded = await service.loadConversation(id)
    if (loaded) {
      vaultEditor.reset()
      activeTab = 'chat'
```

In `handleDeleteConversation` (around line 272), add the same after the `vaultEditor.reset()`:

```ts
    await database.deleteVaultConversation(id)
    if (service?.getConversationId() === id) {
      service.reset()
      vaultEditor.reset()
      activeTab = 'chat'
      initializeService()
    }
```

- [ ] **Step 3: Collapse `editPanelRef` and `editPanelMobileRef` into a single ref**

Remove the two ref declarations (currently around lines 291–292):

```ts
  let editPanelRef = $state<ReturnType<typeof VaultEntityEditPanel> | null>(null)
  let editPanelMobileRef = $state<ReturnType<typeof VaultEntityEditPanel> | null>(null)
```

Replace with a single ref:

```ts
  let editPanelRef = $state<ReturnType<typeof VaultEntityEditPanel> | null>(null)
```

Update `handleSetPortrait` (currently around line 294) to use the single ref; the tab-switch behavior is added in Task 7, so for this task the body stays minimal:

```ts
  function handleSetPortrait(imageId: string) {
    if (!activeCharacterEntity || !service) return
    const dataUrl = service.generatedImages.get(imageId)
    if (!dataUrl) return
    editPanelRef?.setPortrait(dataUrl)
  }
```

- [ ] **Step 4: Render the tab bar inside the chat-side column**

Find the chat-side column opening (currently around line 614):

```svelte
        <!-- Chat Panel (right, or full-width on mobile) -->
        <div
          class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isCompact.current
            ? 'w-full max-w-2xl shrink-0'
            : 'mx-auto w-full max-w-2xl'}"
        >
          <!-- Conversation selector -->
```

Right before the `<!-- Conversation selector -->` comment, insert the tab bar. But keep the conversation selector and pending-list popovers above the tabs — so actually insert the tab bar BELOW the pending-list popover block (currently around line 813, right after the `{#if pendingOnly.length > 0} ... {/if}` closes):

```svelte
          <!-- Compact-width tab bar: Chat | Entity -->
          {#if isCompact.current && vaultEditor.editorOpen && vaultEditor.activeChange}
            <div
              class="border-surface-700 flex shrink-0 gap-1 border-b px-2 py-1.5"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chat'}
                class={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'chat'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-foreground hover:bg-foreground/5',
                )}
                onclick={() => (activeTab = 'chat')}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'entity'}
                class={cn(
                  'relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'entity'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-foreground hover:bg-foreground/5',
                )}
                onclick={() => (activeTab = 'entity')}
              >
                Entity
                {#if vaultEditor.pendingCount > 0}
                  <span
                    class="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-300"
                  >
                    {vaultEditor.pendingCount}
                  </span>
                {/if}
              </button>
            </div>
          {/if}
```

- [ ] **Step 5: Gate the messages/input body on active tab + render Entity tab body**

The chat content (currently lines 815–1085 — messages container + error + input) needs to be wrapped so it only renders when the Chat tab is active on compact (or always on wide).

Wrap the existing content with a conditional. Find the start of the messages div (around line 816):

```svelte
          <!-- Messages -->
          <div class="flex-1 space-y-3 overflow-y-auto px-4 py-3" bind:this={messagesContainer}>
```

Immediately before this comment, open a new conditional wrapper:

```svelte
          {#if !isCompact.current || activeTab === 'chat'}
          <!-- Messages -->
          <div class="flex-1 space-y-3 overflow-y-auto px-4 py-3" bind:this={messagesContainer}>
```

Then find the input-area closing (around line 1085–1086):

```svelte
            <div class="text-surface-500 mt-1.5 hidden text-center text-[10px] md:block">
              {isTouchDevice()
                ? 'Shift+Enter to send, Enter for new line'
                : 'Enter to send, Shift+Enter for new line'}
            </div>
          </div>
        </div>
```

Close the wrapper right after the input area's outer `</div>` (the one that closes the input-area padding container, NOT the chat-side column div). Add an `{:else}` branch for the Entity tab body:

```svelte
            <div class="text-surface-500 mt-1.5 hidden text-center text-[10px] md:block">
              {isTouchDevice()
                ? 'Shift+Enter to send, Enter for new line'
                : 'Enter to send, Shift+Enter for new line'}
            </div>
          </div>
          {:else}
            <!-- Entity tab body (compact width only; wide width shows the left panel instead) -->
            {#if vaultEditor.activeChange}
              <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <VaultEntityEditPanel
                  bind:this={editPanelRef}
                  change={vaultEditor.activeChange}
                  onApprove={(specificChange) =>
                    handleApprove(specificChange ?? vaultEditor.activeChange!)}
                  onReject={(change) => handleReject(change)}
                  onClose={() => vaultEditor.closeEditor()}
                />
              </div>
            {/if}
          {/if}
        </div>
```

- [ ] **Step 6: Remove the standalone `Sheet.Root` compact edit panel**

Find the block starting around line 1092:

```svelte
<!-- Mobile entity editor — bottom sheet -->
{#if isCompact.current && vaultEditor.activeChange}
  <Sheet.Root
    open={vaultEditor.editorOpen}
    onOpenChange={(open) => {
      if (!open) vaultEditor.closeEditor()
    }}
  >
    <Sheet.Content side="bottom" class="flex h-[85dvh] flex-col p-0">
      {#if vaultEditor.activeChange}
        <VaultEntityEditPanel
          bind:this={editPanelMobileRef}
          change={vaultEditor.activeChange}
          onApprove={(specificChange) => handleApprove(specificChange ?? vaultEditor.activeChange!)}
          onReject={(change) => handleReject(change)}
          onClose={() => vaultEditor.closeEditor()}
        />
      {/if}
    </Sheet.Content>
  </Sheet.Root>
{/if}
```

Delete the entire block (including the surrounding comment).

- [ ] **Step 7: Remove the now-unused `Sheet` import**

Find the imports block (lines 47):

```ts
  import * as Sheet from '$lib/components/ui/sheet'
```

Delete this line.

- [ ] **Step 8: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors. If lint complains about `editPanelMobileRef` being unused, double-check that Step 3 replaced both the declaration and all `editPanelMobileRef` usages.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "feat: tab-based compact layout for vault assistant"
```

---

## Task 5: Remove `!isMobile.current` auto-open guards

**Goal:** Now that compact has a place to show the entity panel (Entity tab), the guards that skipped auto-opening on mobile can go. State updates run on every width; the tab system handles whether they're visually surfaced.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Remove the onMount focused-entity guard**

Find the block at lines 145–169:

```ts
    // Auto-open focused entity if provided
    if (focusedEntity && !isMobile.current) {
      let entityData: any = null
      if (focusedEntity.entityType === 'character') {
        entityData = characterVault.getById(focusedEntity.entityId)
      } else if (focusedEntity.entityType === 'lorebook') {
        entityData = lorebookVault.getById(focusedEntity.entityId)
      } else if (focusedEntity.entityType === 'scenario') {
        entityData = scenarioVault.getById(focusedEntity.entityId)
      }

      if (entityData) {
        // Construct a dummy change to satisfy the viewer store requirement
        const dummyChange = {
          id: `view-${focusedEntity.entityId}`,
          toolCallId: 'init',
          entityType: focusedEntity.entityType,
          action: 'update',
          status: 'pending',
          entityId: focusedEntity.entityId,
          data: JSON.parse(JSON.stringify(entityData)),
        } as unknown as VaultPendingChange

        vaultEditor.openViewer(dummyChange, focusedEntity.entityId, focusedEntity.entityType)
      }
    }
```

Replace `focusedEntity && !isMobile.current` with just `focusedEntity`:

```ts
    // Auto-open focused entity if provided
    if (focusedEntity) {
```

(Leave the rest of the block unchanged.)

- [ ] **Step 2: Remove the tool_end auto-created-lorebook guard**

Find the block at lines 384–399 (inside the `tool_end` case):

```ts
              // Auto-approve lorebook creation (it's a prerequisite step)
              if (incoming.entityType === 'lorebook' && incoming.action === 'create' && service) {
                vaultEditor.addPendingChange(incoming)
                await handleApprove(incoming)
                // Open the newly created lorebook in the editor
                if (!isMobile.current) {
                  await tick()
                  vaultEditor.openEditor(incoming)
                }
              } else {
                vaultEditor.addPendingChange(incoming)
                // Auto-open entity editor on desktop (store handles same-lorebook skip)
                if (!isMobile.current) {
                  vaultEditor.openEditorSmart(incoming)
                }
              }
```

Replace with (guards removed):

```ts
              // Auto-approve lorebook creation (it's a prerequisite step)
              if (incoming.entityType === 'lorebook' && incoming.action === 'create' && service) {
                vaultEditor.addPendingChange(incoming)
                await handleApprove(incoming)
                // Open the newly created lorebook in the editor
                await tick()
                vaultEditor.openEditor(incoming)
              } else {
                vaultEditor.addPendingChange(incoming)
                // Auto-open entity editor (store handles same-lorebook skip).
                // On compact, the Entity tab becomes available — user still has to tap to switch.
                vaultEditor.openEditorSmart(incoming)
              }
```

- [ ] **Step 3: Remove the show_entity viewer guard**

Find the block at lines 419–434 (inside the `show_entity` case):

```ts
          case 'show_entity':
            // Open entity in view mode (no approval workflow)
            if (!isMobile.current) {
              vaultEditor.openViewer(event.change, event.entityId, event.entityType)
            }
            // Track which character is currently being viewed so the Set Portrait button appears
            if (event.entityType === 'character') {
```

Replace with:

```ts
          case 'show_entity':
            // Open entity in view mode (no approval workflow)
            vaultEditor.openViewer(event.change, event.entityId, event.entityType)
            // Track which character is currently being viewed so the Set Portrait button appears
            if (event.entityType === 'character') {
```

- [ ] **Step 4: Remove the now-unused `isMobile` hook**

Confirm no remaining `isMobile.current` references exist:

Run (via Grep tool, not shell): search pattern `isMobile\.current` in `src/lib/components/vault/InteractiveVaultAssistant.svelte`.
Expected: zero matches.

If zero matches, remove the instantiation (currently around line 64):

```ts
  // Mobile detection (touch/native-device flavour + 768px breakpoint — kept for non-layout guards)
  const isMobile = createIsMobile()
```

Delete these two lines.

Also remove the import (around line 54):

```ts
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
```

Delete it.

Update the comment on the remaining `isCompact` block so the context is still clear:

```ts
  // Layout breakpoint: below 1024px we use the compact (tabs, full-screen) layout
  const isCompact = createIsCompact()
```

- [ ] **Step 5: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors. If the lint catches an unused import that Step 4 missed, delete it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "feat: remove mobile guards so auto-open state runs on all widths"
```

---

## Task 6: Entity tab pulse animation on new pending changes

**Goal:** When a new pending change lands while the user is viewing the Chat tab, the Entity tab pulses once (~800ms) so the user notices without being yanked to a new screen.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Add pulse state and count-tracker effect**

Just below the `activeTab` declaration added in Task 4 Step 1, add:

```ts
  // Pulse the Entity tab when a new pending change arrives while user is on Chat
  let entityTabPulsing = $state(false)
  let prevPendingCount = vaultEditor.pendingCount
  $effect(() => {
    const current = vaultEditor.pendingCount
    if (current > prevPendingCount && activeTab === 'chat') {
      entityTabPulsing = true
      const timer = setTimeout(() => {
        entityTabPulsing = false
      }, 800)
      prevPendingCount = current
      return () => clearTimeout(timer)
    }
    prevPendingCount = current
  })
```

- [ ] **Step 2: Apply the pulse class to the Entity tab button**

Find the Entity tab button added in Task 4 Step 4. Update its `class={cn(...)}` expression to include a `vault-tab-pulse` class when `entityTabPulsing` is true:

```svelte
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'entity'}
                class={cn(
                  'relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'entity'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-foreground hover:bg-foreground/5',
                  entityTabPulsing && 'vault-tab-pulse',
                )}
                onclick={() => (activeTab = 'entity')}
              >
```

- [ ] **Step 3: Add the keyframe definition to the component's `<style>` block**

The component currently has no `<style>` block. Add one at the very bottom of the file (after the closing `</Dialog.Root>` of the image-enlargement dialog, so it's the final top-level element):

```svelte
<style>
  :global(.vault-tab-pulse) {
    animation: vault-tab-pulse 800ms ease-out 1;
  }

  @keyframes vault-tab-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45);
    }
    60% {
      box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    }
  }
</style>
```

Note: `:global(...)` ensures the class survives Svelte's scoped-style hashing when applied via `cn()`. If you prefer to scope it, apply the class directly on the element (not via `cn`) and drop the `:global`.

- [ ] **Step 4: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "feat: pulse entity tab when a pending change arrives off-tab"
```

---

## Task 7: "Set Portrait" auto-switches to Entity tab on compact

**Goal:** The "Set Portrait" button on a generated image is a direct user action that only makes sense inside the edit panel. On compact, tapping it should switch to the Entity tab so the result is visible — this is not the same class of action as the ambient auto-opens from Task 5, so an explicit tab switch is appropriate.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Update `handleSetPortrait`**

Find the current handler (updated in Task 4 Step 3):

```ts
  function handleSetPortrait(imageId: string) {
    if (!activeCharacterEntity || !service) return
    const dataUrl = service.generatedImages.get(imageId)
    if (!dataUrl) return
    editPanelRef?.setPortrait(dataUrl)
  }
```

Replace with:

```ts
  async function handleSetPortrait(imageId: string) {
    if (!activeCharacterEntity || !service) return
    const dataUrl = service.generatedImages.get(imageId)
    if (!dataUrl) return
    // On compact, the panel only mounts inside the Entity tab — switch first so the ref exists.
    if (isCompact.current && activeTab !== 'entity') {
      activeTab = 'entity'
      await tick()
    }
    editPanelRef?.setPortrait(dataUrl)
  }
```

No caller changes needed — the button's onclick already awaits because it was already wrapped in an arrow function; `await` in a non-async onclick is fine because we don't need the caller to wait for completion.

- [ ] **Step 2: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "feat: set portrait switches to entity tab on compact"
```

---

## Task 8: Narrow-desktop flex sizing

**Goal:** At widths ≥1024px, the two-panel layout can't leave the editor panel starved. Set minimums on both panels so they shrink together, and remove the `shrink-0` on chat so it can give up space.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Set minimum width on the desktop edit panel**

Find the desktop edit panel wrapper (updated in Task 2 Step 3, currently around line 598):

```svelte
{#if vaultEditor.editorOpen && vaultEditor.activeChange && !isCompact.current}
  <div
    class="border-surface-700 flex flex-1 flex-col overflow-hidden border-r"
    transition:fade={{ duration: 100 }}
  >
```

Change the classes:

```svelte
{#if vaultEditor.editorOpen && vaultEditor.activeChange && !isCompact.current}
  <div
    class="border-surface-700 flex min-w-[28rem] flex-1 flex-col overflow-hidden border-r"
    transition:fade={{ duration: 100 }}
  >
```

- [ ] **Step 2: Update the chat-side column sizing when editor is open**

Find the chat-side column (updated in Task 2 Step 3, currently around line 616):

```svelte
<div
  class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isCompact.current
    ? 'w-full max-w-2xl shrink-0'
    : 'mx-auto w-full max-w-2xl'}"
>
```

Change the editor-open class set so chat can shrink and has a minimum:

```svelte
<div
  class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isCompact.current
    ? 'w-full min-w-[22rem] max-w-2xl flex-1'
    : 'mx-auto w-full max-w-2xl'}"
>
```

Key differences:
- `shrink-0` removed → chat is allowed to shrink below its `max-w-2xl` (672px).
- `min-w-[22rem]` (352px) → chat won't collapse below readable width.
- `flex-1` → chat grows to take available space up to its `max-w-2xl`.

At 1024px viewport: container is 90vw = 921px. Edit panel reserves min 448px, chat takes the remaining 473px. Both usable. Above ~1344px: chat saturates at 672px, edit panel takes the rest. Below 1024px: we're in compact mode, this branch doesn't apply.

- [ ] **Step 3: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "fix: allow chat panel to shrink on narrow desktop widths"
```

---

## Task 9: Safe-area polish and final housekeeping

**Goal:** Ensure bottom-anchored UI clears iOS home indicator / Android navigation bars on compact, and sweep for leftover unused code.

**Files:**
- Modify: `src/lib/components/vault/InteractiveVaultAssistant.svelte`

- [ ] **Step 1: Apply safe-area inset to the input container on compact**

Find the input-area container (currently around line 1053):

```svelte
<!-- Input area -->
<div class="border-surface-700 bg-surface-900 border-t p-3">
```

Replace with:

```svelte
<!-- Input area -->
<div
  class="border-surface-700 bg-surface-900 border-t p-3"
  style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
>
```

This keeps the 12px (`p-3`) padding on desktop and bumps it up to the safe-area inset on iOS devices where that's larger.

- [ ] **Step 2: Sweep for unused imports and dead identifiers**

Run (via Grep tool):
- pattern `editPanelMobileRef` in the file — expected 0 matches.
- pattern `isMobile\.` in the file — expected 0 matches.
- pattern `Sheet\.` in the file — expected 0 matches (no usage after Task 4 Step 6).
- pattern `from '\$lib/components/ui/sheet'` in the file — expected 0 matches.

If any non-zero matches remain, clean them up.

- [ ] **Step 3: Type-check and lint**

Run:

```bash
npm run check
npm run lint
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/vault/InteractiveVaultAssistant.svelte
git commit -m "chore: apply safe-area inset and sweep leftover refs"
```

---

## Task 10: Manual smoke test

**Goal:** Verify behavior end-to-end at several widths and flows, with the app actually running. This is the gate for considering the feature done.

**Files:** none (verification only).

- [ ] **Step 1: Start dev server**

Run:

```bash
npm run dev
```

Open the browser to the printed URL.

- [ ] **Step 2: Verify each viewport width**

Using browser DevTools device emulation, check:

- [ ] Phone portrait (~390×844, e.g. iPhone 14): full-screen dialog, no horizontal scroll, tab bar appears when a pending change exists, tap the Entity tab and the panel fills the screen.
- [ ] Galaxy Fold outer (~344×882): same as phone — full-screen, tabs work.
- [ ] Galaxy Fold inner (~700×900): full-screen dialog stretches edge-to-edge (NOT capped at 672px). Tabs usable.
- [ ] Tablet portrait (~768×1024): compact layout (full-screen + tabs).
- [ ] Tablet landscape (~1024×768): two-panel layout kicks in at exactly 1024px. Edit panel is at least 448px wide.
- [ ] Narrow desktop window (~1100×800): two-panel layout; chat shrunk below 672px, edit panel ≥448px, both usable.
- [ ] Wide desktop (~1920×1080): chat saturated at 672px, edit panel takes the remainder.

- [ ] **Step 3: Verify compact flows (on a compact width)**

- [ ] Open the Vault Assistant without a `focusedEntity`. Tab bar is absent, chat fills the viewport.
- [ ] Send a message that should produce a pending character change ("create a new character named Alex"). Pending change arrives → Entity tab appears in the tab bar with a pulse and `1` badge. Tab does NOT auto-switch.
- [ ] Tap Entity tab → edit panel is visible and functional. Scroll through fields, edit one, tap Approve. Change applies; if it was the last pending item, the Entity tab disappears and you fall back to Chat automatically.
- [ ] Generate an image via the assistant. The image card appears in chat. Tap "Set Portrait" → compact switches to the Entity tab and the portrait is set on the character.
- [ ] Open a conversation via History dropdown — if it has no active change, you land on Chat (activeTab reset works).
- [ ] Start a new conversation — landed on Chat, no Entity tab.

- [ ] **Step 4: Verify wide flows**

On a wide viewport (e.g. 1280×800):

- [ ] Without a pending change: single-column chat centered, no tab bar.
- [ ] Ask AI to create a lorebook + entries. The auto-created lorebook opens on the left, then the entries appear with the edit panel still visible. Chat stays on the right at ≤672px. Neither panel below its minimum.
- [ ] At 1024px exactly: two-panel layout renders, both panels legible. At 1023px: flips to tab layout cleanly.

- [ ] **Step 5: Check console and network**

DevTools → Console: no new errors or warnings attributable to this change (some pre-existing warnings may remain; ignore those).

- [ ] **Step 6: If everything passes, mark complete**

No commit for this step — it's verification. If any check fails, address the root cause and commit a fix; do NOT create follow-up "defer" items inside this plan.

---

## Plan Self-Review Results

**Spec coverage:** every section of the spec maps to a task above.

| Spec section                         | Task(s) |
| ------------------------------------ | ------- |
| Breakpoints / createIsCompact        | 1       |
| Shell branching (compact vs wide)    | 3       |
| Tab architecture + edit panel mount  | 4       |
| Auto-open policy (guard removal)     | 5       |
| Auto-switch-to-chat fallback effect  | 4       |
| Pulse + badge                        | 6       |
| Set Portrait explicit tab switch     | 7       |
| Narrow-desktop flex sizing           | 8       |
| Safe-area inset                      | 9       |
| Remove unused Sheet import/refs      | 4, 9    |
| Manual smoke tests                   | 10      |

**Type consistency:** `editPanelRef` is the sole ref name throughout after Task 4. `activeTab` values are always `'chat' | 'entity'`. `isCompact.current` is the sole layout-breakpoint reference from Task 5 onward.

**No placeholders:** every code step shows the exact code. Every verification step shows exact commands and expected outputs.
