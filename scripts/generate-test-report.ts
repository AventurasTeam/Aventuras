// scripts/generate-test-report.ts
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const JSON_PATH = resolve(process.cwd(), 'test-results/e2e-report.json')
const HTML_PATH = resolve(process.cwd(), 'test-results/e2e-report.html')

let report: any
try {
  const raw = readFileSync(JSON_PATH, 'utf-8')
  report = JSON.parse(raw)
} catch (err: any) {
  console.error(`Error reading ${JSON_PATH}: ${err.message}`)
  process.exit(1)
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

function buildTestHtml(test: any, suiteIndex: number, testIndex: number): string {
  const id = `test-${suiteIndex}-${testIndex}`
  const badge =
    test.status === 'passed'
      ? '<span class="badge pass">PASS</span>'
      : test.status === 'failed'
        ? '<span class="badge fail">FAIL</span>'
        : '<span class="badge skip">SKIP</span>'

  let stepsHtml = ''
  if (test.steps?.length > 0) {
    for (const step of test.steps) {
      const templateInputsHtml =
        Object.keys(step.input?.templateInputs ?? {}).length > 0
          ? `<table class="kv-table">
            <thead><tr><th>Key</th><th>Value</th></tr></thead>
            <tbody>${Object.entries(step.input.templateInputs)
              .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(JSON.stringify(v))}</td></tr>`)
              .join('')}</tbody>
          </table>`
          : '<p class="empty">No template inputs recorded</p>'

      const promptHtml = step.input?.capturedPrompt
        ? `<details class="prompt-details">
            <summary>Captured Prompt</summary>
            <pre><code>${esc(JSON.stringify(step.input.capturedPrompt, null, 2))}</code></pre>
          </details>`
        : ''

      const responseHtml =
        step.output?.mockedResponse != null
          ? `<div class="response-block">
            <strong>Mocked Response:</strong>
            <pre><code>${esc(typeof step.output.mockedResponse === 'string' ? step.output.mockedResponse : JSON.stringify(step.output.mockedResponse, null, 2))}</code></pre>
          </div>`
          : ''

      const diffsHtml = (step.output?.storeDiffs ?? [])
        .map(
          (diff: any) => `
        <div class="store-diff">
          <strong>Store: ${esc(diff.storeName)}</strong>
          ${
            diff.changes?.length > 0
              ? `<table class="diff-table">
                <thead><tr><th>Path</th><th>Before</th><th>After</th></tr></thead>
                <tbody>${diff.changes
                  .map(
                    (c: any) =>
                      `<tr>
                    <td class="diff-path">${esc(c.path)}</td>
                    <td class="diff-old">${esc(JSON.stringify(c.old))}</td>
                    <td class="diff-new">${esc(JSON.stringify(c.new))}</td>
                  </tr>`,
                  )
                  .join('')}</tbody>
              </table>`
              : '<p class="empty">No changes detected</p>'
          }
          <details class="snapshot-details">
            <summary>Full snapshots</summary>
            <div class="snapshot-panels">
              <div><strong>Before:</strong><pre><code>${esc(JSON.stringify(diff.before, null, 2))}</code></pre></div>
              <div><strong>After:</strong><pre><code>${esc(JSON.stringify(diff.after, null, 2))}</code></pre></div>
            </div>
          </details>
        </div>`,
        )
        .join('')

      stepsHtml += `<div class="step">
        <div class="step-header">Service: <strong>${esc(step.serviceId)}</strong></div>
        <div class="panels">
          <div class="panel input-panel">
            <h4>Input</h4>
            ${templateInputsHtml}
            ${promptHtml}
          </div>
          <div class="panel output-panel">
            <h4>Output</h4>
            ${responseHtml}
            ${diffsHtml}
          </div>
        </div>
      </div>`
    }
  }

  const errorHtml = test.error
    ? `<div class="error-block">
        <strong>Error:</strong> ${esc(test.error.message)}
        ${test.error.stack ? `<pre class="stack">${esc(test.error.stack)}</pre>` : ''}
      </div>`
    : ''

  return `<div class="test ${test.status}" data-suite="${suiteIndex}" id="${id}">
    <div class="test-header" onclick="toggle('${id}')">
      ${badge}
      <span class="test-name">${esc(test.name)}</span>
      <span class="test-duration">${formatDuration(test.duration)}</span>
    </div>
    <div class="test-body" style="display:none">
      ${errorHtml}
      ${stepsHtml || '<p class="empty">No trace data recorded</p>'}
    </div>
  </div>`
}

// Build sidebar
const suiteSidebarItems = report.suites
  .map((suite: any, i: number) => {
    const hasFailed = suite.tests.some((t: any) => t.status === 'failed')
    const allPassed = suite.tests.every((t: any) => t.status === 'passed')
    const icon = hasFailed ? '&#x2717;' : allPassed ? '&#x2713;' : '&#x25CB;'
    const cls = hasFailed ? 'fail' : allPassed ? 'pass' : 'skip'
    return `<li class="sidebar-item ${cls}" onclick="filterSuite(${i})" data-suite="${i}">
    <span class="sidebar-icon">${icon}</span> ${esc(suite.name)}
  </li>`
  })
  .join('')

// Build main content (failed tests sorted to top within each suite)
const suiteTestsHtml = report.suites
  .map((suite: any, si: number) => {
    const sorted = [...suite.tests].sort((a: any, b: any) => {
      if (a.status === 'failed' && b.status !== 'failed') return -1
      if (b.status === 'failed' && a.status !== 'failed') return 1
      return 0
    })
    return `<div class="suite" data-suite="${si}">
    <h3 class="suite-name">${esc(suite.name)}</h3>
    <p class="suite-file">${esc(suite.file)}</p>
    ${sorted.map((t: any, ti: number) => buildTestHtml(t, si, ti)).join('')}
  </div>`
  })
  .join('')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E Test Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;flex-direction:column;min-height:100vh}
.topbar{background:#161b22;padding:12px 24px;display:flex;align-items:center;gap:24px;border-bottom:1px solid #30363d;flex-shrink:0}
.topbar h1{font-size:16px;font-weight:600}
.stat{display:flex;align-items:center;gap:6px;font-size:14px}
.stat.pass-count{color:#3fb950} .stat.fail-count{color:#f85149} .stat.skip-count{color:#8b949e} .stat.duration{color:#8b949e}
.layout{display:flex;flex:1;overflow:hidden}
.sidebar{width:280px;background:#161b22;border-right:1px solid #30363d;overflow-y:auto;padding:12px 0;flex-shrink:0}
.sidebar-item{list-style:none;padding:8px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px}
.sidebar-item:hover,.sidebar-item.active{background:#1f2937}
.sidebar-item.active{font-weight:600}
.sidebar-item.pass .sidebar-icon{color:#3fb950} .sidebar-item.fail .sidebar-icon{color:#f85149} .sidebar-item.skip .sidebar-icon{color:#8b949e}
.sidebar-all{padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;border-bottom:1px solid #30363d;margin-bottom:4px}
.sidebar-all:hover{background:#1f2937}
.main{flex:1;overflow-y:auto;padding:16px 24px}
.suite{margin-bottom:24px}
.suite-name{font-size:16px;font-weight:600;margin-bottom:4px;color:#e6edf3}
.suite-file{font-size:12px;color:#8b949e;margin-bottom:12px}
.test{border:1px solid #30363d;border-radius:6px;margin-bottom:8px;overflow:hidden}
.test-header{padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;background:#161b22}
.test-header:hover{background:#1f2937}
.test-name{flex:1;font-size:14px} .test-duration{font-size:12px;color:#8b949e}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;text-transform:uppercase}
.badge.pass{background:#23312e;color:#3fb950} .badge.fail{background:#3d1a1e;color:#f85149} .badge.skip{background:#272c33;color:#8b949e}
.test-body{padding:14px;background:#0d1117}
.step{border:1px solid #21262d;border-radius:4px;padding:12px;margin-bottom:10px}
.step-header{font-size:13px;font-weight:600;margin-bottom:10px;color:#58a6ff}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.panel{background:#161b22;border-radius:4px;padding:10px}
.panel h4{font-size:12px;text-transform:uppercase;color:#8b949e;margin-bottom:8px;letter-spacing:.05em}
.kv-table,.diff-table{width:100%;border-collapse:collapse;font-size:12px}
.kv-table th,.diff-table th{text-align:left;color:#8b949e;padding:4px 8px;border-bottom:1px solid #30363d}
.kv-table td,.diff-table td{padding:4px 8px;border-bottom:1px solid #21262d;word-break:break-word}
.diff-old{color:#f85149} .diff-new{color:#3fb950} .diff-path{color:#d2a8ff}
pre{background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;overflow-x:auto;font-size:12px;line-height:1.5}
code{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace}
details{margin-top:8px}
summary{cursor:pointer;font-size:13px;color:#58a6ff}
summary:hover{text-decoration:underline}
.snapshot-panels{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.error-block{background:#3d1a1e;border:1px solid #f85149;border-radius:4px;padding:10px;margin-bottom:10px;font-size:13px}
.error-block .stack{margin-top:8px;font-size:11px;color:#f0a0a0;background:transparent;border:none}
.empty{font-size:12px;color:#484f58;font-style:italic}
.response-block{margin-bottom:8px} .response-block strong{font-size:12px;color:#8b949e}
.store-diff{margin-top:8px} .store-diff strong{font-size:12px}
@media(max-width:900px){.panels{grid-template-columns:1fr}.snapshot-panels{grid-template-columns:1fr}.sidebar{display:none}}
</style>
</head>
<body>
<div class="topbar">
  <h1>E2E Test Report</h1>
  <span class="stat pass-count">&#x2713; ${report.summary.passed} passed</span>
  <span class="stat fail-count">&#x2717; ${report.summary.failed} failed</span>
  ${report.summary.skipped ? `<span class="stat skip-count">&#x25CB; ${report.summary.skipped} skipped</span>` : ''}
  <span class="stat duration">&#x23F1; ${formatDuration(report.duration)}</span>
  <span class="stat" style="margin-left:auto;font-size:12px;color:#484f58;">${new Date(report.timestamp).toLocaleString()}</span>
</div>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-all" onclick="filterSuite(-1)">All Suites</div>
    <ul>${suiteSidebarItems}</ul>
  </div>
  <div class="main">${suiteTestsHtml}</div>
</div>
<script>
function toggle(id){var e=document.getElementById(id),b=e.querySelector('.test-body');b.style.display=b.style.display==='none'?'block':'none'}
function filterSuite(i){document.querySelectorAll('.suite').forEach(function(s){s.style.display=i===-1||parseInt(s.dataset.suite)===i?'block':'none'});document.querySelectorAll('.sidebar-item').forEach(function(s){s.classList.toggle('active',parseInt(s.dataset.suite)===i)})}
</script>
</body>
</html>`

writeFileSync(HTML_PATH, html, 'utf-8')
console.log(`Report written to ${HTML_PATH}`)
