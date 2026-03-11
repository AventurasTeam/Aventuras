/**
 * Debug configuration.
 * Controls logging behavior across all AI services.
 */
const DEBUG = {
  /** Master switch for all AI service logging - enabled in dev mode only */
  enabled: import.meta.env.DEV,
} as const

/**
 * Creates a logger function for an AI service.
 * Logs are only output when DEBUG.enabled is true (dev mode).
 *
 * @param serviceName - Name of the service (shown as prefix in logs)
 * @returns A logging function that respects the DEBUG configuration
 *
 * @example
 * const log = createLogger('Classifier');
 * log('Processing entry', { id: entry.id }); // [Classifier] Processing entry { id: ... }
 */
export function createLogger(serviceName: string) {
  const prefix = `[${serviceName}]`
  return (...args: unknown[]) => {
    if (DEBUG.enabled) {
      console.log(prefix, ...args)
    }
  }
}
