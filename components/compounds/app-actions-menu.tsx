import { useRouter } from 'expo-router'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenuPure } from '@/components/compounds/app-actions-menu-pure'
import { buildGoToGroup, type InStoryContext } from '@/components/compounds/go-to-group'
import { buildStoryToolsGroup } from '@/components/compounds/story-tools-group'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { appSettingsStore, chapterOverlaysStore } from '@/lib/stores'

type AppActionsMenuProps = {
  contextual?: ActionGroup
  /**
   * Present on in-story surfaces: renders the `GO TO` group for this story and
   * branch, self-omitting `surface`. Off-story screens omit it.
   */
  story?: InStoryContext
  /**
   * `Close chapter…`'s inputs: the route's `useChapterProgress` `canClose`, the branch it was read
   * for, which the entry opens the modal on, and the run gate's reason. With `story`, builds
   * `STORY TOOLS`; omitted, that group is absent.
   */
  closeChapter?: { branchId: string; canClose: boolean; gateReason: string | undefined }
  /**
   * Wraps every route jump this menu owns. A surface with a save session
   * passes its `requestLeave` so the jump routes through the unsaved-changes
   * guard; `save-sessions.md → Navigate-away guard` lists Actions-menu route
   * jumps as a required intercept. Defaults to navigating immediately.
   */
  beforeNavigate?: (proceed: () => void) => void
  /**
   * Wraps story-leaving jumps (the Diagnostics Hub) inside `beforeNavigate`; `GO TO` skips it.
   * In-story surfaces pass `guardLeave`; off-story screens pass null, having no story to leave.
   */
  beforeLeaveStory: ((proceed: () => void) => void) | null
  /**
   * Whether the surface is mid-decision — a confirm the user must answer before
   * navigating away — per [`actions-menu.md`](../../docs/ui/patterns/actions-menu.md).
   * Open sheets gate themselves; only the judgment half is route-supplied, because
   * no signal distinguishes a confirm worth trapping from any other overlay.
   */
  blocked?: boolean
  /** Passed through to `ActionsMenu`: the reader resolves its Undo label as the menu opens. */
  onOpenChange?: (open: boolean) => void
}

// Connected variant of AppActionsMenuPure: reads the diagnostics gate via selector
// (never a snapshot) and owns every route jump this menu triggers.
export function AppActionsMenu({
  contextual,
  story,
  closeChapter,
  beforeNavigate,
  beforeLeaveStory,
  blocked,
  onOpenChange,
}: AppActionsMenuProps) {
  const router = useRouter()
  const surfaceNavigate = useSurfaceNavigate()
  // Derived, not a prop: a route that forgets to gate its shortcut re-opens the
  // background-screen bug silently, and nothing would fail.
  const hotkeyEnabled = useIsRouteFocused()
  const diagnosticsEnabled = appSettingsStore.useAppSettings((s) => s.diagnostics.enabled)
  const jump = (go: () => void) => {
    if (beforeNavigate) beforeNavigate(go)
    else go()
  }
  const leaveStory = (go: () => void) => {
    if (beforeLeaveStory) beforeLeaveStory(go)
    else go()
  }
  const navigateGoTo = (path: string) => jump(() => surfaceNavigate(path))
  // Not through beforeNavigate: openCloseModal runs the surface's registered guard itself (C7).
  const storyTools =
    story != null && closeChapter != null
      ? buildStoryToolsGroup({
          ...closeChapter,
          openCloseModal: chapterOverlaysStore.openCloseModal,
        })
      : undefined
  return (
    <AppActionsMenuPure
      diagnosticsEnabled={diagnosticsEnabled}
      onOpenDiagnosticsHub={() => jump(() => leaveStory(() => router.push('/diagnostics')))}
      contextual={contextual}
      goTo={story != null ? buildGoToGroup(story, navigateGoTo) : undefined}
      storyTools={storyTools}
      hotkeyEnabled={hotkeyEnabled}
      blocked={blocked}
      onOpenChange={onOpenChange}
    />
  )
}
