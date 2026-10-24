import { vi } from 'vitest'

import type { Logger } from '../core/logger'

// Not makeLogger: the real one drops everything while the diagnostics gate is off, its unit-test default.
export const spyLogger = () =>
  ({
    error: vi.fn<Logger['error']>(),
    warn: vi.fn<Logger['warn']>(),
    debug: vi.fn<Logger['debug']>(),
  }) satisfies Logger
