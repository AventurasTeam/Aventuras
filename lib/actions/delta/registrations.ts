// Append-only: each domain slice adds ONE import + one call here. Reverse-replay
// (incl. boot recovery) resolves descriptors by target_table, so every delta-logged
// table must be registered before any reverse-replay runs.
import { registerEntities } from '../entities/register'
import { registerStoryEntries } from '../story-entries/register'

let done = false // Resets per test file under Vitest default isolation; isolate:false would leak this across files and break registration.
export function registerAllDomains(): void {
  if (done) return
  registerStoryEntries()
  registerEntities()
  // <domain slices append their register*() call here>
  done = true
}
