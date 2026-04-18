# Vault Assistant — Mobile & Narrow-Width Parity

**Date:** 2026-04-18
**Component:** `src/lib/components/vault/InteractiveVaultAssistant.svelte`
**Branch:** `fix/vault-assistant-mobile`

## Problem

The Interactive Vault Assistant's desktop layout is a two-panel split (entity edit panel on the left, chat on the right) that gives users simultaneous access to an ongoing chat and the entity being created/modified. The mobile experience does not have feature parity:

1. **Auto-open behaviors are gated to desktop.** On mobile, the entity editor never surfaces automatically when the AI proposes a change, when it calls `show_entity`, when it auto-creates a lorebook, or when a `focusedEntity` is passed in on mount. Users must manually tap an inline diff card to reach the editor.
2. **The mobile edit sheet is a second-tier affordance.** `VaultEntityEditPanel` is rendered inside a bottom `Sheet.Root` that's only mounted when `vaultEditor.activeChange` is set. This makes `editPanelMobileRef` unreliable — e.g. the "Set Portrait" action on a generated image silently does nothing if the sheet isn't open.
3. **Width is clipped at ~672px on small-but-not-mobile screens.** The main modal applies `max-w-2xl` even in drawer mode, so on the Galaxy Fold inner screen (~700–800px CSS width) the drawer doesn't stretch edge-to-edge. There's also a conflict between the outer `h-[90vh]` and the drawer's own `max-h-[85vh]`.
4. **Narrow-desktop layout cramps the entity panel.** When the editor is open, the chat uses `max-w-2xl shrink-0` and the edit panel uses `flex-1`, so at viewports between ~770px and ~1280px, the chat hogs 672px and the edit panel collapses to ~100–200px — unusable.

## Goals

- Mobile users get the same set of functional affordances as desktop (entity editor, all auto-open triggers, Set Portrait from chat, etc.).
- Auto-opening must not hijack the chat stream on mobile — badge/pulse discoverability only, no forced tab switches.
- The modal stretches edge-to-edge on Fold-inner-class devices.
- Narrow-desktop viewports (including split-screen browsers) get a working layout at every width.

## Non-goals

- No changes to `VaultEntityEditPanel` internals, `VaultDiffView`, the service layer, or the `vaultEditor` store API.
- No changes to the shared `createIsMobile` hook, `ResponsiveModal` primitive, or `Drawer`/`Sheet` primitives. Other call-sites keep their current breakpoint.
- Desktop ≥1024px two-panel layout keeps its current shape (flex behavior is tweaked, but the user-facing structure is unchanged).

## Design

### Breakpoints

Add a new hook `createIsCompact()` at `src/lib/hooks/is-compact.svelte.ts` with a `1024px` threshold (matches Tailwind `lg`). This hook mirrors `createIsMobile`'s shape but is scoped to this component's layout decisions so bumping the threshold doesn't ripple through `ResponsiveModal`, `TemplateEditor`, or `PromptPackEditor`.

```ts
export function createIsCompact() {
  let isCompact = $state(false)
  onMount(() => {
    const mql = window.matchMedia('(max-width: 1023px)')
    const onChange = () => (isCompact = mql.matches)
    mql.addEventListener('change', onChange)
    isCompact = mql.matches
    return () => mql.removeEventListener('change', onChange)
  })
  return {
    get current() { return isCompact },
  }
}
```

The existing `isMobile` usage in `InteractiveVaultAssistant.svelte` is replaced by `isCompact`. Touch-vs-mouse input behavior (`handleKeyDown`) continues to use `isTouchDevice()` unchanged.

### Shell: compact vs wide

- **Wide (`!isCompact.current`)**: keep the current `ResponsiveModal` path rendering as a `Dialog`. No visual change.
- **Compact (`isCompact.current`)**: bypass `ResponsiveModal` and render a **full-viewport `Dialog`** with `w-screen h-[100dvh] max-w-none max-h-none p-0 rounded-none`. No drawer, no width cap, no height conflict. The full-screen overlay covers the Fold-inner and tablet-width cases cleanly.

Branching happens at the `InteractiveVaultAssistant.svelte` level — it renders either `<ResponsiveModal.Root>` (wide) or `<Dialog.Root>` with full-screen classes (compact). The inner content layout is shared.

### Compact layout: tab architecture

```
┌─ Vault Assistant ─────── [Approve All] [✕] ─┐
│ History ▾                                    │
│ Pending ▾ (if any)                           │
│ ╭─ Chat ─╮ ╭─ Entity (3) ─╮                  │   ← (n) = pending count badge
│ ╰────────╯ ╰──────────────╯                  │      tab pulses when new change arrives
│                                              │      while user is on Chat
│  <active tab body: chat OR entity>           │
│                                              │
│  <input bar, only when active tab === chat>  │
└──────────────────────────────────────────────┘
```

- **Segmented control** directly below the existing dropdowns (history selector and pending-list popover stay where they are).
- **Entity tab visibility:** shown only when `vaultEditor.editorOpen && vaultEditor.activeChange` is truthy. When no active change exists, the tab bar is hidden entirely and the chat fills the viewport as today.
- **Default tab:** `chat`. Resets to `chat` on new conversation and on conversation switch.
- **Badge:** shows `vaultEditor.pendingCount` when >0. `0` → no badge.
- **Pulse:** a one-shot Tailwind keyframe highlight on the Entity tab trigger for ~800ms, fired from an `$effect` watching `vaultEditor.pendingCount`. Only pulses when the increase happened while `activeTab === 'chat'`.
- **Tab content:**
  - *Chat tab body* = messages list (existing block) + streaming progress indicator + error banner + input bar.
  - *Entity tab body* = `VaultEntityEditPanel` for `vaultEditor.activeChange`, filling available height. This replaces the old `Sheet.Root` path entirely; the panel is mounted inside the tab so `editPanelMobileRef` is available whenever the tab has been rendered.
- **Input bar** is only rendered on the chat tab so the virtual keyboard never fights with the entity form. The entity form's own Approve/Reject footer (inside `VaultEntityEditPanel`) is the bottom-anchored UI on that tab.
- **Safe area:** whichever element is at the bottom on a given tab gets `padding-bottom: env(safe-area-inset-bottom)` so content clears the iOS home indicator / Android nav bar.

### Auto-open policy (compact)

The `!isMobile.current` guards in `onMount`, the `tool_end` handler (new-lorebook + `openEditorSmart`), and the `show_entity` handler are **removed**. State updates to `vaultEditor` (opening the viewer, setting `activeChange`, auto-approving lorebooks) now run on all widths, so compact and wide share the same state model.

Navigation is the only thing that differs:

- **Wide:** state updates make the left panel visible immediately (as today).
- **Compact:** state updates cause the Entity tab to appear in the tab bar (if not already present) and, if the change is new, the tab pulses once. **No automatic tab switch** — the user stays on whatever tab they were on.

**Exception — explicit user intent:** "Set Portrait" on a chat image is a direct user action that only makes sense inside the edit panel. When tapped on compact, it switches to the Entity tab *and* applies the portrait. This replaces the current `editPanelRef ?? editPanelMobileRef` fallback and fixes the silent-failure case when neither ref is mounted.

### Wide layout: narrow-desktop flex fix

With editor open on wide layout (≥1024px), the current flex sizing cramps the edit panel between ~1024px and ~1344px. Change the sizing to:

- **Modal container** (editor open): `max-w-[90vw]` — unchanged.
- **Edit panel**: `flex-1 min-w-[28rem]` (adds 448px minimum).
- **Chat panel** (editor open): `flex-1 min-w-[22rem] max-w-2xl` (replaces `w-full max-w-2xl shrink-0`). Chat can shrink below 672px down to 352px, then the edit panel's minimum kicks in.
- **Chat panel** (editor closed): unchanged (`mx-auto w-full max-w-2xl`).

At 1024px viewport: container = 90vw = 921px → chat fills the balance above 448px, edit panel fills ≥448px. Both panels remain legible at the breakpoint boundary. Above ~1344px, chat reaches its 672px max and edit panel takes the remainder, matching current behavior.

### Feature-parity fixes recap

| Item                                      | Current (mobile)           | After                                                              |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Auto-open focused entity on mount         | Skipped                    | Sets viewer state (Entity tab appears, doesn't switch)             |
| Auto-open new lorebook after creation     | Skipped                    | Sets editor state (Entity tab appears, doesn't switch)             |
| `openEditorSmart` on `tool_end`           | Skipped                    | Runs; Entity tab appears with pulse                                |
| `openViewer` on `show_entity`             | Skipped                    | Runs; Entity tab appears with pulse                                |
| Entity edit panel mount                   | Inside bottom `Sheet.Root` | Inside Entity tab body                                             |
| `editPanelMobileRef`                      | Null unless sheet is open  | Mounted whenever Entity tab has rendered                           |
| "Set Portrait" when edit panel not active | Silent no-op               | Switches to Entity tab + applies portrait                          |
| Modal width on Fold inner (~700–800px)    | Capped at 672px            | Full viewport (`w-screen h-[100dvh]`)                              |
| Height conflict (`90vh` vs `85vh`)        | Conflicting                | Single `h-[100dvh]` on compact, original values on wide            |
| Narrow-desktop editor panel (1024–1344px) | ~100–200px wide            | ≥448px via `min-w-[28rem]`; chat shrinks to 352px minimum          |

## Files touched

**New:**
- `src/lib/hooks/is-compact.svelte.ts`

**Modified:**
- `src/lib/components/vault/InteractiveVaultAssistant.svelte`
  - Replace `isMobile` with `isCompact` for all layout decisions.
  - Remove `!isMobile.current` guards on auto-open logic.
  - Add `activeTab` state + tab bar + pulse effect (compact only).
  - Branch shell: `ResponsiveModal` (wide) vs full-screen `Dialog` (compact).
  - Remove the separate bottom `Sheet.Root` for the mobile edit panel.
  - Adjust wide-layout flex sizing (`min-w-[22rem]`, `min-w-[28rem]`, drop `shrink-0`).
  - Update `handleSetPortrait` to switch to the Entity tab when on compact.
  - Replace `editPanelMobileRef` with a single ref used across layouts.

No other files change. No store, service, or shared-primitive changes.

## Testing plan

Manual verification only — there are no existing unit/E2E tests for this component.

**Device widths to check:**
- Phone portrait (~390px) — tabs, full-screen, no drawer artifacts.
- Galaxy Fold outer (~344px) and inner (~700–820px) — both should be full-width, tabs present.
- Tablet portrait (~768px) / tablet landscape (~1024px) — compact layout up to 1024px, two-panel at 1024px exactly and above.
- Narrow desktop window / split-screen (1024–1280px) — two-panel, edit panel ≥448px, chat shrinks.
- Desktop (≥1344px) — two-panel at current proportions, chat ≤672px.

**Flows to verify on compact:**
- Cold start with `focusedEntity` → Entity tab appears pre-populated, stays on Chat tab.
- AI proposes character change → Entity tab pulses, badge shows `1`, tap switches tab, edit panel functional.
- AI calls `show_entity` → same pattern in view mode.
- New lorebook auto-created → Entity tab appears (no pulse for auto-approved items is fine, but current behavior of auto-opening the new lorebook into editor is preserved).
- Generate image → tap "Set Portrait" → switches to Entity tab, portrait applied.
- Approve All from top bar works from either tab.
- Open keyboard on Chat tab → input stays visible, no viewport jump. Switch to Entity tab while keyboard open → keyboard dismisses.

## Risks & mitigations

- **Vaul-svelte drawer removal on compact** — we're not modifying `ResponsiveModal`, just bypassing it for this component on compact. Other call-sites unaffected.
- **Tab pulse feels spammy during streaming** — pulse is gated to "count increased while on chat tab" and runs at most once per change. If multi-change bursts feel noisy, we can throttle in a follow-up.
- **`h-[100dvh]` on older browsers** — `dvh` has solid 2023+ support; Tailwind v3 emits it directly. Acceptable for target audience.
- **Existing `Sheet.Root` import removal** — unused after refactor, will be pruned.
