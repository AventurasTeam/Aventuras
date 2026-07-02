import type { IncludeViolation, Pack } from './types'

// Matches `{% include 'id' %}` / `{% render "id" %}`, with optional whitespace
// trims (`{%-` / `-%}`). The bundled pack only uses the include form.
const INCLUDE_RE = /\{%-?\s*(?:include|render)\s+['"]([^'"]+)['"]/g

export function extractIncludes(source: string): string[] {
  const ids = new Set<string>()
  for (const match of source.matchAll(INCLUDE_RE)) ids.add(match[1])
  return [...ids]
}

// A template in group G may include only G-tagged or `staticContent` macros.
export function validatePackIncludes(pack: Pack): IncludeViolation[] {
  const violations: IncludeViolation[] = []
  for (const [templateId, template] of Object.entries(pack.templates)) {
    for (const macroId of extractIncludes(template.source)) {
      const macro = pack.macros[macroId]
      if (!macro) {
        violations.push({
          templateId,
          macroId,
          reason: 'missing-macro',
          templateGroup: template.group,
        })
        continue
      }
      if (macro.group !== 'staticContent' && macro.group !== template.group) {
        violations.push({
          templateId,
          macroId,
          reason: 'group-mismatch',
          templateGroup: template.group,
          macroGroup: macro.group,
        })
      }
    }
  }
  return violations
}
