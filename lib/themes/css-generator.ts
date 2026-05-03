import type { Theme } from './types'

type BlockOptions = { selector: ':root' | 'auto' }

export function themeToCssBlock(theme: Theme, opts: BlockOptions): string {
  const selector = opts.selector === ':root' ? ':root' : `[data-theme="${theme.id}"]`
  const lines: string[] = [`${selector} {`]
  for (const [key, value] of Object.entries(theme.colors)) {
    lines.push(`  ${key}: ${value};`)
  }
  if (theme.fonts) {
    for (const [key, value] of Object.entries(theme.fonts)) {
      lines.push(`  ${key}: ${value};`)
    }
  }
  lines.push('}')
  return lines.join('\n')
}

export function themesToFullCss(themes: readonly Theme[]): string {
  if (themes.length === 0) throw new Error('themesToFullCss: empty registry')
  const tailwind = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'
  const baseLayer = '@layer base {\n'
  const blocks: string[] = []
  // First theme also gets a [data-theme="<id>"] block so per-element
  // scoping (e.g. ThemeMatrix story rows) can override the global
  // selection. Without it, "set the global to anything" falls
  // through to :root which never gets re-scoped on inner elements.
  blocks.push(themeToCssBlock(themes[0], { selector: ':root' }))
  for (const theme of themes) {
    blocks.push(themeToCssBlock(theme, { selector: 'auto' }))
  }
  return tailwind + '\n' + baseLayer + blocks.join('\n\n').replace(/^/gm, '  ') + '\n}\n'
}
