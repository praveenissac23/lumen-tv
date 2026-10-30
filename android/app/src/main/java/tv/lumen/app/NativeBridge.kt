package tv.lumen.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.inputmethod.InputMethodManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Methods the web UI calls as window.Native.*  (see web/src/native.js).
 * Calls arrive on a WebView binder thread; anything touching views is posted to the UI thread.
 */
class NativeBridge(private val act: MainActivity) {

    private val io = Executors.newFixedThreadPool(4)
    private val bodies = ConcurrentHashMap<Int, String>()
    private val dir: File = File(act.filesDir, "cache").apply { mkdirs() }
    private var recognizer: SpeechRecognizer? = null

    private fun emit(evt: String, data: JSONObject) = act.emit(evt, data)
    private fun ui(block: () -> Unit) = act.runOnUiThread(block)

    // ---------- device ----------
    @JavascriptInterface
    fun deviceInfo(): String {
        val pm = act.packageManager
        val fire = pm.hasSystemFeature("amazon.hardware.fire_tv") || Build.MODEL.startsWith("AFT")
        // Fire TV reports recognisers that apps can't actually use; it gets the native text box instead.
        val voice = !fire && (SpeechRecognizer.isRecognitionAvailable(act) ||
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).resolveActivity(pm) != null)
        return JSONObject()
            .put("fireTv", fire).put("voice", voice)
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}").put("version", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("cssW", viewCss().first).put("cssH", viewCss().second).toString()
    }

    @JavascriptInterface
    fun exit() = ui { act.finish() }

    /** Size of the WebView in CSS pixels (dp), for scaling the 1920x1080 interface to fit. */
    private fun viewCss(): Pair<Double, Double> {
        val d = act.resources.displayMetrics
        val w = if (act.webView.width > 0) act.webView.width else d.widthPixels
        val h = if (act.webView.height > 0) act.webView.height else d.heightPixels
        return (w / d.density.toDouble()) to (h / d.density.toDouble())
    }

    @JavascriptInterface
    fun viewSize(): String = JSONObject().put("w", viewCss().first).put("h", viewCss().second).toString()

    // ---------- network ----------
    @JavascriptInterface
    fun http(id: Int, url: String, timeout: Int) {
        io.execute {
            try {
                bodies[id] = Net.getText(url, timeout)
                emit("http", JSONObject().put("id", id).put("ok", true))
            } catch (e: Net.HttpError) {
                emit("http", JSONObject().put("id", id).put("ok", false).put("status", e.code).put("error", "HTTP ${e.code}"))
            } catch (e: Exception) {
                emit("http", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: e.javaClass.simpleName))
            }
        }
    }

    @JavascriptInterface
    fun take(id: Int): String? = bodies.remove(id)

    /** Streams a big Xtream list into a compact cache file; the body is then read with cacheRead(key). */
    @JavascriptInterface
    fun catalog(id: Int, url: String, kind: String, key: String) {
        io.execute {
            try {
                val n = Catalog.fetch(url, kind, file(key))
                emit("catalog", JSONObject().put("id", id).put("ok", true).put("count", n))
            } catch (e: Exception) {
                emit("catalog", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Download failed"))
            }
        }
    }

    // ---------- programme guide (SQLite, see EpgStore) ----------
    @JavascriptInterface
    fun epgImport(id: Int, url: String, from: Double, to: Double, idsCsv: String) {
        io.execute {
            try {
                val wanted = if (idsCsv.isBlank()) null else idsCsv.split(',').filter { it.isNotEmpty() }.toHashSet()
                val (c, stream) = Net.open(url, 180000)
                val n = try {
                    stream.use { act.epg.import(it, from.toLong(), to.toLong(), wanted) { done ->
                        emit("epg", JSONObject().put("state", "importing").put("count", done))
                    } }
                } finally { c.disconnect() }
                emit("epg", JSONObject().put("id", id).put("state", "ready").put("ok", true).put("count", n))
            } catch (e: Exception) {
                emit("epg", JSONObject().put("id", id).put("state", "error").put("ok", false).put("error", e.message ?: "Guide download failed"))
            }
        }
    }

    @JavascriptInterface
    fun epgInfo(): String = JSONObject().put("importedAt", act.epg.importedAt()).put("count", act.epg.count()).put("importing", act.epg.importing).toString()

    private fun ids(csv: String) = csv.split(',').filter { it.isNotEmpty() }.take(200)

    @JavascriptInterface
    fun epgNow(id: Int, idsCsv: String, at: Double) {
        io.execute {
            try { bodies[id] = act.epg.nowNext(ids(idsCsv), at.toLong()).toString(); emit("call", JSONObject().put("id", id).put("ok", true)) }
            catch (e: Exception) { emit("call", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Guide error")) }
        }
    }

    @JavascriptInterface
    fun epgRange(id: Int, idsCsv: String, from: Double, to: Double) {
        io.execute {
            try { bodies[id] = act.epg.range(ids(idsCsv), from.toLong(), to.toLong()).toString(); emit("call", JSONObject().put("id", id).put("ok", true)) }
            catch (e: Exception) { emit("call", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Guide error")) }
        }
    }

    @JavascriptInterface
    fun epgSearch(id: Int, q: String, from: Double, to: Double, limit: Int) {
        io.execute {
            try { bodies[id] = act.epg.search(q, from.toLong(), to.toLong(), limit.coerceIn(1, 200)).toString(); emit("call", JSONObject().put("id", id).put("ok", true)) }
            catch (e: Exception) { emit("call", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Guide error")) }
        }
    }

    // ---------- cache (catalogue, guide, settings) ----------
    private fun file(key: String) = File(dir, key.replace(Regex("[^A-Za-z0-9._-]"), "_"))

    @JavascriptInterface
    fun cacheRead(key: String): String? {
        val f = file(key)
        return if (f.exists()) f.readText() else null
    }

    @JavascriptInterface
    fun cacheWrite(key: String, text: String) = write(key, text)

    private fun write(key: String, text: String) {
        val f = file(key)
        val tmp = File(f.path + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    // ---------- voice ----------
    @JavascriptInterface
    fun voiceStart() = ui {
        if (Build.VERSION.SDK_INT >= 23 &&
            act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            act.pendingVoice = true
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MainActivity.REQ_MIC)
            return@ui
        }
        startListening()
    }

    fun startListening() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        if (!SpeechRecognizer.isRecognitionAvailable(act)) {
            // Some TVs only offer the system voice dialog.
            if (intent.resolveActivity(act.packageManager) != null) {
                act.startActivityForResult(intent, MainActivity.REQ_VOICE)
            } else {
                emit("voice", JSONObject().put("state", "error").put("text", "Voice input isn’t available on this device"))
            }
            return
        }
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(act)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { emit("voice", JSONObject().put("state", "listening")) }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onError(error: Int) {
                val msg = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_match"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                    else -> "error_$error"
                }
                emit("voice", JSONObject().put("state", "error").put("text", msg))
            }
            override fun onPartialResults(partial: Bundle?) {
                val t = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!t.isNullOrBlank()) emit("voice", JSONObject().put("state", "partial").put("text", t))
            }
            override fun onResults(results: Bundle?) {
                val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (t.isNullOrBlank()) emit("voice", JSONObject().put("state", "error").put("text", "no_match"))
                else emit("voice", JSONObject().put("state", "final").put("text", t))
            }
        })
        r.startListening(intent)
    }

    @JavascriptInterface
    fun voiceStop() = ui { recognizer?.cancel() }

    fun onVoiceResult(text: String?) {
        if (text.isNullOrBlank()) emit("voice", JSONObject().put("state", "error").put("text", "no_match"))
        else emit("voice", JSONObject().put("state", "final").put("text", text))
    }

    fun onMicDenied() {
        emit("voice", JSONObject().put("state", "error").put("text", "Allow microphone access to search by voice"))
    }

    // ---------- player ----------
    @JavascriptInterface
    fun play(url: String, opts: String) = ui { act.player.play(url, JSONObject(opts)) }

    @JavascriptInterface
    fun stop() = ui { act.player.stop() }

    @JavascriptInterface
    fun pause() = ui { act.player.pause(true) }

    @JavascriptInterface
    fun resume() = ui { act.player.pause(false) }

    @JavascriptInterface
    fun seekBy(ms: Double) = ui { act.player.seekBy(ms.toLong()) }

    @JavascriptInterface
    fun seekTo(ms: Double) = ui { act.player.seekTo(ms.toLong()) }

    @JavascriptInterface
    fun setRect(json: String) = ui { act.player.setRect(if (json == "null" || json.isBlank()) null else JSONObject(json)) }

    @JavascriptInterface
    fun setResize(mode: String) = ui { act.player.setResize(mode) }

    @JavascriptInterface
    fun setBuffer(ms: Int) = ui { act.player.setBuffer(ms) }

    // ---------- other apps: download managers and external players ----------
    private val known = listOf(
        "com.dv.adm" to ("ADM" to "download"), "com.dv.adm.pay" to ("ADM Pro" to "download"),
        "idm.internet.download.manager" to ("1DM" to "download"), "idm.internet.download.manager.plus" to ("1DM+" to "download"),
        "idm.internet.download.manager.adm.lite" to ("1DM Lite" to "download"),
        "org.videolan.vlc" to ("VLC" to "player"), "com.mxtech.videoplayer.ad" to ("MX Player" to "player"),
        "com.mxtech.videoplayer.pro" to ("MX Player Pro" to "player"), "com.brouken.player" to ("Just Player" to "player"),
    )

    @JavascriptInterface
    fun apps(): String {
        val pm = act.packageManager
        val out = org.json.JSONArray()
        for ((pkg, info) in known) {
            val installed = try { pm.getPackageInfo(pkg, 0); true } catch (e: PackageManager.NameNotFoundException) { false }
            if (installed) out.put(JSONObject().put("pkg", pkg).put("name", info.first).put("role", info.second))
        }
        return out.toString()
    }

    /** Hands a link to another app. pkg "" shows Android's app chooser. */
    @JavascriptInterface
    fun openWith(pkg: String, url: String, optsJson: String): Boolean {
        val o = JSONObject(optsJson)
        val title = o.optString("title"); val file = o.optString("file")
        val download = o.optString("mode") == "download"
        val pos = o.optLong("position", 0)
        val uri = Uri.parse(url)
        val pm = act.packageManager
        fun base(type: String?): Intent = Intent(Intent.ACTION_VIEW).apply {
            if (type != null) setDataAndType(uri, type) else data = uri
            if (pkg.isNotEmpty()) setPackage(pkg)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("title", title)
            putExtra(Intent.EXTRA_TITLE, title)
            if (download) {
                putExtra("filename", file)
                putExtra("android.intent.extra.FILENAME", file)
            } else {
                if (pkg.startsWith("org.videolan")) putExtra("position", pos) else putExtra("position", pos.toInt())
                putExtra("from_start", pos == 0L)
                putExtra("secure_uri", true)
            }
        }
        // Download managers register for plain links; players for video types. Try both, then share as text.
        val candidates = if (download) listOf(base(null), base("video/*"), base("application/octet-stream"))
                         else listOf(base("video/*"), base(null))
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url); putExtra(Intent.EXTRA_SUBJECT, file.ifEmpty { title })
            if (pkg.isNotEmpty()) setPackage(pkg); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val intent = (candidates + send).firstOrNull { it.resolveActivity(pm) != null } ?: return false
        return try {
            act.runOnUiThread {
                try {
                    if (pkg.isEmpty()) act.startActivity(Intent.createChooser(intent, if (download) "Download with" else "Play with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    else act.startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    emit("toast", JSONObject().put("text", "That app couldn\u2019t open the link"))
                }
            }
            true
        } catch (e: Exception) { false }
    }

    @JavascriptInterface
    fun copy(text: String) = ui {
        val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Lumen link", text))
    }

    @JavascriptInterface
    fun openUrl(url: String) = ui {
        try { act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e: ActivityNotFoundException) { emit("toast", JSONObject().put("text", "No app on this TV can open that link")) }
    }

    @JavascriptInterface
    fun head(id: Int, url: String) {
        io.execute {
            try {
                val (size, type) = Net.head(url)
                emit("head", JSONObject().put("id", id).put("ok", true).put("size", size).put("type", type))
            } catch (e: Exception) {
                emit("head", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Couldn\u2019t reach the file"))
            }
        }
    }

    /** JSON API request; the body is collected with take(id). */
    @JavascriptInterface
    fun call(id: Int, method: String, url: String, headersJson: String, body: String) {
        io.execute {
            try {
                val h = JSONObject(headersJson)
                val map = h.keys().asSequence().associateWith { h.getString(it) }
                bodies[id] = Net.request(method, url, map, body)
                emit("call", JSONObject().put("id", id).put("ok", true))
            } catch (e: Exception) {
                emit("call", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Request failed"))
            }
        }
    }

    // ---------- subtitles and tracks ----------
    @JavascriptInterface
    fun subtitleHash(id: Int, url: String) {
        io.execute {
            val r = try { Net.subtitleHash(url) } catch (e: Exception) { null }
            emit("head", JSONObject().put("id", id).put("ok", true).put("hash", r?.first ?: "").put("size", r?.second ?: 0))
        }
    }

    @JavascriptInterface
    fun loadSubtitle(url: String, lang: String, name: String) {
        io.execute {
            try {
                val dir = File(act.cacheDir, "subs").apply { mkdirs() }
                dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3 * 86400000L }?.forEach { it.delete() }
                val ext = Regex("\\.(srt|vtt|ass|ssa)(\\?|$)", RegexOption.IGNORE_CASE).find(url)?.groupValues?.get(1)?.lowercase() ?: "srt"
                val f = File(dir, "${System.currentTimeMillis()}.$ext")
                Net.download(url, f)
                ui { act.player.addSubtitle(f, lang, name) }
            } catch (e: Exception) {
                emit("toast", JSONObject().put("text", "Couldn\u2019t download the subtitles"))
            }
        }
    }

    @JavascriptInterface
    fun tracks(): String {
        val result = java.util.concurrent.atomic.AtomicReference("{\"audio\":[],\"text\":[]}")
        val latch = java.util.concurrent.CountDownLatch(1)
        act.runOnUiThread { try { result.set(act.player.tracks()) } finally { latch.countDown() } }
        latch.await(1, java.util.concurrent.TimeUnit.SECONDS)
        return result.get()
    }

    @JavascriptInterface
    fun selectTrack(type: String, id: String) = ui { act.player.selectTrack(type, id) }

    @JavascriptInterface
    fun setSpeed(x: Double) = ui { act.player.setSpeed(x.toFloat()) }

    // ---------- phone remote and keyboard ----------
    @JavascriptInterface
    fun companion(): String {
        val s = act.server
        val url = s.url() ?: return "null"
        return JSONObject().put("url", url).put("pin", s.pin).toString()
    }

    /** Native search box: the TV keyboard opens, and holding the remote's mic button dictates into it. */
    @JavascriptInterface
    fun textInput(title: String, hint: String, initial: String) = ui {
        act.textEntry.show(title, hint, initial) { text ->
            emit("textinput", JSONObject().put("text", text ?: JSONObject.NULL))
        }
    }

    /** Opens the TV's on-screen keyboard (on Fire TV, holding the Alexa button there dictates text). */
    @JavascriptInterface
    fun showKeyboard() = ui {
        act.webView.requestFocus()
        act.webView.postDelayed({
            val imm = act.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(act.webView, InputMethodManager.SHOW_IMPLICIT)
        }, 150)
    }

    // ---------- self update ----------
    @JavascriptInterface
    fun installUpdate(url: String) { act.updater.install(url) { e, d -> emit(e, d) } }

    fun release() {
        recognizer?.destroy()
        io.shutdownNow()
    }
}
