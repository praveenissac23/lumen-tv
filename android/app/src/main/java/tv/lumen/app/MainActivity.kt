package tv.lumen.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/**
 * One activity: a video layer (SurfaceView via PlayerHost) under a transparent WebView
 * that draws the whole interface from assets/web. Remote keys the WebView can't see
 * (Back, Menu, channel and media keys) are forwarded to the UI as "key" events.
 */
class MainActivity : Activity() {

    lateinit var player: PlayerHost
    private lateinit var web: WebView
    val webView: WebView get() = web
    private lateinit var bridge: NativeBridge
    lateinit var server: LocalServer
    val updater by lazy { Updater(this) }
    var pendingVoice = false
    @Volatile var recovered = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        val videoLayer = FrameLayout(this)
        root.addView(videoLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        rootView = root
        web = buildWebView()
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        server = LocalServer { msg -> emit("remote", msg) }
        server.start()
        player = PlayerHost(this, videoLayer) { evt, data -> emit(evt, data) }
        bridge = NativeBridge(this)
        web.addJavascriptInterface(bridge, "Native")
        web.loadUrl("file:///android_asset/web/index.html")
        web.requestFocus()
    }

    private lateinit var rootView: FrameLayout
    val thumbs by lazy { Thumbs(this) }
    val epg by lazy { EpgStore(this) }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(): WebView {
        val w = WebView(this)
        w.setBackgroundColor(Color.TRANSPARENT)
        w.isFocusable = true
        w.isFocusableInTouchMode = true
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.setInitialScale(100)
        w.isVerticalScrollBarEnabled = false
        w.isHorizontalScrollBarEnabled = false
        if (Build.VERSION.SDK_INT >= 26) w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // 1 CSS pixel = 1 dp, no automatic zoom: the page scales itself to the screen.
            loadWithOverviewMode = false
            useWideViewPort = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        w.webViewClient = object : WebViewClient() {
            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = true // never navigate away

            // Logos and posters are downscaled natively (see Thumbs)
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val u = request?.url ?: return null
                if (u.host == "thumb.lumen") {
                    val src = u.getQueryParameter("u") ?: return null
                    val width = u.getQueryParameter("w")?.toIntOrNull() ?: 320
                    return thumbs.serve(src, width)
                }
                return null
            }

            // If Android kills the interface process (low memory), rebuild it instead of crashing the app.
            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                if (view !== web) return true
                recovered = true      // the page reloads; it continues what was playing instead of starting over
                try { rootView.removeView(web); web.destroy() } catch (e: Exception) { }
                web = buildWebView()
                rootView.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                web.addJavascriptInterface(bridge, "Native")
                web.loadUrl("file:///android_asset/web/index.html")
                web.requestFocus()
                return true
            }
        }
        w.webChromeClient = WebChromeClient()
        w.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, orr, ob ->
            if (r - l != orr - ol || b - t != ob - ot) emit("resize", JSONObject())
        }
        return w
    }

    /** Send an event to the web UI: window.__nat(evt, data). Safe from any thread. */
    fun emit(evt: String, data: JSONObject) {
        val js = "window.__nat&&window.__nat(${JSONObject.quote(evt)},${data})"
        web.post { web.evaluateJavascript(js, null) }
    }

    private fun key(name: String) = emit("key", JSONObject().put("name", name))

    // Keys the page can't receive, or that Android would otherwise act on itself.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> "back"
            KeyEvent.KEYCODE_MENU -> "menu"
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> "chup"
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> "chdown"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "playpause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "rew"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_NEXT -> "ffwd"
            KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_VOICE_ASSIST -> "search"
            KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_TV_INPUT -> "guide"
            KeyEvent.KEYCODE_INFO -> "info"
            KeyEvent.KEYCODE_PROG_RED -> "red"
            KeyEvent.KEYCODE_PROG_GREEN -> "green"
            KeyEvent.KEYCODE_PROG_YELLOW -> "yellow"
            KeyEvent.KEYCODE_PROG_BLUE -> "blue"
            KeyEvent.KEYCODE_LAST_CHANNEL -> "d0"
            else -> null
        } ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            // Holding Back would otherwise fire repeatedly; only the first press counts.
            if (event.repeatCount == 0 || name == "chup" || name == "chdown" || name == "rew" || name == "ffwd") key(name)
        }
        return true
    }

    // Google TV / Android TV: the remote's search button
    override fun onSearchRequested(): Boolean { key("search"); return true }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent?.action == Intent.ACTION_SEARCH || intent?.action == Intent.ACTION_ASSIST) key("search")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && pendingVoice) {
            pendingVoice = false
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) bridge.startListening() else bridge.onMicDenied()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_TEXT) {
            bridge.onTextResult(if (resultCode == RESULT_OK) data?.getStringExtra(SearchActivity.EXTRA_TEXT) else null)
            return
        }
        if (requestCode == REQ_VOICE) {
            val text = if (resultCode == RESULT_OK) data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
            bridge.onVoiceResult(text)
        }
    }

    override fun onStart() { super.onStart(); player.onStart(); web.onResume() }
    override fun onResume() { super.onResume(); updater.onResume { e, d -> emit(e, d) } }
    override fun onStop() { player.onStop(); web.onPause(); emit("lifecycle", JSONObject().put("state", "stop")); super.onStop() }

    override fun onDestroy() {
        player.release()
        bridge.release()
        server.stop()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val REQ_MIC = 41
        const val REQ_VOICE = 42
        const val REQ_TEXT = 43
    }
}
