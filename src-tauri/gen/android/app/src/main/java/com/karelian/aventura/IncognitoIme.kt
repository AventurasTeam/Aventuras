package com.karelian.aventura

import android.view.inputmethod.EditorInfo

/** Set from the JS bridge; read on the IME thread when an input connection is created. */
object IncognitoIme {
  @Volatile var enabled: Boolean = false

  fun apply(outAttrs: EditorInfo) {
    if (enabled) outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
  }
}
