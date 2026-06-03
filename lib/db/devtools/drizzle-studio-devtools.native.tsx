import { useDrizzleStudio } from 'expo-drizzle-studio-plugin'

import { expoDb } from '../runtime/client.native'

// The plugin needs the raw expo-sqlite handle (not the drizzle instance) and
// compiles to a no-op in production via NODE_ENV, so no __DEV__ gate is needed.
export function DrizzleStudioDevTools() {
  useDrizzleStudio(expoDb)
  return null
}
