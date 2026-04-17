// src/test/helpers/templateTestHelper.ts
import { ContextBuilder } from '$lib/services/context/context-builder'
import type { RenderResult } from '$lib/services/context/types'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import { createDatabaseMock } from '$test/e2e/utils/databaseMock'
import type { TemplateVariableManifest } from '$test/fixtures/templateManifests'
import { it, expect } from 'vitest'

/**
 * Create a fresh ContextBuilder, add context, and render a template.
 * Each call gets an isolated ContextBuilder -- no shared state between tests.
 */
export async function renderTemplate(
  templateId: string,
  context: Record<string, any>,
): Promise<RenderResult> {
  const ctx = new ContextBuilder()
  ctx.add(context)
  return ctx.render(templateId)
}

/**
 * Create a fresh database mock for template tests.
 * Call in beforeEach to get isolated state.
 */
export function createTemplateTestMock() {
  return createDatabaseMock()
}

/**
 * Auto-generate variable injection tests from a manifest.
 * Call inside a describe() block for a template.
 */
export function testVariableInjection(
  manifest: TemplateVariableManifest,
  context: Record<string, any>,
) {
  for (const variable of manifest.variables) {
    const mergedContext = variable.requiresContext
      ? { ...context, ...variable.requiresContext }
      : context

    if (variable.expectedInSystem) {
      for (const expected of variable.expectedInSystem) {
        it(`renders ${variable.name} in system -> "${expected}"`, async () => {
          const result = await renderTemplate(manifest.templateId, mergedContext)
          expect(result.system).toContain(expected)
        })
      }
    }

    if (variable.expectedInUser) {
      for (const expected of variable.expectedInUser) {
        it(`renders ${variable.name} in user -> "${expected}"`, async () => {
          const result = await renderTemplate(manifest.templateId, mergedContext)
          expect(result.user).toContain(expected)
        })
      }
    }
  }
}

/**
 * Verify that a manifest covers all root-level variables used in a template.
 * Call inside a describe() block for a template.
 */
export function testManifestCoverage(manifest: TemplateVariableManifest) {
  it(`manifest covers all variables in ${manifest.templateId}`, () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === manifest.templateId)
    expect(template).toBeDefined()

    const allContent = [template!.content, template!.userContent ?? ''].join('\n')
    const usedVars = templateEngine.extractVariableNames(allContent)

    // Get root variable names from manifest (before first dot, bracket, or space)
    const manifestRoots = new Set(
      manifest.variables.map((v) => v.name.split('.')[0].split('[')[0].split(' ')[0]),
    )

    // Extract root names from template (before first dot)
    const templateRoots = usedVars.map((v) => v.split('.')[0])

    // Filter out loop-scoped variables (defined by {% for X in Y %})
    // Note: {%- is Liquid's whitespace-stripping tag syntax
    const forPattern = /\{%-?\s*for\s+(\w+)\s+in/g
    let match = forPattern.exec(allContent)
    const loopVars = new Set<string>()
    while (match) {
      loopVars.add(match[1])
      match = forPattern.exec(allContent)
    }

    // Filter out assign-scoped variables
    const assignPattern = /\{%-?\s*assign\s+(\w+)\s*=/g
    match = assignPattern.exec(allContent)
    while (match) {
      loopVars.add(match[1])
      match = assignPattern.exec(allContent)
    }

    // Filter out capture-scoped variables
    const capturePattern = /\{%-?\s*capture\s+(\w+)/g
    match = capturePattern.exec(allContent)
    while (match) {
      loopVars.add(match[1])
      match = capturePattern.exec(allContent)
    }

    // Also exclude Liquid built-ins
    const builtins = new Set(['forloop', 'tablerowloop'])

    const uncovered = templateRoots.filter(
      (v) => !manifestRoots.has(v) && !loopVars.has(v) && !builtins.has(v),
    )

    if (uncovered.length > 0) {
      throw new Error(
        `Manifest for "${manifest.templateId}" is missing variables: ${[...new Set(uncovered)].join(', ')}`,
      )
    }
  })
}
