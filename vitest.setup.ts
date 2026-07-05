// Import the concrete module, not the `@/lib/actions` barrel: the barrel
// re-exports turns/pipeline.ts, which statically imports `@/lib/ai`, and
// loading that here — before each test file's own vi.mock() hoists — caches
// the real, unmocked modules and silently defeats those mocks.
// eslint-disable-next-line boundaries/dependencies -- test setup, not shipped code
import { registerAllDomains } from '@/lib/actions/delta/registrations'

registerAllDomains()
