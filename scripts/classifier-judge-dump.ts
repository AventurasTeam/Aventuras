// A faithfulness judge's input from parse-probe runs saved with PROBE_OUT; the judge's
// instructions are scripts/classifier-eval/judge-brief.md.
//   pnpm judge:classifier <out-dir> <run-dir>...
import { EVAL_WINDOWS } from './classifier-eval'
import { writeJudgeDump } from './classifier-eval/judge'

const [outDir, ...runDirs] = process.argv.slice(2)
if (outDir == null || runDirs.length === 0) {
  console.error('usage: pnpm judge:classifier <out-dir> <run-dir>...')
  process.exit(1)
}
writeJudgeDump(EVAL_WINDOWS, runDirs, outDir)
console.log(`[judge] ${runDirs.length} runs written to ${outDir}; key.txt names each label's run`)
