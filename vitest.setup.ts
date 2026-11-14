// Import the concrete module, not the `@/lib/actions` barrel: the barrel
// re-exports turns/pipeline.ts, which statically imports `@/lib/ai`, and
// loading that here — before each test file's own vi.mock() hoists — caches
// the real, unmocked modules and silently defeats those mocks.
import { deltaActionPort } from '@/lib/actions/delta/action-port'
import { registerAllDomains } from '@/lib/actions/delta/registrations'
import { configureDeltaActionPort } from '@/lib/pipeline/runtime/action-port'

// Node and jsdom lack this global; a no-op also keeps tests from building the encoder unasked.
globalThis.requestIdleCallback ??= () => 0

registerAllDomains()
configureDeltaActionPort(deltaActionPort())
