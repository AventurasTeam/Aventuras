/**
 * The generated files of an exported tree: what a template may reference, which version that
 * describes, and what the directory itself is.
 *
 * All of it is written from the app's own definitions on every export and never read back,
 * so it follows a new release without anyone maintaining it. None of it depends on the
 * exported templates, so an edit to one changes nothing here.
 */

import { variableRegistry } from '#lib/services/templates/variables.ts'
import type { VariableCategory, VariableDefinition } from '#lib/services/templates/types.ts'
import guide from '../../../../../guides/prompt-packs-as-folders.md?raw'

/** Cells are pipe-separated, so a description containing one would split the row. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function table(headers: string[], rows: string[][]): string {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`)
  return lines.join('\n')
}

function describeType(definition: VariableDefinition): string {
  if (definition.type === 'enum' && definition.enumValues) {
    return `enum (${definition.enumValues.join(', ')})`
  }
  return definition.type
}

const CATEGORY_INTRO: Record<'system' | 'runtime', string> = {
  system:
    'Filled from the story a prompt is being rendered for. Available in every template, though a value may be empty outside a story.',
  runtime:
    'Injected by the service that renders the prompt. A variable is only filled in the templates its own service renders — referencing it elsewhere leaves it empty.',
}

/** One file per variable category, listing what a template may reference. */
export function variablesDoc(category: 'system' | 'runtime'): string {
  const definitions = [...variableRegistry.getByCategory(category as VariableCategory)].sort(
    (a, b) => a.name.localeCompare(b.name),
  )

  const rows = definitions.map((definition) => [
    `\`${definition.name}\``,
    cell(describeType(definition)),
    definition.required ? 'yes' : 'no',
    cell(definition.description),
  ])

  return [
    `# ${category === 'system' ? 'System' : 'Runtime'} variables`,
    '',
    CATEGORY_INTRO[category],
    '',
    'Generated on export. Editing this file changes nothing.',
    '',
    table(['Variable', 'Type', 'Required', 'Description'], rows),
    '',
  ].join('\n')
}

/**
 * The application version the variable lists beside it describe.
 *
 * A file of its own, so a merge across releases conflicts on this one line at most.
 */
export function versionDoc(appVersion: string): string {
  return ['# Aventuras version', '', appVersion, ''].join('\n')
}

/** Pins line endings so an editor on Windows cannot turn a merge into a whole-file conflict. */
export function gitattributesDoc(): string {
  return '* text eol=lf\n'
}

/**
 * What the directory is and how to use it, for a reader who has only the tree: the repository's
 * guide, as shipped in this build. Line feeds, because a checkout may have converted the source.
 */
export function readmeDoc(): string {
  return guide.replace(/\r\n/g, '\n')
}
