package tv.lumen.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.app.Dialog
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Methods the web UI calls as window.Native.*  (see web/src/native.js).
 * Calls arrive on a WebView binder thread; anything touching views is posted to the UI thread.
 */
class NativeBridge(private val act: MainActivity) {

    private val io = Executors.newFixedThreadPool(6)   // channels, films and series download side by side
    private val artworkIo = Executors.newFixedThreadPool(3) // never block catalogue/search calls behind posters
    private val bodies = ConcurrentHashMap<Int, String>()
    private val dir: File = File(act.filesDir, "cache").apply { mkdirs() }
    private var externalTorrent = false
    private var recognizer: SpeechRecognizer? = null
    private var pendingSubtitle: Triple<String, String, String>? = null
    private var subtitleDialog: Dialog? = null

    private fun emit(evt: String, data: JSONObject) = act.emit(evt, data)
    private fun ui(block: () -> Unit) = act.runOnUiThread(block)

    @JavascriptInterface
    fun artwork(id: Int, url: String, width: Int) {
        artworkIo.execute {
            try {
                require(url.startsWith("https://") || url.startsWith("http://"))
                val response = act.thumbs.serve(url, width)
                check(response.statusCode == 200) { "Image unavailable" }
                val bytes = response.data.use { it.readBytes() }
                check(bytes.isNotEmpty()) { "Empty image" }
                bodies[id] = "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                emit("artwork", JSONObject().put("id", id).put("ok", true))
            } catch (e: Exception) {
                emit("artwork", JSONObject().put("id", id).put("ok", false).put("error", "Image could not be loaded"))
            }
        }
    }

    // The torrent engine is lazy and does not run during normal IPTV browsing.
    @JavascriptInterface
    fun torrentPrepare(id:Int,magnet:String) {
        if(Build.VERSION.SDK_INT<24) { emit("call",JSONObject().put("id",id).put("ok",false).put("error","Local torrent playback needs Android 7 / Fire OS 6 or newer"));return }
        ui {
            try {
                val service=Intent(act,TorrentPlaybackService::class.java)
                if(Build.VERSION.SDK_INT>=26)act.startForegroundService(service)else act.startService(service)
                TorrentRuntime.prepare(act,magnet,{message->emit("torrentProgress",JSONObject().put("id",id).put("message",message))}){result,error->torrentReply(id,result,error)}
            }catch(e:Exception){torrentReply(id,null,e.message?:"Could not start torrent playback")}
        }
    }
    @JavascriptInterface
    fun torrentStart(id:Int,hash:String,file:Int) = TorrentRuntime.start(act,hash,file,{message->emit("torrentProgress",JSONObject().put("id",id).put("message",message))}){result,error->torrentReply(id,result,error)}
    @JavascriptInterface
    fun torrentCancel() = TorrentRuntime.stop(act)
    private fun torrentReply(id:Int,result:JSONObject?,error:String?) {
        if(result!=null)bodies[id]=result.toString()
        emit("call",JSONObject().put("id",id).put("ok",result!=null).put("error",error?:""))
    }

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
            .put("abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
            .put("recovered", act.recovered)
            .put("canInstall", act.updater.canInstall())
            .put("downloader", try { pm.getPackageInfo(Updater.DOWNLOADER, 0); true } catch (e: Exception) { false })
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
    fun play(url: String, opts: String) = ui { act.recovered = false; act.player.play(url, JSONObject(opts)) }

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
        val magnet = o.optString("mode") == "magnet"
        val pos = o.optLong("position", 0)
        val uri = Uri.parse(url)
        val subtitleUri = o.optString("subtitle").takeIf { it.isNotBlank() }?.let { Uri.parse(it) }
            ?.takeIf { it.scheme == "content" && it.authority == "${act.packageName}.files" }
        val pm = act.packageManager
        fun base(type: String?): Intent = Intent(Intent.ACTION_VIEW).apply {
            if (type != null) setDataAndType(uri, type) else data = uri
            if (pkg.isNotEmpty()) setPackage(pkg)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("title", title)
            putExtra(Intent.EXTRA_TITLE, title)
            if (!download && subtitleUri != null) {
                // ClipData grants the receiver access to this cache file even though the
                // video itself is a remote URL in Intent.data.
                clipData = ClipData.newUri(act.contentResolver, "Lumen subtitles", subtitleUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                putExtra("subtitles_location", subtitleUri.toString()) // VLC
                putExtra("subs", arrayOf(subtitleUri))                 // MX Player
                putExtra("subs.name", arrayOf("Lumen subtitles"))
                putExtra("subs.filename", arrayOf("Lumen.srt"))
                putExtra("subs.enable", arrayOf(subtitleUri))
                putExtra("subtitle_uri", arrayOf(subtitleUri))         // Just Player
                putExtra("subtitle_name", arrayOf("Lumen subtitles"))
            }
            if (download) {
                putExtra("filename", file)
                putExtra("android.intent.extra.FILENAME", file)
            } else {
                if (pkg.startsWith("org.videolan")) putExtra("position", pos) else putExtra("position", pos.toInt())
                putExtra("from_start", pos == 0L)
                putExtra("secure_uri", true)
                if (pkg.startsWith("com.mxtech")) putExtra("video_zoom", 1)      // MX Player: fit inside the screen
                if (pkg.startsWith("org.videolan")) putExtra("from_start", pos == 0L)
            }
        }
        // Download managers register for plain links; players for video types. Try both, then share as text.
        val directVlc = if((o.optBoolean("torrent") || subtitleUri != null) &&
            !download && !magnet && pkg=="org.videolan.vlc") {
            val video=base("video/*").setClassName(pkg,"org.videolan.vlc.gui.video.VideoPlayerActivity")
                .putExtra("from_external",true)
            if (subtitleUri != null) {
                video.action = "org.videolan.vlc.gui.video.PLAY_FROM_VIDEOGRID"
                video.putExtra("item_location", uri)
                video.putExtra("item_title", title)
            }
            try { if(pm.getActivityInfo(video.component!!,0).exported) listOf(video) else emptyList() } catch(_:PackageManager.NameNotFoundException){emptyList()}
        }else emptyList()
        val candidates = directVlc + (if (magnet) listOf(base(null), base("application/x-bittorrent")) else if (download) listOf(base(null), base("video/*"), base("application/octet-stream"))
                         else listOf(base("video/*"), base(null)))
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url); putExtra(Intent.EXTRA_SUBJECT, file.ifEmpty { title })
            if (pkg.isNotEmpty()) setPackage(pkg); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val intent = (if (magnet) candidates else candidates + send).firstOrNull { it.resolveActivity(pm) != null } ?: return false
        return try {
            act.runOnUiThread {
                try {
                    if (magnet) act.startActivity(intent)
                    else if (pkg.isEmpty()) act.startActivity(Intent.createChooser(intent, if (download) "Download with" else "Play with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    else if (!download && intent.action == Intent.ACTION_VIEW) {
                        // Players report where you stopped when they close (VLC: extra_position, MX: position),
                        // so Continue watching works with them too. That needs a result, so no new task.
                        intent.flags = intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK.inv()
                        intent.putExtra("return_result", true)
                        externalTorrent = TorrentRuntime.current?.owns(url) == true
                        act.startActivityForResult(intent, MainActivity.REQ_EXT)
                    }
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
    fun onSubtitleImportResult(uri: Uri?) {
        val request = pendingSubtitle ?: return
        pendingSubtitle = null
        if (uri == null) return
        io.execute {
            val file = File(File(act.cacheDir, "subs").apply { mkdirs() }, "imported-${System.currentTimeMillis()}.srt")
            try {
                val input = act.contentResolver.openInputStream(uri) ?: error("Could not read the selected subtitle")
                input.use { source ->
                    file.outputStream().use { dest ->
                        val buffer = ByteArray(8192)
                        var size = 0
                        while (true) {
                            val count = source.read(buffer)
                            if (count < 0) break
                            size += count
                            require(size <= 5_000_000) { "The subtitle is too large" }
                            dest.write(buffer, 0, count)
                        }
                    }
                }
                val first = file.inputStream().bufferedReader().use { reader ->
                    (1..3).joinToString("\n") { reader.readLine().orEmpty() }
                }
                require(Regex("\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}").containsMatchIn(first)) {
                    "Choose a valid .srt subtitle file"
                }
                val content = FileProvider.getUriForFile(act, "${act.packageName}.files", file)
                ui {
                    subtitleDialog?.dismiss()
                    subtitleDialog = null
                    openWith(request.second, request.first, JSONObject().put("title", request.third)
                        .put("subtitle", content.toString()).toString())
                }
            } catch (e: Exception) {
                file.delete()
                emit("toast", JSONObject().put("text", e.message ?: "Could not import the subtitle"))
            }
        }
    }

    /**
     * SubtitleCat's Translate button runs in a browser. Keep that browser in our
     * process so a user-initiated SRT download can be handed to VLC/MX immediately.
     * An external download manager cannot report its private download to us.
     */
    @JavascriptInterface
    fun openSubtitleCat(searchUrl: String, videoUrl: String, playerPkg: String, title: String): Boolean {
        val site = Uri.parse(searchUrl)
        if (site.scheme != "https" || site.host !in listOf("subtitlecat.com", "www.subtitlecat.com") ||
            videoUrl.let { !it.startsWith("https://") && !it.startsWith("http://") } || playerPkg !in listOf(
                "org.videolan.vlc", "com.mxtech.videoplayer.ad", "com.mxtech.videoplayer.pro", "com.brouken.player"
            )) return false
        ui {
            val dialog = Dialog(act, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            val root = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(12, 16, 28)) }
            val bar = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }
            val status = TextView(act).apply {
                text = "SubtitleCat · choose the matching subtitle, then Malayalam → Translate → Download"
                setTextColor(Color.WHITE); textSize = 16f; setPadding(20, 12, 16, 12)
            }
            val browser = WebView(act).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.setSupportMultipleWindows(false)
                setBackgroundColor(Color.WHITE)
            }
            var downloading = false
            fun downloadSrt(url: String) {
                val u = Uri.parse(url)
                if (u.scheme != "https" || u.host !in listOf("subtitlecat.com", "www.subtitlecat.com") ||
                    !u.path.orEmpty().endsWith(".srt", ignoreCase = true)) {
                    status.text = "Choose a Malayalam .srt download on SubtitleCat."
                    return
                }
                if (downloading) return
                downloading = true
                status.text = "Downloading Malayalam subtitles…"
                val cookies = CookieManager.getInstance().getCookie(url)
                val headers = mapOf("Referer" to browser.url.orEmpty(), "User-Agent" to browser.settings.userAgentString) +
                    (if (cookies.isNullOrBlank()) emptyMap() else mapOf("Cookie" to cookies))
                io.execute {
                    val file = File(File(act.cacheDir, "subs").apply { mkdirs() }, "subtitlecat-${System.currentTimeMillis()}.srt")
                    try {
                        Net.download(url, file, headers)
                        require(file.length() in 20..5_000_000) { "The subtitle file is empty or too large" }
                        val beginning = file.inputStream().bufferedReader().use { it.readLine().orEmpty() + "\n" + it.readLine().orEmpty() + "\n" + it.readLine().orEmpty() }
                        require(Regex("\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}").containsMatchIn(beginning)) {
                            "The download was not an SRT subtitle"
                        }
                        val content = FileProvider.getUriForFile(act, "${act.packageName}.files", file)
                        ui {
                            dialog.dismiss()
                            if (!openWith(playerPkg, videoUrl, JSONObject().put("title", title)
                                    .put("subtitle", content.toString()).toString())) {
                                emit("toast", JSONObject().put("text", "The selected player could not open the subtitle"))
                            }
                        }
                    } catch (e: Exception) {
                        file.delete()
                        ui { downloading = false; status.text = e.message ?: "Subtitle download failed. Try again." }
                    }
                }
            }
            browser.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    if (request.url.path.orEmpty().endsWith(".srt", ignoreCase = true)) { downloadSrt(url); return true }
                    return request.url.scheme !in listOf("https", "http")
                }
                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    if (Uri.parse(url).path.orEmpty().endsWith(".srt", ignoreCase = true)) { downloadSrt(url); return true }
                    return Uri.parse(url).scheme !in listOf("https", "http")
                }
            }
            browser.webChromeClient = WebChromeClient()
            browser.setDownloadListener { url, _, _, _, _ -> downloadSrt(url) }
            fun button(label: String, action: () -> Unit) = Button(act).apply {
                text = label; textSize = 15f; setTextColor(Color.WHITE)
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(31, 48, 73))
                setOnClickListener { action() }; isFocusable = true
            }
            bar.addView(button("Back") { if (browser.canGoBack()) browser.goBack() else dialog.dismiss() })
            bar.addView(button("Open in Downloader") {
                val pm = act.packageManager
                val pkg = "com.esaba.downloader"
                val installed = try { pm.getPackageInfo(pkg, 0); true } catch (_: Exception) { false }
                if (!installed) status.text = "Downloader is not installed. Use this browser for automatic playback."
                else try {
                    act.startActivity(Intent(Intent.ACTION_VIEW, site).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(pkg))
                    status.text = "Downloader cannot return its saved file automatically. Use this browser for automatic playback."
                } catch (_: Exception) { status.text = "Downloader could not open this page. Use this browser instead." }
            })
            bar.addView(button("Use downloaded SRT") {
                try {
                    pendingSubtitle = Triple(videoUrl, playerPkg, title)
                    act.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/x-subrip", "text/plain", "application/octet-stream"))
                    }, MainActivity.REQ_SUBTITLE)
                    status.text = "Select the Malayalam .srt saved by Downloader."
                } catch (_: Exception) {
                    pendingSubtitle = null
                    status.text = "This Fire TV cannot open a subtitle file picker. Use this browser for automatic playback."
                }
            })
            bar.addView(button("Close") { dialog.dismiss() })
            root.addView(bar)
            root.addView(status)
            root.addView(browser, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            dialog.setContentView(root)
            subtitleDialog = dialog
            dialog.setOnDismissListener {
                if (subtitleDialog === dialog) subtitleDialog = null
                browser.stopLoading(); root.removeView(browser); browser.destroy()
            }
            dialog.show()
            dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            browser.loadUrl(searchUrl)
            browser.requestFocus()
        }
        return true
    }

    @JavascriptInterface
    fun prepareSubtitle(id: Int, url: String) {
        io.execute {
            try {
                require(url.startsWith("https://")) { "Invalid subtitle link" }
                val dir = File(act.cacheDir, "subs").apply { mkdirs() }
                dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3 * 86400000L }?.forEach { it.delete() }
                val ext = Regex("\\.(srt|vtt)(\\?|$)", RegexOption.IGNORE_CASE).find(url)?.groupValues?.get(1)?.lowercase() ?: "srt"
                val file = File(dir, "external-${System.currentTimeMillis()}-$id.$ext")
                try {
                    Net.download(url, file)
                    require(file.length() in 1..5_000_000) { "Subtitle file is empty or too large" }
                    bodies[id] = FileProvider.getUriForFile(act, "${act.packageName}.files", file).toString()
                    emit("call", JSONObject().put("id", id).put("ok", true))
                } catch (e: Exception) { file.delete(); throw e }
            } catch (e: Exception) {
                emit("call", JSONObject().put("id", id).put("ok", false).put("error", e.message ?: "Subtitle download failed"))
            }
        }
    }

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
        try {
            act.startActivityForResult(Intent(act, SearchActivity::class.java)
                .putExtra(SearchActivity.EXTRA_TITLE, title).putExtra(SearchActivity.EXTRA_HINT, hint)
                .putExtra(SearchActivity.EXTRA_INITIAL, initial), MainActivity.REQ_TEXT)
        } catch (e: Exception) {
            emit("textinput", JSONObject().put("text", JSONObject.NULL))
        }
    }

    fun onPlayerResult(data: Intent?) {
        val x = data?.extras
        // VLC is singleTask; Android can return an empty cancellation while its
        // real player is still opening. Only a documented player result can end
        // a local stream. Idle cleanup/Stop still handles players with no result.
        if(externalTorrent && data?.action!="org.videolan.vlc.player.result" && x?.containsKey("end_by")!=true) return
        var pos = -1L; var dur = 0L
        if (x != null) {
            pos = when {
                x.containsKey("extra_position") -> x.getLong("extra_position", -1)           // VLC
                x.containsKey("position") -> (x.get("position") as? Number)?.toLong() ?: -1  // MX Player, Just Player
                else -> -1
            }
            dur = when {
                x.containsKey("extra_duration") -> x.getLong("extra_duration", 0)
                x.containsKey("duration") -> (x.get("duration") as? Number)?.toLong() ?: 0
                else -> 0
            }
        }
        val done = x?.getString("end_by") == "playback_completion"
        if(externalTorrent) { externalTorrent=false;TorrentRuntime.stop(act) }
        emit("extplayer", JSONObject().put("pos", pos).put("dur", dur).put("done", done))
    }

    fun onTextResult(text: String?) { emit("textinput", JSONObject().put("text", text ?: JSONObject.NULL)) }

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
    fun installUpdate(url: String) { act.updater.install(url, "auto") { e, d -> emit(e, d) } }

    @JavascriptInterface
    fun installUpdateWith(url: String, mode: String) { act.updater.install(url, mode) { e, d -> emit(e, d) } }

    fun release() {
        recognizer?.destroy()
        io.shutdownNow()
        artworkIo.shutdownNow()
    }
}
