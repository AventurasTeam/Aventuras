import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

// SQLite has no JSON-typed bind parameter, so the payload crosses as TEXT and
// json_set / json_insert would store it as a quoted JSON string rather than the
// value it encodes. json() re-parses it, keeping booleans, numbers and objects
// their own types through the round-trip. (json_patch parses TEXT on its own,
// but the wrapper stays uniform so no call site has to track which does.)
export function jsonArg(value: unknown): SQL {
  return sql`json(${JSON.stringify(value)})`
}

/**
 * RFC 7386 merge of `patch` onto a JSON object column, evaluated inside SQLite.
 * Keys absent from `patch` keep their stored value, so two writers touching
 * different keys no longer clobber each other through a stale snapshot.
 *
 * A null-valued key would *delete* it rather than store null — safe for every
 * current caller because no `app_settings` object column declares a nullable
 * field. Re-check that before merging a schema that adds one.
 */
export function jsonMergeObject(column: AnyColumn, patch: object): SQL {
  return sql`json_patch(${column}, ${jsonArg(patch)})`
}

/**
 * Rebuilds a JSON array column, merging `patch` onto the one element whose
 * `$.id` matches `id` and leaving every sibling byte-identical. The match runs
 * in SQL so no caller has to know the element's index.
 */
export function jsonMergeArrayElementById(column: AnyColumn, id: string, patch: object): SQL {
  return sql`(SELECT json_group_array(
    CASE WHEN json_extract(elem.value, '$.id') = ${id}
         THEN json_patch(elem.value, ${jsonArg(patch)})
         ELSE elem.value END)
    FROM json_each(${column}) elem)`
}

/**
 * Upserts `element` into a JSON array column by `$.id`: merges when a match
 * exists, appends otherwise. Single statement, so a concurrent upsert of a
 * different id cannot drop this one.
 */
export function jsonUpsertArrayElementById(column: AnyColumn, id: string, element: object): SQL {
  return sql`(SELECT json_group_array(json(merged)) FROM (
    SELECT CASE WHEN json_extract(elem.value, '$.id') = ${id}
                THEN json_patch(elem.value, ${jsonArg(element)})
                ELSE elem.value END AS merged
    FROM json_each(${column}) elem
    UNION ALL
    SELECT ${jsonArg(element)}
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(${column}) probe
      WHERE json_extract(probe.value, '$.id') = ${id})))`
}
