import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Every hunk fails Android-only and CI has no Android lane; `pnpm patch-commit` can drop the
// added-file hunk with a successful exit, which `ignorePatchFailures: false` cannot catch.
// See lessons-learned/pnpm-patch-drops-added-files.md.
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

  // A dynamic version ships whatever Maven serves, and CMake's wildcard links the first of every
  // version ever extracted.
  it('the installed build pins the runtime AAR and links that same version', () => {
    const gradle = readFileSync(`${PKG_DIR}/android/build.gradle`, 'utf8')
    const cmake = readFileSync(`${PKG_DIR}/android/CMakeLists.txt`, 'utf8')
    const pinned = /onnxruntime-android:([^@"]+)@aar/.exec(gradle)?.[1]
    expect(pinned, 'build.gradle no longer pins onnxruntime-android').toBe('1.31.0')
    const standard = /^else\(\)$([\s\S]*?)^endif\(\)$/m.exec(cmake)?.[1] ?? ''
    expect(
      standard.match(/onnxruntime-android-[^/"]*\.aar/g),
      'CMakeLists.txt links another',
    ).toEqual(['onnxruntime-android-1.31.0.aar', 'onnxruntime-android-1.31.0.aar'])
  })

  // build.gradle's QNN line stays at latest.integration, so the pin above must not reach it.
  it('the installed build still links a QNN build against the QNN AAR', () => {
    const cmake = readFileSync(`${PKG_DIR}/android/CMakeLists.txt`, 'utf8')
    const qnn = /^if\(USE_QNN\)$([\s\S]*?)^else\(\)$/m.exec(cmake)?.[1] ?? ''
    expect(qnn.match(/onnxruntime-android-[^/"]*\.aar/g), 'a QNN build links another').toEqual([
      'onnxruntime-android-qnn-*.aar',
      'onnxruntime-android-qnn-*.aar',
    ])
  })
})
