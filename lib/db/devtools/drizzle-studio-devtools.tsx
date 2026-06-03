// Web/Electron has no expo-sqlite handle (queries cross the IPC proxy) and the
// plugin doesn't support web. Browse the desktop DB with drizzle-kit studio
// against the on-disk file instead — see drizzle.studio.config.ts.
export function DrizzleStudioDevTools() {
  return null
}
