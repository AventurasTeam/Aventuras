import { MAX_SLOT, slotPorts } from './slot'

const HOST_ENTRY = /<string name="debug_http_host">([^<]*)<\/string>/

/**
 * React Native's dev-settings prefs (`<appId>_preferences.xml`) with `debug_http_host` set, keeping
 * every other entry. The debug build reads it for the bundler address; without it a stock emulator
 * asks the host's :8081 through 10.0.2.2, which `adb reverse` never sees.
 */
export function withDebugHttpHost(xml: string | undefined, host: string): string {
  const entry = `<string name="debug_http_host">${host}</string>`
  if (xml && HOST_ENTRY.test(xml)) return xml.replace(HOST_ENTRY, entry)
  if (xml?.includes('<map>')) return xml.replace('<map>', `<map>\n    ${entry}`)
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    ${entry}\n</map>\n`
}

export function debugHttpHost(xml: string | undefined): string | undefined {
  return xml?.match(HOST_ENTRY)?.[1]
}

/** The prefs without `debug_http_host`, so the app goes back to its default bundler address. */
export function withoutDebugHttpHost(xml: string): string {
  return xml.replace(new RegExp(`\\n?[ \\t]*${HOST_ENTRY.source}`), '')
}

/** The worker slot an address points at, if it is one `withDebugHttpHost` was given for a slot. */
export function workerSlotOf(host: string | undefined): number | undefined {
  for (let slot = 1; slot <= MAX_SLOT; slot++) {
    if (host === `localhost:${slotPorts(slot).metro}`) return slot
  }
  return undefined
}
