// Density CSS generator — emits one `[data-density="X"]` block per
// density value plus a `:root` block for the regular default. The
// output is appended to global.css alongside the theme blocks.
import { densityTokens } from './registry'
import { DENSITY_VALUES, type DensityValue } from './types'

type DensityBlockOptions = { selector: ':root' | 'auto' }

export function densityToCssBlock(density: DensityValue, opts: DensityBlockOptions): string {
  const selector = opts.selector === ':root' ? ':root' : `[data-density="${density}"]`
  const tokens = densityTokens[density]
  const lines: string[] = [`${selector} {`]
  for (const [key, value] of Object.entries(tokens)) {
    lines.push(`  ${key}: ${value};`)
  }
  lines.push('}')
  return lines.join('\n')
}

export function densityToFullCss(): string {
  // First density (compact, the desktop default) doubles as :root
  // so per-element scoping (e.g. dev-page density picker rows) can
  // override the global selection. Without it, "set the global to
  // anything" falls through to :root which never gets re-scoped.
  // Keeping the regular default at first-position of DENSITY_VALUES
  // would lock first-paint to regular-on-desktop, which is wrong;
  // compact-at-:root makes desktop first-paint consistent.
  const blocks: string[] = []
  blocks.push(densityToCssBlock('compact', { selector: ':root' }))
  for (const density of DENSITY_VALUES) {
    blocks.push(densityToCssBlock(density, { selector: 'auto' }))
  }
  return blocks.join('\n\n')
}
