package com.karelian.aventura

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      val wv = webView
      if (wv != null) {
        wv.evaluateJavascript("window.__aventuraBackHandler?.()", null)
      } else {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    onBackPressedDispatcher.addCallback(this, backCallback)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    backCallback.isEnabled = true
  }
}
