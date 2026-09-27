import { describe, expect, it } from 'vitest'

import { withDebugHttpHost } from './android-prefs'

const HOST = '<string name="debug_http_host">localhost:8083</string>'

describe('withDebugHttpHost', () => {
  it('creates the prefs file when the app has none', () => {
    const xml = withDebugHttpHost(undefined, 'localhost:8083')
    expect(xml).toMatch(/^<\?xml [^>]*\?>\n<map>\n\s*<string name="debug_http_host">/)
    expect(xml).toContain(HOST)
  })

  it('expands an empty self-closed map', () => {
    expect(withDebugHttpHost("<?xml version='1.0' ?>\n<map />\n", 'localhost:8083')).toContain(HOST)
  })

  it('keeps the developer’s other dev settings', () => {
    const before =
      '<?xml version=\'1.0\' ?>\n<map>\n    <boolean name="fps_debug" value="true" />\n</map>\n'
    const after = withDebugHttpHost(before, 'localhost:8083')
    expect(after).toContain('<boolean name="fps_debug" value="true" />')
    expect(after).toContain(HOST)
  })

  it('replaces a host set earlier instead of adding a second', () => {
    const before = withDebugHttpHost(undefined, 'localhost:8082')
    const after = withDebugHttpHost(before, 'localhost:8083')
    expect(after.match(/debug_http_host/g)).toHaveLength(1)
    expect(after).toContain(HOST)
  })
})
