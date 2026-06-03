// Electron main applies migrations synchronously at its own startup, before the
// renderer can issue any query RPC — so on web/desktop migration is already done.
export function useDbMigrations(): { success: boolean; error?: Error } {
  return { success: true }
}
