// Append-only: each domain slice adds ONE import + one call here. Reverse-replay
// (incl. boot recovery) resolves descriptors by target_table, so every delta-logged
// table must be registered before any reverse-replay runs.
import { registerChapters } from '../chapters/register'
import { registerEntities } from '../entities/register'
import { registerBranchEraFlips } from '../era-flips/register'
import { registerHappeningAwareness } from '../happenings/register-awareness'
import { registerHappenings } from '../happenings/register-happenings'
import { registerHappeningInvolvements } from '../happenings/register-involvements'
import { registerLore } from '../lore/register'
import { registerCharacterRelationships } from '../relationships/register'
import { registerStoryEntries } from '../story-entries/register'
import { registerThreads } from '../threads/register'

let done = false // Resets per test file under Vitest default isolation; isolate:false would leak this across files and break registration.
export function registerAllDomains(): void {
  if (done) return
  registerStoryEntries()
  registerEntities()
  registerLore()
  registerThreads()
  registerHappenings()
  registerHappeningInvolvements()
  registerHappeningAwareness()
  registerCharacterRelationships()
  registerChapters()
  registerBranchEraFlips()
  // <domain slices append their register*() call here>
  done = true
}
