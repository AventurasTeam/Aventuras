<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import Toast from '$lib/components/Toast.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'

  let { children } = $props()

  const BACK_EXIT_WINDOW_MS = 2000

  onMount(() => {
    if (!/Android/i.test(navigator.userAgent)) return

    let lastBackAttemptAt = 0

    ;(window as any).__aventuraBackHandler = () => {
      // Close open dialog/drawer via Escape key so vaul-svelte/bits-ui
      // run their proper close sequence (animations, body style cleanup)
      const openDialog = document.querySelector('[data-state="open"][role="dialog"]')
      if (openDialog) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }

      if (ui.sidebarOpen && window.innerWidth < 640) {
        ui.toggleSidebar()
        return
      }

      // Navigate back: sub-panels → story, story/vault → library
      if (ui.activePanel !== 'library') {
        if (
          ui.activePanel === 'lorebook' ||
          ui.activePanel === 'memory' ||
          ui.activePanel === 'gallery'
        ) {
          ui.setActivePanel('story')
        } else {
          if (story.currentStory) story.closeStory()
          ui.setActivePanel('library')
        }
        return
      }

      const now = Date.now()
      const pressedBackAgain = now - lastBackAttemptAt <= BACK_EXIT_WINDOW_MS

      if (pressedBackAgain) {
        lastBackAttemptAt = 0
        import('@tauri-apps/plugin-process').then(({ exit }) => exit(0))
        return
      }

      lastBackAttemptAt = now
      ui.showToast('Press back again to exit', 'info', BACK_EXIT_WINDOW_MS)
    }

    return () => {
      delete (window as any).__aventuraBackHandler
    }
  })
</script>

<div class="h-screen w-screen overflow-hidden">
  {@render children()}
</div>

<Toast />
