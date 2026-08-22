import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// patches/onnxruntime-react-native.patch carries two hunks with no automated signal of
// their own. Both fail Android-only, and CI has no Android lane.
//
// The added-file hunk is the fragile one: `pnpm patch-commit` drops files created in the
// scratch dir with a successful exit (lessons-learned/pnpm-patch-drops-added-files.md), so
// a regenerated patch loses it silently — and `ignorePatchFailures: false` cannot catch
// that, since the patch it applies simply no longer contains the hunk. Without the file,
// autolinking never registers OnnxruntimePackage and NativeModules.Onnxruntime is null at
// the JSI install ("Cannot read property 'install' of null").
const PATCH_PATH = 'patches/onnxruntime-react-native.patch'
const PKG_DIR = 'node_modules/onnxruntime-react-native'
const ADDED_FILE = 'react-native.config.js'

describe('onnxruntime-react-native patch guard', () => {
  it('the patch still carries the react-native.config.js new-file hunk', () => {
    const patch = readFileSync(PATCH_PATH, 'utf8')
    expect(patch, `${PATCH_PATH} lost its added-file hunk — re-append it by hand`).toContain(
      `diff --git a/${ADDED_FILE} b/${ADDED_FILE}`,
    )
    expect(patch).toContain('new file mode')
  })

  it('the installed package registers the autolinking entry point', () => {
    const configPath = `${PKG_DIR}/${ADDED_FILE}`
    expect(
      existsSync(configPath),
      `${configPath} is absent — autolinking will skip the package`,
    ).toBe(true)
    const config = readFileSync(configPath, 'utf8')
    // The two fields RN's PackageList generator reads. A config present but naming the wrong
    // class fails identically at runtime, so assert the values, not just the file.
    expect(config).toContain('import ai.onnxruntime.reactnative.OnnxruntimePackage;')
    expect(config).toContain('new OnnxruntimePackage()')
  })

  it('the installed build.gradle has the Gradle-9 VersionNumber guard removed', () => {
    const gradle = readFileSync(`${PKG_DIR}/android/build.gradle`, 'utf8')
    // Both directions: absence alone would pass just as well on a file that moved or emptied.
    expect(gradle, 'the patch comment is gone — the gradle hunk did not apply').toContain(
      'Gradle 9 removed VersionNumber',
    )
    expect(
      gradle,
      'VersionNumber.parse is back — the Android build will fail under Gradle 9',
    ).not.toContain('VersionNumber.parse')
  })
})
