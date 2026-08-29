import type { PackExport } from './validation'

/** A statement in the form `database.transaction` takes. */
export interface Statement {
  sql: string
  params: unknown[]
}

const TEMPLATE_SQL = `INSERT INTO pack_templates (id, pack_id, template_id, content, content_hash, baseline_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

const VARIABLE_SQL = `INSERT INTO pack_variables (id, pack_id, variable_name, display_name, description, variable_type, is_required, sort_order, default_value, enum_options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * One template row of a replaced pack.
 *
 * `baseline_hash` equals `content_hash`: the file is this pack's baseline, so what has to
 * survive a later refresh is whatever the user edits afterwards, not the file itself.
 */
export function packTemplateStatement(args: {
  id: string
  packId: string
  templateId: string
  content: string
  contentHash: string
  now: number
}): Statement {
  return {
    sql: TEMPLATE_SQL,
    params: [
      args.id,
      args.packId,
      args.templateId,
      args.content,
      args.contentHash,
      args.contentHash,
      args.now,
      args.now,
    ],
  }
}

/**
 * One variable row of a replaced pack.
 *
 * Every optional field lands as an explicit NULL: `transaction` rejects `undefined` rather
 * than guess what it meant.
 */
export function packVariableStatement(args: {
  id: string
  packId: string
  variable: PackExport['variables'][number]
  sortOrder: number
  now: number
}): Statement {
  const { variable } = args
  return {
    sql: VARIABLE_SQL,
    params: [
      args.id,
      args.packId,
      variable.variableName,
      variable.displayName,
      variable.description ?? null,
      variable.variableType,
      variable.isRequired ? 1 : 0,
      variable.sortOrder ?? args.sortOrder,
      variable.defaultValue ?? null,
      variable.enumOptions ? JSON.stringify(variable.enumOptions) : null,
      args.now,
    ],
  }
}

/**
 * Every statement that turns a pack's contents into the file's, in order.
 *
 * The pack row is updated, never deleted: `stories.pack_id` is `ON DELETE RESTRICT` and
 * `pack_runtime_variables` is `ON DELETE CASCADE`, so removing it would either fail or
 * strand the per-entity values keyed to those definitions. The name is the user's label and
 * stays theirs.
 *
 * `hashes` is keyed by template id and must cover every template in `packData`.
 */
export function packReplacementStatements(args: {
  packId: string
  packData: PackExport
  hashes: Map<string, string>
  ids: { templates: string[]; variables: string[] }
  now: number
}): Statement[] {
  const { packId, packData, hashes, ids, now } = args

  if (ids.templates.length !== packData.templates.length) {
    throw new Error('packReplacementStatements: one id required per template')
  }
  if (ids.variables.length !== packData.variables.length) {
    throw new Error('packReplacementStatements: one id required per variable')
  }

  const statements: Statement[] = [
    {
      sql: 'UPDATE preset_packs SET description = ?, author = ?, updated_at = ? WHERE id = ?',
      params: [packData.description ?? null, packData.author ?? null, now, packId],
    },
    { sql: 'DELETE FROM pack_templates WHERE pack_id = ?', params: [packId] },
    { sql: 'DELETE FROM pack_variables WHERE pack_id = ?', params: [packId] },
  ]

  packData.templates.forEach((template, i) => {
    const contentHash = hashes.get(template.templateId)
    if (contentHash === undefined) {
      throw new Error(`packReplacementStatements: no hash for template ${template.templateId}`)
    }
    statements.push(
      packTemplateStatement({
        id: ids.templates[i],
        packId,
        templateId: template.templateId,
        content: template.content,
        contentHash,
        now,
      }),
    )
  })

  packData.variables.forEach((variable, i) => {
    statements.push(
      packVariableStatement({ id: ids.variables[i], packId, variable, sortOrder: i, now }),
    )
  })

  return statements
}
