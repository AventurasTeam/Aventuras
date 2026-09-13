export type BootFailureSinks = {
  showErrorBox: (title: string, content: string) => void
  exit: (code: number) => void
}

// Main has no i18n, so this stays English whatever the app locale.
const TITLE = "Aventuras couldn't start"

/**
 * Says why boot failed, then exits. Left unhandled, the rejection only warns: the windowless
 * process lives on holding the single-instance lock, and every relaunch quits silently.
 */
export function reportBootFailure(error: unknown, sinks: BootFailureSinks): void {
  sinks.showErrorBox(TITLE, error instanceof Error ? (error.stack ?? error.message) : String(error))
  sinks.exit(1)
}
