/**
 * React Native's dev-settings prefs (`<appId>_preferences.xml`) with `debug_http_host` set, keeping
 * every other entry. The debug build reads it for the bundler address; without it a stock emulator
 * asks the host's :8081 through 10.0.2.2, which `adb reverse` never sees.
 */
export function withDebugHttpHost(xml: string | undefined, host: string): string {
  const entry = `<string name="debug_http_host">${host}</string>`
  if (xml?.includes('name="debug_http_host"')) {
    return xml.replace(/<string name="debug_http_host">[^<]*<\/string>/, entry)
  }
  if (xml?.includes('<map>')) return xml.replace('<map>', `<map>\n    ${entry}`)
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    ${entry}\n</map>\n`
}
