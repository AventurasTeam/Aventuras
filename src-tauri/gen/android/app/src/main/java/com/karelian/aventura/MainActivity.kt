package com.karelian.aventura

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

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

    // Keep the WebView renderer alive when the app is backgrounded
    webView.setRendererPriorityPolicy(
      WebView.RENDERER_PRIORITY_IMPORTANT,
      false  // don't allow renderer to be reclaimed when not visible
    )

    // Expose the bridge so JS can start/stop the foreground service
    webView.addJavascriptInterface(AndroidBridgeInterface(), "AndroidBridge")
  }

  /**
   * JavaScript-callable bridge for controlling the generation foreground service.
   *
   * Methods are invoked from the WebView via `window.AndroidBridge.<method>()`.
   * Each method annotated with [@JavascriptInterface] runs on a WebView background
   * thread, so service start/stop calls are inherently async from the JS caller's
   * perspective.
   */
  inner class AndroidBridgeInterface {
    @JavascriptInterface
    fun startGenerationService() {
      val intent = Intent(this@MainActivity, GenerationForegroundService::class.java)
      ContextCompat.startForegroundService(this@MainActivity, intent)
    }

    @JavascriptInterface
    fun stopGenerationService() {
      val intent = Intent(this@MainActivity, GenerationForegroundService::class.java)
      stopService(intent)
    }

    /**
     * Returns the current system-bar + display-cutout + mandatory-gesture insets
     * as JSON (values in dp). Called from the inline pull script in src/app.html
     * to populate --sat/--sab/--sal/--sar, used as a fallback on devices where
     * env(safe-area-inset-*) misses system bars.
     */
    @JavascriptInterface
    fun getInsets(): String {
      val view = webView ?: return """{"top":0,"bottom":0,"left":0,"right":0}"""
      val raw = ViewCompat.getRootWindowInsets(view)
        ?: return """{"top":0,"bottom":0,"left":0,"right":0}"""
      val bars = raw.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.mandatorySystemGestures()
      )
      val d = resources.displayMetrics.density
      val t = (bars.top / d).toInt()
      val b = (bars.bottom / d).toInt()
      val l = (bars.left / d).toInt()
      val r = (bars.right / d).toInt()
      return """{"top":$t,"bottom":$b,"left":$l,"right":$r}"""
    }
  }
}
