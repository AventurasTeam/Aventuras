import type { Lint } from 'harper.js'

// Hermes has no WebAssembly or Worker, so harper.js cannot execute on native —
// and its binaryInlined WASM payload alone is ~24 MB of bundle. The type-only
// harper import erases at compile time; this module keeps the runtime graph
// harper-free and the composer simply gets zero lints.
export async function lintNarrativeText(_text: string): Promise<Lint[]> {
  return []
}

export { buildTextSegments, type LintSpan, type TextSegment } from './segments'
