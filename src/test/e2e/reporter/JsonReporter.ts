import type { Reporter, TestModule, TestRunEndReason, SerializedError } from 'vitest/node'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

interface ReportTest {
  name: string
  fullName: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  steps: unknown[]
  error: { message: string; stack?: string } | null
}

interface ReportSuite {
  name: string
  file: string
  tests: ReportTest[]
}

interface Report {
  timestamp: string
  duration: number
  summary: { total: number; passed: number; failed: number; skipped: number }
  suites: ReportSuite[]
}

class JsonReporter implements Reporter {
  private startTime = 0

  onInit(): void {
    this.startTime = Date.now()
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<SerializedError>,
    _reason: TestRunEndReason,
  ): void {
    const duration = Date.now() - this.startTime

    let total = 0
    let passed = 0
    let failed = 0
    let skipped = 0

    const suites: ReportSuite[] = []

    for (const testModule of testModules) {
      const reportTests: ReportTest[] = []

      for (const testCase of testModule.children.allTests()) {
        total++
        const result = testCase.result()
        const state = result.state

        let status: 'passed' | 'failed' | 'skipped'
        if (state === 'passed') {
          status = 'passed'
          passed++
        } else if (state === 'failed') {
          status = 'failed'
          failed++
        } else {
          status = 'skipped'
          skipped++
        }

        // Read trace data from task.meta (set by tests via task.meta.traceData)
        const meta = testCase.meta()
        const steps = (meta as any).traceData ?? []

        const errors = result.errors
        const error =
          errors && errors.length > 0
            ? { message: errors[0].message, stack: errors[0].stack }
            : null

        reportTests.push({
          name: testCase.name,
          fullName: testCase.fullName,
          status,
          duration: testCase.diagnostic()?.duration ?? 0,
          steps,
          error,
        })
      }

      if (reportTests.length > 0) {
        const suiteName =
          testModule.children.at(0)?.type === 'suite'
            ? testModule.children.at(0)!.name
            : testModule.moduleId

        suites.push({
          name: suiteName,
          file: testModule.moduleId,
          tests: reportTests,
        })
      }
    }

    const report: Report = {
      timestamp: new Date().toISOString(),
      duration,
      summary: { total, passed, failed, skipped },
      suites,
    }

    const outDir = resolve(process.cwd(), 'test-results')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf-8')
  }
}

export default new JsonReporter()
