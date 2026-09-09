/**
 * The generated files of an exported tree: what a template may reference, what references
 * it, what carries an edit, and what the directory itself is.
 *
 * All of it is written from the app's own definitions on every export and never read back,
 * so it follows a new release without anyone maintaining it.
 */

import { variableRegistry } from '$lib/services/templates/variables'
import { templateEngine } from '$lib/services/templates/engine'
import type { VariableCategory, VariableDefinition } from '$lib/services/templates/types'
import { classifyTemplate, isUntouched } from '../staleness'
import type { PackTemplate } from '../types'
import {
  ABOUT_FILE,
  GITATTRIBUTES_FILE,
  PACK_FILE,
  REFERENCE_DIR,
  UNGROUPED_DIR,
  USER_HALF_SUFFIX,
} from './layout'

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

/** Which variables each exported template references, and which templates reference each variable. */
export function templateVariablesDoc(templates: Map<string, string>): string {
  const byTemplate = [...templates.keys()].sort().map((templateId) => {
    const names = [
      ...new Set(templateEngine.extractVariableNames(templates.get(templateId)!)),
    ].sort()
    return { templateId, names }
  })

  const byVariable = new Map<string, string[]>()
  for (const { templateId, names } of byTemplate) {
    for (const name of names) {
      const existing = byVariable.get(name)
      if (existing) existing.push(templateId)
      else byVariable.set(name, [templateId])
    }
  }

  const knownFirst = [...byVariable.keys()].sort()

  return [
    '# Templates and variables',
    '',
    'Which variables each template in this export references, and which templates reference each',
    'variable. Generated on export. Editing this file changes nothing.',
    '',
    '## By template',
    '',
    table(
      ['Template', 'References'],
      byTemplate.map(({ templateId, names }) => [
        `\`${templateId}\``,
        names.length > 0 ? names.map((n) => `\`${n}\``).join(', ') : '—',
      ]),
    ),
    '',
    '## By variable',
    '',
    table(
      ['Variable', 'Known', 'Referenced by'],
      knownFirst.map((name) => [
        `\`${name}\``,
        variableRegistry.has(name) ? 'yes' : 'no',
        byVariable
          .get(name)!
          .map((id) => `\`${id}\``)
          .join(', '),
      ]),
    ),
    '',
  ].join('\n')
}

type StatusRow = Pick<PackTemplate, 'templateId' | 'contentHash' | 'baselineHash'>

/**
 * What the status report is being written for.
 *
 * The three-state vocabulary only means something when a row's baseline *is* the shipped
 * text, so it is offered for the built-in pack alone. A custom pack's baseline is the file
 * its author wrote, and comparing that against what Aventuras ships answers no question
 * anyone asked.
 */
export type StatusSource =
  | { kind: 'default-pack'; rows: StatusRow[]; shippedHashes: Map<string, string> }
  | { kind: 'custom-pack'; rows: StatusRow[] }
  | { kind: 'shipped-baseline' }

const NOTHING_EDITED = 'No template in this export carries an edit made in the app.'

function defaultPackStatus(rows: StatusRow[], shippedHashes: Map<string, string>): string[] {
  const customised: string[] = []
  const behind: string[] = []
  const unknown: string[] = []

  for (const row of [...rows].sort((a, b) => a.templateId.localeCompare(b.templateId))) {
    const state = classifyTemplate(row, shippedHashes.get(row.templateId))
    if (state === null) unknown.push(row.templateId)
    else if (state === 'behind') behind.push(row.templateId)
    else if (state === 'customised') customised.push(row.templateId)
  }

  const sections: string[] = [
    'This export came from the built-in pack as it is currently stored, so it carries any edit made',
    'in the app. Those edits become part of whatever you commit — if you meant to capture the prompts',
    'this release ships, export the shipped baseline instead.',
    '',
  ]

  if (customised.length === 0 && behind.length === 0 && unknown.length === 0) {
    sections.push(NOTHING_EDITED, '')
    return sections
  }

  if (behind.length > 0) {
    sections.push(
      '## Edited, and newer text has shipped since',
      '',
      'These carry your edit *and* the app has changed its own text for them since you made it.',
      '',
      ...behind.map((id) => `- \`${id}\``),
      '',
    )
  }
  if (customised.length > 0) {
    sections.push(
      '## Edited',
      '',
      'These carry your edit; the app ships nothing newer for them.',
      '',
      ...customised.map((id) => `- \`${id}\``),
      '',
    )
  }
  if (unknown.length > 0) {
    sections.push(
      '## No longer shipped',
      '',
      `The app no longer ships these ids. They export to \`${UNGROUPED_DIR}/\`.`,
      '',
      ...unknown.map((id) => `- \`${id}\``),
      '',
    )
  }
  return sections
}

function customPackStatus(rows: StatusRow[]): string[] {
  const edited = rows
    .filter((row) => !isUntouched(row))
    .map((row) => row.templateId)
    .sort()

  const sections: string[] = [
    'This export came from a custom pack. A custom pack’s baseline is whatever it last received,',
    'not the text Aventuras ships, so the only question worth asking is whether a template has been',
    'edited in the app since then — those edits are what replacing this pack from a directory discards.',
    '',
  ]

  if (edited.length === 0) {
    sections.push(NOTHING_EDITED, '')
    return sections
  }

  sections.push(
    '## Edited in the app since this pack last received its contents',
    '',
    ...edited.map((id) => `- \`${id}\``),
    '',
  )
  return sections
}

/** Names the templates carrying an edit, in the vocabulary that fits where the export came from. */
export function templateStatusDoc(source: StatusSource): string {
  const body =
    source.kind === 'shipped-baseline'
      ? [
          'This export came from the text this version of the app ships, not from any pack, so nothing',
          'in it can carry an edit. It is a merge base you can trust.',
          '',
          NOTHING_EDITED,
          '',
        ]
      : source.kind === 'default-pack'
        ? defaultPackStatus(source.rows, source.shippedHashes)
        : customPackStatus(source.rows)

  return [
    '# Template status',
    '',
    'Generated on export. Editing this file changes nothing.',
    '',
    ...body,
  ].join('\n')
}

/** Pins line endings so an editor on Windows cannot turn a merge into a whole-file conflict. */
export function gitattributesDoc(): string {
  return '* text eol=lf\n'
}

/** What the directory is, for a reader who has only the tree. */
export function aboutDoc(): string {
  return `# About this directory

This is a prompt pack exported from Aventuras as Markdown, so it can be searched, diffed and
merged with ordinary tools. It is regenerated on every export — including this file.

## What is here

- **Group folders** (\`Story Generation/\`, \`Analysis/\`, …) hold one \`.md\` file per stored
  template. The folder is presentation only: it names the group the app lists that template
  under, and it changes when the app regroups a template. It is **not** part of the
  template's identity, so moving a file between folders changes nothing.
- **A file's name is its identity.** \`adventure.md\` is the template \`adventure\`. A file
  ending \`${USER_HALF_SUFFIX}.md\` is that prompt's user-message half, stored separately from its
  system half.
- **\`${UNGROUPED_DIR}/\`** holds templates whose id this version of the app no longer ships.
- **\`${PACK_FILE}\`** carries the pack's name, description, author and custom variables, plus the
  format and app versions this tree was written by.
- **\`${REFERENCE_DIR}/\`** is generated reference material: the variables a template may
  reference, which templates reference which, and which templates carry an edit. It is never
  read back.
- **\`${ABOUT_FILE}\`** and **\`${GITATTRIBUTES_FILE}\`** are generated and overwritten on every export.

## What these files actually are

**Liquid templates, not Markdown.** The \`.md\` extension is for your tooling's benefit — it
makes the files open, diff and search as text everywhere — but nothing renders them as
Markdown. The app parses each one with Liquid and sends the result to the model. Markdown
holding Liquid is how Jekyll works too, so the pairing is ordinary; it just means the
extension describes the prose, not the syntax.

Two constructs appear:

- \`{{ variableName }}\` is replaced by that variable's value.
- \`{% if ... %}\` … \`{% endif %}\` (and \`elsif\`, \`else\`, \`unless\`, \`for\`, \`comment\`) decide
  whether a passage appears at all. Most prompts here use them to drop a heading or a bullet
  when the story has nothing to put in it.

\`${REFERENCE_DIR}/\` lists every variable the app can fill, what it means, and which prompts
already reference it. That listing is generated from this exact version of the app, so it is
the authority on what a name has to be.

Your editor will most likely highlight these as Markdown, which is wrong but harmless — the
Liquid tags show as plain text. Editor extensions for Liquid exist if you want real
highlighting; nothing here depends on having one.

## When a template is broken

Two kinds of mistake, and they are treated very differently.

**Liquid that does not parse** — a tag left unclosed, an \`{% endif %}\` that does not match its
opening, an unclosed \`{{\`, or a filter the app does not have. The whole import is refused
before anything is written. Every failing file is named with the line and column of the
fault, and the pack is left exactly as it was. Nothing is partially applied, so fixing the
file and importing again is always safe.

**A variable name that does not exist** — this is *not* an error, and nothing will tell you
about it. Liquid renders an unknown name as an empty string, so \`{{ protagonistNmae }}\`
imports cleanly, generates cleanly, and quietly contributes nothing to the prompt forever.
A misspelling costs you the whole line it was on.

That asymmetry is worth remembering when merging: a conflict that mangles a tag stops you at
the door, while one that mangles a variable name passes silently. Check names against
\`${REFERENCE_DIR}/\` rather than assuming a clean import means a correct prompt.

## What import reads

Only \`${PACK_FILE}\` and the \`.md\` files inside folders. Ignored, silently:

- Markdown files at the root — so your own \`README.md\` and notes are safe
- Any folder whose name starts with \`_\`, including \`${REFERENCE_DIR}/\`
- Anything that is not a \`.md\` file

Two files anywhere in the tree with the same name are refused, since the folder does not
disambiguate them. Names are compared without case, because two spellings are one file on
Windows and macOS.

**Do not keep your own notes inside a group folder.** Any \`.md\` there is a prompt as far as
this format is concerned: it imports as one, and if the pack has no such prompt it is
removed on the next export. The root is the safe place for your own files — the export
never reads or deletes anything there apart from the generated files named above.

## Import replaces

Importing this directory over a pack replaces that pack's templates and custom variables
with what is here. A template this tree does not contain is removed from the pack. Deleting
a file is therefore a real deletion — which is why it should be a commit you can see.

Runtime variables are not part of this format. An import leaves a pack's runtime variable
definitions, and every value stored against them, exactly as they were.

## Line endings

\`${GITATTRIBUTES_FILE}\` pins this tree to line-feed endings. Without it an editor on Windows can
rewrite every file, turning the next merge into a conflict in all of them. If you use git,
keep that file.
`
}
