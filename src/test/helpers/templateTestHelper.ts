// src/test/helpers/templateTestHelper.ts
import { ContextBuilder } from '$lib/services/context/context-builder'
import type { RenderResult } from '$lib/services/context/types'
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
